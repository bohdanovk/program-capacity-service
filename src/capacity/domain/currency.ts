import { UnsupportedCurrencyError } from './errors';

/** ISO 4217 minor-unit exponents for the currencies this service handles. */
const MINOR_UNITS: ReadonlyMap<string, number> = new Map<string, number>([
  ['USD', 2],
  ['EUR', 2],
  ['GBP', 2],
  ['CHF', 2],
  ['JPY', 0],
  ['CAD', 2],
  ['AUD', 2],
  ['NZD', 2],
  ['SEK', 2],
  ['NOK', 2],
  ['DKK', 2],
  ['PLN', 2],
  ['CZK', 2],
  ['HUF', 2],
  ['RON', 2],
  ['BGN', 2],
  ['TRY', 2],
  ['ZAR', 2],
  ['SGD', 2],
  ['HKD', 2],
  ['CNY', 2],
  ['INR', 2],
  ['KRW', 0],
  ['MXN', 2],
  ['BRL', 2],
  ['AED', 2],
  ['SAR', 2],
  ['ILS', 2],
  ['UAH', 2],
  ['KWD', 3],
  ['BHD', 3],
  ['OMR', 3],
  ['JOD', 3],
]);

export class Currency {
  private constructor(
    readonly code: string,
    /** Number of decimal digits in the currency's minor unit (2 for USD, 0 for JPY, 3 for KWD). */
    readonly minorUnits: number,
  ) {}

  static of(code: string): Currency {
    const normalized = code.trim().toUpperCase();
    const minorUnits = MINOR_UNITS.get(normalized);
    if (minorUnits === undefined) {
      throw new UnsupportedCurrencyError(code);
    }
    return new Currency(normalized, minorUnits);
  }

  static isSupported(code: string): boolean {
    return MINOR_UNITS.has(code.trim().toUpperCase());
  }

  equals(other: Currency): boolean {
    return this.code === other.code;
  }

  toString(): string {
    return this.code;
  }
}
