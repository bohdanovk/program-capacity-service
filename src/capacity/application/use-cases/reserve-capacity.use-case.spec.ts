import { Currency } from '../../domain/currency';
import {
  ConcurrencyConflictError,
  InsufficientCapacityError,
  ProgramNotFoundError,
  UnsupportedCurrencyPairError,
} from '../../domain/errors';
import { Money } from '../../domain/money';
import { Clock } from '../../domain/ports/clock';
import { Program } from '../../domain/program';
import { StaticFxRateProvider } from '../../infrastructure/fx/static-fx-rate.provider';
import { InMemoryProgramRepository } from '../../infrastructure/persistence/in-memory-program.repository';
import { ReserveCapacityUseCase } from './reserve-capacity.use-case';

const fixedClock: Clock = { now: () => new Date('2026-09-19T10:00:00.000Z') };

async function setup(limit: string): Promise<{
  useCase: ReserveCapacityUseCase;
  repository: InMemoryProgramRepository;
}> {
  const repository = new InMemoryProgramRepository();
  await repository.save(
    Program.create({
      id: 'PRG-1',
      creditLimit: Money.parse(limit, Currency.of('USD')),
      at: fixedClock.now(),
    }),
  );
  const fx = new StaticFxRateProvider([{ base: 'EUR', quote: 'USD', rate: '1.0850' }]);
  return { useCase: new ReserveCapacityUseCase(repository, fx, fixedClock), repository };
}

function reserve(
  useCase: ReserveCapacityUseCase,
  invoiceId: string,
  amount: string,
  currency = 'USD',
): ReturnType<ReserveCapacityUseCase['execute']> {
  return useCase.execute({ programId: 'PRG-1', invoiceId, invoiceAmount: { amount, currency } });
}

describe('ReserveCapacityUseCase', () => {
  it('converts foreign-currency invoices through the FX port', async () => {
    const { useCase } = await setup('1000.00');
    const outcome = await reserve(useCase, 'INV-1', '100.00', 'EUR');

    expect(outcome.created).toBe(true);
    expect(outcome.reservation.reservedAmount).toEqual({ amount: '108.50', currency: 'USD' });
    expect(outcome.reservation.exchangeRate).toBe('1.085');
  });

  it('fails clearly when no rate is configured or the program is unknown', async () => {
    const { useCase } = await setup('1000.00');
    await expect(reserve(useCase, 'INV-1', '100.00', 'GBP')).rejects.toBeInstanceOf(
      UnsupportedCurrencyPairError,
    );
    await expect(
      useCase.execute({
        programId: 'nope',
        invoiceId: 'INV-1',
        invoiceAmount: { amount: '1.00', currency: 'USD' },
      }),
    ).rejects.toBeInstanceOf(ProgramNotFoundError);
  });

  it('never over-allocates when two reservations race for the last capacity', async () => {
    const { useCase, repository } = await setup('100.00');

    const results = await Promise.allSettled([
      reserve(useCase, 'INV-A', '60.00'),
      reserve(useCase, 'INV-B', '60.00'),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The loser retried on the version conflict, reloaded, and hit the real business rule.
    expect(rejected[0]?.reason).toBeInstanceOf(InsufficientCapacityError);

    const program = await repository.findById('PRG-1');
    expect(program?.reservedTotal.toDecimalString()).toBe('60.00');
    expect(program?.activeReservationCount).toBe(1);
  });

  it('keeps the invariant under a burst of concurrent reservations', async () => {
    const { useCase, repository } = await setup('50.00');
    const attempts = Array.from({ length: 10 }, (_, i) => reserve(useCase, `INV-${i}`, '10.00'));

    const results = await Promise.allSettled(attempts);
    const successes = results.filter((result) => result.status === 'fulfilled').length;
    for (const result of results) {
      if (result.status === 'rejected') {
        // Only two failures are acceptable: a real capacity shortage, or a retryable conflict.
        expect(
          result.reason instanceof InsufficientCapacityError ||
            result.reason instanceof ConcurrencyConflictError,
        ).toBe(true);
      }
    }

    const program = await repository.findById('PRG-1');
    expect(successes).toBeGreaterThan(0);
    expect(successes).toBeLessThanOrEqual(5);
    expect(program?.reservedTotal.toDecimalString()).toBe(`${successes * 10}.00`);
    expect(program?.available.isNegative).toBe(false);
  });
});
