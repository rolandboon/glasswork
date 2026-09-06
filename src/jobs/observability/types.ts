/** Outcome of one execution attempt under the job's retry policy, not SQS delivery state. */
export type JobExecutionStatus = 'success' | 'failed' | 'retry' | 'dead_letter';

/** CloudWatch units used by worker metrics. */
export type EMFMetricUnit = 'Count' | 'Milliseconds';

/** AWS Embedded Metric Format directive for extracting metrics from a log event. */
export interface EMFMetadata {
  Timestamp: number;
  CloudWatchMetrics: Array<{
    Namespace: string;
    Dimensions: string[][];
    Metrics: Array<{ Name: string; Unit: EMFMetricUnit }>;
  }>;
}

/** Execution counters and timings. Identifiers are log fields, never metric dimensions. */
export interface EMFJobMetricRecord {
  _aws: EMFMetadata;
  JobName: string;
  Status: JobExecutionStatus;
  JobId: string;
  AttemptNumber: number;
  JobCount: number;
  JobDuration: number;
  JobErrorCount: number;
  RetryCount: number;
  DeadLetterCount: number;
  QueueWaitTime?: number;
  FunctionName?: string;
  [key: string]: unknown;
}

/** Measurements for one registered job attempt. Payloads and error details are excluded. */
export interface JobExecutionMetricData {
  jobName: string;
  jobId: string;
  status: JobExecutionStatus;
  attemptNumber: number;
  durationMs: number;
  startedAt: Date;
  enqueuedAt?: Date;
}

/**
 * Worker telemetry policy only. Dashboards, alarms and CloudWatch queries belong to the
 * application, which owns infrastructure, access control and operational thresholds.
 */
export interface JobMetricsConfig {
  /** Defaults to enabled in Lambda, disabled in tests/local runs; a sink opts in. */
  enabled?: boolean;
  /** CloudWatch namespace. Defaults to 'Glasswork/Jobs'. */
  namespace?: string;
  /** Stable dimensions such as Service or Environment. Avoid tenant/user/request IDs. */
  dimensions?: Record<string, string>;
  /** Synchronous sink receiving one JSON document. Defaults to raw stdout plus a newline. */
  sink?: (logLine: string) => void;
}
