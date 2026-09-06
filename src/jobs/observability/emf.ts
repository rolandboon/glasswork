import { isTest } from '../../utils/environment.js';
import type { EMFJobMetricRecord, JobExecutionMetricData, JobMetricsConfig } from './types.js';

/**
 * Build a structured AWS CloudWatch Embedded Metric Format (EMF) record for a background job.
 *
 * Conforms to the AWS CloudWatch EMF specification:
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 *
 * @param data - Execution metrics for the completed or failed job.
 * @param config - Optional configuration for namespace, dimensions, etc.
 * @returns An object adhering to the EMF JSON schema.
 */
export function createEMFJobMetric(
  data: JobExecutionMetricData,
  config?: JobMetricsConfig
): EMFJobMetricRecord {
  const namespace = config?.namespace ?? 'Glasswork/Jobs';
  const customDimensions = {
    ...(config?.dimensions ?? {}),
    ...(data.customDimensions ?? {}),
  };
  const customDimensionKeys = Object.keys(customDimensions);

  // Standard dimension sets:
  // 1. [JobName]
  // 2. [JobName, Status]
  // 3. [Status]
  // If custom dimensions exist, they are appended to each dimension set for granular filtering.
  const baseDimensionSets: string[][] = [['JobName'], ['JobName', 'Status'], ['Status']];

  const dimensionSets: string[][] =
    customDimensionKeys.length > 0
      ? baseDimensionSets.map((set) => [...set, ...customDimensionKeys])
      : baseDimensionSets;

  const queueWaitTime = data.enqueuedAt
    ? Math.max(0, data.startedAt.getTime() - data.enqueuedAt.getTime())
    : undefined;

  const retryCount = Math.max(0, data.attemptNumber - 1);
  const isError = data.status !== 'success';

  const metrics: Array<{ Name: string; Unit: 'Count' | 'Milliseconds' }> = [
    { Name: 'JobCount', Unit: 'Count' },
    { Name: 'JobDuration', Unit: 'Milliseconds' },
    { Name: 'JobErrorCount', Unit: 'Count' },
    { Name: 'RetryCount', Unit: 'Count' },
  ];

  if (queueWaitTime !== undefined) {
    metrics.push({ Name: 'QueueWaitTime', Unit: 'Milliseconds' });
  }

  const record: EMFJobMetricRecord = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: dimensionSets,
          Metrics: metrics,
        },
      ],
    },
    JobName: data.jobName,
    Status: data.status,
    JobId: data.jobId,
    AttemptNumber: data.attemptNumber,
    JobCount: 1,
    JobDuration: data.durationMs,
    JobErrorCount: isError ? 1 : 0,
    RetryCount: retryCount,
    ...customDimensions,
  };

  if (queueWaitTime !== undefined) {
    record.QueueWaitTime = queueWaitTime;
  }

  if (data.error) {
    record.ErrorName = data.error.name || 'Error';
    record.ErrorMessage = data.error.message;
    if (data.error.stack) {
      record.ErrorStack = data.error.stack;
    }
  }

  return record;
}

/**
 * Emit an EMF metric to stdout or a configured sink.
 *
 * When emitted to stdout within an AWS Lambda environment, AWS CloudWatch Logs automatically
 * extracts these metrics into CloudWatch Metrics with zero API overhead and zero latency.
 *
 * @param data - Execution metrics for the job.
 * @param config - Optional configuration for namespace, dimensions, or custom sink.
 * @returns The generated record or null if metrics are disabled.
 */
export function emitJobMetric(
  data: JobExecutionMetricData,
  config?: JobMetricsConfig
): EMFJobMetricRecord | null {
  const isEnabled = config?.enabled ?? (config?.sink !== undefined || !isTest());
  if (!isEnabled) {
    return null;
  }

  const record = createEMFJobMetric(data, config);
  const json = JSON.stringify(record);

  if (config?.sink) {
    config.sink(json);
  } else {
    console.log(json);
  }

  return record;
}
