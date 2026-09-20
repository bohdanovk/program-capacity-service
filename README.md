# Program Capacity Service

A financing program has a total credit limit. When an invoice is approved for early payment
it reserves part of that limit; when the invoice is repaid the amount is released. This
service tracks that in real time: it accepts reservations and releases over an authenticated
HTTP API, exposes current availability, and stays in line with the treasury system through a
Kafka feed of limit changes and periodic full-state snapshots. Programs and invoices may be in
different currencies.

Stack: TypeScript 5.9, Nest.js 11, Jest, kafkajs via `@nestjs/microservices`, OpenAPI via
`@nestjs/swagger`. Architecture: DDD with hexagonal layering, enforced by lint.

## Quick start

Prerequisites: Node 22+, npm, Docker (only for Kafka).

```bash
npm install
npm run start:dev       # API on :3000, OpenAPI UI on /docs
```

No configuration file is needed. The configuration contract is a schema
(`src/config/environment.ts`); in development it fills in two dev API keys and a few FX
rates and says so in the first log line. Anything else, and every value in test or
production, comes from the environment (a `.env` file is honoured if present). The service
refuses to start when the environment does not satisfy the schema.

With the treasury feed, everything runs in Docker from one terminal:

```bash
docker compose --profile app up --build -d    # broker, topic, and the service on :3000
npm run kafka:publish                          # limit set, snapshot, limit raised, a stale duplicate
curl -s localhost:3000/api/v1/programs/PRG-001 -H 'x-api-key: local-admin-key-0123456789'
docker compose --profile app logs app          # CREATED, APPLIED, APPLIED, STALE
```

For the feed against a locally running service instead: `npm run kafka:up`, then start with
`KAFKA_ENABLED=true npm run start:dev`. `npm run kafka:publish -- PRG-002 --with-poison` adds
a malformed message to show the poison-message path (logged at ERROR level and dropped; it
stays in the topic, so every new consumer group replays and reports it). `npm run kafka:down`
removes the broker and its data.

Everything at once (format check, lint with architecture rules, type check, unit and e2e tests):

```bash
npm run check
```

## Walkthrough

In development two keys exist by default: `dev-admin-key-0123456789` (read and write) and
`dev-reader-key-0123456789` (read only). The same requests are in
[http/capacity.http](http/capacity.http) for the VS Code REST Client or the JetBrains HTTP
Client, which is the quickest way to click through the API.

```bash
API=localhost:3000/api/v1
KEY='x-api-key: dev-admin-key-0123456789'
JSON='content-type: application/json'

# 1. Create a program with a USD 10,000,000 limit (or let treasury announce it over Kafka)
curl -s -X POST $API/programs -H "$KEY" -H "$JSON" \
  -d '{"programId":"PRG-100","creditLimit":{"amount":"10000000.00","currency":"USD"}}'

# 2. Reserve capacity for a EUR invoice. Converted at the configured rate, rounded up.
curl -s -X POST $API/programs/PRG-100/reservations -H "$KEY" -H "$JSON" \
  -d '{"invoiceId":"INV-1","invoiceAmount":{"amount":"250000.00","currency":"EUR"}}'
# -> 201, reservedAmount 271250.00 USD, exchangeRate "1.085"

# 3. Repeat the same request: idempotent, 200 with the same reservation.
#    Same invoice with a different amount: 409 RESERVATION_CONFLICT.

# 4. Current capacity
curl -s $API/programs/PRG-100 -H "$KEY"
# -> creditLimit 10000000.00, reserved 271250.00, available 9728750.00

# 5. Invoice repaid: release. Idempotent as well.
curl -s -X POST $API/programs/PRG-100/reservations/INV-1/release -H "$KEY"
```

Every error uses one envelope with a stable `code` to branch on:

```json
{
  "statusCode": 409,
  "code": "INSUFFICIENT_CAPACITY",
  "message": "Program \"PRG-100\" cannot reserve 250000.00 USD: only 120000.00 USD is available",
  "details": { "programId": "PRG-100", "requested": "250000.00 USD", "available": "120000.00 USD" },
  "requestId": "3f1c2a2e-9d1a-4c1b-8e77-0b1f3d2a9c11",
  "timestamp": "2026-09-19T10:15:30.000Z",
  "path": "/api/v1/programs/PRG-100/reservations"
}
```

## API

Full, interactive documentation is generated from the code at `/docs` (JSON at
`/docs/openapi.json`). The UI is public; every endpoint below needs an `x-api-key` header,
except `/health`.

| Method | Path                                                            | Scope | Notes                                                      |
| ------ | --------------------------------------------------------------- | ----- | ---------------------------------------------------------- |
| GET    | `/health`                                                       | none  | Liveness; reports whether the treasury consumer is enabled |
| GET    | `/api/v1/programs`                                              | read  | All programs with live capacity                            |
| POST   | `/api/v1/programs`                                              | write | Bootstrap a program (treasury overrides it later)          |
| GET    | `/api/v1/programs/{programId}`                                  | read  | Limit, reserved, available, over-commitment flag           |
| GET    | `/api/v1/programs/{programId}/reservations?status=`             | read  | Reservations, oldest first                                 |
| POST   | `/api/v1/programs/{programId}/reservations`                     | write | Reserve; 201 created, 200 idempotent replay                |
| GET    | `/api/v1/programs/{programId}/reservations/{invoiceId}`         | read  | One reservation                                            |
| POST   | `/api/v1/programs/{programId}/reservations/{invoiceId}/release` | write | Release; idempotent                                        |

Status codes: 400 malformed or imprecise input, 401 no or bad key, 403 missing scope, 404
unknown program or reservation, 409 state conflicts (`INSUFFICIENT_CAPACITY`,
`RESERVATION_CONFLICT`, `PROGRAM_ALREADY_EXISTS`, `CONCURRENT_MODIFICATION`), 422 the request
is well-formed but cannot be processed (`UNSUPPORTED_CURRENCY_PAIR`).

Amounts are always `{ "amount": "1234.56", "currency": "USD" }` with the amount as a decimal
string and the currency an exact upper-case ISO 4217 code. Floats are rejected on the way in
and never produced on the way out.

Lists are keyset-paginated, the same way everywhere: `?limit=` (1 to 200, default 50) and an
opaque `?cursor=`. A page is `{ "items": [...], "nextCursor": "..." | null, "limit": n }`;
pass `nextCursor` back until it is null. A cursor from another list or from elsewhere is a 400
`INVALID_CURSOR`. Nothing in the service ever loads a whole collection.

## Architecture

One bounded context, `capacity`, laid out in the classic four layers. Dependencies point
inward only, and `npm run lint` fails when they do not.

```
src/
  capacity/                       bounded context
    domain/                       pure TypeScript, no framework, no libraries
      money.ts, currency.ts,      exact arithmetic on bigint minor units
      exchange-rate.ts, decimal.ts
      program.ts                  aggregate root: limit, reservations, invariant, reconciliation
      reservation.ts              immutable entity inside the aggregate
      errors.ts                   typed domain errors with a transport-agnostic kind
      ports/                      outbound ports: ProgramRepository, FxRateProvider, Clock
    application/                  use cases and queries; plain-data commands in, views out
      use-cases/                  CreateProgram, ReserveCapacity, ReleaseReservation,
                                  ApplyTreasuryLimit, ReconcileProgram
      queries/                    read side
      concurrency.ts              optimistic-lock retry
    infrastructure/               outbound adapters, one Nest module per port
      persistence/                InMemoryProgramRepository (mementos + version check)
      fx/                         StaticFxRateProvider (rates from configuration)
      clock/                      SystemClock
    presentation/                 inbound adapters; both call the same use cases
      http/                       controllers, DTOs with OpenAPI metadata
      kafka/                      treasury consumer, message DTO, acknowledgement policy
    capacity.module.ts            binds ports to adapters
  auth/                           API-key guard, scopes, @Public / @RequireScopes
  common/                         request id, error envelope, shared validation patterns
  config/                         typed, validated configuration (fails fast at start-up)
  docs/                           OpenAPI document setup
  health/
  shared/domain/                  DomainError base (the shared kernel)
  app.module.ts, app.setup.ts, main.ts
```

How a reservation flows: `ReservationsController` validates the shape of the request
(`class-validator`) and hands a command of plain strings to `ReserveCapacityUseCase`. The use
case parses `Money` (which rejects excess precision), loads the `Program` through the
repository port, asks the FX port for a rate when currencies differ, and calls
`program.reserve(...)`. The aggregate applies every rule and either returns a reservation or
throws a typed `DomainError`. The use case saves with an optimistic version check and retries
once more on a conflict. A global filter maps the error kind to an HTTP status.

The Kafka consumer is a second inbound adapter over the same application layer: a
`ProgramReconciled` message becomes a `ReconcileProgramCommand`, and the aggregate decides
what the snapshot changes. See [docs/treasury-kafka-contract.md](docs/treasury-kafka-contract.md)
for the message contract and exactly how a snapshot is applied.

### Rules enforced by lint

`eslint-plugin-boundaries` classifies every file under `src/` and rejects, with an explicit
message, any import that breaks these policies:

- `domain` imports only `domain` of the same context and `shared`. Not Nest, not `node:*`,
  not a library.
- `application` adds `application` of the same context.
- `infrastructure` and `presentation` may import `application` and `domain` of their own
  context; `presentation` may also use `auth`, `common` and `config`.
- No layer reaches into another bounded context.
- A file that matches no layer is an error, so the structure cannot erode quietly.

On top: typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`, explicit return
types, exhaustive switches, `no-floating-promises` as an error, Prettier for formatting.
Why ESLint and not Biome: Biome has neither type-aware rules nor an architecture plugin, and
those two are the point here (see decision 12).

## Domain semantics, precisely

- **Money** is a `bigint` of minor units plus an ISO 4217 currency. `"10.005"` in USD is a
  400, not a rounding. Amounts far beyond `Number.MAX_SAFE_INTEGER` are handled exactly.
  The currency registry is one typed object: the code union and the set of legal decimal
  scales (0, 2, 3 for currencies, 10 for rates) are derived from it, and input is matched
  exactly (`"usd"` is rejected, not repaired).
- **FX conversion** uses the configured rate at 10 decimal places and rounds the result
  **up** to the program currency's minor unit, so a reservation never consumes less than the
  invoice is worth. Only explicitly configured pairs are served; nothing is inverted or
  crossed.
- **Reserve** is idempotent per `invoiceId`: same amount, same reservation (200); different
  amount, 409. A reservation is refused when it would exceed `available`.
- **Release** returns exactly the reserved program-currency amount, without re-conversion,
  and is idempotent. A repaid invoice cannot be reserved again by replaying the original
  request.
- **Available** is `max(0, limit - reserved)`. Treasury may lower a limit below the reserved
  total; the program then reports `overCommitted: true` and accepts no new reservations until
  releases catch up.
- **Concurrency**: two requests racing for the last capacity both load the same state; the
  second save fails the version check, the use case reloads and re-evaluates, and the loser
  gets a 409 for the real reason. This is tested against the actual repository.
- **Treasury feed**: one topic keyed by `programId`, a per-program monotonic `sequence`.
  Anything at or below the last applied sequence is `STALE` and ignored, which makes
  at-least-once delivery, replays and duplicates safe. A snapshot replaces the program's
  state as of its `occurredAt`; local changes made after that instant are preserved until the
  next snapshot confirms them. Poison messages are logged with topic, partition, offset and
  key, then acknowledged; transient failures are rethrown so kafkajs redelivers.

## Configuration

`src/config/environment.ts` is the contract: every variable with its type, constraints and
default, validated at start-up. There is no template file to copy; a misconfigured service
does not start, and the error names each offending variable. In development, `API_KEYS` and
`FX_RATES` fall back to built-in values (logged at start-up) so a fresh clone runs unchanged.
Test and production must set them.

| Variable          | Default                    | Meaning                                                                                                      |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`        | `development`              | `production` switches logs to JSON                                                                           |
| `PORT`            | `3000`                     |                                                                                                              |
| `API_KEYS`        | required                   | `name:secret:scope[+scope]`, comma separated. Secret 16+ chars of `[A-Za-z0-9._~-]`. Scopes `read`, `write`. |
| `FX_RATES`        | empty                      | `BASE/QUOTE=rate`, comma separated, up to 10 decimals                                                        |
| `KAFKA_ENABLED`   | `false`                    | Start the treasury consumer                                                                                  |
| `KAFKA_BROKERS`   | `localhost:9092`           | Comma separated                                                                                              |
| `KAFKA_CLIENT_ID` | `program-capacity-service` |                                                                                                              |
| `KAFKA_GROUP_ID`  | `program-capacity-service` | A new group reads the topic from the beginning and rebuilds state                                            |
| `SWAGGER_ENABLED` | `true`                     | Serve `/docs`                                                                                                |

The topic name `treasury.program-capacity.v1` is part of the contract and therefore a constant.

## Tests

Tests sit where a mistake would cost money, and nowhere else.

| Suite                                               | What it proves                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/money.spec.ts`                              | Strict parsing, formatting, exactness beyond double precision, currency safety                                                            |
| `domain/exchange-rate.spec.ts`                      | Rounding modes, mixed minor units (JPY, KWD), full-precision exactness                                                                    |
| `domain/program.spec.ts`                            | Every aggregate rule: capacity boundary, idempotency, conflicts, release, limit changes, all reconciliation cases, persistence round trip |
| `application/.../reserve-capacity.use-case.spec.ts` | No over-allocation under concurrent requests, through the real repository                                                                 |
| `presentation/kafka/...message.dto.spec.ts`         | The Kafka wire contract rejects what it must                                                                                              |
| `test/capacity.e2e-spec.ts`                         | Authentication and scopes, error envelope, the whole lifecycle over HTTP                                                                  |

```bash
npm test            # unit
npm run test:e2e    # HTTP end to end (no Kafka needed)
npm run test:cov
```

Controllers, mappers and Nest modules have no isolated unit tests on purpose: the e2e suite
exercises them, and mocking them apart would only restate their code.

## Assumptions and trade-offs

The short list; each has a fuller record in [docs/decisions.md](docs/decisions.md).

1. Treasury is the system of record for programs and limits. `POST /programs` is a bootstrap
   for environments without the feed and is overridden by treasury.
2. Reservation state lives in memory behind a repository port. This is a deliberate scope
   choice for the exercise: the port, the version check and the mementos are shaped so a
   database adapter drops in without touching domain or application code. Until then the
   service is single-instance and loses state on restart (a fresh consumer group replays the
   topic and treasury snapshots rebuild it).
3. FX rates are static configuration. A market-data or treasury-fed provider implements the
   same one-method port.
4. Rounding up on conversion and "release what was reserved" are conservative choices a
   risk team would usually prefer; both are one-line changes if not.
5. API keys with scopes instead of OAuth2/JWT. Right for machine clients today; the guard is
   the only thing to replace.
6. Poison messages are dropped and logged rather than sent to a dead-letter topic; the
   decision point is one filter.
7. Nest 11 and TypeScript 5.9 rather than the versions released in the last few weeks.
8. `multer` is overridden to 2.4.0 (Nest 11 pins a version with DoS advisories; this service
   has no file uploads). `npm audit` is clean.

## What production would add next

Database-backed repository (Postgres, `programs` + `reservations`, version column), a
dead-letter topic for dropped treasury messages, an outbox that publishes this service's
reservations and releases back to treasury, metrics (reservations per outcome, consumer lag),
and an identity provider for client credentials.

## Scripts

| Script                              | Purpose                                            |
| ----------------------------------- | -------------------------------------------------- |
| `npm run start:dev`                 | Watch mode                                         |
| `npm run build`                     | Compile to `dist/`                                 |
| `npm run start:prod`                | Run the compiled service                           |
| `npm run check`                     | Format check, lint, type check, unit and e2e tests |
| `npm run lint`                      | ESLint including architecture boundaries           |
| `npm run kafka:up`                  | Start Kafka and create the topic                   |
| `npm run kafka:publish [programId]` | Publish the sample treasury scenario               |
| `npm run kafka:down`                | Stop Kafka                                         |
