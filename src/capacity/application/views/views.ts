import { Money } from '../../domain/money';
import { Program } from '../../domain/program';
import { Reservation, ReservationStatus } from '../../domain/reservation';

/** Read models returned to inbound adapters. Amounts are decimal strings, instants ISO 8601. */

export interface MoneyView {
  readonly amount: string;
  readonly currency: string;
}

export interface ProgramCapacityView {
  readonly programId: string;
  readonly currency: string;
  readonly creditLimit: MoneyView;
  readonly reserved: MoneyView;
  readonly available: MoneyView;
  readonly overCommitted: boolean;
  readonly activeReservations: number;
  readonly lastTreasurySequence: number | null;
  readonly lastReconciledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReservationView {
  readonly programId: string;
  readonly invoiceId: string;
  readonly status: ReservationStatus;
  readonly invoiceAmount: MoneyView;
  readonly reservedAmount: MoneyView;
  readonly exchangeRate: string | null;
  readonly reservedAt: string;
  readonly releasedAt: string | null;
  readonly updatedAt: string;
}

export function toMoneyView(money: Money): MoneyView {
  return { amount: money.toDecimalString(), currency: money.currency.code };
}

export function toProgramCapacityView(program: Program): ProgramCapacityView {
  return {
    programId: program.id,
    currency: program.currency.code,
    creditLimit: toMoneyView(program.creditLimit),
    reserved: toMoneyView(program.reservedTotal),
    available: toMoneyView(program.available),
    overCommitted: program.isOverCommitted,
    activeReservations: program.activeReservationCount,
    lastTreasurySequence: program.lastTreasurySequence,
    lastReconciledAt: program.lastReconciledAt?.toISOString() ?? null,
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString(),
  };
}

export function toReservationView(programId: string, reservation: Reservation): ReservationView {
  return {
    programId,
    invoiceId: reservation.invoiceId,
    status: reservation.status,
    invoiceAmount: toMoneyView(reservation.invoiceAmount),
    reservedAmount: toMoneyView(reservation.reservedAmount),
    exchangeRate: reservation.exchangeRate?.toDecimalString() ?? null,
    reservedAt: reservation.reservedAt.toISOString(),
    releasedAt: reservation.releasedAt?.toISOString() ?? null,
    updatedAt: reservation.updatedAt.toISOString(),
  };
}
