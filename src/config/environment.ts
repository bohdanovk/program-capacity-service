import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { coerceBoolean, coerceInteger } from '../shared/transform/coercion';
import type { Environment } from './app-config';

/**
 * Values assumed in development when the variable is absent, so a fresh clone runs with
 * `npm run start:dev` and nothing else. Test and production must set them explicitly.
 */
export const DEVELOPMENT_DEFAULTS: Readonly<Record<string, string>> = {
  API_KEYS:
    'dev-admin:dev-admin-key-0123456789:read+write,dev-reader:dev-reader-key-0123456789:read',
  FX_RATES: 'EUR/USD=1.0850,GBP/USD=1.2700,USD/EUR=0.9217,JPY/USD=0.0066889632',
};

/**
 * The configuration contract. Every variable, its type, its constraints and its default live
 * here and nowhere else; the service refuses to start when the environment does not satisfy it.
 */
export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: Environment = 'development';

  @Transform(({ value }) => coerceInteger(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  /** `name:secret:scope[+scope]` entries separated by commas, e.g. `ops:0123456789abcdef:read+write`. */
  @IsString()
  @IsNotEmpty()
  API_KEYS!: string;

  /** `BASE/QUOTE=rate` pairs separated by commas, e.g. `EUR/USD=1.0850,GBP/USD=1.2700`. */
  @IsOptional()
  @IsString()
  FX_RATES = '';

  @Transform(({ value }) => coerceBoolean(value))
  @IsBoolean()
  KAFKA_ENABLED = false;

  @IsString()
  @IsNotEmpty()
  KAFKA_BROKERS = 'localhost:9092';

  @IsString()
  @IsNotEmpty()
  KAFKA_CLIENT_ID = 'program-capacity-service';

  @IsString()
  @IsNotEmpty()
  KAFKA_GROUP_ID = 'program-capacity-service';

  @Transform(({ value }) => coerceBoolean(value))
  @IsBoolean()
  SWAGGER_ENABLED = true;
}

export interface ValidatedEnvironment {
  readonly env: EnvironmentVariables;
  /** Names of variables filled from {@link DEVELOPMENT_DEFAULTS}; empty outside development. */
  readonly defaulted: readonly string[];
}

export function validateEnvironment(raw: Record<string, unknown>): ValidatedEnvironment {
  const { values, defaulted } = applyDevelopmentDefaults(raw);
  const env = plainToInstance(EnvironmentVariables, values, { exposeDefaultValues: true });
  const errors = validateSync(env, { whitelist: true, forbidUnknownValues: false });

  if (errors.length > 0) {
    const problems = errors
      .map((error) => Object.values(error.constraints ?? {}).join('; '))
      .join('\n  - ');

    throw new Error(`Invalid environment configuration:\n  - ${problems}`);
  }

  return { env, defaulted };
}

function applyDevelopmentDefaults(raw: Record<string, unknown>): {
  values: Record<string, unknown>;
  defaulted: string[];
} {
  const isDevelopment = (raw.NODE_ENV ?? 'development') === 'development';
  const values = { ...raw };
  const defaulted: string[] = [];

  if (isDevelopment) {
    for (const [name, value] of Object.entries(DEVELOPMENT_DEFAULTS)) {
      if (values[name] === undefined || values[name] === '') {
        values[name] = value;
        defaulted.push(name);
      }
    }
  }

  return { values, defaulted };
}
