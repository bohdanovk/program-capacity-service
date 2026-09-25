import { Controller, Logger, UseFilters, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { Ctx, EventPattern, KafkaContext, Payload } from '@nestjs/microservices';
import { ApplyTreasuryLimitUseCase } from '../../application/use-cases/apply-treasury-limit.use-case';
import { ReconcileProgramUseCase } from '../../application/use-cases/reconcile-program.use-case';
import { describeMessageOrigin } from './kafka-message-origin';
import { TreasuryMessageExceptionFilter } from './treasury-message-exception.filter';
import { TreasuryMessageType, TreasuryProgramMessageDto } from './treasury-program-message.dto';
import { TreasuryRetryInterceptor } from './treasury-retry.interceptor';
import { TREASURY_PROGRAM_CAPACITY_TOPIC } from './treasury-topics';

/**
 * Inbound Kafka adapter. It only translates messages into application commands; every
 * decision (staleness, currency checks, what a snapshot overrides) belongs to the domain.
 * Messages are keyed by programId, so all updates for one program arrive in order.
 *
 * Failures are bounded: the interceptor retries what may succeed later, and the filter
 * dead-letters what still fails, so no single message can hold its partition indefinitely.
 */
@Controller()
@UseInterceptors(TreasuryRetryInterceptor)
@UseFilters(TreasuryMessageExceptionFilter)
export class TreasuryCapacityConsumer {
  private readonly logger = new Logger(TreasuryCapacityConsumer.name);

  constructor(
    private readonly applyTreasuryLimit: ApplyTreasuryLimitUseCase,
    private readonly reconcileProgram: ReconcileProgramUseCase,
  ) {}

  @EventPattern(TREASURY_PROGRAM_CAPACITY_TOPIC)
  async handle(
    @Payload(new ValidationPipe({ transform: true, whitelist: true, forbidUnknownValues: true }))
    message: TreasuryProgramMessageDto,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    const origin = describeMessageOrigin(context);
    const subject = `${message.type} program=${message.programId} seq=${message.sequence}`;

    switch (message.type) {
      case TreasuryMessageType.ProgramLimitChanged: {
        const outcome = await this.applyTreasuryLimit.execute({
          programId: message.programId,
          sequence: message.sequence,
          currency: message.currency,
          creditLimit: message.creditLimit,
        });
        this.logger.log(`${subject} -> ${outcome} (${origin})`);
        return;
      }
      case TreasuryMessageType.ProgramReconciled: {
        const result = await this.reconcileProgram.execute({
          programId: message.programId,
          sequence: message.sequence,
          asOf: new Date(message.occurredAt),
          currency: message.currency,
          creditLimit: message.creditLimit,
          activeReservations: message.activeReservations ?? [],
        });
        const summary =
          result.outcome === 'APPLIED'
            ? `APPLIED${result.created ? ' (program created)' : ''} added=${result.added} updated=${result.updated} released=${result.released} preserved=${result.preserved} unchanged=${result.unchanged}`
            : result.outcome;
        this.logger.log(`${subject} -> ${summary} (${origin})`);
        return;
      }
    }
  }
}
