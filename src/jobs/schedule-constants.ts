/**
 * Shared constants for job scheduling metadata.
 */
export const RUN_AT_METADATA_KEY = '__glassworkRunAt';

/**
 * SQS supports a maximum delay of 15 minutes (900 seconds).
 */
export const MAX_SQS_DELAY_SECONDS = 15 * 60;
