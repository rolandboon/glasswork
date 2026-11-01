import { createHash } from 'node:crypto';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { EventEnvelope, EventPublisher } from './outbox.js';

/**
 * Publishes events to an SQS queue. On a FIFO queue the full aggregate identity is hashed
 * into the message group, which preserves broker acceptance order, and the event id deduplicates a repeated publish
 * within SQS's five-minute window. Consumers still deduplicate with an inbox.
 *
 * The AWS SDK loads on the first publish, so handlers that never publish do not pay for it
 * at cold start.
 */
export class SqsEventPublisher implements EventPublisher {
  #client: Pick<SQSClient, 'send'> | undefined;
  readonly #queueUrl: string | undefined;

  /** Without a queue URL every publish fails, and the relay keeps the error on the message. */
  constructor(options: { client?: Pick<SQSClient, 'send'>; queueUrl: string | undefined }) {
    this.#client = options.client;
    this.#queueUrl = options.queueUrl;
  }

  async publish(event: EventEnvelope): Promise<void> {
    if (!this.#queueUrl) throw new Error('No queue URL configured for events');
    const { SendMessageCommand, SQSClient } = await import('@aws-sdk/client-sqs');
    this.#client ??= new SQSClient({});
    const fifo = this.#queueUrl.endsWith('.fifo');
    const groupId = createHash('sha256')
      .update(JSON.stringify([event.tenantId, event.aggregateType, event.aggregateId]))
      .digest('hex');
    await this.#client.send(
      new SendMessageCommand({
        QueueUrl: this.#queueUrl,
        MessageBody: JSON.stringify(event),
        MessageAttributes: { type: { DataType: 'String', StringValue: event.type } },
        ...(fifo ? { MessageGroupId: groupId, MessageDeduplicationId: event.id } : {}),
      })
    );
  }
}
