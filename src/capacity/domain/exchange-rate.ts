import { Currency } from './currency';
import {
  divideRounded,
  formatScaledDecimal,
  parseScaledDecimal,
  pow10,
  RoundingMode,
  stripTrailingFractionZeros,
} from './decimal';
import { CurrencyMismatchError, InvalidExchangeRateError } from './errors';
import { Money } from './money';

/**
 * Price of one unit of `base` expressed in `quote`, held as an exact fixed-point number
 * with {@link ExchangeRate.SCALE} decimal digits.
 */
export class ExchangeRate {
  static readonly SCALE = 10;

  private constructor(
    readonly base: Currency,
    readonly quote: Currency,
    private readonly scaledRate: bigint,
  ) {}

  static parse(base: Currency, quote: Currency, rate: string): ExchangeRate {
    const scaled = parseScaledDecimal(rate, ExchangeRate.SCALE);
    if (scaled === null || scaled <= 0n) {
      throw new InvalidExchangeRateError(base.code, quote.code, rate);
    }
    return new ExchangeRate(base, quote, scaled);
  }

  static identity(currency: Currency): ExchangeRate {
    return new ExchangeRate(currency, currency, pow10(ExchangeRate.SCALE));
  }

  get isIdentity(): boolean {
    return this.base.equals(this.quote);
  }

  /**
   * Converts an amount in `base` into `quote`, rounding the result to the quote
   * currency's minor unit with the given mode. Exact integer arithmetic throughout:
   *   minor(quote) = minor(base) * rate * 10^quote.minorUnits / 10^base.minorUnits
   */
  convert(amount: Money, rounding: RoundingMode): Money {
    if (!amount.currency.equals(this.base)) {
      throw new CurrencyMismatchError(
        this.base.code,
        amount.currency.code,
        `Rate ${this.base.code}/${this.quote.code} cannot convert this amount`,
      );
    }
    const numerator = amount.minorUnits * this.scaledRate * pow10(this.quote.minorUnits);
    const denominator = pow10(ExchangeRate.SCALE) * pow10(this.base.minorUnits);
    return Money.ofMinorUnits(divideRounded(numerator, denominator, rounding), this.quote);
  }

  /** Rate as a plain decimal without insignificant trailing zeros, e.g. "1.085". */
  toDecimalString(): string {
    return stripTrailingFractionZeros(formatScaledDecimal(this.scaledRate, ExchangeRate.SCALE));
  }

  toString(): string {
    return `${this.base.code}/${this.quote.code} ${this.toDecimalString()}`;
  }
}
