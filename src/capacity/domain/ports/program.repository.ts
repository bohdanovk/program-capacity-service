import { Program } from '../program';

export const PROGRAM_REPOSITORY = Symbol('PROGRAM_REPOSITORY');

/**
 * Outbound port for program persistence. Implementations must provide optimistic
 * concurrency: `save` rejects an aggregate whose `version` no longer matches the stored one.
 */
export interface ProgramRepository {
  findById(programId: string): Promise<Program | null>;
  findAll(): Promise<Program[]>;
  /**
   * Inserts (version 0) or updates the aggregate and bumps the stored version.
   * @throws ConcurrencyConflictError when the stored version differs from `program.version`,
   *         or when inserting an id that already exists.
   */
  save(program: Program): Promise<void>;
}
