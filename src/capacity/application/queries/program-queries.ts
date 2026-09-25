import { Inject, Injectable } from '@nestjs/common';
import { Page, PageRequest } from '../../../shared/pagination/pagination';
import { ReservationNotFoundError } from '../../domain/errors';
import { PROGRAM_REPOSITORY } from '../../domain/ports/program.repository';
import type { ProgramRepository } from '../../domain/ports/program.repository';
import { invoiceScope } from '../../domain/program';
import { ReservationStatus } from '../../domain/reservation';
import { requireProgram } from '../program-loader';
import {
  ProgramCapacityView,
  ReservationView,
  toProgramCapacityView,
  toReservationView,
} from '../views/views';

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

  /** Oldest first; the invoice id breaks ties so the order is total and the cursor unambiguous. */
  async listReservations(
    programId: string,
    request: PageRequest,
    status?: ReservationStatus,
  ): Promise<Page<ReservationView>> {
    await requireProgram(this.programs, programId);
    const page = await this.programs.findReservationPage(programId, request, status);

    return {
      ...page,
      items: page.items.map((reservation) => toReservationView(programId, reservation)),
    };
  }

  async getReservation(programId: string, invoiceId: string): Promise<ReservationView> {
    const program = await requireProgram(this.programs, programId, invoiceScope(invoiceId));
    const reservation = program.findReservation(invoiceId);

    if (reservation === undefined) {
      throw new ReservationNotFoundError(programId, invoiceId);
    }

    return toReservationView(program.id, reservation);
  }
}
