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
});
