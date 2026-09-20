import { Currency } from './currency';
import { formatScaledDecimal, parseScaledDecimal } from './decimal';
import { CurrencyMismatchError, InvalidMoneyAmountError } from './errors';

/** Immutable monetary amount: an exact integer number of minor units in one currency. */
export class Money {
  private constructor(
    readonly minorUnits: bigint,
    readonly currency: Currency,
  ) {}

  static ofMinorUnits(minorUnits: bigint, currency: Currency): Money {
    return new Money(minorUnits, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(0n, currency);
  }

  /**
   * Parses a plain decimal string. The text may not carry more fraction digits than
   * the currency has minor units ("10.005" is rejected for USD rather than rounded).
   */
  static parse(amount: string, currency: Currency): Money {
    const minorUnits = parseScaledDecimal(amount, currency.minorUnits);
    if (minorUnits === null) {
      throw new InvalidMoneyAmountError(amount, currency.code);
    }
    return new Money(minorUnits, currency);
  }

  static max(a: Money, b: Money): Money {
    return a.isGreaterThan(b) ? a : b;
  }

  get isZero(): boolean {
    return this.minorUnits === 0n;
  }

  get isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  get isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, 'add');
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, 'subtract');
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other, 'compare');
    return this.minorUnits > other.minorUnits;
  }

  equals(other: Money): boolean {
    return this.currency.equals(other.currency) && this.minorUnits === other.minorUnits;
  }

  /** Plain decimal with exactly the currency's minor-unit digits, e.g. "1234.50". */
  toDecimalString(): string {
    return formatScaledDecimal(this.minorUnits, this.currency.minorUnits);
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency.code}`;
  }

  private assertSameCurrency(other: Money, operation: string): void {
    if (!this.currency.equals(other.currency)) {
      throw new CurrencyMismatchError(
        this.currency.code,
        other.currency.code,
        `Cannot ${operation} amounts in different currencies`,
      );
    }
  }
}
