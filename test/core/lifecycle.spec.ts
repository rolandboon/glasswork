import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { OnModuleDestroy, OnModuleInit } from '../../src/core/types.js';

describe('Lifecycle Hooks', () => {
  it('should execute onModuleInit when application starts', async () => {
    const initSpy = vi.fn();

    class TestService implements OnModuleInit {
      onModuleInit() {
        initSpy();
      }
    }

    const TestModule = defineModule({
      name: 'test',
      providers: [TestService],
    });

    const { start } = await bootstrap(TestModule, { environment: 'test' });

    // Should not be called yet (test env doesn't auto-start)
    expect(initSpy).not.toHaveBeenCalled();

    await start();

    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it('should execute onModuleDestroy when application stops', async () => {
    const destroySpy = vi.fn();

    class TestService implements OnModuleDestroy {
      onModuleDestroy() {
        destroySpy();
      }
    }

    const TestModule = defineModule({
      name: 'test',
      providers: [TestService],
    });

    const { stop } = await bootstrap(TestModule, { environment: 'test' });

    await stop();

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('should handle async hooks', async () => {
    const initSpy = vi.fn();
    const destroySpy = vi.fn();

    class AsyncService implements OnModuleInit, OnModuleDestroy {
      async onModuleInit() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        initSpy();
      }

      async onModuleDestroy() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        destroySpy();
      }
    }

    const TestModule = defineModule({
      name: 'test',
      providers: [AsyncService],
    });

    const { start, stop } = await bootstrap(TestModule, { environment: 'test' });

    await start();
    expect(initSpy).toHaveBeenCalledTimes(1);

    await stop();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('should execute hooks in parallel', async () => {
    const order: string[] = [];

    class ServiceA implements OnModuleInit {
      async onModuleInit() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('A');
      }
    }

    class ServiceB implements OnModuleInit {
      async onModuleInit() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push('B');
      }
    }

    const TestModule = defineModule({
      name: 'test',
      providers: [ServiceA, ServiceB],
    });

    const { start } = await bootstrap(TestModule, { environment: 'test' });

    await start();

    // B should finish before A because it's faster
    expect(order).toEqual(['B', 'A']);
  });

  it('should fail fast when a hook throws an error', async () => {
    class FailingService implements OnModuleInit {
      onModuleInit() {
        throw new Error('Initialization failed');
      }
    }

    const TestModule = defineModule({
      name: 'test',
      providers: [FailingService],
    });

    const { start } = await bootstrap(TestModule, { environment: 'test' });

    await expect(start()).rejects.toThrow('Initialization failed');
  });

  it('should handle services without hooks gracefully', async () => {
    const spy = vi.fn();

    class ServiceWithHook implements OnModuleInit {
      onModuleInit() {
        spy();
      }
    }

    class ServiceWithoutHook {
      doSomething() {
        return 'no hook';
      }
    }

    const TestModule = defineModule({
      name: 'test',
      providers: [ServiceWithHook, ServiceWithoutHook],
    });

    const { start } = await bootstrap(TestModule, { environment: 'test' });

    await start();

    // Should only execute hook for ServiceWithHook
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should be idempotent when start is called multiple times', async () => {
    const spy = vi.fn();

    class TestService implements OnModuleInit {
      onModuleInit() {
        spy();
      }
    }

    const TestModule = defineModule({
      name: 'test',
      providers: [TestService],
    });

    const { start } = await bootstrap(TestModule, { environment: 'test' });

    await start();
    await start(); // Second call
    await start(); // Third call

    // Should only execute once due to idempotency
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should be idempotent when stop is called multiple times', async () => {
    const spy = vi.fn();

    class TestService implements OnModuleDestroy {
      onModuleDestroy() {
        spy();
      }
    }

    const TestModule = defineModule({
      name: 'test',
      providers: [TestService],
    });

    const { stop } = await bootstrap(TestModule, { environment: 'test' });

    await stop();
    await stop(); // Second call
    await stop(); // Third call

    // Should only execute once due to idempotency
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should not instantiate scoped or transient providers for hooks', async () => {
    const factory = vi.fn(() => ({ onModuleInit: vi.fn() }));

    const TestModule = defineModule({
      name: 'test',
      providers: [
        { provide: 'scoped', scope: 'SCOPED', useFactory: factory },
        { provide: 'transient', scope: 'TRANSIENT', useFactory: factory },
      ],
    });

    const { start } = await bootstrap(TestModule, { environment: 'test' });
    await start();

    expect(factory).not.toHaveBeenCalled();
  });

  describe('start and stop state', () => {
    function deferred() {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    async function bootstrapWith(hooks: {
      onModuleInit?: () => unknown;
      onModuleDestroy?: () => unknown;
    }) {
      class HookedService {
        onModuleInit() {
          return hooks.onModuleInit?.();
        }
        onModuleDestroy() {
          return hooks.onModuleDestroy?.();
        }
      }
      return bootstrap(defineModule({ name: 'test', providers: [HookedService] }), {
        environment: 'test',
      });
    }

    it('resolves concurrent starts only after initialization has finished', async () => {
      const init = deferred();
      const onModuleInit = vi.fn(() => init.promise);
      const { start } = await bootstrapWith({ onModuleInit });
      const settled: string[] = [];

      const first = start().then(() => settled.push('first'));
      const second = start().then(() => settled.push('second'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toEqual([]);

      init.resolve();
      await Promise.all([first, second]);
      expect(settled).toEqual(['first', 'second']);
      expect(onModuleInit).toHaveBeenCalledTimes(1);
    });

    it('keeps rejecting with the original error after a failed start', async () => {
      const failure = new Error('Initialization failed');
      const onModuleInit = vi.fn(() => {
        throw failure;
      });
      const { start } = await bootstrapWith({ onModuleInit });

      await expect(start()).rejects.toBe(failure);
      await expect(start()).rejects.toBe(failure);
      expect(onModuleInit).toHaveBeenCalledTimes(1);
    });

    it('shares one completion between concurrent stops', async () => {
      const destroy = deferred();
      const onModuleDestroy = vi.fn(() => destroy.promise);
      const { stop } = await bootstrapWith({ onModuleDestroy });
      let stopped = false;

      const first = stop();
      const second = stop().then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(stopped).toBe(false);

      destroy.resolve();
      await Promise.all([first, second]);
      expect(onModuleDestroy).toHaveBeenCalledTimes(1);
    });

    it('stops after a pending start has finished', async () => {
      const init = deferred();
      const order: string[] = [];
      const { start, stop } = await bootstrapWith({
        onModuleInit: async () => {
          await init.promise;
          order.push('init');
        },
        onModuleDestroy: () => order.push('destroy'),
      });

      const starting = start();
      const stopping = stop();
      init.resolve();
      await Promise.all([starting, stopping]);

      expect(order).toEqual(['init', 'destroy']);
    });

    it('runs destroy hooks after a failed start', async () => {
      const onModuleDestroy = vi.fn();
      const { start, stop } = await bootstrapWith({
        onModuleInit: () => {
          throw new Error('Initialization failed');
        },
        onModuleDestroy,
      });

      await expect(start()).rejects.toThrow('Initialization failed');
      await stop();
      expect(onModuleDestroy).toHaveBeenCalledTimes(1);
    });

    it('rejects a start after stop', async () => {
      const onModuleInit = vi.fn();
      const { start, stop } = await bootstrapWith({ onModuleInit });

      await stop();
      await expect(start()).rejects.toThrow('stopped and cannot start again');
      expect(onModuleInit).not.toHaveBeenCalled();
    });
  });
});
