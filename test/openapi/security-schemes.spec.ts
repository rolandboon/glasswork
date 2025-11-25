import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { bootstrap, defineModule } from '../../src/index';

describe('OpenAPI security schemes', () => {
  const TestBodyDto = v.object({ name: v.string() });
  const TestResponseDto = v.object({ id: v.string() });

  it('should use bearerAuth when only bearerAuth is defined', async () => {
    const TestModule = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router, _services, route) => {
        router.post(
          '/item',
          ...route({
            summary: 'Create item',
            body: TestBodyDto,
            responses: { 201: TestResponseDto },
            handler: async () => ({ id: '123' }),
          })
        );
      },
    });

    const { app } = bootstrap(TestModule, {
      environment: 'test',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
              },
            },
          },
        },
      },
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const operation = spec.paths?.['/api/test/item']?.post;

    // Should have bearerAuth in security
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  });

  it('should use cookieAuth when only cookieAuth is defined', async () => {
    const TestModule = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router, _services, route) => {
        router.post(
          '/item',
          ...route({
            summary: 'Create item',
            body: TestBodyDto,
            responses: { 201: TestResponseDto },
            handler: async () => ({ id: '123' }),
          })
        );
      },
    });

    const { app } = bootstrap(TestModule, {
      environment: 'test',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
          components: {
            securitySchemes: {
              cookieAuth: {
                type: 'apiKey',
                in: 'cookie',
                name: 'session',
              },
            },
          },
        },
      },
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const operation = spec.paths?.['/api/test/item']?.post;

    // Should have cookieAuth in security
    expect(operation?.security).toEqual([{ cookieAuth: [] }]);
  });

  it('should use all defined security schemes', async () => {
    const TestModule = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router, _services, route) => {
        router.post(
          '/item',
          ...route({
            summary: 'Create item',
            body: TestBodyDto,
            responses: { 201: TestResponseDto },
            handler: async () => ({ id: '123' }),
          })
        );
      },
    });

    const { app } = bootstrap(TestModule, {
      environment: 'test',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
              },
              cookieAuth: {
                type: 'apiKey',
                in: 'cookie',
                name: 'session',
              },
            },
          },
        },
      },
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const operation = spec.paths?.['/api/test/item']?.post;

    // Should have both security schemes (order may vary based on object key iteration)
    expect(operation?.security).toHaveLength(2);
    expect(operation?.security).toContainEqual({ bearerAuth: [] });
    expect(operation?.security).toContainEqual({ cookieAuth: [] });
  });

  it('should have no security for public routes', async () => {
    const TestModule = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router, _services, route) => {
        router.post(
          '/public',
          ...route({
            summary: 'Public endpoint',
            public: true,
            body: TestBodyDto,
            responses: { 201: TestResponseDto },
            handler: async () => ({ id: '123' }),
          })
        );
      },
    });

    const { app } = bootstrap(TestModule, {
      environment: 'test',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
          components: {
            securitySchemes: {
              bearerAuth: {
                type: 'http',
                scheme: 'bearer',
              },
              cookieAuth: {
                type: 'apiKey',
                in: 'cookie',
                name: 'session',
              },
            },
          },
        },
      },
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const operation = spec.paths?.['/api/test/public']?.post;

    // Public routes should have empty security array
    expect(operation?.security).toEqual([]);
  });

  it('should handle no security schemes defined', async () => {
    const TestModule = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router, _services, route) => {
        router.post(
          '/item',
          ...route({
            summary: 'Create item',
            body: TestBodyDto,
            responses: { 201: TestResponseDto },
            handler: async () => ({ id: '123' }),
          })
        );
      },
    });

    const { app } = bootstrap(TestModule, {
      environment: 'test',
      openapi: {
        enabled: true,
        serveSpecs: true,
        documentation: {
          info: { title: 'Test API', version: '1.0.0' },
          // No security schemes defined
        },
      },
    });

    const response = await app.request('/api/openapi.json');
    const spec = await response.json();

    const operation = spec.paths?.['/api/test/item']?.post;

    // When no security schemes are defined, should have empty array
    expect(operation?.security).toEqual([]);
  });
});
