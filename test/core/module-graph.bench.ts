import { bench, describe } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import { inspectModuleGraph } from '../../src/core/module-inspection.js';
import type { ModuleConfig } from '../../src/core/types.js';

/**
 * A layered application: every module declares five providers, exports two of them and
 * imports the three modules before it. Run with `npx vitest bench`.
 */
function createApplication(size: number): ModuleConfig {
  const modules: ModuleConfig[] = [];
  for (let index = 0; index < size; index++) {
    const imports = modules.slice(Math.max(0, index - 3));
    modules.push(
      defineModule({
        name: `module${index}`,
        imports,
        providers: [
          { provide: `config${index}`, useValue: { index } },
          { provide: `repository${index}`, useFactory: () => ({}) },
          { provide: `service${index}`, useFactory: () => ({}) },
          { provide: `client${index}`, inject: [`config${index}`], useFactory: async () => ({}) },
          { provide: `requestState${index}`, scope: 'SCOPED', useFactory: () => ({}) },
        ],
        exports: [`service${index}`, `config${index}`],
      })
    );
  }
  return defineModule({ name: 'app', imports: modules });
}

for (const size of [30, 100, 300]) {
  describe(`${size} modules`, () => {
    const root = createApplication(size);

    bench('inspectModuleGraph', () => {
      inspectModuleGraph(root);
    });

    bench('bootstrap without start', async () => {
      await bootstrap(root, { environment: 'test' });
    });
  });
}
