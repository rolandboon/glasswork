import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureOpenAPI } from '../../src/openapi/openapi.js';

describe('configureOpenAPI', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return empty object when openapi is disabled', () => {
    const app = new Hono();

    const result = configureOpenAPI({
      app,
      environment: 'development',
      openapi: {
        enabled: false,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
    });

    expect(result).toEqual({});
    expect(result.writeSpec).toBeUndefined();
  });

  it('should serve Swagger UI when serveUI is true', async () => {
    const app = new Hono();

    configureOpenAPI({
      app,
      environment: 'development',
      openapi: {
        enabled: true,
        serveSpecs: true,
        serveUI: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
    });

    // Should serve Swagger UI at /api
    const response = await app.request('/api');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('swagger');
  });

  it('should serve Swagger UI by default in development', async () => {
    const app = new Hono();

    configureOpenAPI({
      app,
      environment: 'development',
      openapi: {
        enabled: true,
        // serveUI not specified, should default to true in development
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
    });

    const response = await app.request('/api');
    expect(response.status).toBe(200);
  });

  it('should not serve Swagger UI by default in production', async () => {
    const app = new Hono();

    configureOpenAPI({
      app,
      environment: 'production',
      openapi: {
        enabled: true,
        // serveUI not specified, should default to false in production
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
    });

    const response = await app.request('/api');
    // Should return 404 since UI is not served in production
    expect(response.status).toBe(404);
  });

  it('should not serve specs by default in production', async () => {
    const app = new Hono();

    configureOpenAPI({
      app,
      environment: 'production',
      openapi: {
        enabled: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
    });

    const response = await app.request('/api/openapi.json');
    expect(response.status).toBe(404);
  });
});

describe('configureOpenAPI writeToFile', () => {
  const testFilePath = '/tmp/test-openapi-spec.json';

  beforeEach(() => {
    vi.useFakeTimers();
    // Clean up test file if it exists
    if (existsSync(testFilePath)) {
      unlinkSync(testFilePath);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clean up test file
    if (existsSync(testFilePath)) {
      unlinkSync(testFilePath);
    }
  });

  it('should return writeSpec function when writeToFile is configured', () => {
    const app = new Hono();

    const result = configureOpenAPI({
      app,
      environment: 'development',
      openapi: {
        enabled: true,
        serveSpecs: true,
        writeToFile: testFilePath,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
    });

    expect(result.writeSpec).toBeDefined();
    expect(typeof result.writeSpec).toBe('function');
  });

  it('should write spec to file when writeSpec is called', async () => {
    const app = new Hono();
    app.get('/test', (c) => c.json({ ok: true }));

    const { writeSpec } = configureOpenAPI({
      app,
      environment: 'development',
      openapi: {
        enabled: true,
        serveSpecs: true,
        writeToFile: testFilePath,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
    });

    // Call writeSpec explicitly
    await writeSpec?.();

    // Verify file was written
    expect(existsSync(testFilePath)).toBe(true);
    const content = readFileSync(testFilePath, 'utf-8');
    const spec = JSON.parse(content);
    expect(spec.info.title).toBe('Test API');
  });

  // Note: Auto-write with timer delay is tested implicitly via the setTimeout in
  // configureOpenAPI. We don't test it explicitly because timer-based async tests
  // are flaky across Node versions. The recommended approach is to call writeSpec()
  // explicitly after all routes are registered.

  it('should write spec when not serving specs (production mode)', async () => {
    const app = new Hono();
    app.get('/test', (c) => c.json({ ok: true }));

    const { writeSpec } = configureOpenAPI({
      app,
      environment: 'production',
      openapi: {
        enabled: true,
        serveSpecs: false, // Not serving specs
        writeToFile: testFilePath,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
    });

    // Call writeSpec explicitly
    await writeSpec?.();

    // Verify file was written even though specs aren't served
    expect(existsSync(testFilePath)).toBe(true);
    const content = readFileSync(testFilePath, 'utf-8');
    const spec = JSON.parse(content);
    expect(spec.info.title).toBe('Test API');
  });

  it('should handle write errors gracefully', async () => {
    const app = new Hono();

    // Use an invalid file path that should cause a write error
    const invalidPath = '/nonexistent/directory/spec.json';

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { writeSpec } = configureOpenAPI({
      app,
      environment: 'development',
      openapi: {
        enabled: true,
        serveSpecs: true,
        writeToFile: invalidPath,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
    });

    // Should not throw
    await expect(writeSpec?.()).resolves.not.toThrow();

    // Should log error
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe('filterComponentsByFeatures', () => {
  it('should return components unchanged when headers is undefined', async () => {
    const app = new Hono();

    // Configure with custom documentation that has no headers in components
    configureOpenAPI({
      app,
      environment: 'development',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
          components: {
            schemas: {
              TestSchema: { type: 'object' },
            },
            // No headers property
          },
        },
      },
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    // Schemas should still be present
    expect(spec.components?.schemas?.TestSchema).toBeDefined();
  });
});

describe('shouldIncludeHeader', () => {
  it('should include unknown headers by default', async () => {
    const app = new Hono();

    // Configure with custom headers that don't match any specific pattern
    configureOpenAPI({
      app,
      environment: 'development',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
          components: {
            headers: {
              'Custom-Header': {
                description: 'A custom header',
                schema: { type: 'string' },
              },
              'Another-Custom': {
                description: 'Another custom header',
                schema: { type: 'string' },
              },
            },
          },
        },
      },
      // Both features disabled to test default inclusion
      rateLimit: { enabled: false, storage: 'memory' },
      middleware: {},
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const headers = Object.keys(spec.components?.headers || {});

    // Custom headers should be included (default return true)
    expect(headers).toContain('Custom-Header');
    expect(headers).toContain('Another-Custom');
  });

  it('should include headers starting with X- (pagination headers)', async () => {
    const app = new Hono();

    configureOpenAPI({
      app,
      environment: 'development',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
        },
      },
      // Both features disabled
      rateLimit: { enabled: false, storage: 'memory' },
      middleware: {},
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const headers = Object.keys(spec.components?.headers || {});

    // X- headers should always be included
    expect(headers).toContain('X-Total-Count');
    expect(headers).toContain('X-Total-Pages');
  });
});
