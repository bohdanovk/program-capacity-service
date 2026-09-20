import { Currency } from './currency';
import { CurrencyMismatchError, InvalidMoneyAmountError, UnsupportedCurrencyError } from './errors';
import { Money } from './money';

const USD = Currency.of('USD');
const JPY = Currency.of('JPY');
const KWD = Currency.of('KWD');

describe('Money', () => {
  describe('parse', () => {
    it.each([
      ['1234.56', USD, 123456n, '1234.56'],
      ['1234', USD, 123400n, '1234.00'],
      ['0.5', USD, 50n, '0.50'],
      ['1000', JPY, 1000n, '1000'],
      ['0.5', KWD, 500n, '0.500'],
      ['10000000.00', USD, 1000000000n, '10000000.00'],
    ])('parses "%s" %s exactly', (text, currency, minorUnits, formatted) => {
      const money = Money.parse(text, currency);
      expect(money.minorUnits).toBe(minorUnits);
      expect(money.toDecimalString()).toBe(formatted);
    });

    it.each(['10.005', '1,000', '1e3', 'abc', '', ' 10', '10.', '.5', '+5'])(
      'rejects "%s" for USD instead of rounding or guessing',
      (text) => {
        expect(() => Money.parse(text, USD)).toThrow(InvalidMoneyAmountError);
      },
    );

    it('rejects fraction digits for a zero-decimal currency', () => {
      expect(() => Money.parse('100.5', JPY)).toThrow(InvalidMoneyAmountError);
    });

    it.each(['XXX', 'usd', ' USD', 'USD '])(
      'rejects currency input "%s" instead of repairing it',
      (input) => {
        expect(() => Currency.parse(input)).toThrow(UnsupportedCurrencyError);
      },
    );

    it('accepts an exact registry code', () => {
      expect(Currency.parse('KWD').minorUnits).toBe(3);
    });
  });

  describe('arithmetic', () => {
    it('adds and subtracts without losing precision', () => {
      const a = Money.parse('0.10', USD);
      const b = Money.parse('0.20', USD);
      expect(a.add(b).toDecimalString()).toBe('0.30');
      expect(a.subtract(b).toDecimalString()).toBe('-0.10');
      expect(a.subtract(b).isNegative).toBe(true);
    });

    it('refuses to mix currencies', () => {
      const usd = Money.parse('1.00', USD);
      const jpy = Money.parse('100', JPY);
      expect(() => usd.add(jpy)).toThrow(CurrencyMismatchError);
      expect(() => usd.isGreaterThan(jpy)).toThrow(CurrencyMismatchError);
      expect(usd.equals(jpy)).toBe(false);
    });

    it('handles amounts beyond the double-precision range', () => {
      const huge = Money.parse('99999999999999999999.99', USD);
      expect(huge.add(Money.parse('0.01', USD)).toDecimalString()).toBe('100000000000000000000.00');
    });
  });
});
