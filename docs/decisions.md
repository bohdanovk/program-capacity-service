# Decisions and trade-offs

Short records of the choices that shape this service, with the reasoning, so a reviewer
does not have to reverse-engineer intent from code.

## 1. Money is an integer count of minor units (bigint)

Amounts never touch floating point. `Money` holds a `bigint` of minor units plus a
currency whose exponent comes from ISO 4217 (USD 2, JPY 0, KWD 3). Input is parsed from
decimal strings and rejected, not rounded, when it carries more fraction digits than the
currency allows. JSON carries amounts as strings for the same reason. No decimal library
is needed: the arithmetic here is addition, subtraction and one exact rational
conversion, which `bigint` does natively and verifiably.

## 2. FX conversion rounds away from zero

An invoice in a foreign currency is converted to program currency with the configured
rate held at 10 decimal places, and the result is rounded **up** to the minor unit. A
reservation may therefore consume one minor unit more than a nearest-rounding would, but
never less than the invoice is worth. The rounding mode is a single constant
(`RESERVATION_ROUNDING`) if the business prefers half-up.

## 3. The release gives back exactly what was reserved

Releases return the stored `reservedAmount` in program currency. Nothing is
re-converted at the current rate, so capacity cannot leak or over-release through FX
drift between reservation and repayment.

## 4. One aggregate: Program owns its reservations

The invariant "active reservations never exceed the limit (for reservations made here)"
spans the limit and every reservation, so they live in one aggregate and change in one
transaction. Reservations are immutable entities inside it. With a database this becomes
a `programs` row plus a `reservations` child table written in the same transaction; the
aggregate does not change.

## 5. Optimistic concurrency with a bounded retry

Every `save` checks the aggregate version it loaded. Two requests racing for the last
capacity both load the same state; the second save fails, the use case reloads and
re-evaluates the rule, and the caller gets 409 `INSUFFICIENT_CAPACITY` rather than an
over-allocation. After three attempts the conflict is surfaced as 409
`CONCURRENT_MODIFICATION`, which is safe to retry. This is needed even in a single
process: the use case awaits between load and save, so requests interleave.

## 6. Idempotency keyed by invoice id

An invoice is reserved at most once per program. Repeating a request with the same
amount returns the existing reservation (200 instead of 201). A different amount for the
same invoice is a 409 `RESERVATION_CONFLICT`: silently replacing a reservation would hide
a client bug. Releasing twice is a no-op that returns the released reservation. A replay
of the original reservation after release returns the released reservation and does not
reserve again; a repaid invoice does not come back.

## 7. Treasury is authoritative; the API bootstraps

Limits, program existence and periodic full state come from treasury. `POST /programs`
exists so the service is useful without the feed and so tests do not need Kafka; any
later treasury message for that program overrides it. Reconciliation keeps local changes
made after the snapshot's `occurredAt` because they are strictly newer facts; the next
snapshot settles them. This assumes clocks within a few seconds of each other, which is
the usual NTP situation.

## 8. One topic, keyed by program, one sequence

Limit changes and snapshots for a program must be ordered relative to each other, so
they share a topic and a key. A per-program `sequence` makes every message idempotent:
at-least-once delivery, replays after a consumer group reset, and out-of-order
duplicates all collapse to "STALE, nothing changed".

## 9. Poison messages are acknowledged and logged; transient failures are redelivered

A message that can never succeed (malformed, unsupported currency, contradictory
snapshot) is dropped with its topic, partition, offset and key in the log so the
partition keeps flowing. Anything else is rethrown so kafkajs retries it. Production adds
a dead-letter topic for the dropped class; the decision point is a single filter.

## 10. In-memory persistence behind a port

The repository interface is the contract; the in-memory adapter keeps plain mementos and
enforces the same version check a SQL `UPDATE ... WHERE version = ?` would. Swapping it
means importing a different persistence module in `CapacityModule`. Durability and
multi-instance deployment need that swap; the domain and application code do not change.

## 11. API keys with scopes

Machine clients authenticate with an `x-api-key` header. Keys are configured with a name
(for logs) and scopes (`read`, `write`); lookup compares SHA-256 digests with
`timingSafeEqual` across all keys. This is deliberately simpler than OAuth2 client
credentials; moving to JWTs from an identity provider replaces one guard and one
registry, and the `@RequireScopes` decorators stay.

## 12. ESLint with type-aware rules and enforced boundaries, not Biome

Biome is faster, but its rule set lacks the type-aware checks that matter most here
(`no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`,
unsafe-`any` detection) and it has no equivalent of `eslint-plugin-boundaries`. Here
the layering is a lint error, not a convention: domain imports nothing but the shared
kernel (no framework, no libraries), application imports domain, adapters import
inward, and a bounded context cannot reach into another one. Prettier formats.

## 13. Nest 11 and TypeScript 5.9

Nest 12 and TypeScript 7 shipped within weeks of this being written; parts of the
toolchain (ts-jest, typescript-eslint) do not yet declare support. The mature line was
chosen on purpose. Upgrading is a dependency bump, not a redesign.

## 14. Tests where the risk is

Unit tests cover the arithmetic (parsing, rounding, conversion across exponents), every
aggregate rule (capacity, idempotency, release, limit changes, reconciliation cases), the
concurrency guarantee through the real repository, and the Kafka wire contract. One e2e
suite proves authentication, the error envelope and the reservation lifecycle over HTTP.
Controllers, mappers and modules are not unit-tested on their own; they are exercised by
the e2e suite, and testing them in isolation would only restate their code.

## 15. One dependency override, and why

Nest 11's `@nestjs/platform-express` pins `multer` 2.2.0, which carries four denial-of-service
advisories fixed in multer 2.3.0. `package.json` overrides `multer` to 2.4.0, the release
Nest 12 ships with, so `npm audit` is clean without a framework major upgrade. The service
has no multipart endpoints, so none of the affected code was reachable; the override exists
so the audit reports the truth and nobody has to re-derive that every time.

## 16. Configuration is a schema, not a template file

There is no `.env.example`. The contract is the `EnvironmentVariables` class: types,
constraints, defaults and documentation in one place, enforced when the process starts. A
template file drifts from the code and cannot enforce anything; the schema fails the start
with the names of the offending variables. Development gets built-in API keys and FX rates
(and logs that it did) so a clone runs with `npm run start:dev` alone; test and production
must set them, which is the point.

## 17. Keyset pagination for every list

Nothing loads a whole collection: the repository port has `findPage`, not `findAll`. Pages
are keyset (cursor) based rather than offset based because a keyset query costs the same
on page 1 and page 1000 and stays consistent while rows are inserted, and because it maps
directly onto `WHERE key > :cursor ORDER BY key LIMIT :n + 1` in SQL. The cursor is opaque
and tagged with the list it belongs to, so a cursor from one endpoint is rejected by
another. The mechanism is one shared module used by both the in-memory repository and the
reservation query; a database adapter replaces the in-memory helper with the equivalent
query and the HTTP contract does not change. Reservations are currently paged inside the
loaded aggregate, which is the known scaling limit of the in-memory design (decision 4).

## 18. The currency registry is the type

Supported currencies live in one `as const` object. The `CurrencyCode` union and the set of
legal decimal scales are derived from it, so `Currency.of('XYZ')` or a scale of 7 is a
compile-time error. Untrusted input goes through `Currency.parse`, which matches exactly:
lower case or padded codes are rejected rather than normalised, because a payments API
should not guess what a caller meant.
