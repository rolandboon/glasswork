import { describe, expect, it } from 'vitest';
import {
  PayloadTooLargeError,
  RetryExhaustedError,
  TransientJobError,
} from '../../src/jobs/errors.js';

describe('job errors', () => {
  it('exposes payload size details', () => {
    const error = new PayloadTooLargeError(300 * 1024, 256 * 1024);
    expect(error.actualSize).toBe(300 * 1024);
    expect(error.maxSize).toBe(256 * 1024);
    expect(error.message).toContain('256KB');
  });

  it('stores retryAfter for transient errors', () => {
    const error = new TransientJobError('retry later', '10m');
    expect(error.retryAfter).toBe('10m');
    expect(error.name).toBe('TransientJobError');
  });

  it('captures retry exhaustion details', () => {
    const cause = new Error('Original failure');
    const error = new RetryExhaustedError('my-job', 5, 5, cause);

    expect(error.name).toBe('RetryExhaustedError');
    expect(error.jobName).toBe('my-job');
    expect(error.attemptNumber).toBe(5);
    expect(error.maxAttempts).toBe(5);
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('my-job');
    expect(error.message).toContain('5 retries');
  });
});
