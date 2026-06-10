# Changelog

All notable changes to Glasswork are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-06-10

Major release: subpath exports, dependency upgrades (CASL 7, MJML 5, Valibot 1.4, Prisma 7), Prisma list-query helpers, and internal refactors. Breaking changes when upgrading from 0.x.

### Added

- **Subpath exports:** `glasswork/core`, `glasswork/http`, `glasswork/auth`, `glasswork/list-query`, `glasswork/jobs`, `glasswork/email`, `glasswork/uploads`, `glasswork/observability`
- **`registerAuthCasl({ createPrismaAbility })`** — register the app's Prisma ability factory at startup (same pattern as `registerCasl()` in list-query)
- **`RouteBinder`** and `core/route-factory.ts` — typed route-factory contract
- **`createPrismaListExecutor`**, **`bindPrismaListDelegate`**, **`runGroupByAggregations`**, **`resolveOrderBy`** — Prisma list-query execution helpers
- **`defaultOrderBy`** on `createListQuery` config — applied when the request omits `sorts`
- **`InferListParams`** — infer typed list params from filter/sort Valibot schemas
- **`intFilterSchema`** and **`unrestrictedWhereSchema`** — additional list-query schema helpers
- **`createSortSchema`** dot-notation — nested relation sorts (e.g. `'organization.name'`)
- Shared test helpers under `test/helpers/` (`createTestRouter`, `buildSqsEvent`, `cradleOf`)
- Pack consumer smoke test (`smoke:pack`) wired into `verify`

### Changed

- **Root entry (`glasswork`)** re-exports **core + http only**; optional subsystems require explicit subpaths
- **Peer dependencies** tightened to tested ranges (`valibot` ^1.4, `@prisma/client` ^7, `@casl/ability` ^7, `@casl/prisma` ^2, and others — see `package.json`)
- **MJML 5** — template compilation is async; `compileTemplates()` API updated accordingly
- **CASL 7 / `@casl/prisma` 2** — `PureAbility` replaced by `Ability` / `AnyAbility`; use `accessibleBy().ofType()` for list-query scopes
- **Prisma CASL extension** — `createCaslExtension()` on `PrismaService` for consumer apps
- **Bootstrap internals** — module graph and lifecycle extracted from `bootstrap.ts`; jobs worker no longer imports bootstrap
- **HTTP internals** — `route-helpers.ts` split into focused modules; public `route()` / `createRoutes()` API unchanged
- **API reference docs** — labeled as manually curated (not TypeDoc-generated)
- **CI coverage job** — build `dist/` before coverage; limit coverage to TypeScript sources

### Removed

- **`html-to-text`** dependency (email plain-text generation uses a lighter path)
- Monolithic optional exports from the root `glasswork` barrel
- Redundant direct `standard-openapi` / `standard-json` dependencies (provided via `hono-openapi`)

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

## [0.13.3] - 2026-05-28

Last 0.x release before the 1.0 breaking changes. Earlier 0.x history is available on [GitHub releases](https://github.com/rolandboon/glasswork/releases).

[Unreleased]: https://github.com/rolandboon/glasswork/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/rolandboon/glasswork/compare/v0.13.3...v1.0.0
[0.13.3]: https://github.com/rolandboon/glasswork/compare/v0.13.2...v0.13.3
