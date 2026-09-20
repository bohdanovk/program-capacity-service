import { UnsupportedCurrencyError } from './errors';

/**
 * ISO 4217 currencies this service handles, each with its minor-unit exponent (2 for USD,
 * 0 for JPY, 3 for KWD). This object is the single source of truth: the code union and the
 * set of legal decimal scales are both derived from it, so an unknown currency or an
 * arbitrary scale is a compile-time error rather than a runtime surprise.
 */
const CURRENCIES = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  JPY: 0,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  CZK: 2,
  HUF: 2,
  RON: 2,
  BGN: 2,
  TRY: 2,
  ZAR: 2,
  SGD: 2,
  HKD: 2,
  CNY: 2,
  INR: 2,
  KRW: 0,
  MXN: 2,
  BRL: 2,
  AED: 2,
  SAR: 2,
  ILS: 2,
  UAH: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
} as const satisfies Record<string, 0 | 2 | 3>;

export type CurrencyCode = keyof typeof CURRENCIES;

/** Every minor-unit exponent that occurs in the registry. */
export type MinorUnits = (typeof CURRENCIES)[CurrencyCode];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCIES, value);
}

export class Currency {
  private constructor(
    readonly code: CurrencyCode,
    readonly minorUnits: MinorUnits,
  ) {}

  /** For codes known at compile time; the type system rejects anything not in the registry. */
  static of(code: CurrencyCode): Currency {
    return new Currency(code, CURRENCIES[code]);
  }

  /** For untrusted input. Exact match only: "usd" and " USD" are rejected, not repaired. */
  static parse(input: string): Currency {
    if (!isCurrencyCode(input)) {
      throw new UnsupportedCurrencyError(input);
    }

    return Currency.of(input);
  }

  equals(other: Currency): boolean {
    return this.code === other.code;
  }

  toString(): string {
    return this.code;
  }
}
