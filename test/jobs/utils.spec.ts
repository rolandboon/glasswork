import { describe, expect, it, vi } from 'vitest';
import {
  calculatePayloadSizeBytes,
  durationToSeconds,
  generateJobId,
} from '../../src/jobs/utils.js';

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

  it('throws on invalid duration format with unsupported unit', () => {
    expect(() => durationToSeconds('10x')).toThrow('Invalid duration format');
  });

  it('falls back when randomUUID is unavailable', async () => {
    vi.resetModules();
    vi.doMock('node:crypto', () => ({ randomUUID: undefined }));

    const utils = await import('../../src/jobs/utils.js');
    const id = utils.generateJobId();

    expect(id).toMatch(/^job-/);
  });

  describe('calculatePayloadSizeBytes', () => {
    it('calculates size of object payload', () => {
      const payload = { name: 'test', count: 42 };
      const size = calculatePayloadSizeBytes(payload);
      expect(size).toBe(JSON.stringify(payload).length);
    });

    it('handles undefined payload', () => {
      const size = calculatePayloadSizeBytes(undefined);
      // undefined is serialized as 'null'
      expect(size).toBe(4); // 'null'.length
    });

    it('handles null payload', () => {
      const size = calculatePayloadSizeBytes(null);
      expect(size).toBe(4); // 'null'.length
    });

    it('handles empty object', () => {
      const size = calculatePayloadSizeBytes({});
      expect(size).toBe(2); // '{}'.length
    });
  });
});
