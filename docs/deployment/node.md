---
description: Running a Glasswork application as a long-running Node.js server, for containers and hosts other than Lambda.
---

# Node.js Server

A Glasswork application is a Hono app, so it runs on any Node.js server that Hono supports. Use `@hono/node-server` for a long-running process, for example in a container:

```typescript
// src/server.ts
import { serve } from '@hono/node-server';
import { bootstrap } from 'glasswork/core';
import { AppModule } from './app.module.js';

const { app, stop } = await bootstrap(AppModule);

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });

process.once('SIGTERM', () => {
  // Stop accepting connections, let open requests finish, then release providers.
  server.close(async () => {
    await stop();
    process.exit(0);
  });
});
```

`bootstrap()` runs the `onModuleInit` hooks before it returns. `stop()` runs the `onModuleDestroy` hooks and the providers' disposers, so database pools and other clients close before the process exits.

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
