import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { KafkaContext } from '@nestjs/microservices';
import { Observable, of, throwError } from 'rxjs';
import { DomainError } from '../../../shared/domain/domain-error';
import { describeMessageOrigin } from './kafka-message-origin';

/**
 * Decides what a failed treasury message means. Nest awaits the value this filter returns
 * before letting kafkajs commit the offset, so the return value is the decision:
 *
 * - Poison messages (malformed payload, unsupported currency, snapshot that contradicts the
 *   program) can never succeed. They are logged with full provenance and acknowledged, so the
 *   partition keeps flowing. In production this is where a dead-letter topic is fed.
 * - Anything else is treated as transient (a store that is briefly unavailable, an optimistic
 *   lock lost to concurrent API traffic even after retries). The error is rethrown, the offset
 *   is not committed, and kafkajs redelivers the message with back-off.
 */
@Catch()
export class TreasuryMessageExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(TreasuryMessageExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): Observable<void> {
    const origin = describeMessageOrigin(host.switchToRpc().getContext<KafkaContext>());
    if (isPoisonMessage(exception)) {
      this.logger.error(`Dropped treasury message ${origin}: ${describeReason(exception)}`);
      return of(undefined);
    }
    this.logger.error(
      `Treasury message ${origin} failed and will be redelivered: ${describeReason(exception)}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    return throwError(() => exception);
  }
}

function isPoisonMessage(exception: unknown): boolean {
  if (exception instanceof BadRequestException) {
    return true;
  }
  return (
    exception instanceof DomainError &&
    (exception.kind === 'INVALID_INPUT' || exception.kind === 'UNPROCESSABLE')
  );
}

function describeReason(exception: unknown): string {
  if (exception instanceof BadRequestException) {
    const payload = exception.getResponse();
    const message: unknown =
      typeof payload === 'string' ? payload : (payload as { message?: unknown }).message;
    return Array.isArray(message) ? `validation failed (${message.join('; ')})` : exception.message;
  }
  if (exception instanceof DomainError) {
    return `${exception.code}: ${exception.message}`;
  }
  return exception instanceof Error ? exception.message : String(exception);
}
