import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { KafkaConfig } from '../../../config/app-config';

/**
 * Nest microservice options for the treasury consumer.
 *
 * `fromBeginning: true` matters only for a consumer group that has never committed an
 * offset: a fresh deployment then replays the topic and rebuilds state. Replays are safe
 * because every message is idempotent under the per-program sequence guard.
 */
export function treasuryKafkaOptions(config: KafkaConfig): MicroserviceOptions {
  return {
    transport: Transport.KAFKA,
    options: {
      client: { clientId: config.clientId, brokers: [...config.brokers] },
      consumer: { groupId: config.groupId, allowAutoTopicCreation: false },
      subscribe: { fromBeginning: true },
    },
  };
}
