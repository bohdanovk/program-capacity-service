import { Inject, Injectable } from '@nestjs/common';
import { ProgramAlreadyExistsError } from '../../domain/errors';
import { CLOCK } from '../../domain/ports/clock';
import type { Clock } from '../../domain/ports/clock';
import { PROGRAM_REPOSITORY } from '../../domain/ports/program.repository';
import type { ProgramRepository } from '../../domain/ports/program.repository';
import { Program } from '../../domain/program';
import { CreateProgramCommand } from '../commands';
import { parseMoneyInput } from '../money-input';
import { ProgramCapacityView, toProgramCapacityView } from '../views/views';

/**
 * Bootstraps a program through the API. Treasury remains the system of record: a later
 * treasury message for the same program overrides the limit set here.
 */
@Injectable()
export class CreateProgramUseCase {
  constructor(
    @Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CreateProgramCommand): Promise<ProgramCapacityView> {
    const creditLimit = parseMoneyInput(command.creditLimit);

    if ((await this.programs.findById(command.programId)) !== null) {
      throw new ProgramAlreadyExistsError(command.programId);
    }

    const program = Program.create({
      id: command.programId,
      creditLimit,
      at: this.clock.now(),
    });
    await this.programs.save(program);

    return toProgramCapacityView(program);
  }
}
