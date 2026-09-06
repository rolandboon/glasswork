import { RLSConfigurationException } from './types.js';

const parameterName = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+$/i;

/** PostgreSQL settings use qualified, case-insensitive names. */
export function validateSessionVariables(sessionVariable: string, bypassVariable?: string): void {
  if (
    !parameterName.test(sessionVariable) ||
    sessionVariable.toLowerCase() === bypassVariable?.toLowerCase()
  ) {
    throw new RLSConfigurationException('Use distinct, qualified session variables.');
  }
  if (bypassVariable !== undefined && !parameterName.test(bypassVariable)) {
    throw new RLSConfigurationException('The bypass variable must be qualified.');
  }
}
