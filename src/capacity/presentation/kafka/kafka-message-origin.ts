import { KafkaContext } from '@nestjs/microservices';

/** One-line provenance of a Kafka message for logs: topic, partition, offset and key. */
export function describeMessageOrigin(context: KafkaContext): string {
  const message = context.getMessage();
  const key = message.key;
  const printableKey =
    key === null ? '' : Buffer.isBuffer(key) ? key.toString('utf8') : String(key);
  return `${context.getTopic()}[${context.getPartition()}]@${message.offset} key=${printableKey}`;
}
