import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEMFJobMetric, emitJobMetric } from '../../../src/jobs/observability/emf.js';
import type { JobExecutionMetricData } from '../../../src/jobs/observability/types.js';

const data: JobExecutionMetricData = {
  jobName: 'send-invitation',
  jobId: 'job-123',
  status: 'success',
  attemptNumber: 1,
  durationMs: 350,
  startedAt: new Date('2026-09-30T10:00:00Z'),
  enqueuedAt: new Date('2026-09-30T09:59:58Z'),
};

beforeEach(() => {
  vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', undefined);
  vi.stubEnv('LAMBDA_TASK_ROOT', undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('job EMF records', () => {
  it('produces numeric metric targets for aggregate and per-job dimensions', () => {
    const metric = createEMFJobMetric(data);
    const directive = metric._aws.CloudWatchMetrics[0];
    expect(directive.Namespace).toBe('Glasswork/Jobs');
    expect(directive.Dimensions).toEqual([[], ['JobName']]);
    expect(metric).toMatchObject({
      JobId: 'job-123',
      JobName: 'send-invitation',
      Status: 'success',
      AttemptNumber: 1,
      JobCount: 1,
      JobDuration: 350,
      JobErrorCount: 0,
      RetryCount: 0,
      DeadLetterCount: 0,
      QueueWaitTime: 2000,
    });
    expect(metric._aws.Timestamp).toBeGreaterThan(0);
    for (const { Name } of directive.Metrics) {
      expect(typeof metric[Name]).toBe('number');
      expect(Number.isFinite(metric[Name])).toBe(true);
    }
  });

  it('isolates workers by function name with stable custom dimensions in every series', () => {
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'stemhof-worker');
    const metric = createEMFJobMetric(data, {
      namespace: 'Stemhof/Jobs',
      dimensions: { Environment: 'production' },
    });
    expect(metric._aws.CloudWatchMetrics[0]).toMatchObject({
      Namespace: 'Stemhof/Jobs',
      Dimensions: [
        ['Environment', 'FunctionName'],
        ['Environment', 'FunctionName', 'JobName'],
      ],
    });
    expect(metric.FunctionName).toBe('stemhof-worker');
    expect(metric.Environment).toBe('production');
  });

  it.each(['failed', 'retry', 'dead_letter'] as const)(
    'counts a %s attempt as one error',
    (status) => {
      const metric = createEMFJobMetric({ ...data, status });
      expect(metric.JobErrorCount).toBe(1);
      expect(metric.DeadLetterCount).toBe(status === 'dead_letter' ? 1 : 0);
    }
  );

  it('counts each retry attempt once, including eventual success', () => {
    const metrics = [1, 2, 3].map((attemptNumber) =>
      createEMFJobMetric({
        ...data,
        attemptNumber,
        status: attemptNumber === 3 ? 'success' : 'retry',
      })
    );
    expect(metrics.reduce((sum, metric) => sum + metric.RetryCount, 0)).toBe(2);
    expect(metrics.reduce((sum, metric) => sum + metric.JobCount, 0)).toBe(3);
    expect(metrics.reduce((sum, metric) => sum + metric.JobErrorCount, 0)).toBe(2);
  });

  it.each([undefined, new Date('invalid')])('omits unknown queue age (%s)', (enqueuedAt) => {
    const metric = createEMFJobMetric({ ...data, enqueuedAt });
    expect(metric).not.toHaveProperty('QueueWaitTime');
    expect(metric._aws.CloudWatchMetrics[0].Metrics.map(({ Name }) => Name)).not.toContain(
      'QueueWaitTime'
    );
  });

  it('clamps future producer timestamps to zero', () => {
    expect(createEMFJobMetric({ ...data, enqueuedAt: new Date('2026-10-01') }).QueueWaitTime).toBe(
      0
    );
  });

  it('does not serialize extra payload, metadata or error properties', () => {
    const input = {
      ...data,
      payload: { email: 'private@example.com' },
      metadata: { token: 'secret' },
      error: new Error('sensitive'),
    };
    const output = JSON.stringify(createEMFJobMetric(input));
    expect(output).not.toMatch(/private@example|secret|sensitive|ErrorStack|ErrorMessage/);
  });

  it.each([
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
  ])('rejects a custom dimension that would overwrite %s', (name) => {
    expect(() => createEMFJobMetric(data, { dimensions: { [name]: 'override' } })).toThrow(
      /reserved/
    );
  });

  it.each(['', ' ', ':Jobs', 'AWS/Jobs', 'Jobs\n', 'Jöbs', 'a'.repeat(256)])(
    'rejects invalid namespaces (%s)',
    (namespace) => {
      expect(() => createEMFJobMetric(data, { namespace })).toThrow(/namespace/);
    }
  );

  it.each([
    { '': 'value' },
    { ['a'.repeat(251)]: 'value' },
    { Service: '' },
    { Service: ' ' },
    { Service: 'a'.repeat(1025) },
    { ':Service': 'value' },
    { Service: 'production\n' },
    { Service: 'pröduction' },
  ])('rejects invalid dimensions (%j)', (dimensions) => {
    expect(() => createEMFJobMetric(data, { dimensions })).toThrow(/dimension/);
  });

  it.each(['', ' ', 'a'.repeat(1025), 'job\n', 'jöb'])(
    'rejects invalid job dimensions (%s)',
    (jobName) => {
      expect(() => createEMFJobMetric({ ...data, jobName })).toThrow(/Job metric names/);
    }
  );

  it('enforces the dimension limit including the implicit function and job dimensions', () => {
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'worker');
    const dimensions = Object.fromEntries(Array.from({ length: 28 }, (_, n) => [`D${n}`, 'value']));
    expect(
      createEMFJobMetric(data, { dimensions })._aws.CloudWatchMetrics[0].Dimensions[1]
    ).toHaveLength(30);
    expect(() =>
      createEMFJobMetric(data, { dimensions: { ...dimensions, Extra: 'value' } })
    ).toThrow(/30 dimensions/);
  });

  it.each([NaN, Infinity, -1])('rejects invalid duration %s', (durationMs) => {
    expect(() => createEMFJobMetric({ ...data, durationMs })).toThrow(/duration/);
  });

  it.each([NaN, Infinity, -1, 0, 1.5])('rejects invalid attempt number %s', (attemptNumber) => {
    expect(() => createEMFJobMetric({ ...data, attemptNumber })).toThrow(/attempt/);
  });
});

describe('job EMF emission', () => {
  it('opts in through a custom sink, even in tests', () => {
    const sink = vi.fn();
    const metric = emitJobMetric(data, { sink });
    expect(sink).toHaveBeenCalledExactlyOnceWith(JSON.stringify(metric));
  });

  it('honors explicit opt-out even with a sink', () => {
    const sink = vi.fn();
    expect(emitJobMetric(data, { enabled: false, sink })).toBeNull();
    expect(sink).not.toHaveBeenCalled();
  });

  it('defaults to disabled during tests, even with Lambda environment variables', () => {
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'worker');
    expect(emitJobMetric(data)).toBeNull();
  });

  it('defaults to disabled outside Lambda, including NODE_ENV=production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', undefined);
    vi.stubEnv('JEST_WORKER_ID', undefined);
    expect(emitJobMetric(data)).toBeNull();
  });

  it('automatically emits in Lambda as one raw JSON line without console wrappers', () => {
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'worker');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', undefined);
    vi.stubEnv('JEST_WORKER_ID', undefined);
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const metric = emitJobMetric(data);
    expect(metric).not.toBeNull();
    expect(stdout).toHaveBeenCalledExactlyOnceWith(`${JSON.stringify(metric)}\n`);
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('allows explicit emission outside Lambda', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    expect(emitJobMetric(data, { enabled: true })).not.toBeNull();
    expect(stdout).toHaveBeenCalledOnce();
  });
});
