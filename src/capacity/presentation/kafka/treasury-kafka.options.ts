import { MicroserviceOptions } from '@nestjs/microservices';
import { KafkaConfig } from '../../../config/app-config';
import { TreasuryKafkaServer } from './treasury-kafka.server';

/**
 * Nest microservice options for the treasury consumer: Nest's Kafka server, keeping every
 * message as delivered so a dead-letter copy is exact (see TreasuryKafkaServer).
 *
 * `fromBeginning: true` matters only for a consumer group that has never committed an
 * offset: a fresh deployment then replays the topic and rebuilds state. Replays are safe
 * because every message is idempotent under the per-program sequence guard.
 *
 * The server's producer writes the dead-letter topic. Topics are provisioned, never created
 * on first use, so a missing dead-letter topic shows up as a failed send (and a message that
 * is redelivered) rather than as a topic nobody configured.
 */
export function treasuryKafkaOptions(config: KafkaConfig): MicroserviceOptions {
  return {
    strategy: new TreasuryKafkaServer({
      client: { clientId: config.clientId, brokers: [...config.brokers] },
      consumer: { groupId: config.groupId, allowAutoTopicCreation: false },
      producer: { allowAutoTopicCreation: false },
      subscribe: { fromBeginning: true },
    }),
  };
}
