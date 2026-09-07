import type { Server } from 'node:http';

/**
 * Configuration options for `serveNodeApp`.
 */
export interface ServeNodeAppOptions {
  /**
   * Port number to bind and listen on.
   * @default 3000
   */
  port?: number;

  /**
   * Hostname or IP address to bind to.
   * @default undefined (all interfaces)
   */
  hostname?: string;

  /**
   * Callback invoked once the server starts listening.
   */
  onListen?: (info: { port: number; address: string }) => void;

  /**
   * Automatically intercept SIGINT / SIGTERM signals for graceful shutdown.
   * @default true
   */
  handleShutdown?: boolean;
}

/**
 * Handle returned by `serveNodeApp`.
 */
export interface ServeNodeAppResult {
  /**
   * The underlying Node.js HTTP server instance.
   */
  server: Server;

  /**
   * Gracefully stop the application, closing the HTTP server and running all `onModuleDestroy` hooks.
   */
  close: () => Promise<void>;
}
