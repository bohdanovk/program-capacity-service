import { Module } from '@nestjs/common';
import { ProgramQueries } from './application/queries/program-queries';
import { ApplyTreasuryLimitUseCase } from './application/use-cases/apply-treasury-limit.use-case';
import { CreateProgramUseCase } from './application/use-cases/create-program.use-case';
import { ReconcileProgramUseCase } from './application/use-cases/reconcile-program.use-case';
import { ReleaseReservationUseCase } from './application/use-cases/release-reservation.use-case';
import { ReserveCapacityUseCase } from './application/use-cases/reserve-capacity.use-case';
import { SystemClockModule } from './infrastructure/clock/system-clock.module';
import { StaticFxModule } from './infrastructure/fx/static-fx.module';
import { InMemoryPersistenceModule } from './infrastructure/persistence/in-memory-persistence.module';
import { ProgramsController } from './presentation/http/programs.controller';
import { ReservationsController } from './presentation/http/reservations.controller';
import { TreasuryCapacityConsumer } from './presentation/kafka/treasury-capacity.consumer';

/**
 * Bounded context: program capacity and invoice reservations.
 *
 * The imports bind each outbound port (repository, FX rates, clock) to one adapter module.
 * Replacing the in-memory store with a database is a matter of importing a different
 * persistence module here; nothing in application or domain changes.
 */
@Module({
  imports: [InMemoryPersistenceModule, StaticFxModule, SystemClockModule],
  controllers: [ProgramsController, ReservationsController, TreasuryCapacityConsumer],
  providers: [
    CreateProgramUseCase,
    ReserveCapacityUseCase,
    ReleaseReservationUseCase,
    ApplyTreasuryLimitUseCase,
    ReconcileProgramUseCase,
    ProgramQueries,
  ],
})
export class CapacityModule {}
