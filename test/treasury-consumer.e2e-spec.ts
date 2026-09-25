import { INestApplication } from '@nestjs/common';
import { ServerKafka } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { KafkaJSError } from 'kafkajs';
import type { IHeaders, Message } from 'kafkajs';
import { AppModule } from '../src/app.module';
import { ProgramQueries } from '../src/capacity/application/queries/program-queries';
import { PROGRAM_REPOSITORY } from '../src/capacity/domain/ports/program.repository';
import { Program } from '../src/capacity/domain/program';
import { InMemoryProgramRepository } from '../src/capacity/infrastructure/persistence/in-memory-program.repository';
import { TreasuryKafkaServer } from '../src/capacity/presentation/kafka/treasury-kafka.server';

const TOPIC = 'treasury.program-capacity.v1';
const DEAD_LETTER_TOPIC = 'treasury.program-capacity.v1.dlq';
const MAX_ATTEMPTS = 3;

type EachMessagePayload = Parameters<ServerKafka['handleMessage']>[0];
type SentRecord = Parameters<NonNullable<ServerKafka['producer']>['send']>[0];

/** The real repository, with a store outage that can be switched on for the next saves. */
class FlakyRepository extends InMemoryProgramRepository {
  failingSaves = 0;
  saveAttempts = 0;

  override save(program: Program): Promise<void> {
    this.saveAttempts += 1;
    if (this.failingSaves > 0) {
      this.failingSaves -= 1;
      return Promise.reject(new Error('store unavailable'));
    }
    return super.save(program);
  }
}

interface Delivered {
  readonly key?: string;
  readonly headers?: IHeaders;
  readonly heartbeat?: () => Promise<void>;
}

/**
 * The service's Kafka server without a broker: messages go in exactly as kafkajs hands them
 * to `eachMessage`, and the producer records what it is asked to send. `deliver` resolving is
 * the point where kafkajs commits the offset; rejecting means kafkajs redelivers.
 */
class InProcessKafkaServer extends TreasuryKafkaServer {
  readonly sent: SentRecord[] = [];
  failSends = false;
  private nextOffset = 0;

  constructor() {
    super({ client: { brokers: ['unused:9092'] }, consumer: { groupId: 'e2e-group' } });
    this.producer = {
      send: (record: SentRecord) => {
        if (this.failSends) {
          return Promise.reject(new Error('broker unavailable'));
        }
        this.sent.push(record);
        return Promise.resolve([]);
      },
      disconnect: () => Promise.resolve(),
    } as unknown as ServerKafka['producer'];
  }

  deliver(value: unknown, delivered: Delivered = {}): Promise<void> {
    const payload: EachMessagePayload = {
      topic: TOPIC,
      partition: 2,
      message: {
        key: Buffer.from(delivered.key ?? 'PRG-K'),
        value: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
        headers: delivered.headers ?? { traceparent: Buffer.from('00-trace-span-01') },
        offset: String(this.nextOffset++),
        timestamp: '1758276900000',
        attributes: 0,
      },
      heartbeat: delivered.heartbeat ?? (() => Promise.resolve()),
      pause: () => () => undefined,
    };
    return this.handleMessage(payload) as Promise<void>;
  }

  deadLetters(): Message[] {
    return this.sent.flatMap((record) => {
      expect(record.topic).toBe(DEAD_LETTER_TOPIC);
      return record.messages;
    });
  }
}

function limitChanged(programId: string, sequence: number, creditLimit: unknown): object {
  return {
    type: 'ProgramLimitChanged',
    programId,
    sequence,
    occurredAt: '2026-09-19T10:15:00.000Z',
    currency: 'USD',
    creditLimit,
  };
}

describe('Treasury consumer failure handling (e2e, Nest Kafka server without a broker)', () => {
  let app: INestApplication;
  let server: InProcessKafkaServer;
  let repository: FlakyRepository;
  let queries: ProgramQueries;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      STORE: 'memory',
      API_KEYS: 'admin:e2e-admin-key-0123456789:read+write',
      KAFKA_ENABLED: 'false',
      KAFKA_MAX_ATTEMPTS: String(MAX_ATTEMPTS),
      KAFKA_RETRY_BACKOFF_MS: '1',
      SWAGGER_ENABLED: 'false',
    });
    repository = new FlakyRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROGRAM_REPOSITORY)
      .useValue(repository)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    server = new InProcessKafkaServer();
    const microservice = app.connectMicroservice({ strategy: server }, { inheritAppConfig: false });
    await app.init();
    await microservice.init();
    queries = app.get(ProgramQueries);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    server.sent.length = 0;
    server.failSends = false;
    repository.failingSaves = 0;
    repository.saveAttempts = 0;
  });

  it('applies a valid message and acknowledges it', async () => {
    await expect(server.deliver(limitChanged('PRG-OK', 1, '1000.00'))).resolves.toBeUndefined();

    expect((await queries.getProgramCapacity('PRG-OK')).creditLimit.amount).toBe('1000.00');
    expect(server.sent).toEqual([]);
  });

  it('dead-letters a poison message at once, unchanged, and acknowledges it', async () => {
    const poison = limitChanged('PRG-POISON', 1, 1.5);

    await expect(server.deliver(poison)).resolves.toBeUndefined();

    expect(repository.saveAttempts).toBe(0);
    const [letter, ...others] = server.deadLetters();
    expect(others).toEqual([]);
    expect(letter?.key).toEqual(Buffer.from('PRG-K'));
    expect(JSON.parse(String(letter?.value))).toEqual(poison);
    expect(letter?.headers).toEqual({
      traceparent: Buffer.from('00-trace-span-01'),
      'dlq-reason': 'POISON',
      'dlq-attempts': '1',
      'dlq-error': expect.stringContaining('creditLimit') as unknown,
      'dlq-source-topic': TOPIC,
      'dlq-source-partition': '2',
      'dlq-source-offset': expect.stringMatching(/^\d+$/) as unknown,
      // Nest suffixes the configured group id; the header names the group actually consuming.
      'dlq-consumer-group': 'e2e-group-server',
    });
  });

  it('keeps the dead-lettered key, value and headers byte for byte', async () => {
    // Decoding would round the number, drop the spacing, join the repeated header into one
    // string, and parse the key as JSON.
    const raw =
      '{ "type": "ProgramLimitChanged", "programId": "PRG-RAW", "sequence": 9007199254740993,\n' +
      '  "occurredAt": "2026-09-19T10:15:00.000Z", "currency": "USD", "creditLimit": 1.50 }';
    const repeated = [Buffer.from('first'), Buffer.from('second')];

    await expect(
      server.deliver(raw, { key: '{"programId":"PRG-RAW"}', headers: { hop: repeated } }),
    ).resolves.toBeUndefined();

    const [letter] = server.deadLetters();
    expect(letter?.value).toEqual(Buffer.from(raw));
    expect(letter?.key).toEqual(Buffer.from('{"programId":"PRG-RAW"}'));
    expect(letter?.headers?.hop).toEqual(repeated);
    expect(letter?.headers?.['dlq-reason']).toBe('POISON');
  });

  it('dead-letters text that is not JSON at all', async () => {
    await expect(server.deliver('not json')).resolves.toBeUndefined();

    const [letter] = server.deadLetters();
    expect(letter?.value).toEqual(Buffer.from('not json'));
    expect(letter?.headers?.['dlq-reason']).toBe('POISON');
  });

  it('retries a failure that goes away, and does not dead-letter it', async () => {
    repository.failingSaves = MAX_ATTEMPTS - 1;

    await expect(server.deliver(limitChanged('PRG-FLAKY', 1, '500.00'))).resolves.toBeUndefined();

    expect(repository.saveAttempts).toBe(MAX_ATTEMPTS);
    expect(server.sent).toEqual([]);
    expect((await queries.getProgramCapacity('PRG-FLAKY')).creditLimit.amount).toBe('500.00');
  });

  it('dead-letters a message still failing after the last attempt, and moves on', async () => {
    repository.failingSaves = Number.POSITIVE_INFINITY;

    await expect(server.deliver(limitChanged('PRG-DOWN', 1, '1.00'))).resolves.toBeUndefined();

    expect(repository.saveAttempts).toBe(MAX_ATTEMPTS);
    const [letter] = server.deadLetters();
    expect(letter?.headers).toMatchObject({
      'dlq-reason': 'RETRIES_EXHAUSTED',
      'dlq-attempts': String(MAX_ATTEMPTS),
      'dlq-error': 'store unavailable',
    });

    // The partition is not blocked: the next message is processed as usual.
    repository.failingSaves = 0;
    await expect(server.deliver(limitChanged('PRG-DOWN', 2, '2.00'))).resolves.toBeUndefined();
    expect((await queries.getProgramCapacity('PRG-DOWN')).creditLimit.amount).toBe('2.00');
  });

  it('leaves the message unacknowledged when the dead-letter topic cannot take it', async () => {
    server.failSends = true;

    await expect(server.deliver(limitChanged('PRG-LOST', 1, 'lots'))).rejects.toBeDefined();
  });

  it('stops retrying, without dead-lettering, when the consumer loses its partition', async () => {
    repository.failingSaves = Number.POSITIVE_INFINITY;
    const rebalancing = (): Promise<void> =>
      Promise.reject(new KafkaJSError('The group is rebalancing', { retriable: true }));

    await expect(
      server.deliver(limitChanged('PRG-MOVED', 1, '1.00'), { heartbeat: rebalancing }),
    ).rejects.toBeInstanceOf(KafkaJSError);

    expect(repository.saveAttempts).toBe(1);
    expect(server.sent).toEqual([]);
  });
});
