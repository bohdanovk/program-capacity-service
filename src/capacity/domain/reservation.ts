import { ExchangeRate } from './exchange-rate';
import { Money } from './money';

export enum ReservationStatus {
  Active = 'ACTIVE',
  Released = 'RELEASED',
}

export interface ReservationProps {
  /** Invoice identifier; also the reservation's identity and idempotency key within a program. */
  readonly invoiceId: string;
  /** Face amount of the invoice in its own currency. */
  readonly invoiceAmount: Money;
  /** Capacity consumed, always in the program currency. */
  readonly reservedAmount: Money;
  /** Rate used to derive `reservedAmount`; null when the figure came from a treasury snapshot. */
  readonly exchangeRate: ExchangeRate | null;
  readonly status: ReservationStatus;
  readonly reservedAt: Date;
  readonly releasedAt: Date | null;
  /** Instant of the last state change; drives "newer than snapshot" decisions during reconciliation. */
  readonly updatedAt: Date;
}

/**
 * Entity inside the Program aggregate. Immutable: state changes return a new instance,
 * which keeps the aggregate free of aliasing bugs and makes persistence snapshots trivial.
 */
export class Reservation {
  private constructor(private readonly props: ReservationProps) {}

  static create(input: {
    invoiceId: string;
    invoiceAmount: Money;
    reservedAmount: Money;
    exchangeRate: ExchangeRate;
    at: Date;
  }): Reservation {
    return new Reservation({
      invoiceId: input.invoiceId,
      invoiceAmount: input.invoiceAmount,
      reservedAmount: input.reservedAmount,
      exchangeRate: input.exchangeRate,
      status: ReservationStatus.Active,
      reservedAt: input.at,
      releasedAt: null,
      updatedAt: input.at,
    });
  }

  static fromTreasurySnapshot(input: {
    invoiceId: string;
    invoiceAmount: Money;
    reservedAmount: Money;
    asOf: Date;
  }): Reservation {
    return new Reservation({
      invoiceId: input.invoiceId,
      invoiceAmount: input.invoiceAmount,
      reservedAmount: input.reservedAmount,
      exchangeRate: null,
      status: ReservationStatus.Active,
      reservedAt: input.asOf,
      releasedAt: null,
      updatedAt: input.asOf,
    });
  }

  static rehydrate(props: ReservationProps): Reservation {
    return new Reservation(props);
  }

  get invoiceId(): string {
    return this.props.invoiceId;
  }

  get invoiceAmount(): Money {
    return this.props.invoiceAmount;
  }

  get reservedAmount(): Money {
    return this.props.reservedAmount;
  }

  get exchangeRate(): ExchangeRate | null {
    return this.props.exchangeRate;
  }

  get status(): ReservationStatus {
    return this.props.status;
  }

  get reservedAt(): Date {
    return this.props.reservedAt;
  }

  get releasedAt(): Date | null {
    return this.props.releasedAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isActive(): boolean {
    return this.props.status === ReservationStatus.Active;
  }

  release(at: Date): Reservation {
    return new Reservation({
      ...this.props,
      status: ReservationStatus.Released,
      releasedAt: at,
      updatedAt: at,
    });
  }

  wasModifiedAfter(instant: Date): boolean {
    return this.props.updatedAt.getTime() > instant.getTime();
  }

  /** True when this reservation is active with exactly the given amounts. */
  matches(invoiceAmount: Money, reservedAmount: Money): boolean {
    return (
      this.isActive &&
      this.props.invoiceAmount.equals(invoiceAmount) &&
      this.props.reservedAmount.equals(reservedAmount)
    );
  }

  /** Treasury's view of this reservation wins: amounts are overwritten and the reservation is active. */
  correctedBySnapshot(invoiceAmount: Money, reservedAmount: Money, asOf: Date): Reservation {
    return new Reservation({
      ...this.props,
      invoiceAmount,
      reservedAmount,
      exchangeRate: null,
      status: ReservationStatus.Active,
      releasedAt: null,
      updatedAt: asOf,
    });
  }

  toProps(): ReservationProps {
    return { ...this.props };
  }
}
