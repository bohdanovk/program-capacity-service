import { Inject, Injectable } from '@nestjs/common';
import { Currency } from '../../domain/currency';
import { Money } from '../../domain/money';
import { CLOCK } from '../../domain/ports/clock';
import type { Clock } from '../../domain/ports/clock';
import { PROGRAM_REPOSITORY } from '../../domain/ports/program.repository';
import type { ProgramRepository } from '../../domain/ports/program.repository';
import { Program, ReconciliationResult, TreasurySnapshot } from '../../domain/program';
import { ReconcileProgramCommand } from '../commands';
import { withConcurrencyRetry } from '../concurrency';

export interface ReconcileProgramOutcome extends ReconciliationResult {
  /** True when the program was unknown and has been created from the snapshot. */
  readonly created: boolean;
}

/** Applies a periodic full-state snapshot from treasury (see docs/treasury-kafka-contract.md). */
@Injectable()
export class ReconcileProgramUseCase {
  constructor(
    @Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(command: ReconcileProgramCommand): Promise<ReconcileProgramOutcome> {
    const programCurrency = Currency.of(command.currency);
    const snapshot: TreasurySnapshot = {
      sequence: command.sequence,
      asOf: command.asOf,
      creditLimit: Money.parse(command.creditLimit, programCurrency),
      activeReservations: command.activeReservations.map((entry) => ({
        invoiceId: entry.invoiceId,
        invoiceAmount: Money.parse(entry.invoiceAmount, Currency.of(entry.invoiceCurrency)),
        reservedAmount: Money.parse(entry.reservedAmount, programCurrency),
      })),
    };

    return withConcurrencyRetry(async () => {
      const now = this.clock.now();
      const existing = await this.programs.findById(command.programId);
      const program =
        existing ??
        Program.create({ id: command.programId, creditLimit: snapshot.creditLimit, at: now });

      const result = program.reconcile(snapshot, now);
      if (result.outcome === 'APPLIED') {
        await this.programs.save(program);
      }
      return { ...result, created: existing === null && result.outcome === 'APPLIED' };
    });
  }
}
