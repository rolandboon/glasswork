import { describe, expect, it } from 'vitest';
import { definePeriodicJob } from '../../src/jobs/periodic-job.js';

describe('definePeriodicJob', () => {
  it('returns a minimal periodic job definition', () => {
    const handler = async () => {};
    const job = definePeriodicJob({
      name: 'daily-report',
      queue: 'reports',
      handler,
    });

    expect(job).toEqual({
      name: 'daily-report',
      queue: 'reports',
      handler,
    });
  });
});
