import { Inject, Injectable } from '@nestjs/common';
import { ReservationNotFoundError } from '../../domain/errors';
import { PROGRAM_REPOSITORY } from '../../domain/ports/program.repository';
import type { ProgramRepository } from '../../domain/ports/program.repository';
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

  async listPrograms(): Promise<ProgramCapacityView[]> {
    const programs = await this.programs.findAll();
    return programs.map(toProgramCapacityView);
  }

  async getProgramCapacity(programId: string): Promise<ProgramCapacityView> {
    return toProgramCapacityView(await requireProgram(this.programs, programId));
  }

  async listReservations(
    programId: string,
    status?: ReservationStatus,
  ): Promise<ReservationView[]> {
    const program = await requireProgram(this.programs, programId);
    return program
      .listReservations()
      .filter((reservation) => status === undefined || reservation.status === status)
      .map((reservation) => toReservationView(program.id, reservation));
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
