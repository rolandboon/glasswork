import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { ProviderOverride } from '../../src/core/types.js';

/** Two modules that each declare a private `config` and export a service reading it. */
function createModules() {
  const VotingModule = defineModule({
    name: 'voting',
    providers: [
      { provide: 'config', useValue: { source: 'voting' } },
      { provide: 'votingSource', useFactory: ({ config }) => config.source },
    ],
    exports: ['votingSource'],
  });
  const BillingModule = defineModule({
    name: 'billing',
    providers: [
      { provide: 'config', useValue: { source: 'billing' } },
      { provide: 'billingSource', useFactory: ({ config }) => config.source },
    ],
    exports: ['billingSource'],
  });
  const AppModule = defineModule({ name: 'app', imports: [VotingModule, BillingModule] });
  return { AppModule, VotingModule, BillingModule };
}

async function sources(providerOverrides: ProviderOverride[], logger = silentLogger()) {
  const { AppModule } = createModules();
  const { container } = await bootstrap(AppModule, {
    environment: 'test',
    providerOverrides,
    logger: { instance: logger },
  });
  return { voting: container.resolve('votingSource'), billing: container.resolve('billingSource') };
}

function silentLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('providerOverrides with module', () => {
  it('replaces a private provider in one module only', async () => {
    const { VotingModule } = createModules();

    await expect(
      sources([{ module: VotingModule, provide: 'config', useValue: { source: 'test' } }])
    ).resolves.toEqual({ voting: 'test', billing: 'billing' });
  });

  it('accepts the module name', async () => {
    await expect(
      sources([{ module: 'billing', provide: 'config', useValue: { source: 'test' } }])
    ).resolves.toEqual({ voting: 'voting', billing: 'test' });
  });

  it('wins over an override for every module', async () => {
    await expect(
      sources([
        { module: 'voting', provide: 'config', useValue: { source: 'specific' } },
        { provide: 'config', useValue: { source: 'everywhere' } },
      ])
    ).resolves.toEqual({ voting: 'specific', billing: 'everywhere' });
  });

  it('replaces async factories in the targeted module', async () => {
    await expect(
      sources([
        { module: 'voting', provide: 'config', useFactory: async () => ({ source: 'async' }) },
      ])
    ).resolves.toEqual({ voting: 'async', billing: 'billing' });
  });

  it('uses only the winning override to determine async initialization and lifetime', async () => {
    const globalFactory = vi.fn(async () => ({}));
    const scopedFactory = vi.fn(() => ({}));
    const module = defineModule({
      name: 'feature',
      providers: [{ provide: 'state', useValue: {} }],
    });
    const application = await bootstrap(module, {
      environment: 'test',
      providerOverrides: [
        { module, provide: 'state', scope: 'SCOPED', useFactory: scopedFactory },
        { provide: 'state', async: true, useFactory: globalFactory },
      ],
    });
    try {
      expect(globalFactory).not.toHaveBeenCalled();
      expect(scopedFactory.mock.calls).toHaveLength(0);
      const first = application.container.createScope();
      const second = application.container.createScope();
      expect(first.resolve('state')).not.toBe(second.resolve('state'));
      await Promise.all([first.dispose(), second.dispose()]);
    } finally {
      await application.stop();
    }
  });

  it('rejects an unknown module', async () => {
    await expect(
      sources([{ module: 'shipping', provide: 'config', useValue: {} }])
    ).rejects.toThrow('Provider override "config" targets unknown module "shipping"');
  });

  it('rejects a provider the module does not declare', async () => {
    await expect(
      sources([{ module: 'voting', provide: 'billingSource', useValue: 'x' }])
    ).rejects.toThrow(
      'Provider override "billingSource" does not match a provider declared in module "voting"'
    );
  });
});

describe('providerOverrides without module', () => {
  it('keeps replacing the provider in every module and warns about it', async () => {
    const logger = silentLogger();

    await expect(
      sources([{ provide: 'config', useValue: { source: 'everywhere' } }], logger)
    ).resolves.toEqual({ voting: 'everywhere', billing: 'everywhere' });
    expect(logger.warn).toHaveBeenCalledWith(
      'Provider override "config" replaces the provider in modules "voting", "billing". Set module to replace it in one module only.'
    );
  });

  it('does not warn when one module declares the provider', async () => {
    const logger = silentLogger();

    await sources([{ provide: 'votingSource', useValue: 'override' }], logger);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('providerOverrides in contract mode', () => {
  it('accepts module-specific value overrides', async () => {
    const { AppModule } = createModules();

    await expect(
      bootstrap(AppModule, {
        mode: 'contract',
        providerOverrides: [
          { module: 'voting', provide: 'config', useValue: { source: 'contract' } },
        ],
      })
    ).resolves.toHaveProperty('generateOpenAPI');
  });

  it('rejects module-specific factory overrides', async () => {
    const { AppModule } = createModules();

    await expect(
      bootstrap(AppModule, {
        mode: 'contract',
        providerOverrides: [{ module: 'voting', provide: 'config', useFactory: () => ({}) }],
      })
    ).rejects.toThrow('Contract providerOverrides must use explicit values');
  });
});
