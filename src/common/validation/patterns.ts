/** Syntactic validation shared by inbound adapters. Semantic checks (minor units, positivity) live in the domain. */

/** Identifiers we accept from the outside world: programs, invoices. */
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Plain non-negative decimal: digits with an optional fraction. No signs, exponents or separators. */
export const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

/** ISO 4217 alphabetic code shape, upper case only. Whether the currency is supported is decided by the domain. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
