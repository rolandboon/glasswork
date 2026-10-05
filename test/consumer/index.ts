import { defineModule } from 'glasswork/core';
import { createRoutes } from 'glasswork/http';
import {
  bootstrapWorker,
  createEMFJobMetric,
  defineJob,
  type JobMetricsConfig,
  JobService,
  MockQueueDriver,
} from 'glasswork/jobs';
import { createRLSExtension, runWithTenant, type TenantContext } from 'glasswork/rls';
import { object, pipe, string, transform } from 'valibot';

interface Services {
  greetingService: { greet(name: string): string };
}

const routes = createRoutes<Services>((router, services, route) => {
  router.post(
    '/',
    ...route({
      body: object({ name: string() }),
      responses: { 200: object({ greeting: string() }) },
      strictTypes: true,
      handler: ({ body }) => {
        // @ts-expect-error A schema field must retain its inferred type.
        const invalid: number = body.name;
        void invalid;
        return { greeting: services.greetingService.greet(body.name) };
      },
    })
  );

  route({
    responses: { 200: object({ greeting: string() }) },
    strictTypes: true,
    // @ts-expect-error The response contract must also be enforced for consumers.
    handler: () => ({ greeting: 123 }),
  });
});

export const module = defineModule({ name: 'consumer', routes });
export const metrics: JobMetricsConfig = {
  namespace: 'Consumer/Jobs',
  dimensions: { Service: 'consumer' },
};
export const worker = bootstrapWorker({ module, metrics });
export const metric = createEMFJobMetric({
  jobName: 'smoke',
  jobId: 'job-1',
  status: 'success',
  attemptNumber: 1,
  durationMs: 10,
  startedAt: new Date(),
});
createEMFJobMetric({
  jobName: 'smoke',
  jobId: 'job-1',
  // @ts-expect-error Only supported execution outcomes may be emitted.
  status: 'unknown',
  attemptNumber: 1,
  durationMs: 10,
  startedAt: new Date(),
});
export const context: TenantContext = { tenantId: 'tenant-a' };
export const result: Promise<string> = runWithTenant(context, () => 'scoped');
export const extension = createRLSExtension({ models: ['Project'] });

// @ts-expect-error Only documented configuration values are valid.
createRLSExtension({ missingContextBehavior: 'allow' });

// SSE keeps event names and payloads linked in the published declarations.
import { SseBroadcaster } from 'glasswork/sse';

const notifications = new SseBroadcaster<{ 'photos:updated': { year: number } }>();
notifications.broadcast('photos:updated', { year: 2026 });
// @ts-expect-error Unknown event name.
notifications.broadcast('unknown', null);
// @ts-expect-error Wrong payload for this event.
notifications.broadcast('photos:updated', { year: '2026' });

const transformedJob = defineJob({
  name: 'transformed',
  schema: pipe(
    string(),
    transform((value) => value.length)
  ),
  unique: { key: (input) => input.toUpperCase() },
  handler: (output) => {
    const length: number = output;
    // @ts-expect-error The handler receives schema output, not input.
    const invalid: string = output;
    void length;
    void invalid;
  },
});
const jobService = new JobService(new MockQueueDriver());
void jobService.enqueue(transformedJob, 'input');
void jobService.enqueueIn(transformedJob, 'input', '1m');
void jobService.enqueueAt(transformedJob, 'input', new Date());
void jobService.enqueueBatch([{ job: transformedJob, payload: 'input' }]);
// @ts-expect-error Enqueue accepts input, not transformed output.
void jobService.enqueue(transformedJob, 5);
// @ts-expect-error Delayed jobs must also retain the input type.
void jobService.enqueueIn(transformedJob, 5, '1m');
// @ts-expect-error Batches must also retain the input type.
void jobService.enqueueBatch([{ job: transformedJob, payload: 5 }]);
defineModule({ name: 'job-consumer', jobs: [transformedJob] });
