import { Module } from '@nestjs/common';
import { ProgramQueries } from './application/queries/program-queries';
import { ApplyTreasuryLimitUseCase } from './application/use-cases/apply-treasury-limit.use-case';
import { CreateProgramUseCase } from './application/use-cases/create-program.use-case';
import { ReconcileProgramUseCase } from './application/use-cases/reconcile-program.use-case';
import { ReleaseReservationUseCase } from './application/use-cases/release-reservation.use-case';
import { ReserveCapacityUseCase } from './application/use-cases/reserve-capacity.use-case';
import { SystemClockModule } from './infrastructure/clock/system-clock.module';
import { StaticFxModule } from './infrastructure/fx/static-fx.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { ProgramsController } from './presentation/http/programs.controller';
import { ReservationsController } from './presentation/http/reservations.controller';
import { TreasuryCapacityConsumer } from './presentation/kafka/treasury-capacity.consumer';

/**
 * Bounded context: program capacity and invoice reservations.
 *
 * The imports bind each outbound port (repository, FX rates, clock) to one adapter module.
 * PersistenceModule selects the configured store without changing application or domain code.
 */
@Module({
  imports: [PersistenceModule, StaticFxModule, SystemClockModule],
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
