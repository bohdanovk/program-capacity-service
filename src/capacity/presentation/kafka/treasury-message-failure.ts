import { BadRequestException } from '@nestjs/common';
import { DomainError } from '../../../shared/domain/domain-error';

/**
 * True for a message that can never succeed however often it is tried: a malformed payload,
 * an unsupported currency, a snapshot that contradicts the program. Anything else may go away
 * on its own (a store that is briefly unavailable, an optimistic lock lost to API traffic even
 * after retries), and so may an error nobody has classified yet: those are retried.
 */
export function isPoisonMessage(exception: unknown): boolean {
  if (exception instanceof BadRequestException) {
    return true;
  }
  return (
    exception instanceof DomainError &&
    (exception.kind === 'INVALID_INPUT' || exception.kind === 'UNPROCESSABLE')
  );
}

export function describeFailure(exception: unknown): string {
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

/** A treasury message that failed for good, with the number of attempts it was given. */
export class TreasuryMessageFailedError extends Error {
  constructor(
    cause: unknown,
    readonly attempts: number,
  ) {
    super(describeFailure(cause), { cause });
    this.name = new.target.name;
  }
}
