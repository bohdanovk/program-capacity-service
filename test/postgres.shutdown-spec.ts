import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/app.setup';
import { ExchangeRate } from '../src/capacity/domain/exchange-rate';
import { FX_RATE_PROVIDER } from '../src/capacity/domain/ports/fx-rate-provider';
import type { FxRateProvider } from '../src/capacity/domain/ports/fx-rate-provider';

it('finishes and persists an active reservation before closing the database pool', async () => {
  const key = 'shutdown-test-key-0123456789';
  Object.assign(process.env, {
    NODE_ENV: 'test',
    STORE: 'postgres',
    API_KEYS: `test:${key}:read+write`,
    FX_RATES: '',
    KAFKA_ENABLED: 'false',
    SWAGGER_ENABLED: 'false',
  });

  let markRequestPaused!: () => void;
  const requestPaused = new Promise<void>((resolve) => {
    markRequestPaused = resolve;
  });
  let releaseRate!: () => void;
  const rateReady = new Promise<void>((resolve) => {
    releaseRate = resolve;
  });
  let markShutdownStarted!: () => void;
  const shutdownStarted = new Promise<void>((resolve) => {
    markShutdownStarted = resolve;
  });

  // Pause at the FX port after the real database read and before the reservation save.
  const fx: FxRateProvider = {
    getRate: async (base, quote) => {
      markRequestPaused();
      await rateReady;
      return ExchangeRate.parse(base, quote, '1.085');
    },
  };
  let app: INestApplication | undefined;
  let shutdown: Promise<void> | undefined;
  let reservation: Promise<request.Response> | undefined;
  const verification = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      providers: [
        {
          provide: 'SHUTDOWN_OBSERVER',
          // Nest calls this after all module-destroy hooks, before draining HTTP requests.
          useValue: { beforeApplicationShutdown: markShutdownStarted },
        },
      ],
    })
      .overrideProvider(FX_RATE_PROVIDER)
      .useValue(fx)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureHttpApp(app);
    await app.listen(0, '127.0.0.1');
    const http = request(app.getHttpServer());
    await http
      .post('/api/v1/programs')
      .set('x-api-key', key)
      .send({
        programId: 'SHUTDOWN',
        creditLimit: { amount: '1000.00', currency: 'USD' },
      })
      .expect(201);

    reservation = http
      .post('/api/v1/programs/SHUTDOWN/reservations')
      .set('x-api-key', key)
      .send({ invoiceId: 'INV-1', invoiceAmount: { amount: '100.00', currency: 'EUR' } })
      .then((response) => response);
    await requestPaused;
    shutdown = app.close();
    await shutdownStarted;
    releaseRate();

    const response = await reservation;
    expect(response.status).toBe(201);
    expect(response.body.reservedAmount).toEqual({ amount: '108.50', currency: 'USD' });
    await shutdown;
    const persisted = await verification.query<{ reserved: string }>(
      "SELECT state->>'reservedTotal' AS reserved FROM programs WHERE id = $1",
      ['SHUTDOWN'],
    );
    expect(persisted.rows[0]?.reserved).toBe('108.50');
  } finally {
    releaseRate();
    await Promise.allSettled([reservation, shutdown ?? app?.close()]);
    await verification.end();
  }
});
