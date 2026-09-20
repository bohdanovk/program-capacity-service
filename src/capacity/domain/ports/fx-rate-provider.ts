import { Currency } from '../currency';
import { ExchangeRate } from '../exchange-rate';

export const FX_RATE_PROVIDER = Symbol('FX_RATE_PROVIDER');

/** Outbound port for foreign-exchange rates. */
export interface FxRateProvider {
  /**
   * Rate from `base` to `quote`, for distinct currencies.
   * @throws UnsupportedCurrencyPairError when no rate is available.
   */
  getRate(base: Currency, quote: Currency): Promise<ExchangeRate>;
}
