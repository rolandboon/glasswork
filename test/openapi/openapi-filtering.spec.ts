import { describe, expect, it } from 'vitest';
import { bootstrap, defineModule } from '../../src/index';

describe('OpenAPI header filtering', () => {
  const TestModule = defineModule({
    name: 'test',
    basePath: 'test',
    providers: [],
    routes: (router, _services) => {
      router.get('/item', async (c) => c.json({ id: '123' }));
    },
  });

  it('should include all headers when all features are enabled', async () => {
    const { app } = bootstrap(TestModule, {
      environment: 'test',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
      rateLimit: { enabled: true, storage: 'memory' },
      middleware: { cors: { origin: 'http://localhost' } },
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const headers = Object.keys(spec.components?.headers || {});

    // Should include CORS headers
    expect(headers).toContain('Access-Control-Allow-Origin');

    // Should include rate limit headers
    expect(headers).toContain('RateLimit-Limit');
    expect(headers).toContain('RateLimit-Remaining');
    expect(headers).toContain('RateLimit-Reset');
    expect(headers).toContain('Retry-After');

    // Should include pagination headers
    expect(headers).toContain('X-Total-Count');
    expect(headers).toContain('X-Page');
    expect(headers).toContain('X-Limit');
  });

  it('should exclude rate limit headers when rate limiting is disabled', async () => {
    const { app } = bootstrap(TestModule, {
      environment: 'test',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
      rateLimit: { enabled: false, storage: 'memory' },
      middleware: { cors: { origin: 'http://localhost' } },
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const headers = Object.keys(spec.components?.headers || {});

    // Should include CORS headers
    expect(headers).toContain('Access-Control-Allow-Origin');

    // Should NOT include rate limit headers
    expect(headers).not.toContain('RateLimit-Limit');
    expect(headers).not.toContain('RateLimit-Remaining');
    expect(headers).not.toContain('RateLimit-Reset');
    expect(headers).not.toContain('Retry-After');

    // Should still include pagination headers
    expect(headers).toContain('X-Total-Count');
  });

  it('should exclude CORS headers when CORS is not configured', async () => {
    const { app } = bootstrap(TestModule, {
      environment: 'test',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
      rateLimit: { enabled: true, storage: 'memory' },
      middleware: {}, // No CORS
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const headers = Object.keys(spec.components?.headers || {});

    // Should NOT include CORS headers
    expect(headers).not.toContain('Access-Control-Allow-Origin');

    // Should include rate limit headers
    expect(headers).toContain('RateLimit-Limit');

    // Should include pagination headers
    expect(headers).toContain('X-Total-Count');
  });

  it('should only include pagination headers when both features are disabled', async () => {
    const { app } = bootstrap(TestModule, {
      environment: 'test',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
      rateLimit: { enabled: false, storage: 'memory' },
      middleware: {}, // No CORS
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const headers = Object.keys(spec.components?.headers || {});

    // Should only have pagination headers
    expect(headers).toEqual(['X-Total-Count', 'X-Page', 'X-Limit']);
  });

  it('should filter header references from response objects', async () => {
    const { app } = bootstrap(TestModule, {
      environment: 'test',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
      rateLimit: { enabled: false, storage: 'memory' },
      middleware: {}, // No CORS
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    // Check a response object
    const testResponse = spec.paths?.['/api/test/item']?.get?.responses?.['200'];
    const responseHeaders = Object.keys(testResponse?.headers || {});

    // Should NOT have rate limit or CORS headers in responses
    expect(responseHeaders).not.toContain('RateLimit-Limit');
    expect(responseHeaders).not.toContain('Access-Control-Allow-Origin');
  });
});
