/**
 * Commands are plain data crossing the application boundary. Inbound adapters (HTTP, Kafka)
 * build them from their own message formats; the application layer turns them into domain
 * objects and rejects what the domain does not accept.
 */

export interface MoneyInput {
  /** Plain decimal string, e.g. "1250000.00". Never a float. */
  readonly amount: string;
  /** ISO 4217 code, e.g. "USD". */
  readonly currency: string;
}

export interface CreateProgramCommand {
  readonly programId: string;
  /** The program currency is the currency of its credit limit. */
  readonly creditLimit: MoneyInput;
}

export interface ReserveCapacityCommand {
  readonly programId: string;
  readonly invoiceId: string;
  readonly invoiceAmount: MoneyInput;
}

export interface ReleaseReservationCommand {
  readonly programId: string;
  readonly invoiceId: string;
}

export interface ApplyTreasuryLimitCommand {
  readonly programId: string;
  readonly sequence: number;
  readonly currency: string;
  readonly creditLimit: string;
}

export interface TreasurySnapshotReservationInput {
  readonly invoiceId: string;
  readonly invoiceAmount: string;
  readonly invoiceCurrency: string;
  /** In program currency. */
  readonly reservedAmount: string;
}

export interface ReconcileProgramCommand {
  readonly programId: string;
  readonly sequence: number;
  readonly asOf: Date;
  readonly currency: string;
  readonly creditLimit: string;
  readonly activeReservations: readonly TreasurySnapshotReservationInput[];
}
