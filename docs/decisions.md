# Decisions and trade-offs

Every choice below shapes how the service behaves. Each one says what we do, why, and what
it means in practice, so a reader can agree or disagree without reading the code first.
Technical words that also appear as names in the code are explained at the end.

## 1. Money is stored as whole numbers of the smallest unit

**What we do.** An amount is a whole number of cents (or pence, or yen) plus a currency.
"1234.56 USD" is stored as 123456 with the currency USD. We use JavaScript's `bigint`, which
has no upper limit and no rounding.

**Why.** Computers cannot represent most decimal fractions exactly as floating-point
numbers. 0.1 + 0.2 is not 0.3 in JavaScript. In a system that reserves credit, an error of
one cent is a defect, so floating point is never used for money.

**In practice.** Amounts travel in JSON as strings (`"1234.56"`), never as numbers, because a
JSON number is a floating-point number. Input with more decimals than the currency has
(`"10.005"` in USD) is refused with a 400 error rather than rounded. No decimal library is
needed: the only arithmetic is add, subtract, and one exact conversion, all of which
`bigint` does natively.

## 2. Currency conversion rounds up

**What we do.** When an invoice is in a different currency than the program, its amount is
converted at the configured rate (kept with 10 decimal places) and the result is rounded
**up** to the next cent.

**Why.** A reservation should never hold less capacity than the invoice is worth. Rounding
up may take one cent more than the exact value; rounding to the nearest cent could take
one cent less.

**In practice.** If the business prefers standard rounding, it is one constant
(`RESERVATION_ROUNDING`) in the domain code.

## 3. A release gives back exactly what was reserved

**What we do.** When an invoice is repaid, the amount released is the amount that was
reserved, in the program currency, as stored at reservation time. The invoice amount is not
converted again at today's rate.

**Why.** Exchange rates move between reservation and repayment. Converting again would
free more or less capacity than was taken, and the program's totals would drift a little
with every invoice.

## 4. A program and its reservations are saved as one unit

**What we do.** The `Program` object holds its credit limit and all of its reservations.
Reserving and releasing happen inside that object, and the whole object is saved at once.
(In the code this is called an aggregate; see the glossary.)

**Why.** The rule "active reservations may not exceed the limit" needs the limit and every
reservation at the same time. Keeping them in one object means the rule is checked and saved
as one step, so no request can see a half-updated program.

**In practice.** PostgreSQL stores the aggregate as JSONB in one `programs` row with a
version column. One statement saves all reservations and totals together. Both stores load
and save the whole program, including all reservations. This keeps the existing consistency
boundary, but read and write costs grow with the program's reservation history.

## 5. Two simultaneous requests cannot both take the last capacity

**What we do.** Every program carries a version number. A save is accepted only if the
version in storage is still the one that was loaded. If another request saved in between,
the save is refused, the request reloads the program, checks the rule again, and tries once
more, up to three times. After that the caller gets 409 `CONCURRENT_MODIFICATION`, which is
safe to retry.

**Why.** Two requests can each read "600 available", each decide their 500 fits, and each
save. Without the version check the program would end up with 1000 reserved out of 600.
With it, the second save fails, the request sees 100 available, and answers 409
`INSUFFICIENT_CAPACITY`, which is the true answer.

**In practice.** PostgreSQL uses `UPDATE ... WHERE version = $3` and increments the version
in that statement. Conflicting inserts also fail the concurrency check. Tests race separate
database connections through the repository and use case. The memory store applies the same
check within one process.

## 6. The invoice id protects against duplicates

**What we do.** An invoice can be reserved at most once per program.

- The same request sent twice returns the same reservation, with 200 instead of 201.
- The same invoice with a different amount is refused with 409 `RESERVATION_CONFLICT`.
- Releasing an already released reservation returns it unchanged.
- Sending the original reservation request after the release does not reserve again.

**Why.** Networks retry. A client that did not get an answer will send the same request
again, and that must not reserve twice. A different amount for the same invoice is most
likely a client bug, and replacing the reservation silently would hide it. A repaid invoice
does not come back, so a late duplicate of the original request must not revive it.

## 7. Treasury is the source of truth; the API can create programs for convenience

**What we do.** Programs, their currency, their credit limits and the periodic full picture
come from the treasury system over Kafka. `POST /programs` also exists so the service is
useful without the feed and so tests do not need Kafka. Any later treasury message for that
program overrides what the API set.

**Why.** Two sources of truth would disagree eventually. Treasury owns the money, so
treasury wins.

**In practice.** A treasury snapshot says "this is the full state as of 10:00". Changes this
service made after 10:00 (a reservation at 10:01, a release at 10:02) are newer than the
snapshot and are kept; the next snapshot confirms or corrects them. This assumes the two
systems' clocks agree within a few seconds, which is normal for servers synchronised with
NTP.

## 8. One Kafka topic per feed, messages keyed by program, with a sequence number

**What we do.** Limit changes and snapshots share one topic and use the program id as the
message key. Every message carries a sequence number that increases per program. A message
whose sequence is not higher than the last one applied is ignored and logged as `STALE`.

**Why.** Kafka keeps order only within one key. Putting both message types under the same
key means a limit change and a snapshot for the same program arrive in the order treasury
sent them. Kafka also delivers a message at least once, never exactly once, so duplicates and
replays are normal. The sequence number makes them harmless.

**In practice.** Restarting the consumer under a new group name replays the whole topic and
rebuilds the state, and nothing is applied twice.

## 9. Broken messages are dropped and logged; temporary failures are retried

**What we do.** A message that can never be processed (malformed, unknown currency, a
snapshot that contradicts the program) is logged with its topic, partition, offset and key,
and then acknowledged so the topic keeps flowing. Any other failure, such as storage being
briefly unavailable, is not acknowledged, so Kafka delivers the message again.

**Why.** Retrying a message that will always fail blocks every message behind it forever.
Dropping a message that would have succeeded a second later loses data. The two cases need
opposite treatment.

**In practice.** Production adds a "dead letter" topic where the dropped messages are sent
for inspection. The decision is made in one place, `TreasuryMessageExceptionFilter`.

## 10. PostgreSQL is the default store, with memory as an explicit option

**What we do.** `STORE=postgres` is the default. `PostgresProgramRepository` uses `pg` and
stores each aggregate in a JSONB row. `STORE=memory` selects `InMemoryProgramRepository`.
Both implement `ProgramRepository`; application and domain code share the same interface.

**Why.** PostgreSQL preserves state across restarts and coordinates multiple instances.
The existing port reads and writes whole aggregates, so one row provides an atomic save
without coordinating separate program and reservation writes. JSONB preserves the memento's
decimal strings; the adapter restores dates when reading. Memory remains useful for tests
and demos that need no database.

**In practice.** `PersistenceModule` selects the adapter from validated configuration.
Apply `database/schema.sql` before starting against an existing database. Docker Compose
applies it on first initialization and keeps data in a named volume. Startup checks database
connectivity and the table; shutdown closes the pool. Memory mode loses state on restart.

## 11. API keys with read and write permissions

**What we do.** Every request carries an `x-api-key` header. Each key has a name (for logs)
and permissions, `read` and/or `write`. Read endpoints need `read`; endpoints that change
state need `write`.

**Why.** The clients are other systems, not people, and API keys are the simplest thing that
is correct for that. Comparing keys takes the same time whether or not they match, so an
attacker cannot learn anything from response timing.

**In practice.** Moving to tokens issued by an identity provider (OAuth2, JWT) means
replacing one guard class and one key registry; the permission annotations on the
endpoints stay.

## 12. ESLint rather than Biome, with architecture rules that fail the build

**What we do.** Linting uses ESLint with the rules that understand types, plus a plugin that
checks which folders may import from which.

**Why.** Biome is faster, but it cannot see types, so it cannot catch a forgotten `await`
on a promise or a `switch` that misses a case, and it has no way to enforce folder
dependencies. Those checks are what protect this code.

**In practice.** The domain folder may not import the framework, Node built-ins, or any
library. The application folder may use the domain. The HTTP and Kafka adapters may use
both. Nothing may reach into another business area. Breaking any of these is a lint error,
not a comment in a document.

## 13. Nest 11 and TypeScript 5.9, not the newest majors

**What we do.** The project uses the previous major versions of Nest and TypeScript.

**Why.** Nest 12 and TypeScript 7 were released a few weeks before this was written, and
parts of the toolchain (the test runner integration, the linter) did not yet support them.

**In practice.** Upgrading later is a dependency bump, not a redesign.

## 14. Tests where a mistake would cost money

**What we do.** Unit tests cover the money arithmetic, every rule of the program (capacity,
duplicates, release, limit changes, every snapshot case), the "no over-allocation under
simultaneous requests" guarantee against the real store, the Kafka message format and the
pagination cursor. One end-to-end suite starts the real HTTP application and proves
authentication, the error format, pagination and the full reserve-and-release flow.

**Why.** Tests earn their keep where the logic is. Controllers, mappers and module wiring
are exercised by the end-to-end suite; testing them in isolation would only repeat their
code line by line.

## 15. One dependency version is overridden

**What we do.** `package.json` forces `multer` to version 2.4.0.

**Why.** Nest 11 pins multer 2.2.0, which has four published denial-of-service
vulnerabilities fixed in 2.3.0. The override is the version Nest 12 ships with, so
`npm audit` is clean without a major framework upgrade. This service has no file uploads,
so the vulnerable code was never reachable, but the audit should say so without anyone
having to work it out again.

## 16. Configuration is a schema, not a template file

**What we do.** There is no `.env.example`. The class `EnvironmentVariables` lists every
variable with its type, allowed values and default, and the service checks the environment
against it at start-up. In development, missing API keys and exchange rates are filled with
built-in values, and the first log line says so.

**Why.** A template file drifts from the code and cannot enforce anything. The schema
refuses to start the service and names the offending variables. The development defaults
match the local Compose database. Run `npm run db:up` before `npm run start:dev`, or select
memory explicitly. Test and production require explicit API keys and a database URL when
using PostgreSQL.

## 17. Lists are paged with a cursor, and nothing loads a whole table

**What we do.** Every list endpoint returns at most `limit` items (default 50, maximum 200)
and a `nextCursor`. To get the next page, the client sends that cursor back. The storage
interface offers `findPage`, never "find all".

**Why.** The usual alternative, `?page=1000`, makes the database count and skip 999 pages of
rows first, and if a row is inserted meanwhile the client sees one item twice or misses
one. A cursor means "give me what comes after this item", which costs the same for page 1
and page 1000, stays correct while rows are being inserted, and is a plain `WHERE key >
:cursor ORDER BY key LIMIT n` query in SQL.

**In practice.** The cursor is opaque to clients and tagged with the list it belongs to, so
a cursor from one endpoint is refused by another. Both the program list and the reservation
list use the same cursor format. PostgreSQL pages programs using an indexed id query with
`C` collation, matching memory's ordering for the ASCII identifiers accepted by the API.
Reservation lists page inside the loaded program with both stores, as described in decision 4.

## 18. The list of supported currencies is also the type

**What we do.** The supported currencies and their number of decimals live in one object
in the code. The set of valid currency codes and the set of valid decimal scales (0, 2 and 3
for currencies, 10 for exchange rates) are derived from it.

**Why.** A typo such as `Currency.of('XYZ')`, or code that formats an amount with 7
decimals, then fails to compile instead of failing at run time.

**In practice.** Input from clients is matched exactly. `"usd"` or `" USD"` is refused with
a 400, not corrected, because a payments API should not guess what the caller meant.

## Words that appear in the code

- **Aggregate.** An object that owns a group of related objects and is loaded and saved as
  one unit. Here, `Program` with its reservations.
- **Port and adapter.** A port is an interface the core logic depends on (`ProgramRepository`,
  `FxRateProvider`, `Clock`). An adapter is an implementation of it (the in-memory store, the
  static rates, the system clock).
- **Domain, application, infrastructure, presentation.** The four folders of the code.
  Domain holds the business rules. Application holds the use cases that run them.
  Infrastructure holds the adapters that talk to storage and other systems. Presentation
  holds what talks to the outside world (HTTP controllers, the Kafka consumer).
- **Idempotent.** Doing something twice has the same effect as doing it once. Reserving the
  same invoice twice, releasing twice, or receiving the same Kafka message twice all leave
  the system as if it happened once.
- **Snapshot / reconciliation.** A treasury message with the complete state of a program at
  a point in time, and the act of making the local program match it.
- **Sequence.** The per-program counter on treasury messages that tells old from new.
- **Optimistic locking.** The version check of decision 5: proceed without locking, and
  reject a save if someone else saved first.
- **Keyset (cursor) pagination.** Paging by "what comes after this item" instead of by page
  number (decision 17).
- **Poison message.** A message that will fail no matter how often it is retried
  (decision 9).
- **Scope.** A permission attached to an API key, `read` or `write`.
- **Memento.** The plain-data copy of a program that the store keeps and the aggregate is
  rebuilt from.

## 19. Security headers on every response, without a Content Security Policy

**What we do.** `helmet` adds the standard headers (`X-Content-Type-Options`,
`Strict-Transport-Security`, `X-Frame-Options`, `Referrer-Policy`) and removes
`X-Powered-By`. Content Security Policy is switched off.

**Why.** The headers cost nothing and close well-known browser-side holes. A Content
Security Policy only protects HTML pages, and the only HTML this service serves is the
OpenAPI UI, which needs inline scripts and styles; a policy that allows those protects
nothing. The API itself returns JSON.

**In practice.** The end-to-end suite asserts the headers, so removing them by accident
fails the build.

## 20. One access-log line per request, and a configurable log level

**What we do.** When a response finishes, the service logs method, path, status, duration,
the name of the API key that authenticated (or `-`) and the request id. Health probes log
at `debug`. `LOG_LEVEL` sets the least severe level to emit; production defaults to `log`,
everything else to `debug`.

**Why.** Without an access log, the only trace of a request that did not fail with a 5xx is
in the client. Operations need to answer "what did client X do at 10:15" from the logs, by
request id. Probes arrive every few seconds and would bury everything else.

**In practice.** In production the logs are JSON, one object per line, ready for an
aggregator. The client name is never the secret.

## 21. The build gate also runs in CI, and the image is started, not just built

**What we do.** GitHub Actions runs `npm run check` and `npm audit` on every push and pull
request, builds the production image, starts it, calls `/health`, and proves that it refuses
to start without `API_KEYS`. Dependabot proposes dependency updates weekly.

**Why.** A gate that only runs on a developer's machine is a convention, not a guarantee.
Building an image proves the Dockerfile; starting it proves the image, the environment
contract and the fail-fast behaviour together.
