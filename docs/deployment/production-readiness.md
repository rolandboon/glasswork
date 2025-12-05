---
title: Production Readiness
---

# Production Readiness

Use this checklist to take a Glasswork service from "it runs locally" to "safe in production". Skim top-to-bottom on first deploy; revisit when adding new modules.

## Quick Checklist

- ✅ **Disable public docs**: `openapi.serveSpecs = false`, `openapi.serveUI = false`
- ✅ **Turn on rate limiting**: `rateLimit.enabled = true`, DynamoDB store in prod
- ✅ **Lock down CORS**: explicit origins + credentials only if required
- ✅ **Secure headers**: enable `middleware.secureHeaders`
- ✅ **Authentication**: implement middleware; never rely on `public` flag alone
- ✅ **Secrets from env**: load from SSM/Secrets Manager; never commit secrets
- ✅ **Structured logging**: Pino JSON with requestId + service names
- ✅ **Exception tracking**: CloudWatch tracker or Sentry/AppSignal
- ✅ **TLS everywhere**: HTTPS and HSTS at CDN/ALB/API Gateway
- ✅ **Database hygiene**: pool sizing, connection reuse, migrations applied
- ✅ **Email**: out of SES sandbox; verified sender identities

## Essentials (Before Traffic)

### 1. Secure Surface

**OpenAPI exposure:**

```typescript
const { app } = await bootstrap(AppModule, {
  openapi: {
    enabled: true,
    serveSpecs: false, // Don't expose in production
    serveUI: false,
  },
});
```

Keep `writeToFile` if you need to publish specs to an artifact store or gateway.

**Rate limiting & CORS:**

```typescript
const { app } = await bootstrap(AppModule, {
  rateLimit: {
    enabled: true,
    storage: 'dynamodb',
    windowMs: 60_000,
    maxRequests: 100,
  },
  middleware: {
    cors: {
      origin: ['https://app.example.com'],
      credentials: true,
    },
    secureHeaders: true,
  },
});
```

### 2. Authentication & Authorization

- Implement auth middleware; `public: true` only marks docs as unauthenticated.
- Document auth scheme in OpenAPI and verify 401/403 responses are present.
- Prefer short-lived access tokens and server-side sessions.
- Strip sensitive headers from logs.

### 3. Configuration & Secrets

- Set `NODE_ENV=production`; run with `"type": "module"` and strict TS build.
- Load secrets from env/SSM/Secrets Manager; never hardcode.
- Validate configuration via `createConfig` at startup.
- Default to least privilege IAM roles; restrict SES identities and S3 buckets.

### 4. Health & Readiness (Container Deployments)

::: tip Lambda Note
Health endpoints are primarily for container/server deployments (ECS, Kubernetes, ALB). Lambda doesn't need them. AWS manages instance health automatically.
:::

For container deployments:
- Add a cheap, dependency-light endpoint (e.g. `/internal/health`).
- Exclude it from OpenAPI with `openapi: { exclude: true }` on the route.
- Optionally add a deeper readiness check that touches DB/queues.

### 5. Observability

**Logging:**
- Use `pino` with the provided `lambdaPinoConfig`.
- Prefer `createContextAwarePinoLogger` in services for consistent fields.
- Ship requestId + service name in every log line.
- Avoid logging secrets (tokens, passwords, PII).

**Error handling:**
- Rely on domain exceptions (`NotFoundException`, `BadRequestException`, etc.).
- Keep a default error handler; do not leak stack traces in production responses.
- Track 5xx errors at minimum. Consider including 404s for critical resources.

**Metrics:**
- Track latency, 4xx/5xx rates, rate-limit hits, cold starts.
- Enable CloudWatch alarms for error rate, latency, and cold start spikes.

### 6. Data Safety

- Validate all input via Valibot schemas.
- Enforce response validation for external-facing routes (prevents data leaks).
- Use `strictTypes: true` for sensitive responses.
- Back up production databases; enable RDS performance insights and error logs.

### 7. Database & Connection Management

- Size connection pools for Lambda concurrency or server threads.
- Reuse clients across invocations; avoid creating clients per request.
- For Lambda + Postgres, use PgBouncer/RDS Proxy; set low pool size.
- Run migrations before deploy; block boot if pending migrations remain.

### 8. Email Hygiene

- Move SES out of sandbox before production; verify sender identities.
- Set `configurationSet` to emit bounces/complaints; alarm on high rates.
- For dev/staging, keep sandbox on and point to non-customer mailboxes.

## Deploy Safely

- **Immutable builds**: use esbuild with `format: 'esm'`, `keepNames: true`, `external: ['@aws-sdk/*']`.
- **Infrastructure**: prefer SAM/CDK/Terraform; pin runtime to `nodejs20.x`+; set memory + timeout per workload.
- **Cold starts**: minimize bundle size; use provisioned concurrency for critical paths; reuse DI container.
- **Static assets**: serve from CDN/S3; do not serve from app.

## Safety Nets Before Launch

- End-to-end smoke test (auth + one read + one write) in staging.
- Run lint, format, and tests on CI.
- Toggle feature flags via config, not code.
- Document rollback procedure (last known good build + infra change).
- Set timeouts: HTTP clients, DB queries, and Lambda function timeout.
- Use idempotency where appropriate for background jobs and webhooks.

## Optional But Valuable

- **Security**: Content Security Policy headers; JWT/session rotation; audit logging.
- **Operational**: request sampling for logs; structured logging only (no `console.log` dumps).
- **Data**: soft deletes for key tables; migrations with down scripts.

## Adding Module Features

When adding new modules (background jobs, caching, auth, CLI, multi-tenancy), document:

- How it changes deployment (queues, cache, roles).
- Observability knobs (metrics/logs).
- Failure modes and rollbacks.

## Learn More

- [Observability Guide](/observability/overview) - Logging and metrics setup
- [OpenAPI Guide](/request-handling/openapi) - Lock in your API surface
- [Testing Guide](/application-structure/testing) - Add robust tests
- [Lambda Deployment](/deployment/lambda) - Optimize for serverless
