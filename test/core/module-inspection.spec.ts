import { describe, expect, it, vi } from 'vitest';
import { defineModule, forwardRef } from '../../src/core/module.js';
import { inspectModuleGraph, moduleGraphToMermaid } from '../../src/core/module-inspection.js';
import type { ModuleConfig } from '../../src/core/types.js';
import { defineJob } from '../../src/jobs/define-job.js';

class InvoiceService {}

function createApp() {
  const factory = vi.fn(() => ({}));
  const SharedModule = defineModule({
    name: 'shared',
    providers: [{ provide: 'config', useValue: {} }],
    exports: ['config'],
  });
  const BillingModule = defineModule({
    name: 'billing',
    basePath: 'billing',
    imports: [SharedModule],
    providers: [
      InvoiceService,
      { provide: 'client', inject: ['config'], useFactory: async () => factory() },
      { provide: 'requestState', scope: 'SCOPED', useFactory: factory },
    ],
    exports: [InvoiceService, SharedModule],
    routes: () => {},
    jobs: [defineJob({ name: 'send-invoice', handler: async () => {} })],
  });
  const AppModule = defineModule({ name: 'app', imports: [BillingModule] });
  return { AppModule, factory };
}

describe('inspectModuleGraph', () => {
  it('describes modules, providers, exports and jobs without creating providers', () => {
    const { AppModule, factory } = createApp();

    const graph = inspectModuleGraph(AppModule);

    expect(factory).not.toHaveBeenCalled();
    expect(graph.root).toBe('app');
    expect(graph.modules.map((module) => module.name)).toEqual(['app', 'billing', 'shared']);
    expect(graph.modules[1]).toEqual({
      name: 'billing',
      basePath: 'billing',
      imports: [{ module: 'shared', deferred: false }],
      exports: ['invoiceService', 'config'],
      providers: [
        {
          name: 'invoiceService',
          kind: 'class',
          scope: 'SINGLETON',
          async: false,
          exported: true,
          inject: [],
        },
        {
          name: 'client',
          kind: 'factory',
          scope: 'SINGLETON',
          async: true,
          exported: false,
          inject: ['config'],
        },
        {
          name: 'requestState',
          kind: 'factory',
          scope: 'SCOPED',
          async: false,
          exported: false,
          inject: [],
        },
      ],
      jobs: ['send-invoice'],
      hasRoutes: true,
    });
    expect(graph.cycles).toEqual([]);
    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
  });

  it('reports cycles closed by forwardRef', () => {
    const UsersModule: ModuleConfig = defineModule({
      name: 'users',
      imports: [forwardRef(() => OrdersModule)],
    });
    const OrdersModule: ModuleConfig = defineModule({ name: 'orders', imports: [UsersModule] });

    const graph = inspectModuleGraph(defineModule({ name: 'app', imports: [OrdersModule] }));

    expect(graph.cycles).toEqual([['users', 'orders', 'users']]);
    expect(graph.modules.find((module) => module.name === 'users')?.imports).toEqual([
      { module: 'orders', deferred: true },
    ]);
  });

  it.each([
    [
      'an import cycle without forwardRef',
      () => {
        const A: ModuleConfig = { name: 'a', imports: [] };
        const B: ModuleConfig = { name: 'b', imports: [A] };
        A.imports = [B];
        return A;
      },
      'Circular dependency detected',
    ],
    [
      'an inject dependency the module cannot see',
      () =>
        defineModule({
          name: 'app',
          providers: [{ provide: 'client', inject: ['config'], useFactory: async () => ({}) }],
        }),
      'Provider "config" is not available in module "app"',
    ],
    [
      'an ambiguous import',
      () => {
        const first = defineModule({
          name: 'first',
          providers: [{ provide: 'config', useValue: 1 }],
          exports: ['config'],
        });
        const second = defineModule({
          name: 'second',
          providers: [{ provide: 'config', useValue: 2 }],
          exports: ['config'],
        });
        return defineModule({ name: 'app', imports: [first, second] });
      },
      'Ambiguous imported provider "config" in module "app"',
    ],
  ])('fails on %s', (_case, createRoot, message) => {
    expect(() => inspectModuleGraph(createRoot())).toThrow(message);
  });
});

describe('moduleGraphToMermaid', () => {
  it('renders modules and imports, with dotted deferred imports', () => {
    const UsersModule: ModuleConfig = defineModule({
      name: 'users',
      imports: [forwardRef(() => OrdersModule)],
    });
    const OrdersModule: ModuleConfig = defineModule({
      name: 'orders',
      imports: [UsersModule],
      providers: [{ provide: 'orders', useValue: [] }],
      exports: ['orders'],
    });

    expect(moduleGraphToMermaid(inspectModuleGraph(OrdersModule))).toBe(
      [
        'flowchart LR',
        '  m_0["orders<br/>1 provider, 1 exported"]',
        '  m_1["users<br/>0 providers, 0 exported"]',
        '  m_0 --> m_1',
        '  m_1 -.-> m_0',
      ].join('\n')
    );
  });
});

it('keeps distinct module names distinct and escapes Mermaid labels', () => {
  const root = defineModule({
    name: 'orders-api',
    imports: [defineModule({ name: 'orders_api' }), defineModule({ name: 'a"<b>' })],
  });
  const diagram = moduleGraphToMermaid(inspectModuleGraph(root));
  const ids = [...diagram.matchAll(/^ {2}(\w+)\[/gm)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(3);
  expect(diagram).toContain('a#34;#60;b#62;');
});
