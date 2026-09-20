import { ProgramNotFoundError } from '../domain/errors';
import { ProgramRepository } from '../domain/ports/program.repository';
import { Program } from '../domain/program';

export async function requireProgram(
  programs: ProgramRepository,
  programId: string,
): Promise<Program> {
  const program = await programs.findById(programId);

  if (program === null) {
    throw new ProgramNotFoundError(programId);
  }

  return program;
}
