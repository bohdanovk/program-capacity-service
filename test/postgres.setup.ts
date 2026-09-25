import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { DEVELOPMENT_DEFAULTS } from '../src/config/environment';

// Each test file owns a schema. Never truncate or drop the service's tables.
const schema = `capacity_test_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = process.env.TEST_DATABASE_URL ?? DEVELOPMENT_DEFAULTS.DATABASE_URL!;
const admin = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
const scopedUrl = new URL(databaseUrl);
scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
process.env.DATABASE_URL = scopedUrl.toString();
process.env.TEST_STORE = 'postgres';

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: scopedUrl.toString() });
  try {
    await pool.query(await readFile(join(__dirname, '../database/schema.sql'), 'utf8'));
  } finally {
    await pool.end();
  }
}, 15000);

afterAll(async () => {
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
});
