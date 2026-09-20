import { ApiKeyConfig, AppConfig, FxRateConfig } from './app-config';
import { validateEnvironment } from './environment';

const MIN_API_KEY_LENGTH = 16;
const API_KEY_ENTRY = /^([A-Za-z0-9._-]+):([A-Za-z0-9._~-]+):([a-z+]+)$/;
const FX_RATE_ENTRY = /^([A-Za-z]{3})\/([A-Za-z]{3})=(\d+(?:\.\d+)?)$/;

/**
 * Builds the typed application configuration from the environment. Throws on any problem so
 * a misconfigured service fails at start-up rather than on the first request.
 */
export function loadAppConfig(raw: Record<string, unknown> = process.env): AppConfig {
  const env = validateEnvironment(raw);

  return {
    env: env.NODE_ENV,
    port: env.PORT,
    auth: { apiKeys: parseApiKeys(env.API_KEYS) },
    fx: { rates: parseFxRates(env.FX_RATES) },
    kafka: {
      enabled: env.KAFKA_ENABLED,
      brokers: splitList(env.KAFKA_BROKERS),
      clientId: env.KAFKA_CLIENT_ID,
      groupId: env.KAFKA_GROUP_ID,
    },
    swagger: { enabled: env.SWAGGER_ENABLED },
  };
}

export function parseApiKeys(text: string): ApiKeyConfig[] {
  const keys = splitList(text).map((entry): ApiKeyConfig => {
    const match = API_KEY_ENTRY.exec(entry);
    if (match === null) {
      throw new Error(
        'API_KEYS entries must look like "name:secret:scope[+scope]" (secret: letters, digits, "._~-")',
      );
    }

    const [, name = '', key = '', scopeList = ''] = match;

    if (key.length < MIN_API_KEY_LENGTH) {
      throw new Error(`API key "${name}" is shorter than ${MIN_API_KEY_LENGTH} characters`);
    }

    return { name, key, scopes: scopeList.split('+') };
  });

  if (keys.length === 0) {
    throw new Error('API_KEYS must define at least one key');
  }

  const names = new Set(keys.map((entry) => entry.name));
  if (names.size !== keys.length) {
    throw new Error('API_KEYS names must be unique');
  }

  return keys;
}

export function parseFxRates(text: string): FxRateConfig[] {
  return splitList(text).map((entry): FxRateConfig => {
    const match = FX_RATE_ENTRY.exec(entry);
    if (match === null) {
      throw new Error(`FX_RATES entry "${entry}" must look like "EUR/USD=1.0850"`);
    }

    const [, base = '', quote = '', rate = ''] = match;
    return { base: base.toUpperCase(), quote: quote.toUpperCase(), rate };
  });
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
