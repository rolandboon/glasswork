/**
 * Environment detection utilities for serverless and local development.
 */

/**
 * Check if running in AWS Lambda environment
 */
export function isLambda(): boolean {
  return !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
}

/**
 * Detect the runtime environment.
 *
 * `NODE_ENV=production` and `NODE_ENV=test` are used as-is. Otherwise AWS Lambda
 * counts as production and everything else as development. This is the default
 * for the `environment` option of `bootstrap()`.
 */
export function detectEnvironment(): 'development' | 'production' | 'test' {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'test') return 'test';
  if (isLambda()) return 'production';
  return 'development';
}

/**
 * Check if running in production environment
 * (either NODE_ENV=production or in Lambda)
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || isLambda();
}

/**
 * Check if running in test environment.
 * Detects both NODE_ENV=test and test runners (Vitest, Jest).
 */
export function isTest(): boolean {
  // Check NODE_ENV first
  if (process.env.NODE_ENV === 'test') {
    return true;
  }
  // Check for test runners (Vitest sets VITEST, Jest sets JEST_WORKER_ID)
  if (process.env.VITEST === 'true' || process.env.JEST_WORKER_ID) {
    return true;
  }
  return false;
}

/**
 * Check if running in development environment
 */
export function isDevelopment(): boolean {
  return !isProduction() && !isTest();
}
