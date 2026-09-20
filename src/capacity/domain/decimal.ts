/**
 * Exact fixed-point decimal helpers on top of bigint.
 *
 * Every monetary quantity in this domain is an integer count of minor units (cents,
 * pence, yen). Floating point never enters the picture: amounts are parsed from and
 * formatted to decimal strings.
 */

/** Rounding modes with java.math.BigDecimal semantics. */
export enum RoundingMode {
  /** Away from zero. */
  Up = 'UP',
  /** Towards zero (truncate). */
  Down = 'DOWN',
  /** Nearest neighbour, ties away from zero. */
  HalfUp = 'HALF_UP',
}

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/;

export function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/**
 * Parses a plain decimal string ("1234.56") into an integer scaled by 10^scale.
 * Returns null when the text is not a plain decimal or carries more fraction digits
 * than the scale allows. Excess precision is never silently rounded away.
 */
export function parseScaledDecimal(text: string, scale: number): bigint | null {
  const match = DECIMAL_PATTERN.exec(text);
  if (match === null) {
    return null;
  }
  const [, sign, integerPart = '', fractionPart = ''] = match;
  if (fractionPart.length > scale) {
    return null;
  }
  const magnitude = BigInt(integerPart + fractionPart.padEnd(scale, '0'));
  return sign === '-' ? -magnitude : magnitude;
}

/** Formats a scaled integer as a plain decimal string with exactly `scale` fraction digits. */
export function formatScaledDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const integerPart = digits.slice(0, digits.length - scale);
  const fractionPart = digits.slice(digits.length - scale);
  const sign = negative ? '-' : '';
  return scale === 0 ? `${sign}${integerPart}` : `${sign}${integerPart}.${fractionPart}`;
}

/** Removes insignificant trailing zeros from the fraction part ("1.0850000" -> "1.085"). */
export function stripTrailingFractionZeros(decimal: string): string {
  if (!decimal.includes('.')) {
    return decimal;
  }
  return decimal.replace(/\.?0+$/, '');
}

/** Integer division with an explicit rounding mode. The denominator must be positive. */
export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n) {
    throw new RangeError('Denominator must be positive');
  }
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const remainder = magnitude % denominator;

  if (remainder !== 0n) {
    switch (mode) {
      case RoundingMode.Up:
        quotient += 1n;
        break;
      case RoundingMode.Down:
        break;
      case RoundingMode.HalfUp:
        if (remainder * 2n >= denominator) {
          quotient += 1n;
        }
        break;
    }
  }
  return negative ? -quotient : quotient;
}
