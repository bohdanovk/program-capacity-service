import { Pool } from 'pg';
import { ReserveCapacityUseCase } from '../src/capacity/application/use-cases/reserve-capacity.use-case';
import { Currency } from '../src/capacity/domain/currency';
import {
  ConcurrencyConflictError,
  InsufficientCapacityError,
  ReservationsNotLoadedError,
} from '../src/capacity/domain/errors';
import { ExchangeRate } from '../src/capacity/domain/exchange-rate';
import { Money } from '../src/capacity/domain/money';
import {
  invoiceScope,
  Program,
  reconciliationScope,
  TreasurySnapshot,
} from '../src/capacity/domain/program';
import { Reservation, ReservationStatus } from '../src/capacity/domain/reservation';
import { StaticFxRateProvider } from '../src/capacity/infrastructure/fx/static-fx-rate.provider';
import { PostgresProgramRepository } from '../src/capacity/infrastructure/persistence/postgres-program.repository';
import { encodeCursor, InvalidCursorError } from '../src/shared/pagination/pagination';

const at = new Date('2026-09-19T10:00:00.123Z');
const usd = (amount: string): Money => Money.parse(amount, Currency.of('USD'));
const create = (id = 'PRG-1', limit = '100.00'): Program =>
  Program.create({ id, creditLimit: usd(limit), at });

describe('PostgresProgramRepository', () => {
  let first: PostgresProgramRepository;
  let second: PostgresProgramRepository;
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE reservations, programs');
    first = new PostgresProgramRepository(process.env.DATABASE_URL!);
    second = new PostgresProgramRepository(process.env.DATABASE_URL!);
    await Promise.all([first.onModuleInit(), second.onModuleInit()]);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([first.onApplicationShutdown(), second.onApplicationShutdown()]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns null for an unknown program', async () => {
    expect(await first.findById('missing')).toBeNull();
  });

  it('preserves exact amounts, rates, dates and treasury state after closing and reopening the store', async () => {
    const program = create('PRG-1', '999999999999999999999999.99');
    program.reconcile(
      {
        sequence: Number.MAX_SAFE_INTEGER - 1,
        asOf: at,
        creditLimit: program.creditLimit,
        activeReservations: [
          { invoiceId: 'TREASURY', invoiceAmount: usd('20.00'), reservedAmount: usd('20.00') },
        ],
      },
      at,
    );
    program.reserve({
      invoiceId: 'LOCAL',
      invoiceAmount: Money.parse('100000000000000000.01', Currency.of('EUR')),
      exchangeRate: ExchangeRate.parse(Currency.of('EUR'), Currency.of('USD'), '1.0850123456'),
      at,
    });
    program.release({ invoiceId: 'LOCAL', at: new Date('2026-09-19T10:01:00.456Z') });
    await first.save(program);
    await first.onApplicationShutdown();

    const loaded = (await second.findById(program.id, {
      invoiceIds: ['LOCAL', 'TREASURY'],
      allActive: false,
    }))!;
    expect(loaded.toMemento()).toEqual({ ...program.toMemento(), version: 1 });
    expect(loaded.findReservation('LOCAL')?.toMemento()).toEqual(
      program.findReservation('LOCAL')?.toMemento(),
    );
    expect(loaded.findReservation('LOCAL')?.releasedAt).toBeInstanceOf(Date);
    expect(loaded.findReservation('TREASURY')?.exchangeRate).toBeNull();
    expect(loaded.applyTreasuryLimitChange({ sequence: 1, creditLimit: usd('1.00') }, at)).toBe(
      'STALE',
    );
    loaded.release({ invoiceId: 'TREASURY', at });
    await second.save(loaded);
    expect((await second.findById(program.id))?.reservedTotal.toDecimalString()).toBe('0.00');
  });

  it('allows exactly one concurrent insert of the same id', async () => {
    const results = await Promise.allSettled([first.save(create()), second.save(create())]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.reason).toBeInstanceOf(ConcurrencyConflictError);
    expect((await first.findById('PRG-1'))?.version).toBe(1);
  });

  it('rejects a stale update without overwriting the winning state', async () => {
    await first.save(create());
    const left = (await first.findById('PRG-1', invoiceScope('LEFT')))!;
    const right = (await second.findById('PRG-1', invoiceScope('RIGHT')))!;
    left.reserve({
      invoiceId: 'LEFT',
      invoiceAmount: usd('60.00'),
      exchangeRate: ExchangeRate.identity(Currency.of('USD')),
      at,
    });
    right.reserve({
      invoiceId: 'RIGHT',
      invoiceAmount: usd('70.00'),
      exchangeRate: ExchangeRate.identity(Currency.of('USD')),
      at,
    });
    const results = await Promise.allSettled([first.save(left), second.save(right)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason).toBeInstanceOf(
      ConcurrencyConflictError,
    );
    const winner = results[0].status === 'fulfilled' ? left : right;
    expect((await first.findById('PRG-1'))?.toMemento()).toEqual({
      ...winner.toMemento(),
      version: 2,
    });
  });

  it('retries competing reservations across independent pools without over-allocating', async () => {
    await first.save(create());
    const fx = new StaticFxRateProvider([]);
    const clock = { now: () => at };
    const useCases = [
      new ReserveCapacityUseCase(first, fx, clock),
      new ReserveCapacityUseCase(second, fx, clock),
    ];
    const results = await Promise.allSettled(
      useCases.map((useCase, index) =>
        useCase.execute({
          programId: 'PRG-1',
          invoiceId: `INV-${index}`,
          invoiceAmount: { amount: '60.00', currency: 'USD' },
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason).toBeInstanceOf(
      InsufficientCapacityError,
    );
    const stored = (await first.findById('PRG-1'))!;
    expect(stored.reservedTotal.toDecimalString()).toBe('60.00');
    expect(stored.activeReservationCount).toBe(1);
  });

  it('loads only the requested reservations and pages by time, invoice and status', async () => {
    const program = create();
    for (const invoiceId of ['INV-C', 'INV-B', 'INV-A']) {
      program.reserve({
        invoiceId,
        invoiceAmount: usd('10.00'),
        exchangeRate: ExchangeRate.identity(Currency.of('USD')),
        at,
      });
    }
    program.release({ invoiceId: 'INV-B', at });
    await first.save(program);
    const reads = jest.spyOn(Reservation, 'fromMemento');
    const bare = (await second.findById(program.id))!;
    await second.findPage({ limit: 2, cursor: null });
    expect(reads).not.toHaveBeenCalled();
    expect(bare.reservedTotal.toDecimalString()).toBe('20.00');
    expect(() => bare.findReservation('INV-B')).toThrow(ReservationsNotLoadedError);

    const one = (await second.findById(program.id, invoiceScope('INV-B')))!;
    expect(reads).toHaveBeenCalledTimes(1);
    expect(one.findReservation('INV-B')?.status).toBe(ReservationStatus.Released);

    const firstPage = await first.findReservationPage(program.id, { limit: 2, cursor: null });
    const nextPage = await second.findReservationPage(program.id, {
      limit: 2,
      cursor: firstPage.nextCursor,
    });
    expect(firstPage.items.map((item) => item.invoiceId)).toEqual(['INV-A', 'INV-B']);
    expect(nextPage.items.map((item) => item.invoiceId)).toEqual(['INV-C']);
    expect(nextPage.nextCursor).toBeNull();

    const active = await first.findReservationPage(
      program.id,
      { limit: 1, cursor: null },
      ReservationStatus.Active,
    );
    const releasing = (await second.findById(program.id, invoiceScope('INV-A')))!;
    releasing.release({ invoiceId: 'INV-A', at });
    await second.save(releasing);
    const remaining = await first.findReservationPage(
      program.id,
      { limit: 2, cursor: active.nextCursor },
      ReservationStatus.Active,
    );
    expect(remaining.items.map((item) => item.invoiceId)).toEqual(['INV-C']);
    const released = await first.findReservationPage(
      program.id,
      { limit: 10, cursor: null },
      ReservationStatus.Released,
    );
    expect(released.items.map((item) => item.invoiceId)).toEqual(['INV-A', 'INV-B']);
  });

  it('reconciles active and named reservations without reading or rewriting unrelated history', async () => {
    const program = create();
    for (const invoiceId of ['ACTIVE', 'HISTORY', 'REOPEN']) {
      program.reserve({
        invoiceId,
        invoiceAmount: usd('10.00'),
        exchangeRate: ExchangeRate.identity(Currency.of('USD')),
        at,
      });
    }
    program.release({ invoiceId: 'HISTORY', at });
    program.release({ invoiceId: 'REOPEN', at });
    await first.save(program);
    const before = await pool.query<{ xmin: string }>(
      "SELECT xmin::text FROM reservations WHERE program_id = $1 AND invoice_id = 'HISTORY'",
      [program.id],
    );
    const snapshot: TreasurySnapshot = {
      sequence: 1,
      asOf: new Date(at.getTime() + 1000),
      creditLimit: usd('100.00'),
      activeReservations: [
        { invoiceId: 'REOPEN', invoiceAmount: usd('20.00'), reservedAmount: usd('20.00') },
        { invoiceId: 'NEW', invoiceAmount: usd('30.00'), reservedAmount: usd('30.00') },
      ],
    };
    const reads = jest.spyOn(Reservation, 'fromMemento');
    const loaded = (await second.findById(program.id, reconciliationScope(snapshot)))!;
    expect(reads).toHaveBeenCalledTimes(2);
    expect(loaded.reconcile(snapshot, snapshot.asOf)).toMatchObject({
      added: 1,
      updated: 1,
      released: 1,
    });
    await second.save(loaded);
    const capacity = (await first.findById(program.id))!;
    expect(capacity.reservedTotal.toDecimalString()).toBe('50.00');
    expect(capacity.activeReservationCount).toBe(2);
    const history = await pool.query<{ xmin: string }>(
      "SELECT xmin::text FROM reservations WHERE program_id = $1 AND invoice_id = 'HISTORY'",
      [program.id],
    );
    expect(history.rows).toEqual(before.rows);
    const entries = await first.findReservationPage(program.id, { limit: 10, cursor: null });
    expect(entries.items.filter((item) => item.isActive).map((item) => item.invoiceId)).toEqual([
      'REOPEN',
      'NEW',
    ]);
  });

  it('rolls back the program update when a reservation write fails', async () => {
    await first.save(create());
    await pool.query(
      "ALTER TABLE reservations ADD CONSTRAINT reject_failure CHECK (invoice_id <> 'FAIL')",
    );
    try {
      const loaded = (await first.findById('PRG-1', invoiceScope('FAIL')))!;
      loaded.reserve({
        invoiceId: 'FAIL',
        invoiceAmount: usd('10.00'),
        exchangeRate: ExchangeRate.identity(Currency.of('USD')),
        at,
      });
      await expect(first.save(loaded)).rejects.toMatchObject({ code: '23514' });
      const unchanged = (await second.findById('PRG-1'))!;
      expect(unchanged.version).toBe(1);
      expect(unchanged.reservedTotal.toDecimalString()).toBe('0.00');
      expect(
        (await second.findReservationPage('PRG-1', { limit: 10, cursor: null })).items,
      ).toEqual([]);
      await first.save(create('AFTER-FAILURE'));
      expect(await second.findById('AFTER-FAILURE')).not.toBeNull();
    } finally {
      await pool.query('ALTER TABLE reservations DROP CONSTRAINT reject_failure');
    }
  });

  it('pages by id using the same case and punctuation order as memory', async () => {
    const ids = ['a', 'A_', 'A', 'A-1', 'Z', '0'];
    for (const id of ids) {
      await first.save(create(id));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await first.findPage({ limit: 2, cursor });
      expect(page.limit).toBe(2);
      seen.push(...page.items.map((program) => program.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(ids.sort());
    expect(await first.findPage({ limit: 2, cursor: encodeCursor('programs', ['z']) })).toEqual({
      items: [],
      nextCursor: null,
      limit: 2,
    });
  });

  it.each(['invalid', encodeCursor('reservations', ['A']), encodeCursor('programs', ['A', 'B'])])(
    'rejects invalid cursor %s',
    async (cursor) => {
      await expect(first.findPage({ limit: 2, cursor })).rejects.toBeInstanceOf(InvalidCursorError);
    },
  );

  it('treats ids as query parameters', async () => {
    const id = "PRG'; DROP TABLE programs; --";
    await first.save(create(id));
    expect((await second.findById(id))?.id).toBe(id);
    expect((await second.findPage({ limit: 2, cursor: null })).items).toHaveLength(1);
  });

  it('fails initialization when the schema has not been provisioned', async () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('options', '-c search_path=pg_catalog');
    const unprovisioned = new PostgresProgramRepository(url.toString());
    await expect(unprovisioned.onModuleInit()).rejects.toMatchObject({ code: '42P01' });
    await unprovisioned.onApplicationShutdown();
  });
});
