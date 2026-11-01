import { describe, expect, it } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { ProviderNotAvailableError } from '../../src/core/errors.js';
import { defineModule } from '../../src/core/module.js';

describe('missing provider errors', () => {
  const BillingModule = defineModule({
    name: 'billing',
    providers: [
      { provide: 'ledger', useValue: {} },
      { provide: 'invoices', useValue: {} },
    ],
    exports: ['invoices'],
  });

  async function resolveWith(dependency: string) {
    class ReportService {
      constructor(cradle: Record<string, unknown>) {
        void cradle.reportRepository;
      }
    }
    class ReportRepository {
      constructor(cradle: Record<string, unknown>) {
        void cradle[dependency];
      }
    }
    const ReportsModule = defineModule({
      name: 'reports',
      providers: [ReportService, ReportRepository],
      exports: [ReportService],
    });
    const { container } = await bootstrap(
      defineModule({ name: 'app', imports: [ReportsModule, BillingModule] }),
      { environment: 'test' }
    );
    try {
      container.resolve('reportService');
    } catch (error) {
      return error;
    }
    throw new Error('expected resolution to fail');
  }

  it('names the provider path and the module that exports the provider', async () => {
    const error = await resolveWith('invoices');

    expect(error).toBeInstanceOf(ProviderNotAvailableError);
    expect(error).toMatchObject({
      module: 'reports',
      provider: 'invoices',
      path: ['reports/reportService', 'reports/reportRepository'],
      message:
        'Provider "invoices" is not available in module "reports" (required by reports/reportService -> reports/reportRepository). Import "billing", which exports it.',
    });
  });

  it('names the module that declares the provider without exporting it', async () => {
    const error = (await resolveWith('ledger')) as Error;

    expect(error.message).toContain('Declared in "billing", which does not export it.');
  });

  it('says when no module declares the provider', async () => {
    const error = (await resolveWith('mailer')) as Error;

    expect(error.message).toContain('No module declares it.');
  });
});

it('includes an async factory in the resolution path', async () => {
  const module = defineModule({
    name: 'reports',
    providers: [{ provide: 'report', useFactory: async ({ missing }) => missing }],
  });
  await expect(bootstrap(module, { environment: 'test' })).rejects.toMatchObject({
    path: ['reports/report'],
    provider: 'missing',
    module: 'reports',
  });
});

it('preserves the identity of a promise supplied as a value', async () => {
  const value = Promise.resolve({ ready: true });
  const application = await bootstrap(
    defineModule({ name: 'values', providers: [{ provide: 'future', useValue: value }] }),
    { environment: 'test' }
  );
  try {
    expect(application.container.resolve('future')).toBe(value);
  } finally {
    await application.stop();
  }
});
