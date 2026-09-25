import { Currency } from '../domain/currency';
import { ExchangeRate } from '../domain/exchange-rate';
import { Money } from '../domain/money';
import { Clock } from '../domain/ports/clock';
import { Program } from '../domain/program';
import { Reservation, ReservationStatus } from '../domain/reservation';
import { StaticFxRateProvider } from '../infrastructure/fx/static-fx-rate.provider';
import { InMemoryProgramRepository } from '../infrastructure/persistence/in-memory-program.repository';
import { ProgramQueries } from './queries/program-queries';
import { ApplyTreasuryLimitUseCase } from './use-cases/apply-treasury-limit.use-case';
import { ReconcileProgramUseCase } from './use-cases/reconcile-program.use-case';
import { ReleaseReservationUseCase } from './use-cases/release-reservation.use-case';
import { ReserveCapacityUseCase } from './use-cases/reserve-capacity.use-case';

const USD = Currency.of('USD');
const PROGRAM_ID = 'PRG-BIG';
/** Half of them released: history that a request must never have to read. */
const RESERVATIONS = 5_000;
const T0 = new Date('2026-09-19T10:00:00.000Z');
const clock: Clock = { now: () => new Date('2026-09-20T10:00:00.000Z') };

/**
 * Key comparisons and entries visited per request. The sorted-btree indexes seek to the
 * requested key and read only a page. Internal tree moves are not counted.
 */
const INDEX_WORK_PER_REQUEST = 500;

/**
 * Count reservation records read and written, key comparisons and index entries visited.
 * Record access must stay limited to the request's scope and index lookup must avoid full
 * scans. Counting instead of timing keeps the test deterministic.
 */
describe('Requests on a program with many reservations', () => {
  let repository: InMemoryProgramRepository;
  let reads: jest.SpiedFunction<typeof Reservation.fromMemento>;
  let writes: jest.SpiedFunction<Reservation['toMemento']>;
  let indexWorkBefore: number;
  const indexWork = (): number => repository.indexWork - indexWorkBefore;

  beforeEach(async () => {
    repository = new InMemoryProgramRepository();
    const program = Program.create({
      id: PROGRAM_ID,
      creditLimit: Money.parse('100000000.00', USD),
      at: T0,
    });
    for (let i = 0; i < RESERVATIONS; i += 1) {
      const at = new Date(T0.getTime() + i);
      program.reserve({
        invoiceId: `INV-${i}`,
        invoiceAmount: Money.parse('10.00', USD),
        exchangeRate: ExchangeRate.identity(USD),
        at,
      });
      if (i % 2 === 1) {
        program.release({ invoiceId: `INV-${i}`, at });
      }
    }
    await repository.save(program);

    reads = jest.spyOn(Reservation, 'fromMemento');
    writes = jest.spyOn(Reservation.prototype, 'toMemento');
    indexWorkBefore = repository.indexWork;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reserving writes the new reservation and reads nothing else', async () => {
    const fx = new StaticFxRateProvider([]);
    await new ReserveCapacityUseCase(repository, fx, clock).execute({
      programId: PROGRAM_ID,
      invoiceId: 'INV-NEW',
      invoiceAmount: { amount: '10.00', currency: 'USD' },
    });

    expect(reads).not.toHaveBeenCalled();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(indexWork()).toBeLessThan(INDEX_WORK_PER_REQUEST);
  });

  it('releasing reads and writes the one reservation released', async () => {
    // The oldest reservation: first in the active list, before every released one.
    await new ReleaseReservationUseCase(repository, clock).execute({
      programId: PROGRAM_ID,
      invoiceId: 'INV-0',
    });

    expect(reads).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(indexWork()).toBeLessThan(INDEX_WORK_PER_REQUEST);
  });

  it('capacity figures and limit changes touch no reservation at all', async () => {
    const capacity = await new ProgramQueries(repository).getProgramCapacity(PROGRAM_ID);
    await new ApplyTreasuryLimitUseCase(repository, clock).execute({
      programId: PROGRAM_ID,
      sequence: 1,
      currency: 'USD',
      creditLimit: '200000000.00',
    });

    expect(capacity.activeReservations).toBe(RESERVATIONS / 2);
    expect(capacity.reserved.amount).toBe('25000.00');
    expect(reads).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(indexWork()).toBe(0);
  });

  it('reading one reservation or one page reads only those', async () => {
    const queries = new ProgramQueries(repository);
    await queries.getReservation(PROGRAM_ID, 'INV-4999');
    expect(reads).toHaveBeenCalledTimes(1);
    expect(indexWork()).toBe(0);

    reads.mockClear();
    const first = await queries.listReservations(
      PROGRAM_ID,
      { limit: 50, cursor: null },
      ReservationStatus.Active,
    );
    await queries.listReservations(
      PROGRAM_ID,
      { limit: 50, cursor: first.nextCursor },
      ReservationStatus.Active,
    );
    expect(reads).toHaveBeenCalledTimes(100);
    expect(indexWork()).toBeLessThan(2 * INDEX_WORK_PER_REQUEST);
  });

  it('a snapshot reads the active reservations it has to compare, never the released ones', async () => {
    const result = await new ReconcileProgramUseCase(repository, clock).execute({
      programId: PROGRAM_ID,
      sequence: 1,
      asOf: clock.now(),
      currency: 'USD',
      creditLimit: '100000000.00',
      activeReservations: [
        {
          invoiceId: 'INV-0',
          invoiceAmount: '10.00',
          invoiceCurrency: 'USD',
          reservedAmount: '10.00',
        },
      ],
    });

    expect(result).toMatchObject({ unchanged: 1, released: RESERVATIONS / 2 - 1 });
    expect(reads).toHaveBeenCalledTimes(RESERVATIONS / 2);
    expect(writes).toHaveBeenCalledTimes(RESERVATIONS / 2 - 1);
    // Proportional to the active reservations it releases, not to the history.
    expect(indexWork()).toBeLessThan((RESERVATIONS / 2) * INDEX_WORK_PER_REQUEST);
  });
});
