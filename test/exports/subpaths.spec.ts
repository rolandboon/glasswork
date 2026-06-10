import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist');

function importDist(subpath: string) {
  return import(pathToFileURL(path.join(distDir, subpath)).href);
}

describe('subpath exports', () => {
  it('exposes glasswork/core without optional subsystem barrels', async () => {
    const core = await importDist('core/index.js');
    expect(core.bootstrap).toBeTypeOf('function');
    expect(core.defineModule).toBeTypeOf('function');
    expect(core.createConfig).toBeTypeOf('function');
    expect(core).not.toHaveProperty('createBetterAuthProvider');
    expect(core).not.toHaveProperty('SESTransport');
    expect(core).not.toHaveProperty('bootstrapWorker');
  });

  it('exposes glasswork/http routing primitives', async () => {
    const http = await importDist('http/index.js');
    expect(http.createRoutes).toBeTypeOf('function');
    expect(http.route).toBeTypeOf('function');
    expect(http.NotFoundException).toBeTypeOf('function');
    expect(http.Hono).toBeTypeOf('function');
  });

  it('exposes optional subsystems on dedicated subpaths', async () => {
    const auth = await importDist('auth/index.js');
    const email = await importDist('email/index.js');
    const jobs = await importDist('jobs/index.js');
    const uploads = await importDist('uploads/index.js');
    const listQuery = await importDist('list-query/index.js');
    const observability = await importDist('observability/index.js');

    expect(auth.createAuthMiddleware).toBeTypeOf('function');
    expect(auth.registerAuthCasl).toBeTypeOf('function');
    expect(email.SESTransport).toBeTypeOf('function');
    expect(jobs.bootstrapWorker).toBeTypeOf('function');
    expect(uploads.UploadsService).toBeTypeOf('function');
    expect(listQuery.registerCasl).toBeTypeOf('function');
    expect(observability.createCloudWatchTracker).toBeTypeOf('function');
  });

  it('keeps root entry limited to core and http', async () => {
    const root = await importDist('index.js');
    expect(root.bootstrap).toBeTypeOf('function');
    expect(root.createRoutes).toBeTypeOf('function');
    expect(root).not.toHaveProperty('createBetterAuthProvider');
    expect(root).not.toHaveProperty('compileTemplates');
  });
});
