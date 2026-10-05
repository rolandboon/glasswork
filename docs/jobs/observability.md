---
description: Automatic per-attempt CloudWatch EMF metrics from Glasswork workers, with application-owned CDK dashboards and alarms.
---

# Worker Observability

`bootstrapWorker` emits CloudWatch Embedded Metric Format (EMF) logs automatically
in AWS Lambda. No CloudWatch SDK, `PutMetricData` permission or network call is
needed: CloudWatch Logs extracts the metrics from the worker's ordinary log stream.
The execution role still needs its normal CloudWatch Logs permissions.

```typescript
import { bootstrapWorker } from 'glasswork/jobs';
import { AppModule } from './app.module';

export const handler = bootstrapWorker({ module: AppModule });
```

Metrics default to disabled outside Lambda and in tests. The local
`MockQueueDriver` validates payloads and runs job callbacks just like the worker,
but does not emit worker EMF metrics.
To opt out of metrics in Lambda, set `metrics: { enabled: false }`.

## Configuration

```typescript
export const handler = bootstrapWorker({
  module: AppModule,
  metrics: {
    namespace: 'MyApp/Jobs', // default: Glasswork/Jobs
    dimensions: { Environment: 'production' },
  },
});
```

Use stable dimensions such as service or environment. Do not use tenant IDs,
user IDs, email addresses or job IDs: each unique dimension combination creates
separate billable CloudWatch metrics. Reserved fields cannot be overwritten by
custom dimensions. Namespaces are limited to 255 characters and may not start
with `AWS/`; dimension names are limited to 250 characters, values to 1024, and
sets to 30 dimensions including the built-in dimensions. Metric identities must
use printable ASCII with at least one non-whitespace character; namespace and
dimension names cannot start with a colon. Registered job names must also be
valid dimension values.

When `AWS_LAMBDA_FUNCTION_NAME` is available, Glasswork adds `FunctionName`.
Every record defines two dimension sets:

- `FunctionName` plus all configured dimensions: all jobs in that worker.
- The same dimensions plus `JobName`: one registered job type in that worker.

Outside Lambda the function dimension is absent. Without custom dimensions,
the sets become `[]` and `[JobName]`. `JobId`, `AttemptNumber` and `Status` are
searchable log properties, never dimensions. Payloads, job metadata, error
messages and stacks are not copied to EMF; the existing application logger and
lifecycle hooks remain responsible for error reporting and redaction.

## Metrics and outcomes

One EMF record is emitted after each registered execution attempt finishes,
including schema validation, lifecycle hooks and scope cleanup. Metrics never
change the job's acknowledgement or retry policy. Emission failures produce a
warning through the worker logger and are otherwise ignored.

| Metric | Unit | Meaning | Statistic |
| --- | --- | --- | --- |
| `JobCount` | Count | 1 per execution attempt, including retries | Sum |
| `JobErrorCount` | Count | 1 for an unsuccessful attempt, otherwise 0 | Sum |
| `RetryCount` | Count | 1 if `attemptNumber > 1`, including a successful retry; otherwise 0 | Sum |
| `DeadLetterCount` | Count | 1 for an attempt classified as `dead_letter`, otherwise 0 | Sum |
| `JobDuration` | Milliseconds | Elapsed execution time using a monotonic clock, including hooks and cleanup | Average / p95 |
| `QueueWaitTime` | Milliseconds | Time from the original enqueue timestamp to this attempt's start | Average / Maximum |

`QueueWaitTime` includes previous attempts and backoff on redelivery; it is job
age at execution, not just time waiting for the current receive. Negative values
are clamped to zero; invalid or absent input timestamps are omitted by the EMF
builder. Workers retain their existing fallback timestamp when an envelope has
no enqueue timestamp.

`Status` describes the execution's retry policy:

- `success`: the job and its completion hook succeeded.
- `retry`: an attempt failed before exhaustion, or a hook/cleanup error caused
  an otherwise acknowledged record to be rejected.
- `failed`: a failed job was acknowledged because retries are disabled or
  `dead: false` discarded it after exhaustion.
- `dead_letter`: a permanent error or exhausted retries with `dead: true`.

`dead_letter` and `DeadLetterCount` indicate a failure classification, **not an
actual transfer to the DLQ**. The worker keeps returning that message as a batch
failure; SQS controls redrive through its `maxReceiveCount`. Align that threshold
with the job's `maxAttempts`. Repeated deliveries can yield multiple classified
attempts for the same job. Monitor the actual DLQ's SQS metrics separately.

Malformed envelopes, unknown job names and worker initialization failures do
not have registered execution metrics. Lambda timeouts and process termination
can also prevent emission. Keep SQS queue-age/DLQ alarms and Lambda errors,
throttles and duration monitoring alongside EMF. Counts represent attempts,
not unique jobs or exactly-once business effects. EMF extraction itself is
at least once, so it is operational telemetry rather than an accounting ledger.

## Dashboards and alarms with CDK

Glasswork owns the metric contract. Applications own dashboards, alarms,
thresholds and query permissions, using the native CDK and AWS SDK types.
There is no dashboard generator or CloudWatch client abstraction in Glasswork.

For the **default worker configuration** (no `metrics` overrides), given a CDK scope, worker Lambda
and its actual dead-letter queue:

```typescript
import { Duration } from 'aws-cdk-lib';
import { Dashboard, GraphWidget, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { IQueue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

export function addWorkerMonitoring(scope: Construct, worker: IFunction, dlq: IQueue) {
  const metricOptions = {
    namespace: 'Glasswork/Jobs',
    dimensionsMap: { FunctionName: worker.functionName },
    statistic: 'Sum',
    period: Duration.minutes(5),
  };
  const attempts = new Metric({ ...metricOptions, metricName: 'JobCount' });
  const errors = new Metric({ ...metricOptions, metricName: 'JobErrorCount' });
  const duration = new Metric({ ...metricOptions, metricName: 'JobDuration', statistic: 'p95' });
  const invitationDuration = duration.with({
    dimensionsMap: { FunctionName: worker.functionName, JobName: 'send-invitation' },
  });

  const dashboard = new Dashboard(scope, 'JobsDashboard');
  dashboard.addWidgets(
    new GraphWidget({ title: 'Execution attempts', left: [attempts, errors] }),
    new GraphWidget({ title: 'Duration p95 (ms)', left: [duration, invitationDuration] }),
    new GraphWidget({ title: 'Actual DLQ depth', left: [dlq.metricApproximateNumberOfMessagesVisible()] }),
  );
  errors.createAlarm(scope, 'JobErrors', {
    threshold: 5,
    evaluationPeriods: 1,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
  return dashboard;
}
```

If you customize the namespace or dimensions in the worker, use **exactly the
same namespace and complete dimension set** in your CDK `Metric` or SDK query.
CloudWatch does not implicitly aggregate custom metrics across dimension sets.
Choose alarm thresholds for your application; the example values are illustrative.

For an application UI, query CloudWatch with `CloudWatchClient` / `GetMetricDataCommand`
on the server and apply your own authorization and response contract there.
Do not add AWS credentials or unrestricted Logs Insights access to the browser.

## Logs Insights

Trace an attempt by log-only job ID:

```sql
fields @timestamp, JobName, JobId, AttemptNumber, Status, JobDuration
| filter ispresent(_aws.CloudWatchMetrics) and JobId = "job-123"
| sort @timestamp asc
```

List unsuccessful attempts:

```sql
fields @timestamp, JobName, JobId, AttemptNumber, Status, JobDuration
| filter ispresent(_aws.CloudWatchMetrics) and JobErrorCount = 1
| sort @timestamp desc
| limit 100
```

## Testing or custom transports

A synchronous sink opts into metrics even in tests. Explicit `enabled: false`
continues to take precedence. A sink receives one JSON document without a newline:

```typescript
const lines: string[] = [];
const handler = bootstrapWorker({
  module: AppModule,
  metrics: { sink: (line) => { lines.push(line); } },
});
```

`createEMFJobMetric` and `emitJobMetric` are also exported from `glasswork/jobs`.
The builder does not emit anything; direct emitter calls may throw on invalid
configuration or a failing sink. Only the worker isolates those failures.
The default emitter writes a raw JSON line with `process.stdout.write`, keeping
`_aws` at the document root even with Lambda's JSON logging enabled. A custom
sink must preserve this format if CloudWatch is expected to extract metrics.
If Lambda's JSON application-log filtering is enabled, retain INFO logs so
the EMF lines are not filtered out. The application logger's log level does
not control this raw stdout sink.

See the [AWS EMF specification](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html),
[AWS Lambda logging guidance](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-logging.html),
and [CloudWatch dimension rules](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html#Dimension).

## Sharing Context Across Job Callbacks

A job may need the same application context when it runs and when it records a
failure. For example, both operations may need access to the same tenant's data.

Use these options in `defineJob()`:

| Option | When it runs | Typical use |
| --- | --- | --- |
| `runInContext(payload, context, execute)` | After validation, around the handler and its failure callback | Set up tenant context, then call and await `execute()` |
| `onDeadLetter(payload, context, error)` | When a permanent error occurs or the configured attempts are exhausted | Record the failure in your application |

Both callbacks receive the payload after Valibot validation and transformation.
If validation fails, neither callback runs. Worker-level hooks remain available
for logging invalid messages and other worker errors.

To type the services available through `context.services`, use
`defineJob<typeof PayloadSchema, JobServices>({...})`. `PayloadSchema` is your
Valibot schema, and `JobServices` describes your application's injected services.

### Local Execution and SQS Retries

The worker and `MockQueueDriver` run the same validation, handler, and job callbacks.
The local driver runs one attempt; it does not simulate SQS retry delays. Pass
your application logger through its `logger` option to use the same logging settings.

SQS controls retries and moves messages to the dead-letter queue. The
`onDeadLetter` callback records a terminal failure; it does not move the message.
SQS can deliver that message again, so make the callback safe to repeat. For
example, update an existing failure record instead of creating a duplicate.
