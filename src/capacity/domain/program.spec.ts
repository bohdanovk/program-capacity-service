import { Currency } from './currency';
import {
  CurrencyMismatchError,
  InsufficientCapacityError,
  InvalidTreasurySnapshotError,
  NegativeCreditLimitError,
  NonPositiveAmountError,
  ReservationConflictError,
  ReservationNotFoundError,
  ReservationsNotLoadedError,
} from './errors';
import { ExchangeRate } from './exchange-rate';
import { Money } from './money';
import {
  invoiceScope,
  NO_RESERVATIONS,
  Program,
  reconciliationScope,
  ReservationScope,
  TreasurySnapshot,
} from './program';
import { ReservationStatus } from './reservation';

const USD = Currency.of('USD');
const EUR = Currency.of('EUR');
const usd = (amount: string): Money => Money.parse(amount, USD);
const eur = (amount: string): Money => Money.parse(amount, EUR);
const identity = ExchangeRate.identity(USD);
const eurUsd = ExchangeRate.parse(EUR, USD, '1.0850');

const T0 = new Date('2026-09-19T10:00:00.000Z');
const T1 = new Date('2026-09-19T10:01:00.000Z');
const T2 = new Date('2026-09-19T10:02:00.000Z');
const T3 = new Date('2026-09-19T10:03:00.000Z');

function programWithLimit(limit: string): Program {
  return Program.create({ id: 'PRG-1', creditLimit: usd(limit), at: T0 });
}

describe('Program', () => {
  describe('creation', () => {
    it('starts with the whole limit available', () => {
      const program = programWithLimit('1000.00');
      expect(program.currency.code).toBe('USD');
      expect(program.available.toString()).toBe('1000.00 USD');
      expect(program.reservedTotal.isZero).toBe(true);
      expect(program.version).toBe(0);
    });

    it('rejects a negative limit', () => {
      expect(() => Program.create({ id: 'PRG-1', creditLimit: usd('-1.00'), at: T0 })).toThrow(
        NegativeCreditLimitError,
      );
    });
  });

  describe('reserve', () => {
    it('consumes capacity in program currency, converting and rounding up', () => {
      const program = programWithLimit('1000.00');
      const { reservation, created } = program.reserve({
        invoiceId: 'INV-1',
        invoiceAmount: eur('100.01'),
        exchangeRate: eurUsd,
        at: T1,
      });

      expect(created).toBe(true);
      // 100.01 * 1.085 = 108.51085 -> 108.52
      expect(reservation.reservedAmount.toString()).toBe('108.52 USD');
      expect(reservation.invoiceAmount.toString()).toBe('100.01 EUR');
      expect(reservation.exchangeRate?.toDecimalString()).toBe('1.085');
      expect(reservation.status).toBe(ReservationStatus.Active);
      expect(program.reservedTotal.toString()).toBe('108.52 USD');
      expect(program.available.toString()).toBe('891.48 USD');
      expect(program.activeReservationCount).toBe(1);
    });

    it('allows reserving exactly the remaining capacity but not one minor unit more', () => {
      const program = programWithLimit('1000.00');
      program.reserve({
        invoiceId: 'INV-1',
        invoiceAmount: usd('400.00'),
        exchangeRate: identity,
        at: T1,
      });

      expect(() =>
        program.reserve({
          invoiceId: 'INV-2',
          invoiceAmount: usd('600.01'),
          exchangeRate: identity,
          at: T1,
        }),
      ).toThrow(InsufficientCapacityError);
      expect(program.activeReservationCount).toBe(1);
      expect(program.available.toString()).toBe('600.00 USD');

      program.reserve({
        invoiceId: 'INV-2',
        invoiceAmount: usd('600.00'),
        exchangeRate: identity,
        at: T1,
      });
      expect(program.available.isZero).toBe(true);
    });

    it('is idempotent for the same invoice and amount', () => {
      const program = programWithLimit('1000.00');
      const first = program.reserve({
        invoiceId: 'INV-1',
        invoiceAmount: usd('100.00'),
        exchangeRate: identity,
        at: T1,
      });
      const replay = program.reserve({
        invoiceId: 'INV-1',
        invoiceAmount: usd('100.00'),
        exchangeRate: identity,
        at: T2,
      });

      expect(replay.created).toBe(false);
      expect(replay.reservation).toBe(first.reservation);
      expect(program.reservedTotal.toString()).toBe('100.00 USD');
    });

    it('rejects a different amount for an already reserved invoice', () => {
      const program = programWithLimit('1000.00');
      program.reserve({
        invoiceId: 'INV-1',
        invoiceAmount: usd('100.00'),
        exchangeRate: identity,
        at: T1,
      });

      expect(() =>
        program.reserve({
          invoiceId: 'INV-1',
          invoiceAmount: usd('100.01'),
          exchangeRate: identity,
          at: T2,
        }),
      ).toThrow(ReservationConflictError);
    });

    it('rejects non-positive amounts and mismatched exchange rates', () => {
      const program = programWithLimit('1000.00');
      expect(() =>
        program.reserve({
          invoiceId: 'INV-1',
          invoiceAmount: usd('0.00'),
          exchangeRate: identity,
          at: T1,
        }),
      ).toThrow(NonPositiveAmountError);
      expect(() =>
        program.reserve({
          invoiceId: 'INV-1',
          invoiceAmount: eur('1.00'),
          exchangeRate: identity,
          at: T1,
        }),
      ).toThrow(CurrencyMismatchError);
    });
  });

  describe('release', () => {
    it('gives the reserved amount back and is idempotent', () => {
      const program = programWithLimit('1000.00');
      program.reserve({
        invoiceId: 'INV-1',
        invoiceAmount: eur('100.01'),
        exchangeRate: eurUsd,
        at: T1,
      });

      const first = program.release({ invoiceId: 'INV-1', at: T2 });
      expect(first.released).toBe(true);
      expect(first.reservation.status).toBe(ReservationStatus.Released);
      expect(first.reservation.releasedAt).toEqual(T2);
      expect(program.available.toString()).toBe('1000.00 USD');
      expect(program.activeReservationCount).toBe(0);

      const second = program.release({ invoiceId: 'INV-1', at: T3 });
      expect(second.released).toBe(false);
      expect(second.reservation.releasedAt).toEqual(T2);
      expect(program.available.toString()).toBe('1000.00 USD');
    });

    it('fails for an unknown invoice', () => {
      expect(() => programWithLimit('1.00').release({ invoiceId: 'nope', at: T1 })).toThrow(
        ReservationNotFoundError,
      );
    });

    it('does not let a released invoice be reserved again through a replay', () => {
      const program = programWithLimit('1000.00');
      program.reserve({
        invoiceId: 'INV-1',
        invoiceAmount: usd('100.00'),
        exchangeRate: identity,
        at: T1,
      });
      program.release({ invoiceId: 'INV-1', at: T2 });

      const replay = program.reserve({
        invoiceId: 'INV-1',
        invoiceAmount: usd('100.00'),
        exchangeRate: identity,
        at: T3,
      });
      expect(replay.created).toBe(false);
      expect(replay.reservation.status).toBe(ReservationStatus.Released);
      expect(program.reservedTotal.isZero).toBe(true);
    });
  });

  describe('treasury limit changes', () => {
    it('applies limits in sequence order and ignores stale ones', () => {
      const program = programWithLimit('1000.00');
      expect(
        program.applyTreasuryLimitChange({ sequence: 5, creditLimit: usd('2000.00') }, T1),
      ).toBe('APPLIED');
      expect(program.applyTreasuryLimitChange({ sequence: 5, creditLimit: usd('1.00') }, T2)).toBe(
        'STALE',
      );
      expect(program.applyTreasuryLimitChange({ sequence: 4, creditLimit: usd('1.00') }, T2)).toBe(
        'STALE',
      );
      expect(program.creditLimit.toString()).toBe('2000.00 USD');
      expect(program.lastTreasurySequence).toBe(5);
    });

    it('accepts a limit below the reserved amount and reports zero availability', () => {
      const program = programWithLimit('1000.00');
      program.reserve({
        invoiceId: 'INV-1',
        invoiceAmount: usd('800.00'),
        exchangeRate: identity,
        at: T1,
      });
      program.applyTreasuryLimitChange({ sequence: 1, creditLimit: usd('500.00') }, T2);

      expect(program.available.isZero).toBe(true);
      expect(program.isOverCommitted).toBe(true);
      expect(program.reservedTotal.toString()).toBe('800.00 USD');
      expect(() =>
        program.reserve({
          invoiceId: 'INV-2',
          invoiceAmount: usd('0.01'),
          exchangeRate: identity,
          at: T3,
        }),
      ).toThrow(InsufficientCapacityError);
    });

    it('rejects a limit in another currency', () => {
      expect(() =>
        programWithLimit('1000.00').applyTreasuryLimitChange(
          { sequence: 1, creditLimit: eur('1.00') },
          T1,
        ),
      ).toThrow(CurrencyMismatchError);
    });
  });

  describe('reconcile', () => {
    function programWithThreeReservations(): Program {
      const program = programWithLimit('10000.00');
      program.reserve({
        invoiceId: 'INV-KEEP',
        invoiceAmount: usd('100.00'),
        exchangeRate: identity,
        at: T1,
      });
      program.reserve({
        invoiceId: 'INV-FIX',
        invoiceAmount: eur('100.00'),
        exchangeRate: eurUsd,
        at: T1,
      });
      program.reserve({
        invoiceId: 'INV-GONE',
        invoiceAmount: usd('300.00'),
        exchangeRate: identity,
        at: T1,
      });
      return program;
    }

    it('makes the program match the snapshot: adds, corrects, releases, keeps', () => {
      const program = programWithThreeReservations();

      const result = program.reconcile(
        {
          sequence: 7,
          asOf: T2,
          creditLimit: usd('20000.00'),
          activeReservations: [
            { invoiceId: 'INV-KEEP', invoiceAmount: usd('100.00'), reservedAmount: usd('100.00') },
            { invoiceId: 'INV-FIX', invoiceAmount: eur('100.00'), reservedAmount: usd('110.00') },
            { invoiceId: 'INV-NEW', invoiceAmount: eur('50.00'), reservedAmount: usd('55.00') },
          ],
        },
        T3,
      );

      expect(result).toEqual({
        outcome: 'APPLIED',
        added: 1,
        updated: 1,
        released: 1,
        preserved: 0,
        unchanged: 1,
      });
      expect(program.creditLimit.toString()).toBe('20000.00 USD');
      expect(program.reservedTotal.toString()).toBe('265.00 USD');
      expect(program.lastTreasurySequence).toBe(7);
      expect(program.lastReconciledAt).toEqual(T2);

      const gone = program.findReservation('INV-GONE')!;
      expect(gone.status).toBe(ReservationStatus.Released);
      expect(gone.releasedAt).toEqual(T2);

      const fixed = program.findReservation('INV-FIX')!;
      expect(fixed.reservedAmount.toString()).toBe('110.00 USD');
      expect(fixed.exchangeRate).toBeNull();
      expect(fixed.reservedAt).toEqual(T1);

      const added = program.findReservation('INV-NEW')!;
      expect(added.reservedAt).toEqual(T2);
      expect(added.exchangeRate).toBeNull();
    });

    it('keeps local changes that happened after the snapshot was taken', () => {
      const program = programWithLimit('10000.00');
      program.reserve({
        invoiceId: 'INV-OLD',
        invoiceAmount: usd('100.00'),
        exchangeRate: identity,
        at: T1,
      });
      // Both of these happen after the snapshot's asOf (T2):
      program.release({ invoiceId: 'INV-OLD', at: T3 });
      program.reserve({
        invoiceId: 'INV-LATE',
        invoiceAmount: usd('200.00'),
        exchangeRate: identity,
        at: T3,
      });

      const result = program.reconcile(
        {
          sequence: 1,
          asOf: T2,
          creditLimit: usd('10000.00'),
          // Treasury still sees INV-OLD as active and does not know INV-LATE yet.
          activeReservations: [
            { invoiceId: 'INV-OLD', invoiceAmount: usd('100.00'), reservedAmount: usd('100.00') },
          ],
        },
        T3,
      );

      expect(result).toMatchObject({
        outcome: 'APPLIED',
        preserved: 2,
        added: 0,
        released: 0,
        updated: 0,
      });
      expect(program.findReservation('INV-OLD')?.status).toBe(ReservationStatus.Released);
      expect(program.findReservation('INV-LATE')?.status).toBe(ReservationStatus.Active);
      expect(program.reservedTotal.toString()).toBe('200.00 USD');
    });

    it('ignores a snapshot that is not newer than the last applied treasury message', () => {
      const program = programWithThreeReservations();
      program.applyTreasuryLimitChange({ sequence: 9, creditLimit: usd('10000.00') }, T1);

      const result = program.reconcile(
        { sequence: 9, asOf: T2, creditLimit: usd('1.00'), activeReservations: [] },
        T3,
      );

      expect(result.outcome).toBe('STALE');
      expect(program.activeReservationCount).toBe(3);
      expect(program.creditLimit.toString()).toBe('10000.00 USD');
    });

    it('rejects snapshots that contradict the program', () => {
      const program = programWithLimit('1000.00');
      expect(() =>
        program.reconcile(
          {
            sequence: 1,
            asOf: T1,
            creditLimit: usd('1000.00'),
            activeReservations: [
              { invoiceId: 'DUP', invoiceAmount: usd('1.00'), reservedAmount: usd('1.00') },
              { invoiceId: 'DUP', invoiceAmount: usd('1.00'), reservedAmount: usd('1.00') },
            ],
          },
          T2,
        ),
      ).toThrow(InvalidTreasurySnapshotError);

      expect(() =>
        program.reconcile(
          {
            sequence: 1,
            asOf: T1,
            creditLimit: usd('1000.00'),
            activeReservations: [
              { invoiceId: 'X', invoiceAmount: eur('1.00'), reservedAmount: eur('1.00') },
            ],
          },
          T2,
        ),
      ).toThrow(CurrencyMismatchError);
      expect(program.lastTreasurySequence).toBeNull();
    });
  });

  it('survives a persistence round trip unchanged', () => {
    const program = programWithLimit('1000.00');
    program.reserve({
      invoiceId: 'INV-1',
      invoiceAmount: eur('100.01'),
      exchangeRate: eurUsd,
      at: T1,
    });
    program.reserve({
      invoiceId: 'INV-2',
      invoiceAmount: usd('10.00'),
      exchangeRate: identity,
      at: T1,
    });
    program.release({ invoiceId: 'INV-2', at: T2 });
    program.applyTreasuryLimitChange({ sequence: 3, creditLimit: usd('900.00') }, T2);

    const memento = program.toMemento();
    const reservations = program.changedReservations();
    const restored = Program.rehydrate(overTheWire(memento), {
      scope: { invoiceIds: ['INV-1', 'INV-2'], allActive: false },
      reservations: overTheWire(reservations),
    });

    expect(restored.toMemento()).toEqual(memento);
    expect(restored.changedReservations()).toEqual([]);
    expect(restored.available.toString()).toBe('791.48 USD');
    expect(restored.activeReservationCount).toBe(1);
    expect(restored.findReservation('INV-1')?.exchangeRate?.toDecimalString()).toBe('1.085');
    expect(restored.findReservation('INV-2')?.toMemento()).toEqual(reservations[1]);
  });

  describe('loaded with a reservation scope', () => {
    /**
     * Saves the program the way a repository does and returns a loader that reads it back
     * with any scope, selecting reservations exactly as the repository contract says.
     */
    function store(program: Program): (scope: ReservationScope) => Program {
      const record = program.toMemento();
      const reservations = program.changedReservations();
      return (scope) =>
        Program.rehydrate(record, {
          scope,
          reservations: reservations.filter(
            (reservation) =>
              scope.invoiceIds.includes(reservation.invoiceId) ||
              (scope.allActive && reservation.status === ReservationStatus.Active),
          ),
        });
    }

    function programWithHistory(): (scope: ReservationScope) => Program {
      const program = programWithLimit('1000.00');
      for (const invoiceId of ['INV-A', 'INV-B', 'INV-OLD']) {
        program.reserve({
          invoiceId,
          invoiceAmount: usd('100.00'),
          exchangeRate: identity,
          at: T1,
        });
      }
      program.release({ invoiceId: 'INV-OLD', at: T1 });
      return store(program);
    }

    it('knows its capacity without loading a single reservation', () => {
      const program = programWithHistory()(NO_RESERVATIONS);

      expect(program.reservedTotal.toString()).toBe('200.00 USD');
      expect(program.available.toString()).toBe('800.00 USD');
      expect(program.activeReservationCount).toBe(2);
    });

    it('refuses to act on reservations it was not loaded with', () => {
      const program = programWithHistory()(invoiceScope('INV-A'));

      // INV-OLD exists but was not loaded; treating it as unknown would let it be reserved again.
      expect(() => program.findReservation('INV-OLD')).toThrow(ReservationsNotLoadedError);
      expect(() =>
        program.reserve({
          invoiceId: 'INV-OLD',
          invoiceAmount: usd('100.00'),
          exchangeRate: identity,
          at: T2,
        }),
      ).toThrow(ReservationsNotLoadedError);
      expect(() => program.release({ invoiceId: 'INV-B', at: T2 })).toThrow(
        ReservationsNotLoadedError,
      );
      expect(program.findReservation('INV-A')?.status).toBe(ReservationStatus.Active);
    });

    it('reserves and releases with only the invoice concerned, and writes only that one', () => {
      const load = programWithHistory();

      const reserving = load(invoiceScope('INV-NEW'));
      reserving.reserve({
        invoiceId: 'INV-NEW',
        invoiceAmount: usd('50.00'),
        exchangeRate: identity,
        at: T2,
      });
      expect(reserving.reservedTotal.toString()).toBe('250.00 USD');
      expect(reserving.activeReservationCount).toBe(3);
      expect(reserving.changedReservations().map((entry) => entry.invoiceId)).toEqual(['INV-NEW']);

      const releasing = load(invoiceScope('INV-A'));
      releasing.release({ invoiceId: 'INV-A', at: T2 });
      expect(releasing.reservedTotal.toString()).toBe('100.00 USD');
      expect(releasing.activeReservationCount).toBe(1);
      expect(releasing.changedReservations().map((entry) => entry.invoiceId)).toEqual(['INV-A']);
    });

    it('still recognises a released invoice when that invoice is loaded', () => {
      const program = programWithHistory()(invoiceScope('INV-OLD'));

      const replay = program.reserve({
        invoiceId: 'INV-OLD',
        invoiceAmount: usd('100.00'),
        exchangeRate: identity,
        at: T2,
      });

      expect(replay.created).toBe(false);
      expect(replay.reservation.status).toBe(ReservationStatus.Released);
      expect(program.changedReservations()).toEqual([]);
    });

    it('reconciles from the active and the named reservations, leaving history unread', () => {
      const load = programWithHistory();
      const snapshot: TreasurySnapshot = {
        sequence: 1,
        asOf: T2,
        creditLimit: usd('1000.00'),
        activeReservations: [
          { invoiceId: 'INV-A', invoiceAmount: usd('100.00'), reservedAmount: usd('100.00') },
          { invoiceId: 'INV-C', invoiceAmount: usd('30.00'), reservedAmount: usd('30.00') },
        ],
      };

      const program = load(reconciliationScope(snapshot));
      const result = program.reconcile(snapshot, T3);

      expect(result).toMatchObject({ added: 1, released: 1, unchanged: 1, updated: 0 });
      expect(program.reservedTotal.toString()).toBe('130.00 USD');
      expect(program.activeReservationCount).toBe(2);
      expect(program.changedReservations().map((entry) => entry.invoiceId)).toEqual([
        'INV-C',
        'INV-B',
      ]);
      expect(() => program.findReservation('INV-OLD')).toThrow(ReservationsNotLoadedError);
    });

    it('refuses to reconcile without every active reservation and every named one', () => {
      const load = programWithHistory();
      const snapshot: TreasurySnapshot = {
        sequence: 1,
        asOf: T2,
        creditLimit: usd('1000.00'),
        activeReservations: [
          { invoiceId: 'INV-A', invoiceAmount: usd('100.00'), reservedAmount: usd('100.00') },
        ],
      };

      expect(() => load(invoiceScope('INV-A')).reconcile(snapshot, T3)).toThrow(
        ReservationsNotLoadedError,
      );
      expect(() => load({ invoiceIds: [], allActive: true }).reconcile(snapshot, T3)).toThrow(
        ReservationsNotLoadedError,
      );
    });
  });
});

/** What a store that serialises to JSON hands back. */
function overTheWire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), reviveDates) as T;
}

function reviveDates(key: string, value: unknown): unknown {
  return typeof value === 'string' && key.endsWith('At') ? new Date(value) : value;
}
