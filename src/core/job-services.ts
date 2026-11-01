/**
 * Module cradles answer this key with a function that opens a scope in the module that
 * declares a job. Queue drivers that run jobs in-process use it so a job resolves the same
 * providers as it does in the worker, without exporting private services.
 * @internal
 */
export const JOB_SERVICES = Symbol.for('glasswork.jobServices');

/** Services for one job execution and the disposal of their scope. */
export interface JobServicesScope {
  services: Record<string, unknown>;
  dispose(): Promise<void>;
}

export type JobServicesResolver = (jobName: string) => JobServicesScope | undefined;

/** Returns the owning module's services for a job when `services` is a module cradle. */
export function resolveJobServices(
  services: Record<string, unknown>,
  jobName: string
): JobServicesScope | undefined {
  let resolver: unknown;
  try {
    resolver = (services as Record<symbol, unknown>)[JOB_SERVICES];
  } catch {
    return undefined;
  }
  return typeof resolver === 'function' ? (resolver as JobServicesResolver)(jobName) : undefined;
}
