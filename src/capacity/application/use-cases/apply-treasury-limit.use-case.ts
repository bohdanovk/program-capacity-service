import { Inject, Injectable } from '@nestjs/common';
import { Currency } from '../../domain/currency';
import { Money } from '../../domain/money';
import { CLOCK } from '../../domain/ports/clock';
import type { Clock } from '../../domain/ports/clock';
import { PROGRAM_REPOSITORY } from '../../domain/ports/program.repository';
import type { ProgramRepository } from '../../domain/ports/program.repository';
import { Program } from '../../domain/program';
import { ApplyTreasuryLimitCommand } from '../commands';
import { withConcurrencyRetry } from '../concurrency';

export type TreasuryLimitOutcome = 'APPLIED' | 'CREATED' | 'STALE';

/**
 * Applies a credit-limit change published by treasury. Unknown programs are created on the
 * spot: treasury owns the program catalogue, so a limit for a program we have not seen is
 * the program's birth as far as this service is concerned.
 */
@Injectable()
export class ApplyTreasuryLimitUseCase {
  constructor(
    @Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(command: ApplyTreasuryLimitCommand): Promise<TreasuryLimitOutcome> {
    const creditLimit = Money.parse(command.creditLimit, Currency.of(command.currency));

    return withConcurrencyRetry(async () => {
      const now = this.clock.now();
      const existing = await this.programs.findById(command.programId);
      const program = existing ?? Program.create({ id: command.programId, creditLimit, at: now });

      const outcome = program.applyTreasuryLimitChange(
        { sequence: command.sequence, creditLimit },
        now,
      );
      if (outcome === 'STALE') {
        return 'STALE';
      }
      await this.programs.save(program);
      return existing === null ? 'CREATED' : 'APPLIED';
    });
  }
}
