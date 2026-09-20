import { Inject, Injectable } from '@nestjs/common';
import {
  compareSortKeys,
  Page,
  PageRequest,
  paginateSorted,
  SortKey,
} from '../../../shared/pagination/pagination';
import { ReservationNotFoundError } from '../../domain/errors';
import { PROGRAM_REPOSITORY } from '../../domain/ports/program.repository';
import type { ProgramRepository } from '../../domain/ports/program.repository';
import { Reservation, ReservationStatus } from '../../domain/reservation';
import { requireProgram } from '../program-loader';
import {
  ProgramCapacityView,
  ReservationView,
  toProgramCapacityView,
  toReservationView,
} from '../views/views';

const RESERVATION_CURSOR = 'reservations';

/** Oldest first; the invoice id breaks ties so the order is total and the cursor unambiguous. */
const reservationSortKey = (reservation: Reservation): SortKey => [
  reservation.reservedAt.toISOString(),
  reservation.invoiceId,
];

/** Read side. Reads go through the same repository; a dedicated read store is a drop-in later. */
@Injectable()
export class ProgramQueries {
  constructor(@Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository) {}

  async listPrograms(request: PageRequest): Promise<Page<ProgramCapacityView>> {
    const page = await this.programs.findPage(request);

    return { ...page, items: page.items.map(toProgramCapacityView) };
  }

  async getProgramCapacity(programId: string): Promise<ProgramCapacityView> {
    return toProgramCapacityView(await requireProgram(this.programs, programId));
  }

  /**
   * Reservations are paged inside the loaded aggregate. A database adapter runs the same
   * keyset query against the reservations table instead; the HTTP contract does not change.
   */
  async listReservations(
    programId: string,
    request: PageRequest,
    status?: ReservationStatus,
  ): Promise<Page<ReservationView>> {
    const program = await requireProgram(this.programs, programId);
    const sorted = program
      .listReservations()
      .filter((reservation) => status === undefined || reservation.status === status)
      .sort((a, b) => compareSortKeys(reservationSortKey(a), reservationSortKey(b)));
    const page = paginateSorted({
      kind: RESERVATION_CURSOR,
      sorted,
      request,
      keyOf: reservationSortKey,
    });

    return {
      ...page,
      items: page.items.map((reservation) => toReservationView(program.id, reservation)),
    };
  }

  async getReservation(programId: string, invoiceId: string): Promise<ReservationView> {
    const program = await requireProgram(this.programs, programId);
    const reservation = program.findReservation(invoiceId);

    if (reservation === undefined) {
      throw new ReservationNotFoundError(programId, invoiceId);
    }

    return toReservationView(program.id, reservation);
  }
}
