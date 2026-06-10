# Changelog

All notable changes to Glasswork are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-09

Major release focused on subpath exports, clearer integration seams, and internal maintainability. Breaking changes are expected when upgrading from 0.x.

### Added

- **Subpath exports:** `glasswork/core`, `glasswork/http`, `glasswork/auth`, `glasswork/list-query`, `glasswork/jobs`, `glasswork/email`, `glasswork/uploads`, `glasswork/observability`
- **`registerAuthCasl({ createPrismaAbility })`** — CASL registration seam for auth abilities (mirrors `registerCasl()` in list-query)
- **`RouteBinder`** and `core/route-factory.ts` — typed route-factory contract without `any`
- Shared test helpers under `test/helpers/` (`createTestRouter`, `buildSqsEvent`, `cradleOf`)

### Changed

- **Root entry (`glasswork`)** re-exports **core + http only**; optional subsystems require explicit subpaths
- **Peer dependencies** tightened to tested ranges (`valibot` ^1.4, `@prisma/client` ^7, `@casl/ability` ^7, `@casl/prisma` ^2, and others — see `package.json`)
- **MJML 5** — template compilation is async; `compileTemplates()` API updated accordingly
- **CASL 7 / `@casl/prisma` 2** — `PureAbility` replaced by `Ability` / `AnyAbility`; use `accessibleBy().ofType()` for list-query scopes
- **Prisma CASL extension** — `createCaslExtension()` on `PrismaService` for consumer apps
- **Bootstrap internals** — module graph and lifecycle extracted from `bootstrap.ts`; jobs worker no longer imports bootstrap
- **HTTP internals** — `route-helpers.ts` split into focused modules; public `route()` / `createRoutes()` API unchanged
- **API reference docs** — relabeled as manually curated (not TypeDoc-generated)

### Removed

- **`html-to-text`** dependency (email plain-text generation uses a lighter path)
- Monolithic optional exports from the root `glasswork` barrel

### Migration from 0.x

1. Replace root imports with subpaths (see [Package Exports](https://glasswork.dev/getting-started/package-exports)):
   - `defineModule`, `bootstrap`, `createConfig` → `glasswork/core`
   - `createRoutes`, `route`, `*Exception` → `glasswork/http`
   - Auth, jobs, email, uploads, list-query, observability → respective subpaths
2. At application startup:
   ```typescript
   import { accessibleBy, createPrismaAbility } from '@casl/prisma';
   import { registerAuthCasl } from 'glasswork/auth';
   import { registerCasl } from 'glasswork/list-query';

   registerCasl({ accessibleBy });
   registerAuthCasl({ createPrismaAbility });
   ```
3. Upgrade CASL/MJML/Valibot/Prisma peers to the ranges in `package.json`
4. Rebuild (`pnpm build`) after install — the package ships compiled `dist/`
