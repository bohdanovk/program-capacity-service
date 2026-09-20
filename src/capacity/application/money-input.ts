import { Currency } from '../domain/currency';
import { Money } from '../domain/money';
import { MoneyInput } from './commands';

export function parseMoneyInput(input: MoneyInput): Money {
  return Money.parse(input.amount, Currency.parse(input.currency));
}
