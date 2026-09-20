import { Currency } from './currency';
import { RoundingMode } from './decimal';
import { CurrencyMismatchError, InvalidExchangeRateError } from './errors';
import { ExchangeRate } from './exchange-rate';
import { Money } from './money';

const USD = Currency.of('USD');
const EUR = Currency.of('EUR');
const JPY = Currency.of('JPY');

describe('ExchangeRate', () => {
  const eurUsd = ExchangeRate.parse(EUR, USD, '1.0850');

  it('converts exactly when no rounding is needed', () => {
    expect(eurUsd.convert(Money.parse('1000.00', EUR), RoundingMode.Up).toString()).toBe(
      '1085.00 USD',
    );
  });

  it.each([
    [RoundingMode.Up, '0.02'],
    [RoundingMode.HalfUp, '0.01'],
    [RoundingMode.Down, '0.01'],
  ])('rounds 0.01 EUR (0.01085 USD) with %s to %s', (mode, expected) => {
    expect(eurUsd.convert(Money.parse('0.01', EUR), mode).toDecimalString()).toBe(expected);
  });

  it('handles currencies with different minor units in both directions', () => {
    const usdJpy = ExchangeRate.parse(USD, JPY, '149.5');
    expect(usdJpy.convert(Money.parse('10.00', USD), RoundingMode.Up).toString()).toBe('1495 JPY');
    // 0.01 USD = 1.495 JPY -> rounded up to 2 JPY
    expect(usdJpy.convert(Money.parse('0.01', USD), RoundingMode.Up).toString()).toBe('2 JPY');

    const jpyUsd = ExchangeRate.parse(JPY, USD, '0.0066889632');
    // 1000 JPY = 6.6889632 USD -> 6.69 USD
    expect(jpyUsd.convert(Money.parse('1000', JPY), RoundingMode.Up).toString()).toBe('6.69 USD');
  });

  it('is exact at full rate precision', () => {
    const rate = ExchangeRate.parse(EUR, USD, '1.0000000001');
    // 1,000,000,000.00 EUR * 1.0000000001 = 1,000,000,000.10 USD exactly
    expect(
      rate.convert(Money.parse('1000000000.00', EUR), RoundingMode.Down).toDecimalString(),
    ).toBe('1000000000.10');
  });

  it('identity rate leaves amounts untouched', () => {
    const identity = ExchangeRate.identity(USD);
    const amount = Money.parse('123.45', USD);
    expect(identity.isIdentity).toBe(true);
    expect(identity.convert(amount, RoundingMode.Up).equals(amount)).toBe(true);
  });

  it('refuses to convert an amount in the wrong currency', () => {
    expect(() => eurUsd.convert(Money.parse('1.00', USD), RoundingMode.Up)).toThrow(
      CurrencyMismatchError,
    );
  });

  it.each(['0', '-1', 'abc', '1.00000000001', ''])('rejects rate "%s"', (rate) => {
    expect(() => ExchangeRate.parse(EUR, USD, rate)).toThrow(InvalidExchangeRateError);
  });

  it('formats without insignificant zeros', () => {
    expect(eurUsd.toDecimalString()).toBe('1.085');
    expect(ExchangeRate.parse(EUR, USD, '2').toDecimalString()).toBe('2');
  });
});
