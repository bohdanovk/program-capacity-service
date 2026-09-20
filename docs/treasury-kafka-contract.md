# Treasury feed: Kafka contract

The treasury system is the system of record for programs and their credit limits. It
publishes to one topic; this service consumes it and applies every message through the
same application layer the HTTP API uses.

| Item     | Value                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| Topic    | `treasury.program-capacity.v1` (version in the name; breaking changes get a new topic) |
| Key      | `programId` (UTF-8). Guarantees per-program ordering within a partition.               |
| Value    | JSON, UTF-8. Amounts are decimal **strings**, never numbers.                           |
| Delivery | At least once. Every message is idempotent under the sequence guard below.             |
| Consumer | Group `KAFKA_GROUP_ID`; a group with no committed offset reads from the beginning.     |

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

| Outcome           | When                                                                                                                                                                                                    | Offset        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| APPLIED / CREATED | Valid message with `sequence` greater than the last applied one.                                                                                                                                        | Committed     |
| STALE             | `sequence` at or below the last applied sequence for the program (duplicate or out of order). Logged, nothing changes.                                                                                  | Committed     |
| Dropped           | Poison message: fails validation, unsupported currency, currency differs from the program's, malformed snapshot (duplicate invoice, non-positive amount). Logged with topic, partition, offset and key. | Committed     |
| Redelivered       | Transient failure (store unavailable, optimistic lock lost to API traffic after retries). Error rethrown; kafkajs retries with back-off.                                                                | Not committed |

## Guidance for producers

- Publish with the program id as the key and keep one producer per program stream, so
  `sequence` and partition order agree.
- Never send floats. Serialize amounts as strings with at most the currency's minor-unit
  digits (`"10.50"`, `"1000"` for JPY).
- Send a `ProgramReconciled` snapshot at least on a schedule and after any repair in
  treasury; it is the mechanism that heals drift.
