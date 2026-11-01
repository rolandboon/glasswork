/**
 * @module glasswork/jobs/sqs
 * Amazon SQS queue driver. Requires `@aws-sdk/client-sqs`, and `@aws-sdk/client-scheduler`
 * for delays over 15 minutes.
 */
export { type SQSDriverConfig, SQSQueueDriver } from './drivers/sqs-driver.js';
