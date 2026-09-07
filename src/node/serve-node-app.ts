import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import type { BootstrapResult } from '../core/types.js';
import type { ServeNodeAppOptions, ServeNodeAppResult } from './types.js';

/**
 * Starts a standalone Node.js HTTP server for a bootstrapped Glasswork application.
 *
 * Features:
 * - Binds the Hono application's request handler to a Node.js HTTP server
 * - Automatically triggers `onServerStart` lifecycle hooks on all registered services (e.g. `WebSocketGateway`)
 * - Provides automatic graceful shutdown on `SIGINT` / `SIGTERM` (runs all `onModuleDestroy` hooks)
 *
 * @example
 * ```typescript
 * import { bootstrap } from 'glasswork';
 * import { serveNodeApp } from 'glasswork/node';
 * import { AppModule } from './app.module';
 *
 * const app = await bootstrap(AppModule);
 * serveNodeApp(app, { port: 3000 });
 * ```
 */
export function serveNodeApp(
  bootstrapResult: BootstrapResult,
  options: ServeNodeAppOptions = {}
): ServeNodeAppResult {
  const port = options.port ?? 3000;

  const server = serve(
    {
      fetch: bootstrapResult.app.fetch,
      port,
      hostname: options.hostname,
    },
    options.onListen
  ) as unknown as Server;

  // Execute all onServerStart lifecycle hooks (e.g. WebSocketGateway auto-attaching)
  void bootstrapResult.attachServer(server);

  let isClosing = false;

  const close = async (): Promise<void> => {
    if (isClosing) return;
    isClosing = true;

    try {
      await bootstrapResult.stop();
    } catch {
      // ignore errors during application shutdown
    }

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  if (options.handleShutdown !== false) {
    const handleSignal = async (_signal: string) => {
      process.removeListener('SIGINT', handleSignal);
      process.removeListener('SIGTERM', handleSignal);
      try {
        await close();
        process.exit(0);
      } catch {
        process.exit(1);
      }
    };

    process.once('SIGINT', () => handleSignal('SIGINT'));
    process.once('SIGTERM', () => handleSignal('SIGTERM'));
  }

  return { server, close };
}
