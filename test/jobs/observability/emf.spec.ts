import { describe, expect, it, vi } from 'vitest';
import { createEMFJobMetric, emitJobMetric } from '../../../src/jobs/observability/emf.js';

describe('EMF (Embedded Metric Format)', () => {
  it('creates valid EMF metric payload for successful job', () => {
    const startedAt = new Date('2026-09-06T10:00:00.000Z');
    const enqueuedAt = new Date('2026-09-06T09:59:58.000Z'); // 2000ms earlier

    const metric = createEMFJobMetric({
      jobName: 'sendInvitationEmail',
      jobId: 'job-123',
      status: 'success',
      attemptNumber: 1,
      durationMs: 350,
      startedAt,
      enqueuedAt,
    });

    expect(metric._aws).toBeDefined();
    expect(metric._aws.CloudWatchMetrics[0]?.Namespace).toBe('Glasswork/Jobs');
    expect(metric._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([
      ['JobName'],
      ['JobName', 'Status'],
      ['Status'],
    ]);

    expect(metric.JobName).toBe('sendInvitationEmail');
    expect(metric.Status).toBe('success');
    expect(metric.JobId).toBe('job-123');
    expect(metric.AttemptNumber).toBe(1);
    expect(metric.JobCount).toBe(1);
    expect(metric.JobDuration).toBe(350);
    expect(metric.JobErrorCount).toBe(0);
    expect(metric.RetryCount).toBe(0);
    expect(metric.QueueWaitTime).toBe(2000);
    expect(metric.ErrorName).toBeUndefined();
  });

  it('creates valid EMF metric payload for failed job with error details', () => {
    const startedAt = new Date('2026-09-06T10:00:00.000Z');
    const error = new Error('SMTP connection timed out');

    const metric = createEMFJobMetric({
      jobName: 'sendInvitationEmail',
      jobId: 'job-456',
      status: 'failed',
      attemptNumber: 3,
      durationMs: 5000,
      startedAt,
      error,
    });

    expect(metric.Status).toBe('failed');
    expect(metric.JobCount).toBe(1);
    expect(metric.JobErrorCount).toBe(1);
    expect(metric.RetryCount).toBe(2);
    expect(metric.ErrorName).toBe('Error');
    expect(metric.ErrorMessage).toBe('SMTP connection timed out');
    expect(metric.ErrorStack).toBeDefined();
  });

  it('supports custom namespace and additional dimensions', () => {
    const startedAt = new Date();
    const metric = createEMFJobMetric(
      {
        jobName: 'tallyBallots',
        jobId: 'job-789',
        status: 'success',
        attemptNumber: 1,
        durationMs: 120,
        startedAt,
        customDimensions: { tenantId: 'tenant-cwz' },
      },
      {
        namespace: 'CustomApp/Jobs',
        dimensions: { environment: 'production' },
      }
    );

    expect(metric._aws.CloudWatchMetrics[0]?.Namespace).toBe('CustomApp/Jobs');
    expect(metric._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([
      ['JobName', 'environment', 'tenantId'],
      ['JobName', 'Status', 'environment', 'tenantId'],
      ['Status', 'environment', 'tenantId'],
    ]);
    expect(metric.environment).toBe('production');
    expect(metric.tenantId).toBe('tenant-cwz');
  });

  it('emits metric JSON string to sink function', () => {
    const sink = vi.fn();
    const startedAt = new Date();

    const emitted = emitJobMetric(
      {
        jobName: 'cleanupExpiredPolls',
        jobId: 'job-111',
        status: 'success',
        attemptNumber: 1,
        durationMs: 80,
        startedAt,
      },
      { sink }
    );

    expect(sink).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(sink.mock.calls[0][0]);
    expect(parsed.JobName).toBe('cleanupExpiredPolls');
    expect(emitted?.JobId).toBe('job-111');
  });

  it('skips emission when metrics are explicitly disabled', () => {
    const sink = vi.fn();
    const result = emitJobMetric(
      {
        jobName: 'noop',
        jobId: 'job-000',
        status: 'success',
        attemptNumber: 1,
        durationMs: 10,
        startedAt: new Date(),
      },
      { enabled: false, sink }
    );

    expect(result).toBeNull();
    expect(sink).not.toHaveBeenCalled();
  });
});
