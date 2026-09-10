import { describe, expect, it, vi } from 'vitest';
import { createJobsObservabilityClient } from '../../../src/jobs/observability/client.js';

describe('JobsObservabilityClient', () => {
  it('queries CloudWatch metrics and transforms them into JobStatsSummaryDTO', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      MetricDataResults: [
        { Id: 'm_total', Values: [100] },
        { Id: 'm_errors', Values: [5] },
        { Id: 'm_retries', Values: [8] },
        { Id: 'm_duration_avg', Values: [240] },
        { Id: 'm_duration_p95', Values: [850] },
        { Id: 'j_0_total', Values: [60] },
        { Id: 'j_0_errors', Values: [2] },
        { Id: 'j_0_retries', Values: [4] },
        { Id: 'j_0_duration_avg', Values: [180] },
        { Id: 'j_0_duration_p95', Values: [500] },
      ],
    });

    const client = createJobsObservabilityClient({
      namespace: 'Glasswork/Jobs',
      cloudWatchClient: { send: mockSend },
    });

    const summary = await client.getSummary({
      jobNames: ['sendEmail'],
      hours: 24,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(summary.totalExecuted).toBe(100);
    expect(summary.totalSucceeded).toBe(95);
    expect(summary.totalFailed).toBe(5);
    expect(summary.totalRetried).toBe(8);
    expect(summary.successRate).toBe(95);
    expect(summary.avgDurationMs).toBe(240);
    expect(summary.p95DurationMs).toBe(850);

    expect(summary.byJob.sendEmail).toEqual({
      jobName: 'sendEmail',
      count: 60,
      succeededCount: 58,
      failedCount: 2,
      retryCount: 4,
      avgDurationMs: 180,
      p95DurationMs: 500,
    });
  });

  it('queries individual job type statistics via getJobTypeStats', async () => {
    const mockSend = vi.fn().mockResolvedValue({
      MetricDataResults: [
        { Id: 'm_total', Values: [50] },
        { Id: 'm_errors', Values: [1] },
        { Id: 'm_retries', Values: [2] },
        { Id: 'm_duration_avg', Values: [150] },
        { Id: 'm_duration_p95', Values: [400] },
        { Id: 'j_0_total', Values: [50] },
        { Id: 'j_0_errors', Values: [1] },
        { Id: 'j_0_retries', Values: [2] },
        { Id: 'j_0_duration_avg', Values: [150] },
        { Id: 'j_0_duration_p95', Values: [400] },
      ],
    });

    const client = createJobsObservabilityClient({
      cloudWatchClient: { send: mockSend },
    });

    const stats = await client.getJobTypeStats('syncRecords');
    expect(stats.jobName).toBe('syncRecords');
    expect(stats.count).toBe(50);
    expect(stats.succeededCount).toBe(49);
    expect(stats.failedCount).toBe(1);
  });

  it('queries CloudWatch Logs Insights for failed jobs and transforms to FailedJobDTO[]', async () => {
    const mockLogsSend = vi
      .fn()
      // First call: StartQuery
      .mockResolvedValueOnce({ queryId: 'q-12345' })
      // Second call: GetQueryResults
      .mockResolvedValueOnce({
        status: 'Complete',
        results: [
          [
            { field: '@timestamp', value: '2026-09-06T09:30:00.000Z' },
            { field: 'JobId', value: 'job-999' },
            { field: 'JobName', value: 'exportReports' },
            { field: 'AttemptNumber', value: '3' },
            { field: 'ErrorName', value: 'TimeoutError' },
            { field: 'ErrorMessage', value: 'Export took longer than 60s' },
            { field: 'ErrorStack', value: 'TimeoutError: Export took...\n  at run' },
            { field: 'JobDuration', value: '60000' },
            { field: 'QueueWaitTime', value: '120' },
          ],
        ],
      });

    const client = createJobsObservabilityClient({
      logGroupName: '/aws/lambda/worker',
      cloudWatchLogsClient: { send: mockLogsSend },
    });

    const failedJobs = await client.getFailedJobs({ limit: 10 });

    expect(failedJobs).toHaveLength(1);
    const failed = failedJobs[0];
    expect(failed?.jobId).toBe('job-999');
    expect(failed?.jobName).toBe('exportReports');
    expect(failed?.attemptNumber).toBe(3);
    expect(failed?.errorName).toBe('TimeoutError');
    expect(failed?.errorMessage).toBe('Export took longer than 60s');
    expect(failed?.errorStack).toContain('TimeoutError: Export took');
    expect(failed?.failedAt).toEqual(new Date('2026-09-06T09:30:00.000Z'));
    expect(failed?.durationMs).toBe(60000);
    expect(failed?.queueWaitTimeMs).toBe(120);
  });

  it('throws error when getFailedJobs is called without logGroupName', async () => {
    const client = createJobsObservabilityClient();
    await expect(client.getFailedJobs()).rejects.toThrow('logGroupName');
  });
});
