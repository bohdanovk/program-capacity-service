export type Environment = 'development' | 'test' | 'production';

/** Nest log levels from least to most severe; a configured level enables itself and everything above. */
export const LOG_LEVELS = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface ApiKeyConfig {
  /** Human-readable client name, used in logs; never the secret. */
  readonly name: string;
  readonly key: string;
  /** Scope names as written in the environment; the auth module validates them. */
  readonly scopes: readonly string[];
}

export interface FxRateConfig {
  readonly base: string;
  readonly quote: string;
  readonly rate: string;
}

export interface KafkaConfig {
  readonly enabled: boolean;
  readonly brokers: readonly string[];
  readonly clientId: string;
  readonly groupId: string;
}

export interface AppConfig {
  readonly env: Environment;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly auth: { readonly apiKeys: readonly ApiKeyConfig[] };
  readonly fx: { readonly rates: readonly FxRateConfig[] };
  readonly kafka: KafkaConfig;
  readonly swagger: { readonly enabled: boolean };
}
