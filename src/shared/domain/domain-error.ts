/**
 * Transport-agnostic classification of a domain failure. Inbound adapters map it to
 * their own vocabulary (HTTP status codes, "drop vs. retry" for message consumers)
 * without the domain knowing anything about HTTP or Kafka.
 */
export type DomainErrorKind = 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT' | 'UNPROCESSABLE';

export abstract class DomainError extends Error {
  protected constructor(
    /** Stable, machine-readable error code exposed to clients. */
    readonly code: string,
    readonly kind: DomainErrorKind,
    message: string,
    /** Structured context safe to expose to clients (no secrets, no internals). */
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}
