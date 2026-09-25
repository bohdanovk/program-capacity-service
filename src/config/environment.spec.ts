import { DEVELOPMENT_DEFAULTS, validateEnvironment } from './environment';

const production = {
  NODE_ENV: 'production',
  API_KEYS: 'test:test-key-0123456789:read+write',
};

describe('Persistence configuration', () => {
  it('defaults to PostgreSQL and the local Compose database in development', () => {
    const { env } = validateEnvironment({});
    expect(env.STORE).toBe('postgres');
    expect(env.DATABASE_URL).toBe(DEVELOPMENT_DEFAULTS.DATABASE_URL);
  });

  it.each(['test', 'production'])('requires an explicit database URL in %s', (nodeEnv) => {
    expect(() => validateEnvironment({ ...production, NODE_ENV: nodeEnv })).toThrow('DATABASE_URL');
  });

  it.each([
    'postgres://db:5432/capacity',
    'postgresql://user:secret@db:5432/capacity?sslmode=require',
  ])('accepts PostgreSQL URL %s', (url) => {
    expect(validateEnvironment({ ...production, DATABASE_URL: url }).env.DATABASE_URL).toBe(url);
  });

  it.each(['', 'not-a-url', 'https://db/capacity'])('rejects invalid URL %s', (url) => {
    expect(() => validateEnvironment({ ...production, DATABASE_URL: url })).toThrow('DATABASE_URL');
  });

  it('allows explicit memory storage without any database configuration', () => {
    const { env } = validateEnvironment({ ...production, STORE: 'memory' });
    expect(env.STORE).toBe('memory');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(validateEnvironment({ STORE: 'memory' }).defaulted).not.toContain('DATABASE_URL');
  });

  it('rejects unknown stores', () => {
    expect(() => validateEnvironment({ STORE: 'sqlite' })).toThrow('STORE');
  });
});
