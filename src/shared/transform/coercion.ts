/**
 * Coercions for values that arrive as text (environment variables, query strings). Only
 * unambiguous text is converted; anything else is returned untouched so the validator
 * reports it instead of a silent guess ("yes" is not a boolean, "1.5" is not an integer).
 */

export function coerceBoolean(value: unknown): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  return value;
}

export function coerceInteger(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}
