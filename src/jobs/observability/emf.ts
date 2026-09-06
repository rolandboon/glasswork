import { isLambda, isTest } from '../../utils/environment.js';
import type { EMFJobMetricRecord, JobExecutionMetricData, JobMetricsConfig } from './types.js';

const RESERVED_FIELDS = new Set([
  '_aws',
  'JobName',
  'Status',
  'JobId',
  'AttemptNumber',
  'JobCount',
  'JobDuration',
  'JobErrorCount',
  'RetryCount',
  'DeadLetterCount',
  'QueueWaitTime',
  'FunctionName',
]);

/**
 * Build a CloudWatch EMF document without an SDK dependency or network request.
 * Each attempt contributes one sample; identifiers and status remain searchable log fields.
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 */
export function createEMFJobMetric(
  data: JobExecutionMetricData,
  config?: JobMetricsConfig
): EMFJobMetricRecord {
  const namespace = config?.namespace ?? 'Glasswork/Jobs';
  const dimensions = { ...config?.dimensions };
  validateDimensions(dimensions);
  validateMetricData(data);
  if (
    !isMetricString(namespace, 255) ||
    namespace.startsWith(':') ||
    namespace.startsWith('AWS/')
  ) {
    throw new Error('Job metrics namespace must contain 1-255 characters outside AWS/');
  }

  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (functionName && !isMetricString(functionName, 1024)) {
    throw new Error('Job metric function names must contain 1-1024 printable ASCII characters');
  }
  const dimensionValues = functionName ? { ...dimensions, FunctionName: functionName } : dimensions;
  const dimensionKeys = Object.keys(dimensionValues);
  if (dimensionKeys.length + 1 > 30) {
    throw new Error('Job metrics support at most 30 dimensions including FunctionName and JobName');
  }
  const queueWaitTime = data.enqueuedAt
    ? data.startedAt.getTime() - data.enqueuedAt.getTime()
    : undefined;

  const metric: EMFJobMetricRecord = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [dimensionKeys, [...dimensionKeys, 'JobName']],
          Metrics: [
            { Name: 'JobCount', Unit: 'Count' },
            { Name: 'JobDuration', Unit: 'Milliseconds' },
            { Name: 'JobErrorCount', Unit: 'Count' },
            { Name: 'RetryCount', Unit: 'Count' },
            { Name: 'DeadLetterCount', Unit: 'Count' },
          ],
        },
      ],
    },
    ...dimensionValues,
    JobName: data.jobName,
    Status: data.status,
    JobId: data.jobId,
    AttemptNumber: data.attemptNumber,
    JobCount: 1,
    JobDuration: data.durationMs,
    JobErrorCount: data.status === 'success' ? 0 : 1,
    RetryCount: data.attemptNumber > 1 ? 1 : 0,
    DeadLetterCount: data.status === 'dead_letter' ? 1 : 0,
  };

  // Invalid or absent producer timestamps must not create null/NaN metric targets.
  if (queueWaitTime !== undefined && Number.isFinite(queueWaitTime)) {
    metric.QueueWaitTime = Math.max(0, queueWaitTime);
    metric._aws.CloudWatchMetrics[0].Metrics.push({ Name: 'QueueWaitTime', Unit: 'Milliseconds' });
  }
  return metric;
}

/**
 * Emit one raw EMF JSON document. Lambda's console wrappers and application loggers can
 * nest or prefix JSON and prevent metric extraction, so the default sink writes to stdout.
 * Direct calls may throw; bootstrapWorker isolates telemetry failures from job processing.
 */
export function emitJobMetric(
  data: JobExecutionMetricData,
  config?: JobMetricsConfig
): EMFJobMetricRecord | null {
  const enabled = config?.enabled ?? (config?.sink !== undefined || (isLambda() && !isTest()));
  if (!enabled) return null;

  const metric = createEMFJobMetric(data, config);
  const json = JSON.stringify(metric);
  if (config?.sink) config.sink(json);
  else process.stdout.write(`${json}\n`);
  return metric;
}

function validateMetricData(data: JobExecutionMetricData): void {
  if (!isMetricString(data.jobName, 1024)) {
    throw new Error('Job metric names must contain 1-1024 printable ASCII characters');
  }
  if (!Number.isFinite(data.durationMs) || data.durationMs < 0) {
    throw new Error('Job duration must be a finite, non-negative number');
  }
  if (!Number.isSafeInteger(data.attemptNumber) || data.attemptNumber < 1) {
    throw new Error('Job attempt number must be a positive safe integer');
  }
}

function validateDimensions(dimensions: Record<string, string>): void {
  for (const [name, value] of Object.entries(dimensions)) {
    if (!isMetricString(name, 250) || name.startsWith(':') || RESERVED_FIELDS.has(name)) {
      throw new Error(
        'Job metric dimensions must have unique, non-reserved names of 1-250 characters'
      );
    }
    if (!isMetricString(value, 1024)) {
      throw new Error('Job metric dimension values must contain 1-1024 characters');
    }
  }
}

/** CloudWatch identities allow printable ASCII, with at least one non-whitespace character. */
function isMetricString(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.length <= maxLength && /^[\x20-\x7e]+$/.test(value);
}
