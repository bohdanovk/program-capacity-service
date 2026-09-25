import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../domain/ports/clock';
import type { Clock } from '../../domain/ports/clock';
import { PROGRAM_REPOSITORY } from '../../domain/ports/program.repository';
import type { ProgramRepository } from '../../domain/ports/program.repository';
import { invoiceScope } from '../../domain/program';
import { ReleaseReservationCommand } from '../commands';
import { withConcurrencyRetry } from '../concurrency';
import { requireProgram } from '../program-loader';
import { ReservationView, toReservationView } from '../views/views';

@Injectable()
export class ReleaseReservationUseCase {
  constructor(
    @Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Idempotent: releasing an already released reservation returns it unchanged. */
  execute(command: ReleaseReservationCommand): Promise<ReservationView> {
    return withConcurrencyRetry(async () => {
      const program = await requireProgram(
        this.programs,
        command.programId,
        invoiceScope(command.invoiceId),
      );
      const result = program.release({ invoiceId: command.invoiceId, at: this.clock.now() });

      if (result.released) {
        await this.programs.save(program);
      }

      return toReservationView(program.id, result.reservation);
    });
  }
}
