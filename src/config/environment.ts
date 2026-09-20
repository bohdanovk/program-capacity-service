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
import type { Environment } from './app-config';

// todo: maybe move toBoolean and toInteger to shared
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;
const toInteger = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

/** Raw environment contract. Defaults are development defaults; production must set everything explicitly. */
export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: Environment = 'development';

  @Transform(toInteger)
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

  @Transform(toBoolean)
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

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED = true;
}

export function validateEnvironment(raw: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, raw, { exposeDefaultValues: true });
  const errors = validateSync(env, { whitelist: true, forbidUnknownValues: false });

  if (errors.length > 0) {
    const problems = errors
      .map((error) => Object.values(error.constraints ?? {}).join('; '))
      .join('\n  - ');

    throw new Error(`Invalid environment configuration:\n  - ${problems}`);
  }

  return env;
}
