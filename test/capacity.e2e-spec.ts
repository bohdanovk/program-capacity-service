import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/app.setup';

const ADMIN_KEY = 'e2e-admin-key-0123456789';
const READER_KEY = 'e2e-reader-key-0123456789';

describe('Capacity API (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      API_KEYS: `admin:${ADMIN_KEY}:read+write,reader:${READER_KEY}:read`,
      FX_RATES: 'EUR/USD=1.0850',
      KAFKA_ENABLED: 'false',
      SWAGGER_ENABLED: 'false',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureHttpApp(app);
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authentication', () => {
    it('serves health without a key', async () => {
      const response = await http.get('/health').expect(200);
      expect(response.body).toMatchObject({ status: 'ok', treasuryFeed: 'disabled' });
    });

    it('rejects missing and invalid keys with a uniform error envelope', async () => {
      const missing = await http.get('/api/v1/programs').expect(401);
      expect(missing.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
      expect(missing.body.requestId).toEqual(expect.any(String));

      await http.get('/api/v1/programs').set('x-api-key', 'wrong').expect(401);
    });

    it('rejects read-only keys on write endpoints', async () => {
      const response = await http
        .post('/api/v1/programs')
        .set('x-api-key', READER_KEY)
        .send({ programId: 'PRG-RO', creditLimit: { amount: '1.00', currency: 'USD' } })
        .expect(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('echoes a caller-supplied request id', async () => {
      const response = await http.get('/health').set('x-request-id', 'trace-123').expect(200);
      expect(response.headers['x-request-id']).toBe('trace-123');
    });
  });

  describe('reservation lifecycle', () => {
    const programId = 'PRG-E2E';
    it('creates a program with the whole limit available', async () => {
      const response = await http
        .post('/api/v1/programs')
        .set('x-api-key', ADMIN_KEY)
        .send({ programId, creditLimit: { amount: '10000.00', currency: 'USD' } })
        .expect(201);
      expect(response.body).toMatchObject({
        programId,
        currency: 'USD',
        creditLimit: { amount: '10000.00', currency: 'USD' },
        reserved: { amount: '0.00', currency: 'USD' },
        available: { amount: '10000.00', currency: 'USD' },
        overCommitted: false,
        activeReservations: 0,
        lastTreasurySequence: null,
      });

      const duplicate = await http
        .post('/api/v1/programs')
        .set('x-api-key', ADMIN_KEY)
        .send({ programId, creditLimit: { amount: '1.00', currency: 'USD' } })
        .expect(409);
      expect(duplicate.body.code).toBe('PROGRAM_ALREADY_EXISTS');
    });

    it('reserves a foreign-currency invoice, idempotently', async () => {
      const body = { invoiceId: 'INV-1', invoiceAmount: { amount: '1000.00', currency: 'EUR' } };

      const created = await http
        .post(`/api/v1/programs/${programId}/reservations`)
        .set('x-api-key', ADMIN_KEY)
        .send(body)
        .expect(201);
      expect(created.body).toMatchObject({
        programId,
        invoiceId: 'INV-1',
        status: 'ACTIVE',
        invoiceAmount: { amount: '1000.00', currency: 'EUR' },
        reservedAmount: { amount: '1085.00', currency: 'USD' },
        exchangeRate: '1.085',
        releasedAt: null,
      });

      const replay = await http
        .post(`/api/v1/programs/${programId}/reservations`)
        .set('x-api-key', ADMIN_KEY)
        .send(body)
        .expect(200);
      expect(replay.body).toEqual(created.body);

      const conflict = await http
        .post(`/api/v1/programs/${programId}/reservations`)
        .set('x-api-key', ADMIN_KEY)
        .send({ ...body, invoiceAmount: { amount: '1000.01', currency: 'EUR' } })
        .expect(409);
      expect(conflict.body.code).toBe('RESERVATION_CONFLICT');

      const program = await http
        .get(`/api/v1/programs/${programId}`)
        .set('x-api-key', READER_KEY)
        .expect(200);
      expect(program.body).toMatchObject({
        reserved: { amount: '1085.00', currency: 'USD' },
        available: { amount: '8915.00', currency: 'USD' },
        activeReservations: 1,
      });
    });

    it('refuses to exceed the available capacity', async () => {
      const response = await http
        .post(`/api/v1/programs/${programId}/reservations`)
        .set('x-api-key', ADMIN_KEY)
        .send({ invoiceId: 'INV-BIG', invoiceAmount: { amount: '8915.01', currency: 'USD' } })
        .expect(409);
      expect(response.body).toMatchObject({
        code: 'INSUFFICIENT_CAPACITY',
        details: { requested: '8915.01 USD', available: '8915.00 USD' },
      });
    });

    it('rejects malformed and imprecise input before touching state', async () => {
      const post = (payload: object): request.Test =>
        http
          .post(`/api/v1/programs/${programId}/reservations`)
          .set('x-api-key', ADMIN_KEY)
          .send(payload);

      const notDecimal = await post({
        invoiceId: 'INV-X',
        invoiceAmount: { amount: 'abc', currency: 'USD' },
      }).expect(400);
      expect(notDecimal.body.code).toBe('VALIDATION_FAILED');

      const tooPrecise = await post({
        invoiceId: 'INV-X',
        invoiceAmount: { amount: '10.005', currency: 'USD' },
      }).expect(400);
      expect(tooPrecise.body.code).toBe('INVALID_AMOUNT');

      const unknownField = await post({
        invoiceId: 'INV-X',
        invoiceAmount: { amount: '1.00', currency: 'USD' },
        note: 'x',
      }).expect(400);
      expect(unknownField.body.code).toBe('VALIDATION_FAILED');

      const noRate = await post({
        invoiceId: 'INV-X',
        invoiceAmount: { amount: '1.00', currency: 'GBP' },
      }).expect(422);
      expect(noRate.body.code).toBe('UNSUPPORTED_CURRENCY_PAIR');

      const zero = await post({
        invoiceId: 'INV-X',
        invoiceAmount: { amount: '0.00', currency: 'USD' },
      }).expect(400);
      expect(zero.body.code).toBe('AMOUNT_NOT_POSITIVE');

      await http
        .get(`/api/v1/programs/${programId}/reservations/INV-X`)
        .set('x-api-key', READER_KEY)
        .expect(404);
    });

    it('releases capacity idempotently', async () => {
      const released = await http
        .post(`/api/v1/programs/${programId}/reservations/INV-1/release`)
        .set('x-api-key', ADMIN_KEY)
        .expect(200);
      expect(released.body.status).toBe('RELEASED');
      expect(released.body.releasedAt).toEqual(expect.any(String));

      const again = await http
        .post(`/api/v1/programs/${programId}/reservations/INV-1/release`)
        .set('x-api-key', ADMIN_KEY)
        .expect(200);
      expect(again.body).toEqual(released.body);

      const program = await http
        .get(`/api/v1/programs/${programId}`)
        .set('x-api-key', READER_KEY)
        .expect(200);
      expect(program.body.available).toEqual({ amount: '10000.00', currency: 'USD' });

      const list = await http
        .get(`/api/v1/programs/${programId}/reservations`)
        .query({ status: 'RELEASED' })
        .set('x-api-key', READER_KEY)
        .expect(200);
      expect(list.body).toHaveLength(1);

      const unknown = await http
        .post(`/api/v1/programs/${programId}/reservations/INV-NOPE/release`)
        .set('x-api-key', ADMIN_KEY)
        .expect(404);
      expect(unknown.body.code).toBe('RESERVATION_NOT_FOUND');
    });
  });
});
