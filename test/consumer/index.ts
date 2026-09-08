import { defineModule } from 'glasswork/core';
import { createRoutes } from 'glasswork/http';
import { createRLSExtension, runWithTenant, type TenantContext } from 'glasswork/rls';
import { object, string } from 'valibot';

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
