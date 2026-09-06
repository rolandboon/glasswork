import type {
  CloudWatchDashboardDefinition,
  GenerateJobsDashboardOptions,
  GetJobsInsightsQueriesOptions,
  JobsInsightsQueries,
} from './types.js';

/**
 * Generate a production-ready AWS CloudWatch Dashboard JSON definition for background jobs.
 *
 * Can be deployed via AWS CLI (`aws cloudwatch put-dashboard`), AWS CDK (`CfnDashboard`),
 * or Terraform (`aws_cloudwatch_dashboard`).
 *
 * @param options - Dashboard configuration options (names, widgets, region).
 * @returns An object with dashboardName and serialized dashboardBody JSON.
 */
export function generateJobsDashboard(
  options: GenerateJobsDashboardOptions
): CloudWatchDashboardDefinition {
  const {
    dashboardName,
    namespace = 'Glasswork/Jobs',
    jobNames = [],
    periodSeconds = 300,
    region = 'eu-west-1',
    logGroupName,
  } = options;

  // Widget 1: Throughput (JobCount)
  const throughputMetrics =
    jobNames.length > 0
      ? jobNames.map((name) => [namespace, 'JobCount', 'JobName', name, { stat: 'Sum' }])
      : [[namespace, 'JobCount', { stat: 'Sum' }]];

  // Widget 2: Errors (JobErrorCount)
  const errorMetrics =
    jobNames.length > 0
      ? jobNames.map((name) => [
          namespace,
          'JobErrorCount',
          'JobName',
          name,
          { stat: 'Sum', color: '#d62728' },
        ])
      : [[namespace, 'JobErrorCount', { stat: 'Sum', color: '#d62728' }]];

  // Widget 3: Duration Percentiles
  const durationMetrics = [
    [namespace, 'JobDuration', { stat: 'p50', label: 'Duration p50' }],
    [namespace, 'JobDuration', { stat: 'p90', label: 'Duration p90' }],
    [namespace, 'JobDuration', { stat: 'p99', label: 'Duration p99' }],
  ];

  // Widget 4: Queue Wait Time
  const queueWaitMetrics = [
    [namespace, 'QueueWaitTime', { stat: 'Average', label: 'Avg Queue Wait' }],
    [namespace, 'QueueWaitTime', { stat: 'Maximum', label: 'Max Queue Wait' }],
  ];

  // biome-ignore lint/suspicious/noExplicitAny: CloudWatch Dashboard JSON specification uses dynamic property arrays
  const widgets: any[] = [
    {
      type: 'metric',
      x: 0,
      y: 0,
      width: 12,
      height: 6,
      properties: {
        metrics: throughputMetrics,
        view: 'timeSeries',
        stacked: true,
        region,
        title: 'Background Jobs - Throughput (JobCount)',
        period: periodSeconds,
      },
    },
    {
      type: 'metric',
      x: 12,
      y: 0,
      width: 12,
      height: 6,
      properties: {
        metrics: errorMetrics,
        view: 'timeSeries',
        stacked: true,
        region,
        title: 'Background Jobs - Errors & Failures',
        period: periodSeconds,
      },
    },
    {
      type: 'metric',
      x: 0,
      y: 6,
      width: 12,
      height: 6,
      properties: {
        metrics: durationMetrics,
        view: 'timeSeries',
        region,
        title: 'Execution Duration (p50 / p90 / p99)',
        period: periodSeconds,
        yAxis: {
          left: {
            label: 'Milliseconds',
          },
        },
      },
    },
    {
      type: 'metric',
      x: 12,
      y: 6,
      width: 12,
      height: 6,
      properties: {
        metrics: queueWaitMetrics,
        view: 'timeSeries',
        region,
        title: 'Queue Wait Time (Enqueued to Execution)',
        period: periodSeconds,
        yAxis: {
          left: {
            label: 'Milliseconds',
          },
        },
      },
    },
  ];

  if (logGroupName) {
    widgets.push({
      type: 'log',
      x: 0,
      y: 12,
      width: 24,
      height: 6,
      properties: {
        query: `SOURCE '${logGroupName}' | fields @timestamp, JobName, JobId, AttemptNumber, ErrorName, ErrorMessage\n| filter Status in ["failed", "dead_letter"]\n| sort @timestamp desc\n| limit 25`,
        region,
        title: 'Recent Job Failures & Dead Letters',
        view: 'table',
      },
    });
  }

  return {
    dashboardName,
    dashboardBody: JSON.stringify({ widgets }),
  };
}

/**
 * Returns a set of pre-canned CloudWatch Logs Insights queries for monitoring and troubleshooting jobs.
 *
 * @param options - Optional configuration for logGroupName and namespace filter.
 * @returns Queries for recent failures, slowest jobs, retries, and job tracing.
 */
export function getJobsInsightsQueries(
  options: GetJobsInsightsQueriesOptions = {}
): JobsInsightsQueries {
  const sourcePrefix = options.logGroupName ? `SOURCE '${options.logGroupName}' | ` : '';

  return {
    recentFailures: `${sourcePrefix}fields @timestamp, JobName, JobId, AttemptNumber, ErrorName, ErrorMessage\n| filter Status in ["failed", "dead_letter"]\n| sort @timestamp desc\n| limit 50`,

    slowestJobs: `${sourcePrefix}fields @timestamp, JobName, JobId, JobDuration, QueueWaitTime\n| filter Status = "success"\n| sort JobDuration desc\n| limit 25`,

    retriedJobs: `${sourcePrefix}fields @timestamp, JobName, JobId, AttemptNumber, Status, ErrorMessage\n| filter AttemptNumber > 1\n| sort @timestamp desc\n| limit 50`,

    throughputHourly: `${sourcePrefix}filter ispresent(JobName)\n| stats count(*) as Total, sum(JobErrorCount) as Errors, avg(JobDuration) as AvgDurationMs by bin(1h), JobName`,

    traceJob: (jobId: string) =>
      `${sourcePrefix}fields @timestamp, JobName, Status, AttemptNumber, @message\n| filter JobId = "${jobId}"\n| sort @timestamp asc`,
  };
}
