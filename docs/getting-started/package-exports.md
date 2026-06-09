---
description: Glasswork 1.0 package exports — subpath imports for core, HTTP, and optional subsystems.
---

# Package Exports

Glasswork 1.0 splits the public API into **subpath exports**. Import only what you need so optional peer dependencies (CASL, Better Auth, AWS SDK) apply only when you use that subsystem.

## Subpath overview

| Import | Purpose | Notable peer dependencies |
| ------ | ------- | ------------------------- |
| `glasswork` | Convenience entry: **core + http only** | `hono`, `awilix`, `valibot` |
| `glasswork/core` | Bootstrap, modules, config, utilities | `awilix`, `dotenv` (optional) |
| `glasswork/http` | Routes, errors, OpenAPI, rate limiting | `hono`, `hono-openapi`, `valibot` |
| `glasswork/auth` | Better Auth middleware, CASL abilities | `@casl/ability`, `@casl/prisma`, `better-auth` |
| `glasswork/list-query` | Filtering, sorting, pagination | `valibot`, `@prisma/client` (types) |
| `glasswork/jobs` | SQS / EventBridge background jobs | `@aws-sdk/client-sqs`, `@aws-sdk/client-scheduler` |
| `glasswork/email` | Templated email, SES transport, webhooks | `@aws-sdk/client-sesv2` (SES) |
| `glasswork/uploads` | S3 presigned upload URLs | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| `glasswork/observability` | Pino logging, CloudWatch exception tracking | `@aws-sdk/client-cloudwatch` (tracker) |

:::: tip Root import
`` still works for **core and HTTP** primitives (`bootstrap`, `defineModule`, `createRoutes`, `route`, exceptions). For auth, email, jobs, uploads, list-query, or observability, use the matching subpath.
::::

## Examples

### Core application setup

```typescript
import { bootstrap, defineModule, isLambda } from 'glasswork/core';
import { createRoutes, route, NotFoundException } from 'glasswork/http';
```

### Auth + list query with CASL

```typescript
import { accessibleBy } from '@casl/prisma';
import { createAuthMiddleware, subject } from 'glasswork/auth';
import { registerCasl, createListQuery, withCaslScope } from 'glasswork/list-query';

registerCasl({ accessibleBy });
```

### Email and jobs (optional AWS peers)

```typescript
import { defineJob, JobService } from 'glasswork/jobs';
import { SESTransport, TemplatedEmailService } from 'glasswork/email';
```

### Observability

```typescript
import { createCloudWatchTracker, lambdaPinoConfig } from 'glasswork/observability';
import { bootstrap } from 'glasswork/core';
```

## Migrating from 0.x

Glasswork 0.x used a single barrel: everything came from `'glasswork'`. In 1.0:

1. **Keep** core/HTTP imports from `'glasswork'` or switch to `'glasswork/core'` / `'glasswork/http'`.
2. **Move** subsystem imports to the subpath in the table above.
3. **Install peers** only for subsystems you import (e.g. no `@casl/ability` if you never import `glasswork/auth`).

```typescript
// 0.x — single barrel
import {
  bootstrap,
  createRoutes,
  subject,
  SESTransport,
  defineJob,
} from 'glasswork';

// 1.0 — explicit subpaths
import { bootstrap } from 'glasswork/core';
import { createRoutes } from 'glasswork/http';
import { subject } from 'glasswork/auth';
import { SESTransport } from 'glasswork/email';
import { defineJob } from 'glasswork/jobs';
```

## TypeScript `package.json` exports

Consumers resolve subpaths via Node.js `exports` in `glasswork/package.json`. Bundlers and `tsc` with `moduleResolution: "bundler"` or `"node16"` / `"nodenext"` support this out of the box.

See the curated [API Reference](/api/) for exports per subpath.
