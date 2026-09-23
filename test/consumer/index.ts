import { defineModule } from 'glasswork/core';
import { createRoutes } from 'glasswork/http';
import { defineJob, JobService, MockQueueDriver } from 'glasswork/jobs';
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
        // @ts-expect-error Een schemaveld moet zijn afgeleide type behouden.
        const invalid: number = body.name;
        void invalid;
        return { greeting: services.greetingService.greet(body.name) };
      },
    })
  );

  route({
    responses: { 200: object({ greeting: string() }) },
    strictTypes: true,
    // @ts-expect-error Het responsecontract moet ook voor afnemers worden afgedwongen.
    handler: () => ({ greeting: 123 }),
  });
});

export const module = defineModule({ name: 'consumer', routes });
export const context: TenantContext = { tenantId: 'tenant-a' };
export const result: Promise<string> = runWithTenant(context, () => 'scoped');
export const extension = createRLSExtension({ models: ['Project'] });

// @ts-expect-error Alleen gedocumenteerde configuratiewaarden zijn geldig.
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
    // @ts-expect-error De handler ontvangt schema-output, geen invoer.
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
// @ts-expect-error Enqueue accepteert invoer, geen getransformeerde output.
void jobService.enqueue(transformedJob, 5);
// @ts-expect-error Ook uitgestelde jobs moeten de invoer behouden.
void jobService.enqueueIn(transformedJob, 5, '1m');
// @ts-expect-error Ook batches moeten de invoer behouden.
void jobService.enqueueBatch([{ job: transformedJob, payload: 5 }]);
defineModule({ name: 'job-consumer', jobs: [transformedJob] });
