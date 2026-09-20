import { Inject, Injectable } from '@nestjs/common';
import { Currency } from '../../domain/currency';
import { ExchangeRate } from '../../domain/exchange-rate';
import { CLOCK } from '../../domain/ports/clock';
import type { Clock } from '../../domain/ports/clock';
import { FX_RATE_PROVIDER } from '../../domain/ports/fx-rate-provider';
import type { FxRateProvider } from '../../domain/ports/fx-rate-provider';
import { PROGRAM_REPOSITORY } from '../../domain/ports/program.repository';
import type { ProgramRepository } from '../../domain/ports/program.repository';
import { ReserveCapacityCommand } from '../commands';
import { withConcurrencyRetry } from '../concurrency';
import { parseMoneyInput } from '../money-input';
import { requireProgram } from '../program-loader';
import { ReservationView, toReservationView } from '../views/views';

export interface ReserveCapacityOutcome {
  readonly reservation: ReservationView;
  /** False when an identical reservation already existed (idempotent replay). */
  readonly created: boolean;
}

@Injectable()
export class ReserveCapacityUseCase {
  constructor(
    @Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository,
    @Inject(FX_RATE_PROVIDER) private readonly fxRates: FxRateProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: ReserveCapacityCommand): Promise<ReserveCapacityOutcome> {
    const invoiceAmount = parseMoneyInput(command.invoiceAmount);

    return withConcurrencyRetry(async () => {
      const program = await requireProgram(this.programs, command.programId);
      const exchangeRate = await this.rateFor(invoiceAmount.currency, program.currency);
      const result = program.reserve({
        invoiceId: command.invoiceId,
        invoiceAmount,
        exchangeRate,
        at: this.clock.now(),
      });

      if (result.created) {
        await this.programs.save(program);
      }

      return {
        reservation: toReservationView(program.id, result.reservation),
        created: result.created,
      };
    });
  }

  private rateFor(invoiceCurrency: Currency, programCurrency: Currency): Promise<ExchangeRate> {
    if (invoiceCurrency.equals(programCurrency)) {
      return Promise.resolve(ExchangeRate.identity(programCurrency));
    }

    return this.fxRates.getRate(invoiceCurrency, programCurrency);
  }
}
