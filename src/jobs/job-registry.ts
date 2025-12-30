import type { AnyJobDefinition, JobDefinition } from './types.js';

/**
 * Registry for job definitions.
 */
export class JobRegistry {
  private readonly jobs = new Map<string, AnyJobDefinition>();

  constructor(initialJobs: AnyJobDefinition[] = []) {
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
    this.jobs.set(job.name, job as AnyJobDefinition);
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
  list(): AnyJobDefinition[] {
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
export function createJobRegistry(jobs: AnyJobDefinition[] = []): JobRegistry {
  return new JobRegistry(jobs);
}
