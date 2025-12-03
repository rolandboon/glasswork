import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { ModuleConfig } from '../../src/core/types.js';
import type { ExceptionTracker } from '../../src/observability/exception-tracking.js';
import type { PinoLogger } from '../../src/observability/pino-logger.js';

describe('bootstrap', () => {
  it('should create Hono app and Awilix container', async () => {
    const module = defineModule({
      name: 'test',
      providers: [],
    });

    const { app, container } = await bootstrap(module);

    expect(app).toBeDefined();
    expect(container).toBeDefined();
    expect(container.cradle).toBeDefined();
  });

  it('should register simple class providers', async () => {
    class TestService {
      getValue() {
        return 'test';
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [TestService],
    });

    const { container } = await bootstrap(module);

    expect(container.cradle).toHaveProperty('testService');
    const service = container.cradle.testService as TestService;
    expect(service.getValue()).toBe('test');
  });

  it('should register providers with explicit config', async () => {
    class CustomService {
      getName() {
        return 'custom';
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'myService',
          useClass: CustomService,
          scope: 'SINGLETON',
        },
      ],
    });

    const { container } = await bootstrap(module);

    expect(container.cradle).toHaveProperty('myService');
    const service = container.cradle.myService as CustomService;
    expect(service.getName()).toBe('custom');
  });

  it('should register value providers', async () => {
    const config = { apiKey: 'test-key', url: 'https://api.test.com' };

    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'config',
          useValue: config,
        },
      ],
    });

    const { container } = await bootstrap(module);

    expect(container.cradle).toHaveProperty('config');
    expect(container.cradle.config).toBe(config);
  });

  it('should register factory providers', async () => {
    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'timestamp',
          useFactory: () => Date.now(),
        },
      ],
    });

    const { container } = await bootstrap(module);

    expect(container.cradle).toHaveProperty('timestamp');
    expect(typeof container.cradle.timestamp).toBe('number');
  });

  it('should handle module imports', async () => {
    class CommonService {
      getValue() {
        return 'common';
      }
    }

    class AuthService {
      constructor({ commonService }: { commonService: CommonService }) {
        this.commonService = commonService;
      }
      commonService: CommonService;
    }

    const CommonModule = defineModule({
      name: 'common',
      providers: [CommonService],
      exports: [CommonService],
    });

    const AuthModule = defineModule({
      name: 'auth',
      providers: [AuthService],
      imports: [CommonModule],
    });

    const { container } = await bootstrap(AuthModule);

    expect(container.cradle).toHaveProperty('commonService');
    expect(container.cradle).toHaveProperty('authService');

    const authService = container.cradle.authService as AuthService;
    expect(authService.commonService.getValue()).toBe('common');
  });

  it('should detect circular dependencies', async () => {
    const ModuleA = defineModule({
      name: 'a',
      imports: [] as ModuleConfig[], // Will be set after ModuleB is defined
    });

    const ModuleB = defineModule({
      name: 'b',
      imports: [ModuleA],
    });

    // Create circular reference
    ModuleA.imports = [ModuleB];

    await expect(bootstrap(ModuleA)).rejects.toThrow('Circular dependency detected');
  });

  it('should mount routes when basePath is provided', async () => {
    const mockRouteFactory = vi.fn();

    const module = defineModule({
      name: 'auth',
      basePath: 'auth',
      providers: [],
      routes: mockRouteFactory,
    });

    const { app } = await bootstrap(module);

    expect(mockRouteFactory).toHaveBeenCalled();
    expect(app).toBeDefined();
  });

  it('should not mount routes when basePath is missing', async () => {
    const mockRouteFactory = vi.fn();

    const module = defineModule({
      name: 'test',
      providers: [],
      routes: mockRouteFactory,
    });

    await bootstrap(module);

    expect(mockRouteFactory).not.toHaveBeenCalled();
  });

  it('should pass services to route factory', async () => {
    class TestService {
      getValue() {
        return 'test';
      }
    }

    let capturedServices: Record<string, unknown> = {};
    const mockRouteFactory = vi.fn((_, services) => {
      capturedServices = services;
    });

    const module = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [TestService],
      routes: mockRouteFactory,
    });

    await bootstrap(module);

    expect(mockRouteFactory).toHaveBeenCalled();
    expect(capturedServices).toHaveProperty('testService');
  });

  it('should support custom API base path', async () => {
    const module = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: vi.fn(),
    });

    const { app } = await bootstrap(module, { apiBasePath: '/v1' });

    expect(app).toBeDefined();
  });

  it('should handle debug mode', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    class TestService {}

    const module = defineModule({
      name: 'test',
      providers: [TestService],
    });

    bootstrap(module, { debug: true });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should flatten nested module imports', async () => {
    class ServiceA {}
    class ServiceB {}
    class ServiceC {}

    const ModuleC = defineModule({
      name: 'c',
      providers: [ServiceC],
    });

    const ModuleB = defineModule({
      name: 'b',
      providers: [ServiceB],
      imports: [ModuleC],
    });

    const ModuleA = defineModule({
      name: 'a',
      providers: [ServiceA],
      imports: [ModuleB],
    });

    const { container } = await bootstrap(ModuleA);

    expect(container.cradle).toHaveProperty('serviceA');
    expect(container.cradle).toHaveProperty('serviceB');
    expect(container.cradle).toHaveProperty('serviceC');
  });

  it('should handle multiple imports correctly', async () => {
    class ServiceA {}
    class ServiceB {}
    class ServiceC {}

    const ModuleA = defineModule({
      name: 'a',
      providers: [ServiceA],
    });

    const ModuleB = defineModule({
      name: 'b',
      providers: [ServiceB],
    });

    const ModuleC = defineModule({
      name: 'c',
      providers: [ServiceC],
      imports: [ModuleA, ModuleB],
    });

    const { container } = await bootstrap(ModuleC);

    expect(container.cradle).toHaveProperty('serviceA');
    expect(container.cradle).toHaveProperty('serviceB');
    expect(container.cradle).toHaveProperty('serviceC');
  });

  it('should support different service scopes', async () => {
    class SingletonService {}
    class ScopedService {}
    class TransientService {}

    const module = defineModule({
      name: 'test',
      providers: [
        { provide: SingletonService, useClass: SingletonService, scope: 'SINGLETON' },
        { provide: ScopedService, useClass: ScopedService, scope: 'SCOPED' },
        { provide: TransientService, useClass: TransientService, scope: 'TRANSIENT' },
      ],
    });

    const { container } = await bootstrap(module);

    expect(container.cradle).toHaveProperty('singletonService');
    expect(container.cradle).toHaveProperty('scopedService');
    expect(container.cradle).toHaveProperty('transientService');
  });

  it('should expose container for direct access', async () => {
    class TestService {
      getData() {
        return { value: 42 };
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [TestService],
    });

    const { container } = await bootstrap(module);

    // Container should be fully accessible
    expect(container.resolve).toBeDefined();
    expect(container.register).toBeDefined();
    expect(container.cradle).toBeDefined();

    // Should be able to use container directly
    const service = container.resolve('testService') as TestService;
    expect(service.getData().value).toBe(42);
  });

  it('should handle empty modules', async () => {
    const module = defineModule({
      name: 'empty',
      providers: [],
    });

    const { app, container } = await bootstrap(module);

    expect(app).toBeDefined();
    expect(container).toBeDefined();
  });

  it('should handle modules without routes', async () => {
    class UtilService {
      add(a: number, b: number) {
        return a + b;
      }
    }

    const module = defineModule({
      name: 'utils',
      providers: [UtilService],
    });

    const { container } = await bootstrap(module);

    const service = container.cradle.utilService as UtilService;
    expect(service.add(2, 3)).toBe(5);
  });

  it('should support provider naming conventions', async () => {
    class MyAwesomeService {
      test() {
        return true;
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [MyAwesomeService],
    });

    const { container } = await bootstrap(module);

    // Should convert PascalCase to camelCase
    expect(container.cradle).toHaveProperty('myAwesomeService');
    const service = container.cradle.myAwesomeService as MyAwesomeService;
    expect(service.test()).toBe(true);
  });

  it('should throw error for invalid provider configuration', async () => {
    const module = defineModule({
      name: 'test',
      providers: [
        // @ts-expect-error - Testing runtime validation with invalid provider config
        { invalidKey: 'value' },
      ],
    });

    await expect(bootstrap(module)).rejects.toThrow(
      'Invalid provider configuration in module "test"'
    );
  });

  it('should support factory providers with inject option', async () => {
    class ConfigService {
      getValue(key: string) {
        return `${key}-value`;
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [
        ConfigService,
        {
          provide: 'appSettings',
          useFactory: ({ configService }: { configService: ConfigService }) => ({
            apiUrl: configService.getValue('apiUrl'),
            timeout: 5000,
          }),
          inject: ['configService'],
          scope: 'SINGLETON',
        },
      ],
    });

    const { container } = await bootstrap(module);

    expect(container.cradle).toHaveProperty('appSettings');
    const settings = container.cradle.appSettings as { apiUrl: string; timeout: number };
    expect(settings.apiUrl).toBe('apiUrl-value');
    expect(settings.timeout).toBe(5000);
  });

  it('should provide Constructor class to useClass provider with provide as class', async () => {
    class MyService {
      getValue() {
        return 'my-value';
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: MyService,
          useClass: MyService,
          scope: 'SINGLETON',
        },
      ],
    });

    const { container } = await bootstrap(module);

    expect(container.cradle).toHaveProperty('myService');
    const service = container.cradle.myService as MyService;
    expect(service.getValue()).toBe('my-value');
  });
});

describe('bootstrap environment detection', async () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should detect production environment from NODE_ENV', async () => {
    process.env.NODE_ENV = 'production';

    // Re-import to get fresh module with new env
    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    // Bootstrap without explicit environment to test detection
    const { app } = await freshBootstrap(module);
    expect(app).toBeDefined();
  });

  it('should detect production environment from AWS_LAMBDA_FUNCTION_NAME', async () => {
    delete process.env.NODE_ENV;
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'my-lambda-function';

    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await freshBootstrap(module);
    expect(app).toBeDefined();
  });

  it('should detect production environment from LAMBDA_TASK_ROOT', async () => {
    delete process.env.NODE_ENV;
    process.env.LAMBDA_TASK_ROOT = '/var/task';

    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await freshBootstrap(module);
    expect(app).toBeDefined();
  });

  it('should apply secure headers in production environment', async () => {
    process.env.NODE_ENV = 'production';

    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await freshBootstrap(module, {
      debug: true,
      // Don't pass environment to use auto-detection
    });

    expect(app).toBeDefined();
    // Verify secure headers were applied (appears in debug logs)
    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('secure headers');

    consoleSpy.mockRestore();
  });

  it('should not apply secure headers when explicitly disabled in production', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const module = defineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await bootstrap(module, {
      debug: true,
      environment: 'production',
      middleware: {
        secureHeaders: false,
      },
    });

    expect(app).toBeDefined();
    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).not.toContain('Applying secure headers');

    consoleSpy.mockRestore();
  });

  it('should detect test environment from NODE_ENV', async () => {
    process.env.NODE_ENV = 'test';

    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await freshBootstrap(module);
    expect(app).toBeDefined();
  });

  it('should default to development when no environment indicators', async () => {
    delete process.env.NODE_ENV;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.LAMBDA_TASK_ROOT;

    const { bootstrap: freshBootstrap } = await import('../../src/core/bootstrap.js');
    const { defineModule: freshDefineModule } = await import('../../src/core/module.js');

    const module = freshDefineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await freshBootstrap(module);
    expect(app).toBeDefined();
  });

  it('should handle modules without providers property', async () => {
    const module = defineModule({
      name: 'no-providers',
    } as ModuleConfig);

    const { container } = await bootstrap(module);
    expect(container).toBeDefined();
  });

  it('should disable error handler when set to false', async () => {
    const module = defineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await bootstrap(module, {
      errorHandler: false,
    });

    expect(app).toBeDefined();
  });
});

describe('bootstrap exception tracking', () => {
  it('should create custom error handler with exception tracking', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mockTracker: ExceptionTracker = {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      setUser: vi.fn(),
      setContext: vi.fn(),
    };

    const module = defineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await bootstrap(module, {
      debug: true,
      exceptionTracking: {
        tracker: mockTracker,
      },
    });

    expect(app).toBeDefined();
    // Verify exception tracking was configured (appears in debug logs)
    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('exception tracking');

    consoleSpy.mockRestore();
  });

  it('should use custom trackStatusCodes with exception tracking', async () => {
    const mockTracker: ExceptionTracker = {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      setUser: vi.fn(),
      setContext: vi.fn(),
    };

    const module = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router) => {
        router.get('/error', () => {
          throw new Error('Test error');
        });
      },
    });

    const { app } = await bootstrap(module, {
      exceptionTracking: {
        tracker: mockTracker,
        trackStatusCodes: (status) => status >= 400,
      },
    });

    // Make a request that throws an error
    await app.request('/api/test/error');

    expect(mockTracker.captureException).toHaveBeenCalled();
  });
});

describe('bootstrap logging', () => {
  it('should apply Pino logger with request context middleware', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mockPino: PinoLogger = {
      level: 'info',
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => mockPino),
    };

    const module = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router) => {
        router.get('/hello', (c) => c.json({ message: 'Hello' }));
      },
    });

    const { app } = await bootstrap(module, {
      debug: true,
      logger: {
        pino: mockPino,
      },
    });

    // Verify Pino logger was configured
    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('Pino logger');
    expect(calls).toContain('AsyncLocalStorage');

    // Make a request to verify middleware is working
    const res = await app.request('/api/test/hello');
    expect(res.status).toBe(200);

    // Pino HTTP middleware should have logged
    expect(mockPino.info).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should disable logging when enabled is false', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const module = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router) => {
        router.get('/hello', (c) => c.json({ message: 'Hello' }));
      },
    });

    const { app } = await bootstrap(module, {
      debug: true,
      logger: {
        enabled: false,
      },
    });

    // Verify logging was NOT applied (no mention of logger in debug output)
    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).not.toContain('Applying built-in logger');
    expect(calls).not.toContain('Pino logger');

    // Make a request
    const res = await app.request('/api/test/hello');
    expect(res.status).toBe(200);

    consoleSpy.mockRestore();
  });
});
