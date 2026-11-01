import { asValue } from 'awilix';
import { describe, expect, it, vi } from 'vitest';
import { bootstrap, defineModule, forwardRef, type ModuleConfig } from '../../src/core/index.js';

const value = (provide: string, useValue: unknown) => ({ provide, useValue });
const boot = (module: ModuleConfig) => bootstrap(module, { environment: 'test' });

describe('module boundaries', () => {
  it.each([false, true])('rejects foreign private providers (imported: %s)', async (imported) => {
    const secret = defineModule({ name: 'secret', providers: [value('secret', 42)] });
    const consumer = defineModule({
      name: 'consumer',
      imports: imported ? [secret] : [],
      providers: [{ provide: 'service', useFactory: ({ secret }) => secret }],
    });
    const root = defineModule({ name: 'root', imports: [secret, consumer] });
    const result = await boot(root);
    await expect(result.start()).rejects.toThrow('not available in module "consumer"');
    expect(() => result.container.resolve('secret')).toThrow('not available');
  });

  it('does not make an export available without an import', async () => {
    const source = defineModule({
      name: 'source',
      providers: [value('shared', 42)],
      exports: ['shared'],
    });
    const consumer = defineModule({
      name: 'consumer',
      providers: [{ provide: 'service', useFactory: ({ shared }) => shared }],
    });
    const result = await boot(defineModule({ name: 'root', imports: [source, consumer] }));
    await expect(result.start()).rejects.toThrow('module "consumer"');
  });

  it('resolves exported services in their owner module and preserves singleton identity', async () => {
    const source = defineModule({
      name: 'source',
      providers: [
        value('config', 'owner'),
        { provide: 'service', useFactory: ({ config }) => ({ config }) },
      ],
      exports: ['service'],
    });
    let fromRoute: unknown;
    const consumer = defineModule({
      name: 'consumer',
      basePath: 'consumer',
      imports: [source],
      providers: [value('config', 'consumer')],
      routes: (_router, { service }) => {
        fromRoute = service;
      },
    });
    const result = await boot(defineModule({ name: 'root', imports: [source, consumer] }));
    expect(result.container.resolve('service')).toBe(fromRoute);
    expect(fromRoute).toEqual({ config: 'owner' });
  });

  it('supports transitive module re-exports without exposing private providers', async () => {
    const source = defineModule({
      name: 'source',
      providers: [value('public', 1), value('private', 2)],
      exports: ['public'],
    });
    const common = defineModule({ name: 'common', imports: [source], exports: [source] });
    const result = await boot(defineModule({ name: 'root', imports: [common] }));
    expect(Object.keys(result.container.cradle)).toEqual(['public']);
    expect(result.container.resolve('public')).toBe(1);
    expect(() => result.container.resolve('private')).toThrow('not available');
  });

  it('rejects ambiguous imports but permits explicit local precedence', async () => {
    const a = defineModule({ name: 'a', providers: [value('config', 'a')], exports: ['config'] });
    const b = defineModule({ name: 'b', providers: [value('config', 'b')], exports: ['config'] });
    await expect(boot(defineModule({ name: 'root', imports: [a, b] }))).rejects.toThrow(
      'Ambiguous imported provider'
    );
    const result = await boot(
      defineModule({ name: 'root', imports: [a, b], providers: [value('config', 'root')] })
    );
    expect(result.container.resolve('config')).toBe('root');
  });

  it('rejects duplicate module names and duplicate local provider tokens', async () => {
    await expect(
      boot(
        defineModule({
          name: 'root',
          imports: [defineModule({ name: 'same' }), defineModule({ name: 'same' })],
        })
      )
    ).rejects.toThrow('Duplicate module name');
    await expect(
      boot(defineModule({ name: 'root', providers: [value('x', 1), value('x', 2)] }))
    ).rejects.toThrow('Duplicate provider');
  });

  it('rejects exports with no provider and re-exports without an import', async () => {
    expect(() => defineModule({ name: 'empty', exports: ['missing'] })).toThrow('not in providers');
    expect(() =>
      defineModule({ name: 'importer', imports: [defineModule({ name: 'x' })], exports: ['typo'] })
    ).toThrow('not in providers');
    const source = defineModule({ name: 'source' });
    await expect(boot(defineModule({ name: 'root', exports: [source] }))).rejects.toThrow(
      'does not import'
    );
  });

  it('keeps routes with identical private provider names independent', async () => {
    const feature = (name: string) =>
      defineModule({
        name,
        basePath: name,
        providers: [value('state', name)],
        routes: (router, { state }) => {
          router.get('/', (c) => c.json(state));
        },
      });
    const { app } = await boot(
      defineModule({ name: 'root', imports: [feature('a'), feature('b')] })
    );
    expect(await (await app.request('/api/a')).json()).toBe('a');
    expect(await (await app.request('/api/b')).json()).toBe('b');
  });

  it('rejects route factory access to foreign providers', async () => {
    const source = defineModule({ name: 'source', providers: [value('private', 42)] });
    await expect(
      boot(
        defineModule({
          name: 'root',
          basePath: 'root',
          imports: [source],
          routes: (_router, services) => {
            void services.private;
          },
        })
      )
    ).rejects.toThrow('not available');
  });

  it('preserves scoped identity across imports and isolates requests', async () => {
    let count = 0;
    const source = defineModule({
      name: 'source',
      providers: [{ provide: 'state', scope: 'SCOPED', useFactory: () => ({ id: ++count }) }],
      exports: ['state'],
    });
    const consumer = defineModule({
      name: 'consumer',
      basePath: 'consumer',
      imports: [source],
      providers: [{ provide: 'service', scope: 'SCOPED', useFactory: ({ state }) => ({ state }) }],
      routes: (router, { service, state }) => {
        router.get('/', (c) =>
          c.json({
            direct: (state as { id: number }).id,
            indirect: (service as { state: { id: number } }).state.id,
          })
        );
      },
    });
    const { app, start } = await boot(consumer);
    await start();
    expect(count).toBe(0);
    const responses = await Promise.all([
      app.request('/api/consumer'),
      app.request('/api/consumer'),
    ]);
    const results = await Promise.all(
      responses.map((response) => response.json() as Promise<{ direct: number; indirect: number }>)
    );
    expect(results.every((result) => result.direct === result.indirect)).toBe(true);
    expect(results[0].direct).not.toBe(results[1].direct);
  });

  it('retains Awilix lifetime checking across module boundaries', async () => {
    const source = defineModule({
      name: 'source',
      providers: [{ provide: 'state', scope: 'SCOPED', useFactory: () => ({}) }],
      exports: ['state'],
    });
    const result = await boot(
      defineModule({
        name: 'root',
        imports: [source],
        providers: [{ provide: 'service', useFactory: ({ state }) => state }],
      })
    );
    expect(() => result.container.resolve('service')).toThrow('shorter lifetime');
  });

  it('runs lifecycle hooks once even through multiple re-exports', async () => {
    const onModuleInit = vi.fn();
    const source = defineModule({
      name: 'source',
      providers: [value('service', { onModuleInit })],
      exports: ['service'],
    });
    const common = defineModule({ name: 'common', imports: [source], exports: [source] });
    const result = await boot(defineModule({ name: 'root', imports: [source, common] }));
    await result.start();
    expect(onModuleInit).toHaveBeenCalledTimes(1);
  });

  it('supports deferred module imports and lazy provider cycles with real instance identity', async () => {
    const a: ModuleConfig = defineModule({
      name: 'a',
      imports: [forwardRef(() => b)],
      providers: [{ provide: 'a', useFactory: (dependencies) => ({ getB: () => dependencies.b }) }],
      exports: ['a'],
    });
    const b: ModuleConfig = defineModule({
      name: 'b',
      imports: [forwardRef(() => a)],
      providers: [{ provide: 'b', useFactory: ({ a }) => ({ a }) }],
      exports: ['b'],
    });
    const { container } = await boot(a);
    const serviceA = container.resolve<{ getB(): { a: unknown } }>('a');
    expect(serviceA.getB()).toBe(container.resolve('b'));
    expect(serviceA.getB().a).toBe(serviceA);
  });

  it('rejects eager provider cycles with a module-qualified resolution path', async () => {
    const a: ModuleConfig = defineModule({
      name: 'a',
      imports: [forwardRef(() => b)],
      providers: [{ provide: 'a', useFactory: ({ b }) => b }],
      exports: ['a'],
    });
    const b: ModuleConfig = defineModule({
      name: 'b',
      imports: [forwardRef(() => a)],
      providers: [{ provide: 'b', useFactory: ({ a }) => a }],
      exports: ['b'],
    });
    const { container } = await boot(a);
    expect(() => container.resolve('a')).toThrow('a/a -> b/b -> a/a');
  });

  it('orders explicitly declared async dependencies across imports', async () => {
    const source = defineModule({
      name: 'source',
      providers: [{ provide: 'config', useFactory: async () => ({ value: 42 }) }],
      exports: ['config'],
    });
    const root = defineModule({
      name: 'root',
      imports: [source],
      providers: [
        { provide: 'result', inject: ['config'], useFactory: async ({ config }) => config.value },
      ],
    });
    const { container } = await boot(root);
    expect(container.resolve('result')).toBe(42);
  });

  it('rejects async dependency cycles without hanging', async () => {
    await expect(
      boot(
        defineModule({
          name: 'root',
          providers: [
            { provide: 'a', inject: ['b'], useFactory: async ({ b }) => b },
            { provide: 'b', inject: ['a'], useFactory: async ({ a }) => a },
          ],
        })
      )
    ).rejects.toThrow('Circular async factory dependency');
  });

  it('supports manual registrations and build within the root module view', async () => {
    const { container } = await boot(defineModule({ name: 'root' }));
    container.register({ config: asValue(42) });
    expect(container.resolve('config')).toBe(42);
    expect(container.build(({ config }: { config: number }) => config)).toBe(42);
  });

  it('rejects manual registrations that would replace an imported provider', async () => {
    const source = defineModule({
      name: 'source',
      providers: [value('db', 'real')],
      exports: ['db'],
    });
    const consumer = defineModule({
      name: 'consumer',
      imports: [source],
      providers: [{ provide: 'service', useFactory: ({ db }) => db }],
      exports: ['service'],
    });
    const { container } = await boot(defineModule({ name: 'root', imports: [source, consumer] }));
    expect(() => container.register({ db: asValue('mock') })).toThrow('providerOverrides');
    expect(() => container.createScope().register({ db: asValue('mock') })).toThrow(
      'providerOverrides'
    );
    expect(container.resolve('service')).toBe('real');
  });

  it('keeps scope registrations inside that scope', async () => {
    const { container } = await boot(
      defineModule({
        name: 'root',
        providers: [
          { provide: 'greeting', scope: 'SCOPED', useFactory: ({ user }) => `hi ${user}` },
        ],
      })
    );
    const scope = container.createScope();
    scope.register({ user: asValue('ada') });
    expect(scope.resolve('greeting')).toBe('hi ada');
    expect(Object.keys(scope.cradle)).toContain('user');
    expect(Object.keys(container.cradle)).not.toContain('user');
    expect(container.hasRegistration('user')).toBe(false);
    expect(() => container.resolve('user')).toThrow('not available');
    await scope.dispose();
  });
  it('shares the HTTP scope across overlapping module routers', async () => {
    let sequence = 0;
    const source = defineModule({
      name: 'source',
      providers: [{ provide: 'state', scope: 'SCOPED', useFactory: () => ({ id: ++sequence }) }],
      exports: ['state'],
    });
    const observed: number[] = [];
    const outer = defineModule({
      name: 'outer',
      basePath: 'shared',
      imports: [source],
      routes: (router, { state }) => {
        router.use('*', async (_c, next) => {
          observed.push((state as { id: number }).id);
          await next();
        });
      },
    });
    const inner = defineModule({
      name: 'inner',
      basePath: 'shared',
      imports: [source],
      routes: (router, { state }) => {
        router.get('/', (c) => c.json({ id: (state as { id: number }).id }));
      },
    });
    const { app } = await boot(defineModule({ name: 'root', imports: [outer, inner] }));
    expect(await (await app.request('/api/shared')).json()).toEqual({ id: observed[0] });
    expect(sequence).toBe(1);
  });

  it('keeps same-named scoped providers private to their route modules', async () => {
    const feature = (name: string) =>
      defineModule({
        name,
        basePath: name,
        providers: [{ provide: 'state', scope: 'SCOPED', useFactory: () => ({ name }) }],
        routes: (router, { state }) => {
          router.get('/', (c) => c.json({ name: (state as { name: string }).name }));
        },
      });
    const { app } = await boot(
      defineModule({ name: 'root', imports: [feature('a'), feature('b')] })
    );
    expect(await (await app.request('/api/a')).json()).toEqual({ name: 'a' });
    expect(await (await app.request('/api/b')).json()).toEqual({ name: 'b' });
  });

  it('propagates re-exports through deferred module cycles', async () => {
    const a: ModuleConfig = defineModule({
      name: 'a',
      imports: [forwardRef(() => b)],
      providers: [value('a', 1)],
      exports: ['a', forwardRef(() => b)],
    });
    const b: ModuleConfig = defineModule({
      name: 'b',
      imports: [forwardRef(() => a)],
      providers: [value('b', 2)],
      exports: ['b', forwardRef(() => a)],
    });
    const { container } = await boot(defineModule({ name: 'root', imports: [a] }));
    expect(container.resolve('a')).toBe(1);
    expect(container.resolve('b')).toBe(2);
  });
});

it('enumerates only visible registrations and reflects later registrations per scope', async () => {
  const imported = defineModule({
    name: 'imported',
    providers: [value('visible', 'public'), value('privateValue', 'private')],
    exports: ['visible'],
  });
  const application = await bootstrap(
    defineModule({ name: 'root', imports: [imported], providers: [value('local', 'root')] }),
    { environment: 'test' }
  );
  const scope = application.container.createScope();
  try {
    const before = application.container.registrations;
    expect(Object.keys(before).sort()).toEqual(['local', 'visible']);
    scope.register({ local: asValue('scoped'), scopedOnly: asValue(true) });
    application.container.register({ later: asValue('added') });

    expect(Object.keys(before).sort()).toEqual(['local', 'visible']);
    expect(Object.keys(application.container.registrations).sort()).toEqual([
      'later',
      'local',
      'visible',
    ]);
    expect(Object.keys(scope.registrations).sort()).toEqual([
      'later',
      'local',
      'scopedOnly',
      'visible',
    ]);
    expect(application.container.resolve('local')).toBe('root');
    expect(scope.resolve('local')).toBe('scoped');
    expect(scope.resolve('visible')).toBe('public');
    expect(scope.registrations).not.toHaveProperty('privateValue');
  } finally {
    await scope.dispose();
    await application.stop();
  }
});
