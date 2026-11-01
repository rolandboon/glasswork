import type { Hono } from 'hono';
import { bench, describe } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { ModuleConfig } from '../../src/core/types.js';

/**
 * A layered application: every module declares five providers, exports two, imports the
 * three modules before it and mounts one route. Run with `npx vitest bench`.
 */
function createApplication(size: number): ModuleConfig {
  const modules: ModuleConfig[] = [];
  for (let index = 0; index < size; index++) {
    modules.push(
      defineModule({
        name: `module${index}`,
        basePath: `m${index}`,
        imports: modules.slice(Math.max(0, index - 3)),
        providers: [
          { provide: `config${index}`, useValue: { index } },
          { provide: `repository${index}`, useFactory: () => ({}) },
          { provide: `service${index}`, useFactory: () => ({ ok: () => true }) },
          { provide: `client${index}`, inject: [`config${index}`], useFactory: async () => ({}) },
          { provide: `requestState${index}`, scope: 'SCOPED', useFactory: () => ({}) },
        ],
        exports: [`service${index}`, `config${index}`],
        routes: (router: Hono, services: Record<string, unknown>) => {
          router.get('/', (c) =>
            c.json({ ok: (services[`service${index}`] as { ok(): boolean }).ok() })
          );
        },
      })
    );
  }
  return defineModule({ name: 'app', imports: modules });
}

for (const size of [30, 100, 300]) {
  describe(`${size} modules`, async () => {
    const root = createApplication(size);
    const started = await bootstrap(root, { environment: 'test' });
    await started.start();

    bench(
      'bootstrap',
      async () => {
        await bootstrap(root, { environment: 'test' });
      },
      { iterations: 5 }
    );

    bench(
      'bootstrap and start',
      async () => {
        const application = await bootstrap(root, { environment: 'test' });
        await application.start();
      },
      { iterations: 5 }
    );

    bench('request that reads a route service', async () => {
      await started.app.request(`/api/m${size - 1}`);
    });
  });
}
