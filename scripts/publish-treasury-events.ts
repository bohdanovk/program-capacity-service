/**
 * Publishes a small, self-explanatory scenario to the treasury topic so the consumer can be
 * watched end to end:
 *
 *   npm run kafka:publish -- [programId] [--with-poison]
 *
 * The default scenario is clean: limit set, snapshot, limit raised, and one out-of-order
 * duplicate that the service logs as STALE. `--with-poison` adds a malformed message, which
 * the service logs at ERROR level and copies to `treasury.program-capacity.v1.dlq`; that
 * message stays in the source topic and is dead-lettered again by every new consumer group
 * that replays it, so only send it on purpose.
 *
 * Sequence numbers restart at 1 each run; the service ignores anything at or below the last
 * applied sequence, so re-running against a live instance logs STALE for the first messages.
 * Use a fresh programId to see the full path again.
 */
import { Kafka, Partitioners, logLevel } from 'kafkajs';

const TOPIC = 'treasury.program-capacity.v1';
const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const args = process.argv.slice(2);
const withPoison = args.includes('--with-poison');
const programId = args.find((arg) => !arg.startsWith('--')) ?? 'PRG-001';
const asOf = new Date().toISOString();

const messages: { label: string; value: Record<string, unknown> }[] = [
  {
    label: 'limit set (creates the program if unknown)',
    value: {
      type: 'ProgramLimitChanged',
      programId,
      sequence: 1,
      occurredAt: asOf,
      currency: 'USD',
      creditLimit: '10000000.00',
    },
  },
  {
    label: 'full-state snapshot with two reservations treasury knows about',
    value: {
      type: 'ProgramReconciled',
      programId,
      sequence: 2,
      occurredAt: asOf,
      currency: 'USD',
      creditLimit: '10000000.00',
      activeReservations: [
        {
          invoiceId: 'INV-T-001',
          invoiceAmount: '250000.00',
          invoiceCurrency: 'EUR',
          reservedAmount: '271250.00',
        },
        {
          invoiceId: 'INV-T-002',
          invoiceAmount: '1000000.00',
          invoiceCurrency: 'USD',
          reservedAmount: '1000000.00',
        },
      ],
    },
  },
  {
    label: 'limit raised',
    value: {
      type: 'ProgramLimitChanged',
      programId,
      sequence: 3,
      occurredAt: asOf,
      currency: 'USD',
      creditLimit: '12000000.00',
    },
  },
  {
    label: 'out-of-order duplicate (sequence 2 again) -> expected to be logged as STALE',
    value: {
      type: 'ProgramLimitChanged',
      programId,
      sequence: 2,
      occurredAt: asOf,
      currency: 'USD',
      creditLimit: '1.00',
    },
  },
];

if (withPoison) {
  messages.push({
    label: 'malformed message (float amount) -> expected to be dead-lettered as poison',
    value: {
      type: 'ProgramLimitChanged',
      programId,
      sequence: 4,
      occurredAt: asOf,
      currency: 'USD',
      creditLimit: 1.5,
    },
  });
}

async function main(): Promise<void> {
  const kafka = new Kafka({ clientId: 'treasury-simulator', brokers, logLevel: logLevel.NOTHING });
  const producer = kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
  await producer.connect();
  try {
    for (const message of messages) {
      await producer.send({
        topic: TOPIC,
        messages: [{ key: programId, value: JSON.stringify(message.value) }],
      });
      console.log(`sent  ${message.label}\n      ${JSON.stringify(message.value)}`);
    }
  } finally {
    await producer.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('publish failed:', error);
  process.exit(1);
});
