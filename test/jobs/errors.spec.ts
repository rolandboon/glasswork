import { describe, expect, it } from 'vitest';
import {
  DuplicateJobError,
  PayloadTooLargeError,
  TransientJobError,
} from '../../src/jobs/errors.js';

describe('job errors', () => {
  it('captures duplicate job details', () => {
    const error = new DuplicateJobError('email-user', 'user-1');
    expect(error.message).toContain('email-user');
    expect(error.dedupeKey).toBe('user-1');
    expect(error.jobName).toBe('email-user');
  });

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
});
