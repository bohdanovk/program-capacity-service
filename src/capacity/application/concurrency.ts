import { ConcurrencyConflictError } from '../domain/errors';

export const DEFAULT_CONCURRENCY_ATTEMPTS = 3;

/**
 * Re-runs a load-mutate-save operation when the repository rejects the save because the
 * aggregate changed underneath it. Every attempt reloads fresh state, so the domain rules
 * are re-evaluated against what was actually persisted. After the last attempt the conflict
 * propagates and the caller decides (HTTP 409 with a retry hint, message redelivery).
 */
export async function withConcurrencyRetry<T>(
  operation: () => Promise<T>,
  maxAttempts: number = DEFAULT_CONCURRENCY_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (!(error instanceof ConcurrencyConflictError) || attempt >= maxAttempts) {
        throw error;
      }
    }
  }
}
