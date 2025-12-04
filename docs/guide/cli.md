---
outline: deep
---

# Glasswork CLI

The Glasswork CLI orchestrates the common build and dev tasks for a project: compiling email templates, bundling your Lambda entrypoints, and generating deployment artifacts. It loads `glasswork.config.*` (TS/JS/MJS/CJS/JSON/YAML) via `defineConfig`, so everything stays type-safe.

## Quick start

1. Install Glasswork (and MJML if you compile emails):

```bash
npm install glasswork mjml --save-dev
```

2. Create `glasswork.config.ts`:

```ts
import { defineConfig } from 'glasswork';

export default defineConfig({
  name: 'my-api',
  build: {
    entrypoint: './src/server.ts',
    outDir: './dist',
    outFile: 'api.mjs',
  },
  email: {
    templates: {
      sourceDir: './src/email/templates',
      outputDir: './src/email/compiled',
    },
  },
  jobs: {
    workerEntrypoint: './src/worker.ts',
  },
  infrastructure: {
    api: { type: 'function-url', cors: true },
    queues: { default: { visibilityTimeout: 300 } },
    tables: { rateLimit: { ttl: 'expiresAt' } },
  },
});
```

3. Add scripts:

```jsonc
{
  "scripts": {
    "dev": "glasswork dev",
    "build": "glasswork build",
    "sam": "glasswork generate sam"
  }
}
```

Run `npx glasswork build` or the scripts above.

## Commands

- `glasswork build [--analyze]`
  - Phases: compile MJML templates (if configured) → bundle API entrypoint with esbuild → bundle worker (when `jobs.workerEntrypoint` exists) → generate a SAM template (`infrastructure.samOutput`, defaults to `template.yaml`).
  - Hooks: `hooks['build:before']` and `hooks['build:after']({ duration })`.

- `glasswork dev [--port 3000] [--lambda]`
  - Starts `tsx watch` on your API entrypoint, recompiles email templates on change, and exposes `PORT`.
  - `--lambda` sets `GLASSWORK_LAMBDA_MODE=true` for Lambda-like dev contexts.

- `glasswork generate sam [--output template.yaml]`
  - Writes a SAM template that includes API function URLs or HttpApi, SQS queues/DLQs, DynamoDB tables, and optional static-site + CloudFront when configured.

## Configuration defaults

- `build.outFile`: `api.mjs`
- `build.outDir`: `dist`
- `build.target`: `node22`
- `build.minify`: `true`
- `build.sourcemap`: `false`
- `jobs.workerOutFile`: `worker.mjs`
- `lambda`: `runtime=nodejs22.x`, `architecture=arm64`, `memory=512`, `timeout=30`, `environment={}`, `layers=[]`
- `infrastructure.samOutput`: `template.yaml`

All relative paths in `glasswork.config.*` are resolved from the config file’s directory, so monorepo packages stay isolated.

## Build hooks

Add simple lifecycle hooks for pre/post build work:

```ts
export default defineConfig({
  // ...
  hooks: {
    'build:before': async () => console.log('Starting build...'),
    'build:after': async ({ duration }) => console.log(`Built in ${duration}ms`),
  },
});
```

## Notes

- Email compilation requires `mjml` installed in your project.
- The CLI ships inside the `glasswork` package; no separate install is needed.
- Generated SAM templates target the outputs from your build config (e.g., `dist/api.mjs`), so keep `outDir`/`outFile` in sync with your Lambda handler expectations.
