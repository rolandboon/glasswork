---
description: Running a Glasswork application as a long-running Node.js server, for containers and hosts other than Lambda.
---

# Node.js Server

A Glasswork application is a Hono app, so it runs on any Node.js server that Hono supports. For a long-running process, such as a container, `serveNode()` from `glasswork/node` serves it with `@hono/node-server` (install it alongside Glasswork) and stops it in order:

```typescript
// src/server.ts
import { bootstrap } from 'glasswork/core';
import { serveNode } from 'glasswork/node';
import { AppModule } from './app.module.js';

const { app, stop } = await bootstrap(AppModule);

serveNode({
  fetch: app.fetch,
  stop,
  drain: [() => relayLoop.stop(), () => events.close()],
  shutdownTimeoutMs: 25_000,
  stopTimeoutMs: 5_000,
});
```

`bootstrap()` runs the `onModuleInit` hooks before it returns. `serveNode()` listens on `PORT` (3000 by default) and answers two health paths before the application sees the request: `/health/live` always answers 200, `/health/ready` answers 200 while the server accepts work and 503 once shutdown began.

## Shutdown

On `SIGTERM` or `SIGINT`, `serveNode()` runs these steps:

| Step | What happens | Bounded by |
| --- | --- | --- |
| 1. Not ready | `/health/ready` answers 503; a request that arrives on an open connection gets 503 with `Connection: close` | Immediate |
| 2. No new connections | The server stops listening and closes idle keep-alive connections | Immediate |
| 3. Drain | The `drain` steps run in parallel: stop claiming jobs, stop an outbox relay, close server-sent event streams with `SseBroadcaster.close()` | `shutdownTimeoutMs` |
| 4. In-flight requests | Running requests finish; their responses close the connection | `shutdownTimeoutMs` |
| 5. Deadline | Connections still open after `shutdownTimeoutMs` are closed, which is logged and counted as a failure | |
| 6. Stop | `stop()` runs the destroy hooks and disposers once and flushes the exception tracker | `stopTimeoutMs` for all cleanup; `exceptionTracking.flushTimeoutMs` additionally bounds the flush |
| 7. Exit | Exit code 0 when everything finished in time, 1 when a drain step or `stop()` failed or the deadline passed | |

A second signal during shutdown exits at once with code 1. Failures are logged, so a non-zero exit always has a log line that explains it.

Each resource is closed by its owner, once:

| Resource | Owner | Closed in |
| --- | --- | --- |
| Listening socket and connections | `serveNode()` | Steps 2 and 5 |
| Server-sent event streams | Your `SseBroadcaster`, through a drain step | Step 3; `stop()` closes any left |
| Job consumers and relay loops | Your process, through a drain step | Step 3 |
| Providers, database pools, clients created by factories | The application, through `stop()` | Step 6 |
| Clients passed in with `useValue` or `providerOverrides` | Whoever created them | After `stop()`, in your own code |

Choose `shutdownTimeoutMs + stopTimeoutMs` below the platform's grace period, leaving a margin for process exit. Cleanup that exceeds `stopTimeoutMs` is logged and exits with code 1; the timeout cannot cancel a provider's own asynchronous operation. For example, Kubernetes and ECS send `SIGKILL` 30 seconds after `SIGTERM` by default, and `docker stop` after 10 seconds unless you pass `--time`. Behind a load balancer, keep the readiness probe on `/health/ready` so traffic stops before the process closes its listener.

To stop programmatically, for example in tests, call `shutdown()`, which removes this server’s signal listeners and resolves with the exit code without exiting the process. Pass `signals: false` to register no listeners. After a timeout, the caller must terminate the process to stop any uncooperative resource.

## Container

```dockerfile
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY bundle/ ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=2s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/ready" || exit 1
# Exec form: node runs as PID 1 and receives SIGTERM from `docker stop` itself.
CMD ["node", "server.mjs"]
```

Use the exec form of `CMD`, not a shell or `npm start`, so the signal reaches Node.js. The [reference consumer](https://github.com/rolandboon/glasswork/tree/main/fixtures/reference-consumer) builds this image in CI, runs it against PostgreSQL, checks readiness and the health check, stops it with `docker stop` and expects exit code 0. Its process tests also check that a request in flight during `SIGTERM` finishes, that new connections are refused, and that a request outlasting a short deadline is cut off with exit code 1.

## Bundling

Bundle the server with the same esbuild settings as a [Lambda function](./lambda#esbuild-configuration): `format: 'esm'`, `keepNames: true` for class providers, and the `createRequire` banner for CommonJS dependencies. Keep `@aws-sdk/*` external and install the AWS clients your application uses as regular dependencies of the deployed package, or leave them out when you do not use them.

```typescript
await esbuild.build({
  entryPoints: { server: 'src/server.ts' },
  outdir: 'dist',
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  minify: true,
  keepNames: true,
  external: ['@aws-sdk/*'],
  outExtension: { '.js': '.mjs' },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
```

Run it with `node dist/server.mjs`. Deployment, process supervision, health checks and scaling stay with your platform.
