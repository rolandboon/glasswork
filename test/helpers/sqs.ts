import type { SQSEvent, SQSRecordAttributes } from 'aws-lambda';

/** Build a minimal SQS event for worker tests. */
export function buildSqsEvent(
  record: Partial<SQSRecordAttributes> & { body: string; messageId?: string }
): SQSEvent {
  const attrs: SQSRecordAttributes = {
    ApproximateFirstReceiveTimestamp: '0',
    ApproximateReceiveCount: '1',
    SenderId: 'sender',
    SentTimestamp: `${Date.now()}`,
    ...record,
  } as SQSRecordAttributes;

  return {
    Records: [
      {
        messageId: record.messageId ?? 'msg-1',
        receiptHandle: 'rh',
        body: record.body,
        attributes: attrs,
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123:queue',
        awsRegion: 'us-east-1',
      },
    ],
  } as SQSEvent;
}
