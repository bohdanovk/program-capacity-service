import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { KafkaContext } from '@nestjs/microservices';
import { KafkaJSError } from 'kafkajs';
import { catchError, defer, map, Observable, throwError } from 'rxjs';
import { describeMessageOrigin } from './kafka-message-origin';
import { DeadLetterReason, deadLetterMessage } from './treasury-dead-letter';
import {
  describeFailure,
  isPoisonMessage,
  TreasuryMessageFailedError,
} from './treasury-message-failure';
import { TREASURY_DEAD_LETTER_TOPIC } from './treasury-topics';

/**
 * Decides what a treasury message that failed for good means. Nest awaits the value this
 * filter returns before letting kafkajs commit the offset, so the return value is the decision:
 *
 * - Poison messages (malformed payload, unsupported currency, snapshot that contradicts the
 *   program) can never succeed; every other failure has already been retried by
 *   TreasuryRetryInterceptor. Either way the message is copied to the dead-letter topic with
 *   its provenance and the reason, and acknowledged, so the partition keeps flowing.
 * - If the dead-letter topic cannot take it, or an exact copy cannot be made, the error is
 *   rethrown and the offset is not committed: kafkajs redelivers the message and nothing is
 *   lost. The same happens when the consumer loses the partition (rebalance, shutdown) while
 *   retrying.
 */
@Catch()
export class TreasuryMessageExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TreasuryMessageExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): Observable<void> {
    const context = host.switchToRpc().getContext<KafkaContext>();
    const origin = describeMessageOrigin(context);

    if (exception instanceof KafkaJSError) {
      this.logger.warn(
        `Treasury message ${origin} was interrupted and will be redelivered: ${exception.message}`,
      );
      return throwError(() => exception);
    }

    const failed = exception instanceof TreasuryMessageFailedError;
    const cause = failed ? exception.cause : exception;
    const attempts = failed ? exception.attempts : 1;
    const reason: DeadLetterReason = isPoisonMessage(cause) ? 'POISON' : 'RETRIES_EXHAUSTED';

    return defer(() => {
      const letter = deadLetterMessage(context, {
        reason,
        attempts,
        error: describeFailure(cause),
      });
      return context.getProducer().send({ topic: TREASURY_DEAD_LETTER_TOPIC, messages: [letter] });
    }).pipe(
      map(() => {
        this.logger.error(
          `Dead-lettered treasury message ${origin} to ${TREASURY_DEAD_LETTER_TOPIC} (${reason} after ${attempts} attempt(s)): ${describeFailure(cause)}`,
          reason === 'POISON' ? undefined : stackOf(cause),
        );
      }),
      catchError((publishError: unknown) => {
        this.logger.error(
          `Treasury message ${origin} failed (${describeFailure(cause)}) and could not be dead-lettered (${describeFailure(publishError)}); it will be redelivered`,
          stackOf(publishError),
        );
        return throwError(() => exception);
      }),
    );
  }
}

function stackOf(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack : undefined;
}
