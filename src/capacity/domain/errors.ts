import { DomainError } from '../../shared/domain/domain-error';

export class UnsupportedCurrencyError extends DomainError {
  constructor(code: string) {
    super('UNSUPPORTED_CURRENCY', 'INVALID_INPUT', `Currency "${code}" is not supported`, {
      currency: code,
    });
  }
}

export class InvalidMoneyAmountError extends DomainError {
  constructor(amount: string, currency: string) {
    super(
      'INVALID_AMOUNT',
      'INVALID_INPUT',
      `"${amount}" is not a valid ${currency} amount (plain decimal, at most the currency's minor-unit digits)`,
      { amount, currency },
    );
  }
}

export class NonPositiveAmountError extends DomainError {
  constructor(amount: string, context: string) {
    super(
      'AMOUNT_NOT_POSITIVE',
      'INVALID_INPUT',
      `${context} must be greater than zero, got ${amount}`,
      {
        amount,
      },
    );
  }
}

export class NegativeCreditLimitError extends DomainError {
  constructor(amount: string) {
    super(
      'NEGATIVE_CREDIT_LIMIT',
      'INVALID_INPUT',
      `Credit limit cannot be negative, got ${amount}`,
      {
        amount,
      },
    );
  }
}

export class InvalidExchangeRateError extends DomainError {
  constructor(base: string, quote: string, rate: string) {
    super(
      'INVALID_EXCHANGE_RATE',
      'INVALID_INPUT',
      `"${rate}" is not a valid ${base}/${quote} exchange rate`,
      { base, quote, rate },
    );
  }
}

export class CurrencyMismatchError extends DomainError {
  constructor(expected: string, actual: string, context: string) {
    super('CURRENCY_MISMATCH', 'UNPROCESSABLE', `${context}: expected ${expected}, got ${actual}`, {
      expected,
      actual,
    });
  }
}

export class UnsupportedCurrencyPairError extends DomainError {
  constructor(base: string, quote: string) {
    super(
      'UNSUPPORTED_CURRENCY_PAIR',
      'UNPROCESSABLE',
      `No exchange rate is available for ${base}/${quote}`,
      { base, quote },
    );
  }
}

export class ProgramNotFoundError extends DomainError {
  constructor(programId: string) {
    super('PROGRAM_NOT_FOUND', 'NOT_FOUND', `Program "${programId}" does not exist`, { programId });
  }
}

export class ProgramAlreadyExistsError extends DomainError {
  constructor(programId: string) {
    super('PROGRAM_ALREADY_EXISTS', 'CONFLICT', `Program "${programId}" already exists`, {
      programId,
    });
  }
}

export class ReservationNotFoundError extends DomainError {
  constructor(programId: string, invoiceId: string) {
    super(
      'RESERVATION_NOT_FOUND',
      'NOT_FOUND',
      `No reservation for invoice "${invoiceId}" in program "${programId}"`,
      { programId, invoiceId },
    );
  }
}

export class ReservationConflictError extends DomainError {
  constructor(
    programId: string,
    invoiceId: string,
    existingAmount: string,
    requestedAmount: string,
  ) {
    super(
      'RESERVATION_CONFLICT',
      'CONFLICT',
      `Invoice "${invoiceId}" is already reserved in program "${programId}" for ${existingAmount}; a reservation for ${requestedAmount} conflicts with it`,
      { programId, invoiceId, existingAmount, requestedAmount },
    );
  }
}

export class InsufficientCapacityError extends DomainError {
  constructor(programId: string, requested: string, available: string) {
    super(
      'INSUFFICIENT_CAPACITY',
      'CONFLICT',
      `Program "${programId}" cannot reserve ${requested}: only ${available} is available`,
      { programId, requested, available },
    );
  }
}

export class InvalidTreasurySnapshotError extends DomainError {
  constructor(programId: string, reason: string) {
    super(
      'INVALID_TREASURY_SNAPSHOT',
      'UNPROCESSABLE',
      `Treasury snapshot for program "${programId}" is invalid: ${reason}`,
      { programId, reason },
    );
  }
}

/** Raised by repositories when an aggregate was modified concurrently (optimistic locking). */
export class ConcurrencyConflictError extends DomainError {
  constructor(programId: string) {
    super(
      'CONCURRENT_MODIFICATION',
      'CONFLICT',
      `Program "${programId}" was modified concurrently; retry the operation`,
      { programId },
    );
  }
}

/**
 * A programming error, not a business outcome: an operation ran on a program that was loaded
 * without the reservations it needs. Answering from a partial view would be silently wrong
 * (a released invoice would look unknown and could be reserved again), so it fails loudly.
 */
export class ReservationsNotLoadedError extends Error {
  constructor(programId: string, missing: string) {
    super(`Program "${programId}" was loaded without ${missing}`);
    this.name = new.target.name;
  }
}
