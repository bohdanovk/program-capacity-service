export type Environment = 'development' | 'test' | 'production';

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
  readonly auth: { readonly apiKeys: readonly ApiKeyConfig[] };
  readonly fx: { readonly rates: readonly FxRateConfig[] };
  readonly kafka: KafkaConfig;
  readonly swagger: { readonly enabled: boolean };
}
