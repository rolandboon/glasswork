import { randomUUID } from 'node:crypto';

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
