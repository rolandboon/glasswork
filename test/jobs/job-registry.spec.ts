import { describe, expect, it } from 'vitest';
import { defineJob } from '../../src/jobs/define-job.js';
import { JobRegistry } from '../../src/jobs/job-registry.js';

describe('JobRegistry', () => {
  it('registers and retrieves jobs', () => {
    const registry = new JobRegistry();
    const job = defineJob({
      name: 'send-welcome-email',
      handler: async () => {},
    });

    registry.register(job);

    expect(registry.size).toBe(1);
    expect(registry.get('send-welcome-email')).toBe(job);
  });

  it('throws when registering a duplicate job', () => {
    const registry = new JobRegistry();
    const job = defineJob({
      name: 'process-payment',
      handler: async () => {},
    });
    registry.register(job);

    expect(() => registry.register(job)).toThrow('Job "process-payment" is already registered');
  });

  it('throws when job is missing', () => {
    const registry = new JobRegistry();
    expect(() => registry.getOrThrow('missing')).toThrow('Job "missing" not found in registry');
  });
});
