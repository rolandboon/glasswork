/**
 * Lifecycle status of a background job execution for observability metrics.
 */
export type JobExecutionStatus = 'success' | 'failed' | 'retry' | 'dead_letter';

/**
 * Metric units supported by AWS CloudWatch EMF.
 */
export type EMFMetricUnit = 'Count' | 'Milliseconds' | 'Bytes' | 'Seconds' | 'None';

/**
 * AWS CloudWatch Embedded Metric Format (EMF) metadata definition.
 */
export interface EMFMetadata {
  Timestamp: number;
  CloudWatchMetrics: Array<{
    Namespace: string;
    Dimensions: string[][];
    Metrics: Array<{
      Name: string;
      Unit: EMFMetricUnit;
    }>;
  }>;
}

/**
 * Complete EMF JSON record structure emitted to stdout.
 */
export interface EMFJobMetricRecord {
  _aws: EMFMetadata;
  JobName: string;
  Status: JobExecutionStatus;
  JobId: string;
  AttemptNumber: number;
  JobCount: number;
  JobDuration: number;
  JobErrorCount: number;
  QueueWaitTime?: number;
  RetryCount: number;
  ErrorName?: string;
  ErrorMessage?: string;
  ErrorStack?: string;
  [key: string]: unknown;
}

/**
 * Input data provided to create an EMF metric record.
 */
export interface JobExecutionMetricData {
  jobName: string;
  jobId: string;
  status: JobExecutionStatus;
  attemptNumber: number;
  durationMs: number;
  enqueuedAt?: Date;
  startedAt: Date;
  error?: Error;
  customDimensions?: Record<string, string>;
}

/**
 * Configuration for worker EMF metric emission.
 */
export interface JobMetricsConfig {
  /**
   * Whether EMF metric logging is enabled.
   * Defaults to true if not in test environment.
   */
  enabled?: boolean;

  /**
   * CloudWatch metrics namespace.
   * @default 'Glasswork/Jobs'
   */
  namespace?: string;

  /**
   * Additional global dimensions to attach to all job metrics (e.g. environment: 'production').
   */
  dimensions?: Record<string, string>;

  /**
   * Custom output sink for EMF formatted JSON strings.
   * Defaults to process.stdout.write / console.log.
   */
  sink?: (logLine: string) => void;
}

/**
 * Performance and throughput statistics for a specific job type.
 */
export interface JobTypeStatsDTO {
  jobName: string;
  count: number;
  succeededCount: number;
  failedCount: number;
  retryCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

/**
 * Aggregated summary DTO of background jobs across a given time window.
 */
export interface JobStatsSummaryDTO {
  totalExecuted: number;
  totalSucceeded: number;
  totalFailed: number;
  totalRetried: number;
  /** Success percentage between 0 and 100, rounded to 2 decimals */
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  byJob: Record<string, JobTypeStatsDTO>;
}

/**
 * Details of a failed background job execution.
 */
export interface FailedJobDTO {
  jobId: string;
  jobName: string;
  attemptNumber: number;
  errorMessage: string;
  errorName?: string;
  errorStack?: string;
  failedAt: Date;
  durationMs?: number;
  queueWaitTimeMs?: number;
}

/**
 * Options for generating a CloudWatch Dashboard.
 */
export interface GenerateJobsDashboardOptions {
  /**
   * Dashboard name in AWS CloudWatch.
   */
  dashboardName: string;

  /**
   * Metric namespace.
   * @default 'Glasswork/Jobs'
   */
  namespace?: string;

  /**
   * Known job names to generate dedicated graphs and widgets for.
   */
  jobNames?: string[];

  /**
   * Aggregation period in seconds for CloudWatch widgets.
   * @default 300 (5 minutes)
   */
  periodSeconds?: number;

  /**
   * AWS Region for CloudWatch widgets.
   * @default 'eu-west-1'
   */
  region?: string;

  /**
   * CloudWatch Log Group name where worker logs are stored.
   * If provided, an embedded CloudWatch Logs Insights widget will be added.
   */
  logGroupName?: string;
}

/**
 * CloudWatch Dashboard JSON definition compatible with AWS API / CLI / CDK / Terraform.
 */
export interface CloudWatchDashboardDefinition {
  dashboardName: string;
  dashboardBody: string;
}

/**
 * Options for generating CloudWatch Logs Insights queries.
 */
export interface GetJobsInsightsQueriesOptions {
  /**
   * Target log group name.
   */
  logGroupName?: string;

  /**
   * Custom namespace if filtered in logs.
   * @default 'Glasswork/Jobs'
   */
  namespace?: string;
}

/**
 * Collection of pre-canned CloudWatch Logs Insights queries.
 */
export interface JobsInsightsQueries {
  /** Query returning recent failed and dead-letter jobs with error messages */
  recentFailures: string;
  /** Query finding the slowest job executions */
  slowestJobs: string;
  /** Query finding jobs that required retries */
  retriedJobs: string;
  /** Hourly job volume and error aggregation */
  throughputHourly: string;
  /** Function returning a query to trace a single jobId */
  traceJob: (jobId: string) => string;
}

/**
 * Options for initializing the JobsObservabilityClient.
 */
export interface JobsObservabilityClientOptions {
  /**
   * CloudWatch metric namespace.
   * @default 'Glasswork/Jobs'
   */
  namespace?: string;

  /**
   * CloudWatch Log Group name for worker execution logs.
   */
  logGroupName?: string;

  /**
   * AWS Region.
   */
  region?: string;

  /**
   * Pre-configured CloudWatch client (avoids loading AWS SDK if injected).
   */
  cloudWatchClient?: unknown;

  /**
   * Pre-configured CloudWatch Logs client (avoids loading AWS SDK if injected).
   */
  cloudWatchLogsClient?: unknown;
}

/**
 * Query options for job summaries.
 */
export interface GetJobSummaryOptions {
  startTime?: Date;
  endTime?: Date;
  jobNames?: string[];
  /** Relative hours if startTime/endTime are omitted */
  hours?: number;
}

/**
 * Query options for fetching failed jobs.
 */
export interface GetFailedJobsOptions {
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  jobName?: string;
}
