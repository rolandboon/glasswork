import { randomUUID } from 'node:crypto';
import type { Duration } from './types.js';

/**
 * Generate a unique job identifier.
 */
export function generateJobId(): string {
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }
  return `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Calculate the size of a payload once serialized.
 */
export function calculatePayloadSizeBytes(payload: unknown): number {
  const serialized = JSON.stringify(payload);
  const encoded = new TextEncoder().encode(serialized ?? 'null');
  return encoded.length;
}

/**
 * Parse a duration value into seconds.
 * Supports number (seconds) or string like "5m", "30s", "1h", "1d".
 */
export function durationToSeconds(duration: Duration): number {
  if (typeof duration === 'number') {
    return duration;
  }

  const trimmed = duration.trim();
  const match = /^(\d+(?:\.\d+)?)([smhd]?)$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration format: "${duration}"`);
  }

  const value = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's':
    case '':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 60 * 60 * 24;
    default:
      throw new Error(`Unsupported duration unit: "${unit}"`);
  }
}

/**
 * Simple exponential backoff with optional jitter.
 */
export function computeBackoffSeconds(
  attemptNumber: number,
  config: {
    baseDelaySeconds: number;
    maxDelaySeconds?: number;
    strategy?: 'exponential' | 'linear' | 'fixed';
    jitter?: boolean;
  }
): number {
  const { baseDelaySeconds, maxDelaySeconds, strategy = 'exponential', jitter = true } = config;

  let delay = baseDelaySeconds;
  if (strategy === 'exponential') {
    delay = baseDelaySeconds * 2 ** (attemptNumber - 1);
  } else if (strategy === 'linear') {
    delay = baseDelaySeconds * attemptNumber;
  }

  if (maxDelaySeconds) {
    delay = Math.min(delay, maxDelaySeconds);
  }

  if (jitter) {
    const random = Math.random();
    delay = delay * (0.5 + random / 2); // between 0.5x and 1x
  }

  return Math.max(0, Math.floor(delay));
}
