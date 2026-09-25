# Treasury feed: Kafka contract

The treasury system is the system of record for programs and their credit limits. It
publishes to one topic; this service consumes it and applies every message through the
same application layer the HTTP API uses.

| Item     | Value                                                                                       |
| -------- | ------------------------------------------------------------------------------------------- |
| Topic    | `treasury.program-capacity.v1` (version in the name; breaking changes get a new topic)      |
| Key      | `programId` (UTF-8). Guarantees per-program ordering within a partition.                    |
| Value    | JSON, UTF-8. Amounts are decimal **strings**, never numbers.                                |
| Delivery | At least once. Every message is idempotent under the sequence guard below.                  |
| Consumer | Group `KAFKA_GROUP_ID`; a group with no committed offset reads from the beginning.          |
| Failures | Copied to `treasury.program-capacity.v1.dlq` (see [Dead-letter topic](#dead-letter-topic)). |

## Envelope

Every message carries these fields at the top level.

| Field         | Type            | Meaning                                                                  |
| ------------- | --------------- | ------------------------------------------------------------------------ |
| `type`        | string          | `ProgramLimitChanged` or `ProgramReconciled`.                            |
| `programId`   | string          | 1 to 64 characters of `[A-Za-z0-9._-]`. Must equal the message key.      |
| `sequence`    | integer >= 0    | Per-program, strictly increasing across both message types.              |
| `occurredAt`  | ISO 8601 string | When the state became true in treasury. For snapshots, the "as of" time. |
| `currency`    | string          | ISO 4217 code of the program. A program never changes currency.          |
| `creditLimit` | decimal string  | Total credit limit in program currency, e.g. `"10000000.00"`.            |

## `ProgramLimitChanged`

The credit limit changed. It also announces programs this service has not seen: an unknown
`programId` is created with the given currency and limit.

```json
{
  "type": "ProgramLimitChanged",
  "programId": "PRG-001",
  "sequence": 12,
  "occurredAt": "2026-09-19T10:15:00Z",
  "currency": "USD",
  "creditLimit": "10000000.00"
}
```

A limit below what is currently reserved is accepted. The program then reports
`available = 0.00` and `overCommitted = true` until releases catch up.

## `ProgramReconciled`

Periodic full-state snapshot. `activeReservations` is the complete set of reservations
treasury considers active at `occurredAt`; anything missing from it is considered released.

```json
{
  "type": "ProgramReconciled",
  "programId": "PRG-001",
  "sequence": 13,
  "occurredAt": "2026-09-19T11:00:00Z",
  "currency": "USD",
  "creditLimit": "10000000.00",
  "activeReservations": [
    {
      "invoiceId": "INV-2026-0001",
      "invoiceAmount": "250000.00",
      "invoiceCurrency": "EUR",
      "reservedAmount": "271250.00"
    }
  ]
}
```

| Field             | Type           | Meaning                                                                                                |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `invoiceId`       | string         | Reservation identity within the program.                                                               |
| `invoiceAmount`   | decimal string | Invoice face amount in `invoiceCurrency`.                                                              |
| `invoiceCurrency` | string         | ISO 4217 code.                                                                                         |
| `reservedAmount`  | decimal string | Capacity consumed, **in program currency**. Treasury's figure is taken as is; nothing is re-converted. |

### How a snapshot is applied

Treasury wins for everything it knew at `occurredAt`. Changes this service made after that
instant are newer facts and are kept; the next snapshot confirms or corrects them.

| Situation                                                                             | Result                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------- |
| Reservation in snapshot, unknown locally                                              | Added as active (no exchange rate recorded). |
| Reservation in snapshot, local copy active with equal amounts                         | Unchanged.                                   |
| Reservation in snapshot, local copy differs (amounts or released before `occurredAt`) | Overwritten with treasury's amounts, active. |
| Local active reservation absent from snapshot                                         | Released as of `occurredAt`.                 |
| Local reservation created or released **after** `occurredAt`                          | Preserved untouched.                         |
| Local reservation already released before `occurredAt`, absent from snapshot          | Kept as history.                             |

The credit limit is set from the snapshot, the reserved total is recomputed from the
resulting active reservations, and `lastReconciledAt` is set to `occurredAt`.

## What the consumer does with each message

| Outcome           | When                                                                                                                                                                                                            | Offset        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| APPLIED / CREATED | Valid message with `sequence` greater than the last applied one.                                                                                                                                                | Committed     |
| STALE             | `sequence` at or below the last applied sequence for the program (duplicate or out of order). Logged, nothing changes.                                                                                          | Committed     |
| Retried           | Any failure that is not poison (store unavailable, optimistic lock lost to API traffic, an unclassified error). Retried in place after 0.5 s, 1 s, 2 s, ... (`KAFKA_RETRY_BACKOFF_MS`, doubling, at most 10 s). | Not yet       |
| Dead-lettered     | Poison message (fails validation, unsupported currency, currency differs from the program's, malformed snapshot), at once; or any other failure after `KAFKA_MAX_ATTEMPTS` attempts. Logged at ERROR.           | Committed     |
| Redelivered       | The dead-letter topic cannot take the message, or the consumer lost the partition (rebalance, shutdown) while retrying. Nothing is skipped; kafkajs delivers it again.                                          | Not committed |

Retries happen inside the consumer, so the partition waits for them and a program's messages
are never applied out of order. After a message is dead-lettered the partition moves on; a
later message for the same program has a higher `sequence` and supersedes it.

## Dead-letter topic

`treasury.program-capacity.v1.dlq`, provisioned with the same partition count as the source
topic. Each record is the original message, its key, value and headers byte for byte as
delivered (a repeated header stays repeated), plus:

| Header                 | Meaning                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `dlq-reason`           | `POISON` (can never succeed) or `RETRIES_EXHAUSTED` (kept failing).                          |
| `dlq-attempts`         | How many times the message was processed before giving up.                                   |
| `dlq-error`            | The last error, as logged (at most 1,000 characters).                                        |
| `dlq-source-topic`     | Topic the message was read from.                                                             |
| `dlq-source-partition` | Its partition.                                                                               |
| `dlq-source-offset`    | Its offset: together with topic and partition, the way to find it again.                     |
| `dlq-consumer-group`   | The consumer group that gave up on it: `KAFKA_GROUP_ID` plus the `-server` suffix Nest adds. |

Nothing consumes this topic automatically. Once the cause is fixed, a message is replayed by
producing its key and value back onto `treasury.program-capacity.v1`; if newer messages for
the program have been applied in the meantime, the replay is logged as `STALE` and changes
nothing, which is the intended result. A consumer group that replays the source topic from
the beginning dead-letters the same poison messages again; `dlq-consumer-group` and
`dlq-source-offset` tell the copies apart.

## Guidance for producers

- Publish with the program id as the key and keep one producer per program stream, so
  `sequence` and partition order agree.
- Never send floats. Serialize amounts as strings with at most the currency's minor-unit
  digits (`"10.50"`, `"1000"` for JPY).
- Send a `ProgramReconciled` snapshot at least on a schedule and after any repair in
  treasury; it is the mechanism that heals drift.
