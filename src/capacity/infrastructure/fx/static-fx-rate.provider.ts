import { Currency } from '../../domain/currency';
import { UnsupportedCurrencyPairError } from '../../domain/errors';
import { ExchangeRate } from '../../domain/exchange-rate';
import { FxRateProvider } from '../../domain/ports/fx-rate-provider';

export interface StaticFxRate {
  readonly base: string;
  readonly quote: string;
  readonly rate: string;
}

/**
 * Rates fixed at start-up from configuration. Only explicitly configured pairs are served:
 * no inverse or cross rates are derived, so the rate applied is always one somebody signed off.
 */
export class StaticFxRateProvider implements FxRateProvider {
  private readonly rates = new Map<string, ExchangeRate>();

  constructor(rates: readonly StaticFxRate[]) {
    for (const entry of rates) {
      const base = Currency.of(entry.base);
      const quote = Currency.of(entry.quote);
      this.rates.set(pairKey(base, quote), ExchangeRate.parse(base, quote, entry.rate));
    }
  }

  getRate(base: Currency, quote: Currency): Promise<ExchangeRate> {
    const rate = this.rates.get(pairKey(base, quote));
    return rate === undefined
      ? Promise.reject(new UnsupportedCurrencyPairError(base.code, quote.code))
      : Promise.resolve(rate);
  }
}

function pairKey(base: Currency, quote: Currency): string {
  return `${base.code}/${quote.code}`;
}
