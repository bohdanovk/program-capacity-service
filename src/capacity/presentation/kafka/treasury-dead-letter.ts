import { KafkaContext } from '@nestjs/microservices';
import type { Message } from 'kafkajs';
import { deliveryOf } from './treasury-kafka.server';

/** Why a message was dead-lettered: it can never succeed, or it kept failing until out of attempts. */
export type DeadLetterReason = 'POISON' | 'RETRIES_EXHAUSTED';

export interface DeadLetter {
  readonly reason: DeadLetterReason;
  readonly attempts: number;
  readonly error: string;
}

/** Keeps the record well under the broker's size limit however long the error message is. */
const MAX_ERROR_HEADER_LENGTH = 1_000;

/**
 * The dead-letter record for the message in `context`: its key, value and headers byte for
 * byte as delivered, so it can be inspected and replayed onto the source topic unchanged, and
 * a program's dead letters share a partition. `dlq-*` headers say where it came from and why
 * it failed.
 *
 * @throws Error when the delivered bytes are not available (the consumer is not running on
 *         TreasuryKafkaServer): a copy rebuilt from the decoded message could differ from the
 *         original, so none is published and the message is redelivered instead.
 */
export function deadLetterMessage(context: KafkaContext, letter: DeadLetter): Message {
  const message = context.getMessage();
  const delivery = deliveryOf(message);
  if (delivery === undefined) {
    throw new Error(
      'The message as delivered is not available; is the consumer a TreasuryKafkaServer?',
    );
  }

  return {
    key: delivery.key,
    value: delivery.value,
    headers: {
      ...delivery.headers,
      'dlq-reason': letter.reason,
      'dlq-attempts': String(letter.attempts),
      'dlq-error': letter.error.slice(0, MAX_ERROR_HEADER_LENGTH),
      'dlq-source-topic': context.getTopic(),
      'dlq-source-partition': String(context.getPartition()),
      'dlq-source-offset': message.offset,
      'dlq-consumer-group': delivery.consumerGroup,
    },
  };
}
