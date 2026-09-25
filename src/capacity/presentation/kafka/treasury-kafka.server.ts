import { KafkaOptions, KafkaParser, ServerKafka } from '@nestjs/microservices';
import type { IHeaders } from 'kafkajs';

/** A message exactly as the broker delivered it, and the consumer group it was delivered to. */
export interface Delivery {
  readonly key: Buffer | null;
  readonly value: Buffer | null;
  /** As kafkajs decodes them: a repeated header is an array, in order. */
  readonly headers: IHeaders;
  readonly consumerGroup: string;
}

type KafkaServerOptions = Required<KafkaOptions>['options'];

interface RawMessage {
  readonly key: Buffer | null;
  readonly value: Buffer | null;
  readonly headers?: IHeaders;
}

const DELIVERY = Symbol('delivery');

/**
 * Nest's Kafka server, keeping every message as delivered next to the decoded one handlers
 * receive. Nest decodes before any handler runs (JSON parsed, repeated headers joined into
 * one string, a key that looks like JSON parsed too), which suits processing but not a
 * dead-letter copy: that has to keep the original bytes to be inspected and replayed.
 */
export class TreasuryKafkaServer extends ServerKafka {
  constructor(options: KafkaServerOptions) {
    super(options);
    // Nest suffixes the configured group id; this is the group the consumer actually joins.
    this.parser = new DeliveryKeepingParser(options.parser, this.groupId);
  }
}

class DeliveryKeepingParser extends KafkaParser {
  constructor(
    config: KafkaServerOptions['parser'],
    private readonly consumerGroup: string,
  ) {
    super(config);
  }

  // Same signature as KafkaParser.parse, which Nest calls with its own type argument.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  override parse<T = unknown>(raw: RawMessage): T {
    const parsed = super.parse<T & object>(raw);
    const delivery: Delivery = {
      key: raw.key,
      value: raw.value,
      headers: raw.headers ?? {},
      consumerGroup: this.consumerGroup,
    };
    Object.defineProperty(parsed, DELIVERY, { value: delivery });
    return parsed;
  }
}

/** The delivered form of a message a handler received; undefined unless it came through TreasuryKafkaServer. */
export function deliveryOf(message: object): Delivery | undefined {
  return (message as { [DELIVERY]?: Delivery })[DELIVERY];
}
