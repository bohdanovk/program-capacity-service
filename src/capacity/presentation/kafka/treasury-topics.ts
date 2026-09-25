/** Topic names are part of the contract with treasury (versioned), hence constants rather than config. */
export const TREASURY_PROGRAM_CAPACITY_TOPIC = 'treasury.program-capacity.v1';

/**
 * Where this service parks treasury messages it could not process, with the reason in the
 * headers (see docs/treasury-kafka-contract.md). Provisioned like the source topic.
 */
export const TREASURY_DEAD_LETTER_TOPIC = 'treasury.program-capacity.v1.dlq';
