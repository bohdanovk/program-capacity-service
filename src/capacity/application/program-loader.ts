import { ProgramNotFoundError } from '../domain/errors';
import { ProgramRepository } from '../domain/ports/program.repository';
import { NO_RESERVATIONS, Program, ReservationScope } from '../domain/program';

export async function requireProgram(
  programs: ProgramRepository,
  programId: string,
  scope: ReservationScope = NO_RESERVATIONS,
): Promise<Program> {
  const program = await programs.findById(programId, scope);

  if (program === null) {
    throw new ProgramNotFoundError(programId);
  }

  return program;
}
