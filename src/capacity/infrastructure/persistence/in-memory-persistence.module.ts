import { Module } from '@nestjs/common';
import { PROGRAM_REPOSITORY } from '../../domain/ports/program.repository';
import { InMemoryProgramRepository } from './in-memory-program.repository';

/** Binds the ProgramRepository port to the in-memory adapter. Swap this module for a database-backed one. */
@Module({
  providers: [{ provide: PROGRAM_REPOSITORY, useClass: InMemoryProgramRepository }],
  exports: [PROGRAM_REPOSITORY],
})
export class InMemoryPersistenceModule {}
