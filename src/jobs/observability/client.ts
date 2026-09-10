import type {
  FailedJobDTO,
  GetFailedJobsOptions,
  GetJobSummaryOptions,
  JobStatsSummaryDTO,
  JobsObservabilityClientOptions,
  JobTypeStatsDTO,
} from './types.js';

interface ClientLike {
  send(command: unknown): Promise<unknown>;
}

/**
 * Interface for the background jobs observability client.
 */
export interface JobsObservabilityClient {
  /**
   * Fetch an aggregated summary of background jobs over a time window.
   */
  getSummary(options?: GetJobSummaryOptions): Promise<JobStatsSummaryDTO>;

  /**
   * Fetch recent failed and dead-letter jobs with their error details.
   */
  getFailedJobs(options?: GetFailedJobsOptions): Promise<FailedJobDTO[]>;

  /**
   * Fetch detailed statistics for a specific job name.
   */
  getJobTypeStats(jobName: string, options?: GetJobSummaryOptions): Promise<JobTypeStatsDTO>;
}

function createJobMetricStat(
  namespace: string,
  jobName: string,
  metricName: string,
  id: string,
  period: number,
  stat: string
) {
  return {
    Id: id,
    MetricStat: {
      Metric: {
        Namespace: namespace,
        MetricName: metricName,
        Dimensions: [{ Name: 'JobName', Value: jobName }],
      },
      Period: period,
      Stat: stat,
    },
    ReturnData: true,
  };
}

function buildMetricDataQueries(
  namespace: string,
  periodSeconds: number,
  jobNames: string[]
): unknown[] {
  const queries: unknown[] = [
    {
      Id: 'm_total',
      MetricStat: {
        Metric: { Namespace: namespace, MetricName: 'JobCount' },
        Period: periodSeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    },
    {
      Id: 'm_errors',
      MetricStat: {
        Metric: { Namespace: namespace, MetricName: 'JobErrorCount' },
        Period: periodSeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    },
    {
      Id: 'm_retries',
      MetricStat: {
        Metric: { Namespace: namespace, MetricName: 'RetryCount' },
        Period: periodSeconds,
        Stat: 'Sum',
      },
      ReturnData: true,
    },
    {
      Id: 'm_duration_avg',
      MetricStat: {
        Metric: { Namespace: namespace, MetricName: 'JobDuration' },
        Period: periodSeconds,
        Stat: 'Average',
      },
      ReturnData: true,
    },
    {
      Id: 'm_duration_p95',
      MetricStat: {
        Metric: { Namespace: namespace, MetricName: 'JobDuration' },
        Period: periodSeconds,
        Stat: 'p95',
      },
      ReturnData: true,
    },
  ];

  for (let i = 0; i < jobNames.length; i++) {
    const name = jobNames[i];
    if (!name) continue;
    queries.push(
      createJobMetricStat(namespace, name, 'JobCount', `j_${i}_total`, periodSeconds, 'Sum'),
      createJobMetricStat(namespace, name, 'JobErrorCount', `j_${i}_errors`, periodSeconds, 'Sum'),
      createJobMetricStat(namespace, name, 'RetryCount', `j_${i}_retries`, periodSeconds, 'Sum'),
      createJobMetricStat(
        namespace,
        name,
        'JobDuration',
        `j_${i}_duration_avg`,
        periodSeconds,
        'Average'
      ),
      createJobMetricStat(
        namespace,
        name,
        'JobDuration',
        `j_${i}_duration_p95`,
        periodSeconds,
        'p95'
      )
    );
  }

  return queries;
}

function extractJobTypeStats(
  resultMap: Map<string, number>,
  jobNames: string[]
): Record<string, JobTypeStatsDTO> {
  const byJob: Record<string, JobTypeStatsDTO> = {};
  for (let i = 0; i < jobNames.length; i++) {
    const name = jobNames[i];
    if (!name) continue;
    const count = resultMap.get(`j_${i}_total`) ?? 0;
    const failedCount = resultMap.get(`j_${i}_errors`) ?? 0;
    byJob[name] = {
      jobName: name,
      count,
      succeededCount: Math.max(0, count - failedCount),
      failedCount,
      retryCount: resultMap.get(`j_${i}_retries`) ?? 0,
      avgDurationMs: Math.round(resultMap.get(`j_${i}_duration_avg`) ?? 0),
      p95DurationMs: Math.round(resultMap.get(`j_${i}_duration_p95`) ?? 0),
    };
  }
  return byJob;
}

function parseMetricResults(
  metricResults: Array<{ Id: string; Values?: number[] }> | undefined,
  jobNames: string[]
): JobStatsSummaryDTO {
  const resultMap = new Map<string, number>();
  for (const res of metricResults ?? []) {
    const val = res.Values && res.Values.length > 0 ? res.Values.reduce((a, b) => a + b, 0) : 0;
    resultMap.set(res.Id, val);
  }

  const totalExecuted = resultMap.get('m_total') ?? 0;
  const totalFailed = resultMap.get('m_errors') ?? 0;
  const totalRetried = resultMap.get('m_retries') ?? 0;
  const totalSucceeded = Math.max(0, totalExecuted - totalFailed);
  const avgDurationMs = Math.round(resultMap.get('m_duration_avg') ?? 0);
  const p95DurationMs = Math.round(resultMap.get('m_duration_p95') ?? 0);

  const successRate =
    totalExecuted > 0
      ? Math.round(((totalExecuted - totalFailed) / totalExecuted) * 10000) / 100
      : 100;

  return {
    totalExecuted,
    totalSucceeded,
    totalFailed,
    totalRetried,
    successRate,
    avgDurationMs,
    p95DurationMs,
    byJob: extractJobTypeStats(resultMap, jobNames),
  };
}

async function pollLogsQuery(
  client: ClientLike,
  queryId: string,
  // biome-ignore lint/suspicious/noExplicitAny: Dynamic command class constructor
  GetQueryResultsClass: any
): Promise<Array<Array<{ field?: string; value?: string }>>> {
  for (let i = 0; i < 10; i++) {
    const res = (await client.send(new GetQueryResultsClass({ queryId }))) as {
      status?: string;
      results?: Array<Array<{ field?: string; value?: string }>>;
    };

    if (res.status === 'Complete') {
      return res.results ?? [];
    }
    if (res.status === 'Failed' || res.status === 'Cancelled') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return [];
}

function mapFailedJobRow(row: Array<{ field?: string; value?: string }>): FailedJobDTO {
  const map = new Map<string, string>();
  for (const cell of row) {
    if (cell.field && cell.value) {
      map.set(cell.field, cell.value);
    }
  }

  const timestampStr = map.get('@timestamp') ?? new Date().toISOString();
  const durationStr = map.get('JobDuration');
  const queueWaitStr = map.get('QueueWaitTime');

  return {
    jobId: map.get('JobId') ?? '',
    jobName: map.get('JobName') ?? '',
    attemptNumber: Number(map.get('AttemptNumber') ?? '1'),
    errorMessage: map.get('ErrorMessage') ?? '',
    errorName: map.get('ErrorName'),
    errorStack: map.get('ErrorStack'),
    failedAt: new Date(timestampStr),
    durationMs: durationStr ? Number(durationStr) : undefined,
    queueWaitTimeMs: queueWaitStr ? Number(queueWaitStr) : undefined,
  };
}

/**
 * Create an observability client for querying background job metrics and execution logs.
 *
 * @param options - Configuration options including namespace, logGroupName, and region.
 * @returns A JobsObservabilityClient instance.
 */
export function createJobsObservabilityClient(
  options: JobsObservabilityClientOptions = {}
): JobsObservabilityClient {
  const {
    namespace = 'Glasswork/Jobs',
    logGroupName,
    region = process.env.AWS_REGION || 'eu-west-1',
  } = options;

  let cwClient: ClientLike | null = (options.cloudWatchClient as ClientLike) ?? null;
  let cwLogsClient: ClientLike | null = (options.cloudWatchLogsClient as ClientLike) ?? null;

  async function getCloudWatchClient(): Promise<ClientLike> {
    if (cwClient) return cwClient;
    try {
      const sdk = (await import('@aws-sdk/client-cloudwatch' as string)) as Record<string, unknown>;
      const CloudWatchClient = sdk.CloudWatchClient as new (opts: unknown) => ClientLike;
      cwClient = new CloudWatchClient({ region });
      return cwClient;
    } catch {
      throw new Error(
        'Package "@aws-sdk/client-cloudwatch" is required to query metrics. Please install it or inject a cloudWatchClient.'
      );
    }
  }

  async function getCloudWatchLogsClient(): Promise<ClientLike> {
    if (cwLogsClient) return cwLogsClient;
    try {
      const sdk = (await import('@aws-sdk/client-cloudwatch-logs' as string)) as Record<
        string,
        unknown
      >;
      const CloudWatchLogsClient = sdk.CloudWatchLogsClient as new (opts: unknown) => ClientLike;
      cwLogsClient = new CloudWatchLogsClient({ region });
      return cwLogsClient;
    } catch {
      throw new Error(
        'Package "@aws-sdk/client-cloudwatch-logs" is required to query logs. Please install it or inject a cloudWatchLogsClient.'
      );
    }
  }

  return {
    async getSummary(queryOptions: GetJobSummaryOptions = {}): Promise<JobStatsSummaryDTO> {
      const client = await getCloudWatchClient();

      const hours = queryOptions.hours ?? 24;
      const endTime = queryOptions.endTime ?? new Date();
      const startTime =
        queryOptions.startTime ?? new Date(endTime.getTime() - hours * 60 * 60 * 1000);
      const period = Math.max(60, Math.floor((endTime.getTime() - startTime.getTime()) / 1000));

      const jobNames = queryOptions.jobNames ?? [];
      const metricDataQueries = buildMetricDataQueries(namespace, period, jobNames);

      // biome-ignore lint/suspicious/noExplicitAny: Dynamic command invocation
      let CommandClass: any;
      try {
        const sdk = (await import('@aws-sdk/client-cloudwatch' as string)) as Record<
          string,
          unknown
        >;
        CommandClass = sdk.GetMetricDataCommand;
      } catch {
        CommandClass = class GetMetricDataCommand {
          constructor(public input: unknown) {}
        };
      }

      const response = (await client.send(
        new CommandClass({
          StartTime: startTime,
          EndTime: endTime,
          MetricDataQueries: metricDataQueries,
        })
      )) as { MetricDataResults?: Array<{ Id: string; Values?: number[] }> };

      return parseMetricResults(response.MetricDataResults, jobNames);
    },

    async getJobTypeStats(
      jobName: string,
      queryOptions: GetJobSummaryOptions = {}
    ): Promise<JobTypeStatsDTO> {
      const summary = await this.getSummary({
        ...queryOptions,
        jobNames: [jobName],
      });

      return (
        summary.byJob[jobName] ?? {
          jobName,
          count: 0,
          succeededCount: 0,
          failedCount: 0,
          retryCount: 0,
          avgDurationMs: 0,
          p95DurationMs: 0,
        }
      );
    },

    async getFailedJobs(failedOptions: GetFailedJobsOptions = {}): Promise<FailedJobDTO[]> {
      if (!logGroupName) {
        throw new Error(
          'Option "logGroupName" is required to query failed jobs from CloudWatch Logs.'
        );
      }

      const client = await getCloudWatchLogsClient();
      const limit = failedOptions.limit ?? 25;
      const endTime = failedOptions.endTime ?? new Date();
      const startTime =
        failedOptions.startTime ?? new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

      const jobNameFilter = failedOptions.jobName ? `and JobName = "${failedOptions.jobName}"` : '';

      const queryString = `fields @timestamp, JobName, JobId, AttemptNumber, ErrorName, ErrorMessage, ErrorStack, JobDuration, QueueWaitTime
| filter Status in ["failed", "dead_letter"] ${jobNameFilter}
| sort @timestamp desc
| limit ${limit}`;

      // biome-ignore lint/suspicious/noExplicitAny: Dynamic command invocation
      let StartQueryCommandClass: any;
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic command invocation
      let GetQueryResultsCommandClass: any;

      try {
        const sdk = (await import('@aws-sdk/client-cloudwatch-logs' as string)) as Record<
          string,
          unknown
        >;
        StartQueryCommandClass = sdk.StartQueryCommand;
        GetQueryResultsCommandClass = sdk.GetQueryResultsCommand;
      } catch {
        StartQueryCommandClass = class StartQueryCommand {
          constructor(public input: unknown) {}
        };
        GetQueryResultsCommandClass = class GetQueryResultsCommand {
          constructor(public input: unknown) {}
        };
      }

      const startRes = (await client.send(
        new StartQueryCommandClass({
          logGroupName,
          startTime: Math.floor(startTime.getTime() / 1000),
          endTime: Math.floor(endTime.getTime() / 1000),
          queryString,
        })
      )) as { queryId?: string };

      if (!startRes.queryId) {
        return [];
      }

      const rows = await pollLogsQuery(client, startRes.queryId, GetQueryResultsCommandClass);
      return rows.map(mapFailedJobRow);
    },
  };
}
