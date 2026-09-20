import { Currency } from './currency';
import { RoundingMode } from './decimal';
import {
  CurrencyMismatchError,
  InsufficientCapacityError,
  InvalidTreasurySnapshotError,
  NegativeCreditLimitError,
  NonPositiveAmountError,
  ReservationConflictError,
  ReservationNotFoundError,
} from './errors';
import { ExchangeRate } from './exchange-rate';
import { Money } from './money';
import { Reservation, ReservationProps, ReservationStatus } from './reservation';

/**
 * Invoice amounts are converted into program currency rounding away from zero, so a
 * reservation never consumes less capacity than the invoice is worth.
 */
export const RESERVATION_ROUNDING = RoundingMode.Up;

export interface ReserveCapacityInput {
  readonly invoiceId: string;
  readonly invoiceAmount: Money;
  /** Rate from the invoice currency to the program currency (identity when equal). */
  readonly exchangeRate: ExchangeRate;
  readonly at: Date;
}

export interface ReserveCapacityResult {
  readonly reservation: Reservation;
  /** False when the call was an idempotent replay of an existing reservation. */
  readonly created: boolean;
}

export interface ReleaseReservationResult {
  readonly reservation: Reservation;
  /** False when the reservation had already been released. */
  readonly released: boolean;
}

export interface TreasuryLimitChange {
  /** Per-program monotonic sequence assigned by treasury; stale sequences are ignored. */
  readonly sequence: number;
  readonly creditLimit: Money;
}

export interface TreasurySnapshotReservation {
  readonly invoiceId: string;
  readonly invoiceAmount: Money;
  /** Capacity consumed, in program currency. */
  readonly reservedAmount: Money;
}

/** Full state of a program as treasury sees it at `asOf`. */
export interface TreasurySnapshot {
  readonly sequence: number;
  readonly asOf: Date;
  readonly creditLimit: Money;
  readonly activeReservations: readonly TreasurySnapshotReservation[];
}

export type TreasuryUpdateOutcome = 'APPLIED' | 'STALE';

export interface ReconciliationResult {
  readonly outcome: TreasuryUpdateOutcome;
  /** Reservations treasury knows about that we did not. */
  readonly added: number;
  /** Local reservations whose amounts or status were overwritten by treasury. */
  readonly updated: number;
  /** Local active reservations absent from the snapshot, released as of the snapshot time. */
  readonly released: number;
  /** Local reservations changed after the snapshot was taken; kept untouched. */
  readonly preserved: number;
  readonly unchanged: number;
}

const NO_RECONCILIATION_CHANGES = {
  added: 0,
  updated: 0,
  released: 0,
  preserved: 0,
  unchanged: 0,
} as const;

/** Persistence-friendly, primitive-only shape of a reservation. */
export interface ReservationMemento {
  readonly invoiceId: string;
  readonly invoiceAmount: string;
  readonly invoiceCurrency: string;
  readonly reservedAmount: string;
  readonly exchangeRate: string | null;
  readonly status: ReservationStatus;
  readonly reservedAt: Date;
  readonly releasedAt: Date | null;
  readonly updatedAt: Date;
}

/** Persistence-friendly, primitive-only shape of a program. Amounts are decimal strings. */
export interface ProgramMemento {
  readonly id: string;
  readonly currency: string;
  readonly creditLimit: string;
  readonly reservedTotal: string;
  readonly reservations: readonly ReservationMemento[];
  readonly lastTreasurySequence: number | null;
  readonly lastReconciledAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Aggregate root. Owns the single invariant that matters:
 *
 *   sum(active reservations) <= credit limit   (for reservations made through this service)
 *
 * Treasury is the system of record for limits and may lower a limit below the amount already
 * reserved; the program then reports zero availability until releases catch up.
 */
export class Program {
  private constructor(
    readonly id: string,
    readonly currency: Currency,
    private creditLimitValue: Money,
    private reservedTotalValue: Money,
    private reservations: Map<string, Reservation>,
    private lastTreasurySequenceValue: number | null,
    private lastReconciledAtValue: Date | null,
    /** Persisted version used for optimistic concurrency control. */
    readonly version: number,
    readonly createdAt: Date,
    private updatedAtValue: Date,
  ) {}

  static create(input: { id: string; creditLimit: Money; at: Date }): Program {
    Program.assertValidCreditLimit(input.creditLimit);

    return new Program(
      input.id,
      input.creditLimit.currency,
      input.creditLimit,
      Money.zero(input.creditLimit.currency),
      new Map(),
      null,
      null,
      0,
      input.at,
      input.at,
    );
  }

  static rehydrate(memento: ProgramMemento): Program {
    const currency = Currency.parse(memento.currency);
    const reservations = new Map<string, Reservation>();

    for (const entry of memento.reservations) {
      reservations.set(entry.invoiceId, Reservation.rehydrate(toReservationProps(entry, currency)));
    }

    return new Program(
      memento.id,
      currency,
      Money.parse(memento.creditLimit, currency),
      Money.parse(memento.reservedTotal, currency),
      reservations,
      memento.lastTreasurySequence,
      memento.lastReconciledAt,
      memento.version,
      memento.createdAt,
      memento.updatedAt,
    );
  }

  toMemento(): ProgramMemento {
    return {
      id: this.id,
      currency: this.currency.code,
      creditLimit: this.creditLimitValue.toDecimalString(),
      reservedTotal: this.reservedTotalValue.toDecimalString(),
      reservations: [...this.reservations.values()].map(toReservationMemento),
      lastTreasurySequence: this.lastTreasurySequenceValue,
      lastReconciledAt: this.lastReconciledAtValue,
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAtValue,
    };
  }

  get creditLimit(): Money {
    return this.creditLimitValue;
  }

  /** Sum of all active reservations, in program currency. */
  get reservedTotal(): Money {
    return this.reservedTotalValue;
  }

  /** Capacity left for new reservations; never negative. */
  get available(): Money {
    return Money.max(
      this.creditLimitValue.subtract(this.reservedTotalValue),
      Money.zero(this.currency),
    );
  }

  /** True when treasury lowered the limit below what is already reserved. */
  get isOverCommitted(): boolean {
    return this.reservedTotalValue.isGreaterThan(this.creditLimitValue);
  }

  get lastTreasurySequence(): number | null {
    return this.lastTreasurySequenceValue;
  }

  get lastReconciledAt(): Date | null {
    return this.lastReconciledAtValue;
  }

  get updatedAt(): Date {
    return this.updatedAtValue;
  }

  get activeReservationCount(): number {
    let count = 0;

    for (const reservation of this.reservations.values()) {
      if (reservation.isActive) {
        count += 1;
      }
    }

    return count;
  }

  findReservation(invoiceId: string): Reservation | undefined {
    return this.reservations.get(invoiceId);
  }

  /** All reservations, oldest first. */
  listReservations(): Reservation[] {
    return [...this.reservations.values()].sort(
      (a, b) =>
        a.reservedAt.getTime() - b.reservedAt.getTime() || a.invoiceId.localeCompare(b.invoiceId),
    );
  }

  /**
   * Reserves capacity for an invoice. Idempotent on invoice id: repeating a request with
   * the same invoice amount returns the existing reservation; a different amount is a conflict.
   */
  reserve(input: ReserveCapacityInput): ReserveCapacityResult {
    if (!input.invoiceAmount.isPositive) {
      throw new NonPositiveAmountError(input.invoiceAmount.toString(), 'Invoice amount');
    }
    if (
      !input.exchangeRate.base.equals(input.invoiceAmount.currency) ||
      !input.exchangeRate.quote.equals(this.currency)
    ) {
      throw new CurrencyMismatchError(
        `${input.invoiceAmount.currency.code}/${this.currency.code}`,
        `${input.exchangeRate.base.code}/${input.exchangeRate.quote.code}`,
        'Exchange rate does not match the invoice and program currencies',
      );
    }

    const existing = this.reservations.get(input.invoiceId);
    if (existing !== undefined) {
      if (existing.invoiceAmount.equals(input.invoiceAmount)) {
        return { reservation: existing, created: false };
      }

      throw new ReservationConflictError(
        this.id,
        input.invoiceId,
        existing.invoiceAmount.toString(),
        input.invoiceAmount.toString(),
      );
    }

    const reservedAmount = input.exchangeRate.convert(input.invoiceAmount, RESERVATION_ROUNDING);
    if (reservedAmount.isGreaterThan(this.available)) {
      throw new InsufficientCapacityError(
        this.id,
        reservedAmount.toString(),
        this.available.toString(),
      );
    }

    const reservation = Reservation.create({
      invoiceId: input.invoiceId,
      invoiceAmount: input.invoiceAmount,
      reservedAmount,
      exchangeRate: input.exchangeRate,
      at: input.at,
    });

    this.reservations.set(reservation.invoiceId, reservation);
    this.reservedTotalValue = this.reservedTotalValue.add(reservedAmount);
    this.touch(input.at);

    return { reservation, created: true };
  }

  /** Releases a reservation, giving its capacity back. Idempotent: releasing twice is a no-op. */
  release(input: { invoiceId: string; at: Date }): ReleaseReservationResult {
    const existing = this.reservations.get(input.invoiceId);
    if (existing === undefined) {
      throw new ReservationNotFoundError(this.id, input.invoiceId);
    }
    if (!existing.isActive) {
      return { reservation: existing, released: false };
    }

    const released = existing.release(input.at);
    this.reservations.set(released.invoiceId, released);
    this.reservedTotalValue = this.reservedTotalValue.subtract(released.reservedAmount);
    this.touch(input.at);

    return { reservation: released, released: true };
  }

  /** Applies a treasury limit change unless a newer treasury update was already applied. */
  applyTreasuryLimitChange(change: TreasuryLimitChange, at: Date): TreasuryUpdateOutcome {
    if (this.isStaleTreasurySequence(change.sequence)) {
      return 'STALE';
    }
    this.assertProgramCurrency(change.creditLimit, 'Credit limit');
    Program.assertValidCreditLimit(change.creditLimit);

    this.creditLimitValue = change.creditLimit;
    this.lastTreasurySequenceValue = change.sequence;
    this.touch(at);

    return 'APPLIED';
  }

  /**
   * Brings the program in line with a full treasury snapshot.
   *
   * Treasury wins for everything it knew at `asOf`. Reservations this service changed after
   * `asOf` are newer facts than the snapshot and are kept as they are; the next snapshot will
   * confirm or correct them. Active reservations missing from the snapshot are released.
   */
  reconcile(snapshot: TreasurySnapshot, at: Date): ReconciliationResult {
    if (this.isStaleTreasurySequence(snapshot.sequence)) {
      return { outcome: 'STALE', ...NO_RECONCILIATION_CHANGES };
    }
    this.assertProgramCurrency(snapshot.creditLimit, 'Credit limit');
    Program.assertValidCreditLimit(snapshot.creditLimit);
    this.assertValidSnapshotEntries(snapshot.activeReservations);

    const counters = { ...NO_RECONCILIATION_CHANGES } as {
      -readonly [K in keyof typeof NO_RECONCILIATION_CHANGES]: number;
    };
    const next = new Map<string, Reservation>();

    for (const [invoiceId, local] of this.reservations) {
      if (local.wasModifiedAfter(snapshot.asOf)) {
        next.set(invoiceId, local);
        counters.preserved += 1;
      }
    }

    for (const entry of snapshot.activeReservations) {
      if (next.has(entry.invoiceId)) {
        continue;
      }

      const local = this.reservations.get(entry.invoiceId);
      if (local === undefined) {
        next.set(
          entry.invoiceId,
          Reservation.fromTreasurySnapshot({ ...entry, asOf: snapshot.asOf }),
        );
        counters.added += 1;
      } else if (local.matches(entry.invoiceAmount, entry.reservedAmount)) {
        next.set(entry.invoiceId, local);
        counters.unchanged += 1;
      } else {
        next.set(
          entry.invoiceId,
          local.correctedBySnapshot(entry.invoiceAmount, entry.reservedAmount, snapshot.asOf),
        );
        counters.updated += 1;
      }
    }

    for (const [invoiceId, local] of this.reservations) {
      if (next.has(invoiceId)) {
        continue;
      }
      if (local.isActive) {
        next.set(invoiceId, local.release(snapshot.asOf));
        counters.released += 1;
      } else {
        next.set(invoiceId, local);
      }
    }

    this.reservations = next;
    this.reservedTotalValue = this.sumActiveReservations();
    this.creditLimitValue = snapshot.creditLimit;
    this.lastTreasurySequenceValue = snapshot.sequence;
    this.lastReconciledAtValue = snapshot.asOf;
    this.touch(at);

    return { outcome: 'APPLIED', ...counters };
  }

  private sumActiveReservations(): Money {
    let total = Money.zero(this.currency);

    for (const reservation of this.reservations.values()) {
      if (reservation.isActive) {
        total = total.add(reservation.reservedAmount);
      }
    }

    return total;
  }

  private isStaleTreasurySequence(sequence: number): boolean {
    return this.lastTreasurySequenceValue !== null && sequence <= this.lastTreasurySequenceValue;
  }

  private assertValidSnapshotEntries(entries: readonly TreasurySnapshotReservation[]): void {
    const seen = new Set<string>();

    for (const entry of entries) {
      if (seen.has(entry.invoiceId)) {
        throw new InvalidTreasurySnapshotError(
          this.id,
          `invoice "${entry.invoiceId}" appears more than once`,
        );
      }

      seen.add(entry.invoiceId);

      this.assertProgramCurrency(
        entry.reservedAmount,
        `Reserved amount of invoice "${entry.invoiceId}"`,
      );
      if (!entry.reservedAmount.isPositive) {
        throw new NonPositiveAmountError(
          entry.reservedAmount.toString(),
          `Reserved amount of invoice "${entry.invoiceId}"`,
        );
      }
      if (!entry.invoiceAmount.isPositive) {
        throw new NonPositiveAmountError(
          entry.invoiceAmount.toString(),
          `Invoice amount of invoice "${entry.invoiceId}"`,
        );
      }
    }
  }

  private assertProgramCurrency(amount: Money, context: string): void {
    if (!amount.currency.equals(this.currency)) {
      throw new CurrencyMismatchError(
        this.currency.code,
        amount.currency.code,
        `${context} must be in the program currency`,
      );
    }
  }

  private static assertValidCreditLimit(creditLimit: Money): void {
    if (creditLimit.isNegative) {
      throw new NegativeCreditLimitError(creditLimit.toString());
    }
  }

  private touch(at: Date): void {
    this.updatedAtValue = at;
  }
}

function toReservationMemento(reservation: Reservation): ReservationMemento {
  return {
    invoiceId: reservation.invoiceId,
    invoiceAmount: reservation.invoiceAmount.toDecimalString(),
    invoiceCurrency: reservation.invoiceAmount.currency.code,
    reservedAmount: reservation.reservedAmount.toDecimalString(),
    exchangeRate: reservation.exchangeRate?.toDecimalString() ?? null,
    status: reservation.status,
    reservedAt: reservation.reservedAt,
    releasedAt: reservation.releasedAt,
    updatedAt: reservation.updatedAt,
  };
}

function toReservationProps(
  memento: ReservationMemento,
  programCurrency: Currency,
): ReservationProps {
  const invoiceCurrency = Currency.parse(memento.invoiceCurrency);

  return {
    invoiceId: memento.invoiceId,
    invoiceAmount: Money.parse(memento.invoiceAmount, invoiceCurrency),
    reservedAmount: Money.parse(memento.reservedAmount, programCurrency),
    exchangeRate:
      memento.exchangeRate === null
        ? null
        : ExchangeRate.parse(invoiceCurrency, programCurrency, memento.exchangeRate),
    status: memento.status,
    reservedAt: memento.reservedAt,
    releasedAt: memento.releasedAt,
    updatedAt: memento.updatedAt,
  };
}
