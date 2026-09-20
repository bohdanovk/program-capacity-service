export const CLOCK = Symbol('CLOCK');

/** Outbound port for the current time, so the domain and tests never call `new Date()` directly. */
export interface Clock {
  now(): Date;
}
