# Best Practices

Building reliable background job systems requires adhering to certain principles.

## 1. Idempotency

**Assume your job will run more than once.**

Network failures, timeouts, or SQS "at-least-once" delivery guarantees mean your handler might be executed multiple times for the same job.

- **Bad**: `UPDATE account SET balance = balance + 10`
- **Good**: `UPDATE account SET balance = balance + 10 WHERE transaction_id NOT IN (SELECT id FROM processed_txs)`

Use unique keys in your database or conditional updates to prevent duplicate side effects.

## 2. Keep Payloads Small

SQS has a message size limit of **256KB**. Glasswork enforces this limit before sending.

- **Don't**: Pass large objects or full database records.
- **Do**: Pass IDs (e.g., `userId`, `orderId`) and fetch the data in the worker.

```typescript
// ❌ Bad
await jobService.enqueue(processImage, { imageData: '...base64...' });

// ✅ Good
await jobService.enqueue(processImage, { s3Key: 'uploads/image.png' });
```

## 3. Handle Failures Gracefully

- Use `TransientJobError` for temporary issues (rate limits, network blips).
- Use `PermanentJobError` for logical errors (invalid data, missing resources).
- Configure Dead Letter Queues (DLQ) in AWS to catch jobs that fail all retries.

## 4. Job Granularity

Break down large tasks into smaller jobs.

- **Scenario**: Send emails to 10,000 users.
- **Bad**: One job that loops through 10,000 users. If it fails at user 9,999, it retries and sends emails to everyone again.
- **Good**: One "fan-out" job that enqueues 10,000 individual `send-email` jobs.

## 5. Monitoring & Observability

Use the lifecycle hooks in `bootstrapWorker` to integrate with your observability stack.

- **Logging**: Log job start, success, and failure with `jobId` and `jobName`.
- **Metrics**: Track job duration, failure rates, and queue depth (CloudWatch).
- **Tracing**: Use AWS X-Ray or similar tools to trace the request from HTTP enqueue to Worker execution.

## 6. Security

- **Validation**: Always use schemas (`valibot`) to validate job payloads. Treat job payloads as untrusted input.
- **Least Privilege**: The Worker Lambda should only have permissions for the specific queues and resources it needs.

## 7. Testing

- Use `MockQueueDriver` for unit tests to verify jobs are enqueued.
- Write integration tests for your worker handlers to verify they process payloads correctly.
- See [Testing](./testing) for more details.
