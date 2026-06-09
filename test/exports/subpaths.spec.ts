import { describe, expect, it } from 'vitest';

describe('subpath exports', () => {
  it('exposes glasswork/core without optional subsystem barrels', async () => {
    const core = await import('../../dist/core/index.js');
    expect(core.bootstrap).toBeTypeOf('function');
    expect(core.defineModule).toBeTypeOf('function');
    expect(core.createConfig).toBeTypeOf('function');
    expect(core).not.toHaveProperty('createBetterAuthProvider');
    expect(core).not.toHaveProperty('SESTransport');
    expect(core).not.toHaveProperty('bootstrapWorker');
  });

  it('exposes glasswork/http routing primitives', async () => {
    const http = await import('../../dist/http/index.js');
    expect(http.createRoutes).toBeTypeOf('function');
    expect(http.route).toBeTypeOf('function');
    expect(http.NotFoundException).toBeTypeOf('function');
    expect(http.Hono).toBeTypeOf('function');
  });

  it('exposes optional subsystems on dedicated subpaths', async () => {
    const auth = await import('../../dist/auth/index.js');
    const email = await import('../../dist/email/index.js');
    const jobs = await import('../../dist/jobs/index.js');
    const uploads = await import('../../dist/uploads/index.js');
    const listQuery = await import('../../dist/list-query/index.js');
    const observability = await import('../../dist/observability/index.js');

    expect(auth.createAuthMiddleware).toBeTypeOf('function');
    expect(email.SESTransport).toBeTypeOf('function');
    expect(jobs.bootstrapWorker).toBeTypeOf('function');
    expect(uploads.UploadsService).toBeTypeOf('function');
    expect(listQuery.registerCasl).toBeTypeOf('function');
    expect(observability.createCloudWatchTracker).toBeTypeOf('function');
  });

  it('keeps root entry limited to core and http', async () => {
    const root = await import('../../dist/index.js');
    expect(root.bootstrap).toBeTypeOf('function');
    expect(root.createRoutes).toBeTypeOf('function');
    expect(root).not.toHaveProperty('createBetterAuthProvider');
    expect(root).not.toHaveProperty('compileTemplates');
  });
});
