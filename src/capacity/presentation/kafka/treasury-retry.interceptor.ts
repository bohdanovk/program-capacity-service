import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaContext } from '@nestjs/microservices';
import { KafkaJSError } from 'kafkajs';
import { catchError, concatMap, defer, Observable, retry, throwError, timer } from 'rxjs';
import { AppConfig } from '../../../config/app-config';
import { describeMessageOrigin } from './kafka-message-origin';
import {
  describeFailure,
  isPoisonMessage,
  TreasuryMessageFailedError,
} from './treasury-message-failure';

/**
 * Longest wait between two attempts. No heartbeat goes out while waiting, and the consumer
 * group drops a member it has not heard from for 30 s (the kafkajs session timeout).
 */
export const MAX_RETRY_DELAY_MS = 10_000;

/**
 * Gives a treasury message that failed for a reason that may go away another chance, with
 * exponential back-off, up to KAFKA_MAX_ATTEMPTS attempts in all. Poison messages are not
 * retried. The partition waits meanwhile, which keeps every program's messages in order, and
 * a heartbeat before each retry keeps the consumer in its group.
 *
 * Whatever still fails reaches TreasuryMessageExceptionFilter as a TreasuryMessageFailedError
 * that carries the number of attempts. A Kafka error from the heartbeat (the partition was
 * revoked, the consumer is stopping) is passed on unchanged: the message is not at fault.
 */
@Injectable()
export class TreasuryRetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TreasuryRetryInterceptor.name);
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(config: ConfigService<AppConfig, true>) {
    const kafka = config.get('kafka', { infer: true });
    this.maxAttempts = kafka.maxAttempts;
    this.backoffMs = kafka.retryBackoffMs;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const kafka = context.switchToRpc().getContext<KafkaContext>();
    let attempts = 0;

    return defer(() => {
      attempts += 1;
      return next.handle();
    }).pipe(
      retry({
        count: this.maxAttempts - 1,
        delay: (error: unknown, retryNumber: number) => {
          if (isPoisonMessage(error)) {
            return throwError(() => error);
          }
          const wait = Math.min(this.backoffMs * 2 ** (retryNumber - 1), MAX_RETRY_DELAY_MS);
          this.logger.warn(
            `Treasury message ${describeMessageOrigin(kafka)} failed on attempt ${retryNumber} of ${this.maxAttempts}, retrying in ${wait} ms: ${describeFailure(error)}`,
          );
          return timer(wait).pipe(concatMap(() => kafka.getHeartbeat()()));
        },
      }),
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof KafkaJSError ? error : new TreasuryMessageFailedError(error, attempts),
        ),
      ),
    );
  }
}
