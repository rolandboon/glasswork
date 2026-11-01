# Reference consumer

A small application that uses Glasswork the way applications do: installed from the packed
tarball, compiled against the published declarations, and run against PostgreSQL. Run it
from the repository root after `npm run build`:

```sh
REFERENCE_DATABASE_URL=postgresql://admin:password@localhost:5432/test_db npm run consumer:reference
```

The runner copies this directory to a temporary folder, installs the tarball and these
dependencies, generates the Prisma client, compiles the application and its tests, runs the
tests, generates `openapi.json`, generates a HeyAPI client from it and typechecks
`client-check.ts` against that client. `REFERENCE_DATABASE_URL` needs a test database user
that may create schemas and roles; every run uses its own schema and a restricted role.
Set `KEEP_REFERENCE_CONSUMER=1` to keep the temporary folder.

## What it guards

| Pattern | Where |
| --- | --- |
| Feature modules with private providers, platform modules and explicit exports | `src/**/*.module.ts` |
| Auth middleware with a protected and a guest route | `src/projects/projects.module.ts` |
| Tenant isolation with the RLS extension and a restricted database role | `test/support.ts`, `src/platform/database.module.ts` |
| A claim and its audit record in one transaction, then a versioned job | `src/invitations/invitations.service.ts` |
| A job that uses a private service of its own module, in-process and through the SQS serializer and worker | `src/invitations/send-invitation.job.ts` |
| Job payloads as JSON values (an ISO timestamp transformed to a `Date`) | `src/invitations/send-invitation.job.ts` |
| Booting one feature module with `bootstrap(FeatureModule)` | `test/application.test.ts` |
| OpenAPI generation without providers, using metadata-only overrides | `src/openapi.ts` |
| A generated client whose types fail when a response field disappears | `client-check.ts` |

The fixture uses TypeScript 6 because the HeyAPI generator relies on the TypeScript
compiler API, which TypeScript 7 no longer provides. The pack smoke test covers TypeScript
5.9, 6 and 7 for the published declarations.
