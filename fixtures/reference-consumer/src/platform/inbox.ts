import * as v from 'valibot';
import type { Transaction } from './database.module.js';
import type { EventEnvelope } from './outbox.js';

const Envelope = v.object({
  id: v.string(),
  type: v.string(),
  payloadVersion: v.number(),
  tenantId: v.string(),
  aggregateType: v.string(),
  aggregateId: v.string(),
  correlationId: v.nullable(v.string()),
  actorUserId: v.nullable(v.string()),
  occurredAt: v.string(),
  payload: v.unknown(),
});

/** Reads an event from a message body; throws when it is not an envelope. */
export function parseEnvelope(body: string): EventEnvelope {
  return v.parse(Envelope, JSON.parse(body));
}

/**
 * Records that a consumer received an event, in the transaction of the consumer's own
 * change. Returns false for an event the consumer already applied: a redelivery, which
 * must change nothing. A concurrent delivery of the same event waits for the first
 * transaction and then also gets false.
 */
export async function receiveOnce(
  tx: Transaction,
  consumer: string,
  event: Pick<EventEnvelope, 'id' | 'tenantId'>
): Promise<boolean> {
  const { count } = await tx.inboxMessage.createMany({
    data: [{ consumer, eventId: event.id, tenantId: event.tenantId }],
    skipDuplicates: true,
  });
  return count === 1;
}
