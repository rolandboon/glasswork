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
 * Check if running in production environment
 * (either NODE_ENV=production or in Lambda)
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || isLambda();
}

/**
 * Check if running in test environment
 */
export function isTest(): boolean {
  return process.env.NODE_ENV === 'test';
}

/**
 * Check if running in development environment
 */
export function isDevelopment(): boolean {
  return !isProduction() && !isTest();
}
