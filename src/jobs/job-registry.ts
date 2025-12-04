import type { JobDefinition } from './types.js';

/**
 * Registry for job definitions.
 */
export class JobRegistry {
  private readonly jobs = new Map<string, JobDefinition<unknown>>();

  constructor(initialJobs: JobDefinition<unknown>[] = []) {
    for (const job of initialJobs) {
      this.register(job);
    }
  }

  /**
   * Register a job definition. Throws if a job with the same name already exists.
   */
  register<TPayload>(job: JobDefinition<TPayload>): this {
    if (this.jobs.has(job.name)) {
      throw new Error(`Job "${job.name}" is already registered`);
    }
    this.jobs.set(job.name, job as JobDefinition<unknown>);
    return this;
  }

  /**
   * Get a job by name.
   */
  get<TPayload = unknown>(name: string): JobDefinition<TPayload> | undefined {
    return this.jobs.get(name) as JobDefinition<TPayload> | undefined;
  }

  /**
   * Get a job by name or throw if not found.
   */
  getOrThrow<TPayload = unknown>(name: string): JobDefinition<TPayload> {
    const job = this.get<TPayload>(name);
    if (!job) {
      throw new Error(`Job "${name}" not found in registry`);
    }
    return job;
  }

  /**
   * List all registered jobs.
   */
  list(): JobDefinition<unknown>[] {
    return [...this.jobs.values()];
  }

  /**
   * Number of registered jobs.
   */
  get size(): number {
    return this.jobs.size;
  }
}

/**
 * Convenience helper to build a registry from an array.
 */
export function createJobRegistry(jobs: JobDefinition<unknown>[] = []): JobRegistry {
  return new JobRegistry(jobs);
}
