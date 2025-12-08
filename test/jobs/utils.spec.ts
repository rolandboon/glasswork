import { describe, expect, it, vi } from 'vitest';
import { computeBackoffSeconds, durationToSeconds, generateJobId } from '../../src/jobs/utils.js';

describe('jobs utils', () => {
  it('generates unique job ids', () => {
    const first = generateJobId();
    const second = generateJobId();

    expect(first).toBeTypeOf('string');
    expect(second).toBeTypeOf('string');
    expect(first).not.toBe(second);
  });

  it('parses duration strings and numbers', () => {
    expect(durationToSeconds(15)).toBe(15);
    expect(durationToSeconds('2m')).toBe(120);
    expect(durationToSeconds('1h')).toBe(3600);
    expect(durationToSeconds('1d')).toBe(86400);
  });

  it('throws on invalid duration format', () => {
    expect(() => durationToSeconds('abc')).toThrow('Invalid duration format');
  });

  it('computes exponential backoff without jitter', () => {
    const delay = computeBackoffSeconds(3, {
      baseDelaySeconds: 10,
      jitter: false,
      maxDelaySeconds: 50,
    });
    expect(delay).toBe(40);
  });

  it('computes linear backoff without jitter', () => {
    const delay = computeBackoffSeconds(4, {
      baseDelaySeconds: 5,
      strategy: 'linear',
      jitter: false,
    });
    expect(delay).toBe(20);
  });

  it('applies jitter and caps at max delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1); // highest jitter
    const delay = computeBackoffSeconds(4, {
      baseDelaySeconds: 30,
      strategy: 'exponential',
      jitter: true,
      maxDelaySeconds: 60,
    });
    expect(delay).toBe(60); // capped after jitter
    vi.restoreAllMocks();
  });

  it('throws on invalid duration format', () => {
    expect(() => durationToSeconds('10x')).toThrow('Invalid duration format');
  });

  it('falls back when randomUUID is unavailable', async () => {
    vi.resetModules();
    vi.doMock('node:crypto', () => ({ randomUUID: undefined }));

    const utils = await import('../../src/jobs/utils.js');
    const id = utils.generateJobId();

    expect(id).toMatch(/^job-/);
  });
});
