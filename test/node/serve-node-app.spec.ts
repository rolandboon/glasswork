import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { OnModuleDestroy, OnServerStart } from '../../src/core/types.js';
import { serveNodeApp } from '../../src/node/serve-node-app.js';

describe('serveNodeApp', () => {
  it('starts node server, invokes attachServer on bootstrapResult, and closes cleanly', async () => {
    const serverStartSpy = vi.fn();
    const destroySpy = vi.fn();

    class ServerService implements OnServerStart, OnModuleDestroy {
      onServerStart(server: unknown) {
        serverStartSpy(server);
      }
      onModuleDestroy() {
        destroySpy();
      }
    }

    const TestModule = defineModule({
      name: 'test',
      providers: [ServerService],
    });

    const bootstrapResult = await bootstrap(TestModule, { environment: 'test' });

    const listenSpy = vi.fn();
    const { server, close } = serveNodeApp(bootstrapResult, {
      port: 0, // random free port
      handleShutdown: false,
      onListen: listenSpy,
    });

    expect(server).toBeDefined();

    // Give microtasks a tick for attachServer promise to run
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(serverStartSpy).toHaveBeenCalledTimes(1);

    await close();
    // Test idempotency of close
    await close();

    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('handles SIGINT signal for graceful shutdown when handleShutdown is true', async () => {
    const destroySpy = vi.fn();
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as unknown as (
        code?: string | number | null | undefined
      ) => never);

    class ServerService implements OnModuleDestroy {
      onModuleDestroy() {
        destroySpy();
      }
    }

    const TestModule = defineModule({
      name: 'test',
      providers: [ServerService],
    });

    const bootstrapResult = await bootstrap(TestModule, { environment: 'test' });

    const { server } = serveNodeApp(bootstrapResult, {
      port: 0,
      handleShutdown: true,
    });

    expect(server).toBeDefined();

    // Trigger SIGINT signal
    process.emit('SIGINT');

    // Give microtasks time to execute signal handler
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
  });
});
