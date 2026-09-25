import { Page, PageRequest } from '../../../shared/pagination/pagination';
import { Program, ReservationScope } from '../program';
import { Reservation, ReservationStatus } from '../reservation';

export const PROGRAM_REPOSITORY = Symbol('PROGRAM_REPOSITORY');

/**
 * Outbound port for program persistence. Implementations must provide optimistic
 * concurrency: `save` rejects an aggregate whose `version` no longer matches the stored one.
 *
 * A program and its reservations are stored as one record plus one record per reservation
 * (`programs` and `reservations` tables). Every method reads or writes only the reservations
 * it needs, so its cost does not grow with the number a program has accumulated.
 */
export interface ProgramRepository {
  /**
   * The program with the reservations `scope` asks for and no others (none by default).
   * The reserved total and the active count are stored on the program record itself.
   */
  findById(programId: string, scope?: ReservationScope): Promise<Program | null>;
  /**
   * Programs ordered by id, one page at a time (keyset: `WHERE id > :cursor ORDER BY id`),
   * without their reservations. Nothing in the service loads every program at once.
   */
  findPage(request: PageRequest): Promise<Page<Program>>;
  /**
   * Reservations of one program, optionally of one status, oldest first with the invoice id
   * breaking ties (keyset on `(reserved_at, invoice_id)`). Empty for an unknown program.
   */
  findReservationPage(
    programId: string,
    request: PageRequest,
    status?: ReservationStatus,
  ): Promise<Page<Reservation>>;
  /**
   * Inserts (version 0) or updates the program record, writes the reservations that changed
   * since it was loaded, and bumps the stored version, all or nothing.
   * @throws ConcurrencyConflictError when the stored version differs from `program.version`,
   *         or when inserting an id that already exists.
   */
  save(program: Program): Promise<void>;
}
