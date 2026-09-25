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
  ReservationsNotLoadedError,
} from './errors';
import { ExchangeRate } from './exchange-rate';
import { Money } from './money';
import { Reservation, ReservationMemento } from './reservation';

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
  /**
   * Local reservations the snapshot concerns (active, or named in it) that changed after it
   * was taken; kept untouched. Released history the snapshot does not name is not counted.
   */
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

/**
 * Persistence-friendly, primitive-only shape of a program. Amounts are decimal strings.
 * Reservations are stored beside it, one record each: the reserved total and the active
 * count live here so that no operation has to read every reservation to know them.
 */
export interface ProgramMemento {
  readonly id: string;
  readonly currency: string;
  readonly creditLimit: string;
  readonly reservedTotal: string;
  readonly activeReservationCount: number;
  readonly lastTreasurySequence: number | null;
  readonly lastReconciledAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Which reservations to load with a program. A program may hold any number of them, released
 * ones included, so an operation loads only those it touches; the aggregate refuses to act
 * on anything outside the scope it was loaded with rather than guess.
 */
export interface ReservationScope {
  /** Invoices whose reservations are loaded, whichever of them exist. */
  readonly invoiceIds: readonly string[];
  /** Also load every active reservation, whatever its invoice. */
  readonly allActive: boolean;
}

/** Enough for the capacity figures and for limit changes. */
export const NO_RESERVATIONS: ReservationScope = { invoiceIds: [], allActive: false };

/** What reserving, releasing or reading one invoice needs. */
export function invoiceScope(invoiceId: string): ReservationScope {
  return { invoiceIds: [invoiceId], allActive: false };
}

/** What applying a snapshot needs: every active reservation and every invoice it names. */
export function reconciliationScope(snapshot: TreasurySnapshot): ReservationScope {
  return {
    invoiceIds: snapshot.activeReservations.map((entry) => entry.invoiceId),
    allActive: true,
  };
}

/** A scope and the stored reservations that fall within it. */
export interface LoadedReservations {
  readonly scope: ReservationScope;
  readonly reservations: readonly ReservationMemento[];
}

/** The reservations a Program instance holds: all of them (a new program), or a loaded scope. */
type Coverage =
  | { readonly complete: true }
  | {
      readonly complete: false;
      readonly invoiceIds: ReadonlySet<string>;
      readonly allActive: boolean;
    };

/**
 * Aggregate root. Owns the single invariant that matters:
 *
 *   sum(active reservations) <= credit limit   (for reservations made through this service)
 *
 * Treasury is the system of record for limits and may lower a limit below the amount already
 * reserved; the program then reports zero availability until releases catch up.
 *
 * The reserved total and the active count are kept up to date on every change, so checking
 * the invariant needs no reservation other than the one being changed. A loaded program
 * holds only the reservations of its {@link ReservationScope}.
 */
export class Program {
  /** Invoices whose reservations changed since the program was created or loaded. */
  private readonly changedInvoiceIds = new Set<string>();

  private constructor(
    readonly id: string,
    readonly currency: Currency,
    private creditLimitValue: Money,
    private reservedTotalValue: Money,
    private activeReservationCountValue: number,
    private reservations: Map<string, Reservation>,
    private readonly coverage: Coverage,
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
      0,
      new Map(),
      { complete: true },
      null,
      null,
      0,
      input.at,
      input.at,
    );
  }

  static rehydrate(memento: ProgramMemento, loaded: LoadedReservations): Program {
    const currency = Currency.parse(memento.currency);
    const reservations = new Map<string, Reservation>();

    for (const entry of loaded.reservations) {
      reservations.set(entry.invoiceId, Reservation.fromMemento(entry, currency));
    }

    return new Program(
      memento.id,
      currency,
      Money.parse(memento.creditLimit, currency),
      Money.parse(memento.reservedTotal, currency),
      memento.activeReservationCount,
      reservations,
      {
        complete: false,
        invoiceIds: new Set(loaded.scope.invoiceIds),
        allActive: loaded.scope.allActive,
      },
      memento.lastTreasurySequence,
      memento.lastReconciledAt,
      memento.version,
      memento.createdAt,
      memento.updatedAt,
    );
  }

  /** The program record itself; reservations are stored separately (see `changedReservations`). */
  toMemento(): ProgramMemento {
    return {
      id: this.id,
      currency: this.currency.code,
      creditLimit: this.creditLimitValue.toDecimalString(),
      reservedTotal: this.reservedTotalValue.toDecimalString(),
      activeReservationCount: this.activeReservationCountValue,
      lastTreasurySequence: this.lastTreasurySequenceValue,
      lastReconciledAt: this.lastReconciledAtValue,
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAtValue,
    };
  }

  /** Reservations created or changed since the program was created or loaded: what a save writes. */
  changedReservations(): ReservationMemento[] {
    const changed: ReservationMemento[] = [];

    for (const invoiceId of this.changedInvoiceIds) {
      const reservation = this.reservations.get(invoiceId);
      if (reservation !== undefined) {
        changed.push(reservation.toMemento());
      }
    }

    return changed;
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
    return this.activeReservationCountValue;
  }

  /** @throws ReservationsNotLoadedError when the invoice is outside the loaded scope. */
  findReservation(invoiceId: string): Reservation | undefined {
    this.assertLoaded(invoiceId);

    return this.reservations.get(invoiceId);
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

    const existing = this.findReservation(input.invoiceId);
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

    this.put(reservation);
    this.reservedTotalValue = this.reservedTotalValue.add(reservedAmount);
    this.activeReservationCountValue += 1;
    this.touch(input.at);

    return { reservation, created: true };
  }

  /** Releases a reservation, giving its capacity back. Idempotent: releasing twice is a no-op. */
  release(input: { invoiceId: string; at: Date }): ReleaseReservationResult {
    const existing = this.findReservation(input.invoiceId);
    if (existing === undefined) {
      throw new ReservationNotFoundError(this.id, input.invoiceId);
    }
    if (!existing.isActive) {
      return { reservation: existing, released: false };
    }

    const released = existing.release(input.at);
    this.put(released);
    this.reservedTotalValue = this.reservedTotalValue.subtract(released.reservedAmount);
    this.activeReservationCountValue -= 1;
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
   *
   * Only reservations the snapshot can affect take part: the active ones and those it names.
   * A released reservation it does not name stays released, so the history is never read.
   */
  reconcile(snapshot: TreasurySnapshot, at: Date): ReconciliationResult {
    if (this.isStaleTreasurySequence(snapshot.sequence)) {
      return { outcome: 'STALE', ...NO_RECONCILIATION_CHANGES };
    }
    this.assertProgramCurrency(snapshot.creditLimit, 'Credit limit');
    Program.assertValidCreditLimit(snapshot.creditLimit);
    this.assertValidSnapshotEntries(snapshot.activeReservations);
    this.assertLoadedForReconciliation(snapshot);

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
        this.changedInvoiceIds.add(entry.invoiceId);
        counters.added += 1;
      } else if (local.matches(entry.invoiceAmount, entry.reservedAmount)) {
        next.set(entry.invoiceId, local);
        counters.unchanged += 1;
      } else {
        next.set(
          entry.invoiceId,
          local.correctedBySnapshot(entry.invoiceAmount, entry.reservedAmount, snapshot.asOf),
        );
        this.changedInvoiceIds.add(entry.invoiceId);
        counters.updated += 1;
      }
    }

    for (const [invoiceId, local] of this.reservations) {
      if (next.has(invoiceId)) {
        continue;
      }
      if (local.isActive) {
        next.set(invoiceId, local.release(snapshot.asOf));
        this.changedInvoiceIds.add(invoiceId);
        counters.released += 1;
      } else {
        next.set(invoiceId, local);
      }
    }

    this.reservations = next;
    this.recountActiveReservations();
    this.creditLimitValue = snapshot.creditLimit;
    this.lastTreasurySequenceValue = snapshot.sequence;
    this.lastReconciledAtValue = snapshot.asOf;
    this.touch(at);

    return { outcome: 'APPLIED', ...counters };
  }

  /** Every active reservation is loaded when this runs (see `reconcile`), so the sums are complete. */
  private recountActiveReservations(): void {
    let total = Money.zero(this.currency);
    let count = 0;

    for (const reservation of this.reservations.values()) {
      if (reservation.isActive) {
        total = total.add(reservation.reservedAmount);
        count += 1;
      }
    }

    this.reservedTotalValue = total;
    this.activeReservationCountValue = count;
  }

  private put(reservation: Reservation): void {
    this.reservations.set(reservation.invoiceId, reservation);
    this.changedInvoiceIds.add(reservation.invoiceId);
  }

  private assertLoaded(invoiceId: string): void {
    if (!this.coverage.complete && !this.coverage.invoiceIds.has(invoiceId)) {
      throw new ReservationsNotLoadedError(this.id, `the reservation of invoice "${invoiceId}"`);
    }
  }

  private assertLoadedForReconciliation(snapshot: TreasurySnapshot): void {
    if (!this.coverage.complete && !this.coverage.allActive) {
      throw new ReservationsNotLoadedError(this.id, 'its active reservations');
    }
    for (const entry of snapshot.activeReservations) {
      this.assertLoaded(entry.invoiceId);
    }
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
