export {
  createJobsObservabilityClient,
  type JobsObservabilityClient,
} from './client.js';

export {
  generateJobsDashboard,
  getJobsInsightsQueries,
} from './dashboard.js';

export {
  createEMFJobMetric,
  emitJobMetric,
} from './emf.js';

export type {
  CloudWatchDashboardDefinition,
  EMFJobMetricRecord,
  EMFMetadata,
  EMFMetricUnit,
  FailedJobDTO,
  GenerateJobsDashboardOptions,
  GetFailedJobsOptions,
  GetJobSummaryOptions,
  GetJobsInsightsQueriesOptions,
  JobExecutionMetricData,
  JobExecutionStatus,
  JobMetricsConfig,
  JobStatsSummaryDTO,
  JobsInsightsQueries,
  JobsObservabilityClientOptions,
  JobTypeStatsDTO,
} from './types.js';
