import { safeParse } from 'valibot';
import { InvalidJobPayloadError, PermanentJobError } from './errors.js';
import type { AnyJobDefinition, JobContext } from './types.js';

/** One validated attempt for local execution and queue workers. SQS owns retries. */
export async function runJobAttempt(
  job: AnyJobDefinition,
  input: unknown,
  context: JobContext,
  hooks: {
    onStart?: () => Promise<void> | void;
    onComplete?: () => Promise<void> | void;
  } = {}
): Promise<void> {
  let payload = input;
  if (job.schema) {
    const result = safeParse(job.schema, input);
    if (!result.success) throw new InvalidJobPayloadError(job.name, result.issues);
    payload = result.output;
  }
  const execute = async () => {
    try {
      await hooks.onStart?.();
      await job.handler(payload, context);
      await hooks.onComplete?.();
    } catch (error) {
      if (isTerminalFailure(job, context, error)) {
        await job.onDeadLetter?.(
          payload,
          context,
          error instanceof Error ? error : new Error(String(error))
        );
      }
      throw error;
    }
  };
  if (job.runInContext) await job.runInContext(payload, context, execute);
  else await execute();
}

function isTerminalFailure(job: AnyJobDefinition, context: JobContext, error: unknown): boolean {
  if (error instanceof PermanentJobError) return true;
  if (job.retry === false) return false;
  const maxAttempts = typeof job.retry === 'number' ? job.retry : (job.retry?.maxAttempts ?? 25);
  return maxAttempts > 0 && context.attemptNumber >= maxAttempts;
}
