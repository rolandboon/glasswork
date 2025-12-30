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
  // JSON.stringify(undefined) returns undefined, not a string
  const serialized = payload === undefined ? 'null' : JSON.stringify(payload);
  const encoded = new TextEncoder().encode(serialized);
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
