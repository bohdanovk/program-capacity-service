import { Currency } from '../../domain/currency';
import { ConcurrencyConflictError } from '../../domain/errors';
import { ExchangeRate } from '../../domain/exchange-rate';
import { Money } from '../../domain/money';
import { invoiceScope, NO_RESERVATIONS, Program } from '../../domain/program';
import { Reservation, ReservationStatus } from '../../domain/reservation';
import { InMemoryProgramRepository } from './in-memory-program.repository';

const USD = Currency.of('USD');
const T1 = new Date('2026-09-19T10:01:00.000Z');
const T2 = new Date('2026-09-19T10:02:00.000Z');
const T3 = new Date('2026-09-19T10:03:00.000Z');

async function seeded(): Promise<InMemoryProgramRepository> {
  const repository = new InMemoryProgramRepository();
  const program = Program.create({ id: 'PRG-1', creditLimit: Money.parse('1000.00', USD), at: T1 });
  // INV-B and INV-A share an instant: the invoice id breaks the tie.
  const reservations: [string, Date][] = [
    ['INV-B', T1],
    ['INV-A', T1],
    ['INV-C', T2],
    ['INV-D', T3],
  ];
  for (const [invoiceId, at] of reservations) {
    program.reserve({
      invoiceId,
      invoiceAmount: Money.parse('10.00', USD),
      exchangeRate: ExchangeRate.identity(USD),
      at,
    });
  }
  await repository.save(program);
  return repository;
}

async function release(repository: InMemoryProgramRepository, invoiceId: string): Promise<void> {
  const program = await repository.findById('PRG-1', invoiceScope(invoiceId));
  program?.release({ invoiceId, at: T3 });
  await repository.save(program!);
}

const ids = (items: readonly Reservation[]): string[] => items.map((item) => item.invoiceId);

describe('InMemoryProgramRepository', () => {
  it('lists reservations oldest first, whole or by status, one page at a time', async () => {
    const repository = await seeded();
    await release(repository, 'INV-C');

    const first = await repository.findReservationPage('PRG-1', { limit: 3, cursor: null });
    const second = await repository.findReservationPage('PRG-1', {
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(ids(first.items)).toEqual(['INV-A', 'INV-B', 'INV-C']);
    expect(ids(second.items)).toEqual(['INV-D']);
    expect(second.nextCursor).toBeNull();

    const active = await repository.findReservationPage(
      'PRG-1',
      { limit: 10, cursor: null },
      ReservationStatus.Active,
    );
    const released = await repository.findReservationPage(
      'PRG-1',
      { limit: 10, cursor: null },
      ReservationStatus.Released,
    );
    expect(ids(active.items)).toEqual(['INV-A', 'INV-B', 'INV-D']);
    expect(ids(released.items)).toEqual(['INV-C']);
  });

  it('keeps a cursor valid while the reservations around it change status', async () => {
    const repository = await seeded();
    const first = await repository.findReservationPage(
      'PRG-1',
      { limit: 1, cursor: null },
      ReservationStatus.Active,
    );
    expect(ids(first.items)).toEqual(['INV-A']);

    // The cursor's own item and the next one leave the active list.
    await release(repository, 'INV-A');
    await release(repository, 'INV-B');

    const next = await repository.findReservationPage(
      'PRG-1',
      { limit: 5, cursor: first.nextCursor },
      ReservationStatus.Active,
    );
    expect(ids(next.items)).toEqual(['INV-C', 'INV-D']);
  });

  it('loads the reservations a scope asks for and no others', async () => {
    const repository = await seeded();
    await release(repository, 'INV-A');

    const bare = await repository.findById('PRG-1', NO_RESERVATIONS);
    expect(bare?.activeReservationCount).toBe(3);
    expect(bare?.reservedTotal.toString()).toBe('30.00 USD');

    const one = await repository.findById('PRG-1', invoiceScope('INV-A'));
    expect(one?.findReservation('INV-A')?.status).toBe(ReservationStatus.Released);
    expect(one?.findReservation('INV-A')?.releasedAt).toEqual(T3);

    const active = await repository.findById('PRG-1', { invoiceIds: ['INV-X'], allActive: true });
    expect(active?.findReservation('INV-X')).toBeUndefined();
    expect(active?.changedReservations()).toEqual([]);
  });

  it('rejects a save based on a stale version, and an insert over an existing program', async () => {
    const repository = await seeded();
    const first = await repository.findById('PRG-1');
    const second = await repository.findById('PRG-1');

    await repository.save(first!);
    await expect(repository.save(second!)).rejects.toBeInstanceOf(ConcurrencyConflictError);
    await expect(
      repository.save(
        Program.create({ id: 'PRG-1', creditLimit: Money.parse('1.00', USD), at: T1 }),
      ),
    ).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });
});
