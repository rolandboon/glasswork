import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { ModuleConfig } from '../../src/core/types.js';

describe('bootstrap', () => {
  it('should create Hono app and Awilix container', () => {
    const module = defineModule({
      name: 'test',
      providers: [],
    });

    const { app, container } = bootstrap(module);

    expect(app).toBeDefined();
    expect(container).toBeDefined();
    expect(container.cradle).toBeDefined();
  });

  it('should register simple class providers', () => {
    class TestService {
      getValue() {
        return 'test';
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [TestService],
    });

    const { container } = bootstrap(module);

    expect(container.cradle).toHaveProperty('testService');
    const service = container.cradle.testService as TestService;
    expect(service.getValue()).toBe('test');
  });

  it('should register providers with explicit config', () => {
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

    const { container } = bootstrap(module);

    expect(container.cradle).toHaveProperty('myService');
    const service = container.cradle.myService as CustomService;
    expect(service.getName()).toBe('custom');
  });

  it('should register value providers', () => {
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

    const { container } = bootstrap(module);

    expect(container.cradle).toHaveProperty('config');
    expect(container.cradle.config).toBe(config);
  });

  it('should register factory providers', () => {
    const module = defineModule({
      name: 'test',
      providers: [
        {
          provide: 'timestamp',
          useFactory: () => Date.now(),
        },
      ],
    });

    const { container } = bootstrap(module);

    expect(container.cradle).toHaveProperty('timestamp');
    expect(typeof container.cradle.timestamp).toBe('number');
  });

  it('should handle module imports', () => {
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

    const { container } = bootstrap(AuthModule);

    expect(container.cradle).toHaveProperty('commonService');
    expect(container.cradle).toHaveProperty('authService');

    const authService = container.cradle.authService as AuthService;
    expect(authService.commonService.getValue()).toBe('common');
  });

  it('should detect circular dependencies', () => {
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

    expect(() => bootstrap(ModuleA)).toThrow('Circular dependency detected');
  });

  it('should mount routes when basePath is provided', () => {
    const mockRouteFactory = vi.fn();

    const module = defineModule({
      name: 'auth',
      basePath: 'auth',
      providers: [],
      routes: mockRouteFactory,
    });

    const { app } = bootstrap(module);

    expect(mockRouteFactory).toHaveBeenCalled();
    expect(app).toBeDefined();
  });

  it('should not mount routes when basePath is missing', () => {
    const mockRouteFactory = vi.fn();

    const module = defineModule({
      name: 'test',
      providers: [],
      routes: mockRouteFactory,
    });

    bootstrap(module);

    expect(mockRouteFactory).not.toHaveBeenCalled();
  });

  it('should pass services to route factory', () => {
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

    bootstrap(module);

    expect(mockRouteFactory).toHaveBeenCalled();
    expect(capturedServices).toHaveProperty('testService');
  });

  it('should support custom API base path', () => {
    const module = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: vi.fn(),
    });

    const { app } = bootstrap(module, { apiBasePath: '/v1' });

    expect(app).toBeDefined();
  });

  it('should handle debug mode', () => {
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

  it('should flatten nested module imports', () => {
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

    const { container } = bootstrap(ModuleA);

    expect(container.cradle).toHaveProperty('serviceA');
    expect(container.cradle).toHaveProperty('serviceB');
    expect(container.cradle).toHaveProperty('serviceC');
  });

  it('should handle multiple imports correctly', () => {
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

    const { container } = bootstrap(ModuleC);

    expect(container.cradle).toHaveProperty('serviceA');
    expect(container.cradle).toHaveProperty('serviceB');
    expect(container.cradle).toHaveProperty('serviceC');
  });

  it('should support different service scopes', () => {
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

    const { container } = bootstrap(module);

    expect(container.cradle).toHaveProperty('singletonService');
    expect(container.cradle).toHaveProperty('scopedService');
    expect(container.cradle).toHaveProperty('transientService');
  });

  it('should expose container for direct access', () => {
    class TestService {
      getData() {
        return { value: 42 };
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [TestService],
    });

    const { container } = bootstrap(module);

    // Container should be fully accessible
    expect(container.resolve).toBeDefined();
    expect(container.register).toBeDefined();
    expect(container.cradle).toBeDefined();

    // Should be able to use container directly
    const service = container.resolve('testService') as TestService;
    expect(service.getData().value).toBe(42);
  });

  it('should handle empty modules', () => {
    const module = defineModule({
      name: 'empty',
      providers: [],
    });

    const { app, container } = bootstrap(module);

    expect(app).toBeDefined();
    expect(container).toBeDefined();
  });

  it('should handle modules without routes', () => {
    class UtilService {
      add(a: number, b: number) {
        return a + b;
      }
    }

    const module = defineModule({
      name: 'utils',
      providers: [UtilService],
    });

    const { container } = bootstrap(module);

    const service = container.cradle.utilService as UtilService;
    expect(service.add(2, 3)).toBe(5);
  });

  it('should support provider naming conventions', () => {
    class MyAwesomeService {
      test() {
        return true;
      }
    }

    const module = defineModule({
      name: 'test',
      providers: [MyAwesomeService],
    });

    const { container } = bootstrap(module);

    // Should convert PascalCase to camelCase
    expect(container.cradle).toHaveProperty('myAwesomeService');
    const service = container.cradle.myAwesomeService as MyAwesomeService;
    expect(service.test()).toBe(true);
  });
});
