---
description: Type-safe list query system for building filterable, sortable, and paginated API endpoints with Prisma, global search, aggregations, and CASL.
---

# List Query

Glasswork provides a powerful list query system for building type-safe, filterable, sortable, and paginated API endpoints. It integrates seamlessly with Prisma and supports global search, aggregations, and CASL authorization.

## Overview

The list query system helps you:

- Parse filter and sort query parameters
- Validate user input against schemas
- Build type-safe Prisma queries
- Handle pagination with response headers
- Add global search across multiple fields
- Compute aggregations (counts by field value)
- Integrate with CASL for authorization scoping

## Naming Conventions

This guide uses two naming conventions:

- **Schema** (e.g., `UserFilterSchema`, `UserSortSchema`) — Validation rules that define what operations are allowed. These constrain user input.
- **Dto** (e.g., `UserDto`, `UsersListDto`) — Data Transfer Objects that define response shapes. These describe output data structures.

Both are Valibot schemas under the hood, but the naming clarifies intent.

## Basic Usage

### 1. Define Filter and Sort Schemas

Use the schema helpers to define what filtering and sorting is allowed:

```typescript
import { createFilterSchema, createSortSchema, stringFilterSchema, enumFilterSchema, dateFilterSchema, sortDirectionSchema } from 'glasswork/list-query';
import { picklist } from 'valibot';

// Define allowed filters
const UserFilterSchema = createFilterSchema({
  name: stringFilterSchema(),
  email: stringFilterSchema(),
  status: enumFilterSchema(picklist(['ACTIVE', 'INACTIVE', 'PENDING'])),
  createdAt: dateFilterSchema(),
});

// Define allowed sort fields
const UserSortSchema = createSortSchema({
  name: sortDirectionSchema(),
  email: sortDirectionSchema(),
  createdAt: sortDirectionSchema(),
});
```

### 2. Create and Execute a List Query

You can parse parameters into a type-safe query in your route and execute it directly or through a service:

```typescript
import {
  createListQuery,
  ListQuerySchema,
  type InferListParams,
} from 'glasswork/list-query';

export type UserListParams = InferListParams<
  typeof UserFilterSchema,
  typeof UserSortSchema
>;

export const userRoutes = createRoutes<{ userService: UserService }>(
  (router, { userService }, route) => {
    router.get('/', ...route({
      summary: 'List users',
      query: ListQuerySchema,
      responses: { 200: UsersResponseDto },
      handler: async ({ query, context }) => {
        const params = createListQuery({
          filter: UserFilterSchema,
          sort: UserSortSchema,
          defaultOrderBy: [{ createdAt: 'desc' }],
        })
          .parse(query, context)
          .build();

        return userService.listUsers(params);
      },
    }));
  }
);
```

In your repository or service, use `executePrismaList` with the Prisma model delegate:

```typescript
import { executePrismaList } from 'glasswork/list-query';

export class UserRepository {
  async listUsers(params: UserListParams) {
    return executePrismaList(this.prisma.user, {
      ...params,
      map: (record) => toUserDto(record),
    });
  }
}
```

Alternatively, `createPrismaListExecutor` creates a reusable executor function you can pass directly to `.execute()` on the query builder:

```typescript
const listUsers = createPrismaListExecutor({
  delegate: () => prisma.user,
  defaultOrderBy: [{ createdAt: 'desc' }],
  map: toUserDto,
});

// In route handler:
return createListQuery({ filter: UserFilterSchema, sort: UserSortSchema })
  .parse(query, context)
  .paginate()
  .execute(listUsers);
```

## Query Parameters

The `ListQuerySchema` accepts these query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `filters` | string | Filter expression, max. 1000 characters (see syntax below) |
| `sorts` | string | Sort expression, max. 100 characters (see syntax below) |
| `page` | integer | Page number from 1 through 1,000,000 (default: 1) |
| `pageSize` | integer | Items per page from 1 through 100 (default: 10) |
| `search` | string | Global search term, max. 255 characters |

`ListQuerySchema` is strict: unknown parameters, malformed integers, and
values outside these bounds return 422 instead of being ignored or clamped.
Filter fields, operators, and typed values are validated by the filter schema;
sort fields are validated by the sort schema.

### Filter Syntax

Filters use a Sieve-inspired syntax:

```http
?filters=name@=John,status==ACTIVE
```

| Operator | Description | Example |
|----------|-------------|---------|
| `==` | Equals | `status==ACTIVE` |
| `!=` | Not equals | `status!=INACTIVE` |
| `>` | Greater than | `age>18` |
| `<` | Less than | `age<65` |
| `>=` | Greater than or equal | `createdAt>=2024-01-01` |
| `<=` | Less than or equal | `createdAt<=2024-12-31` |
| `@=` | Contains | `name@=john` |
| `_=` | Starts with | `email_=admin` |
| `_-=` | Ends with | `email_-=@example.com` |
| `@=\|` | In (multiple values) | `status@=\|ACTIVE\|PENDING` |
| `!@=\|` | Not in (multiple values) | `status!@=\|INACTIVE\|DELETED` |

**Case-insensitive variants** (add `*` suffix):

- `==*`, `!=*` — Case-insensitive equality
- `@=*`, `_=*`, `_-=*` — Case-insensitive string operations
- `@=|*`, `!@=|*` — Case-insensitive IN operations

**Negation** (add `!` prefix):

- `!@=` — Does not contain
- `!_=` — Does not start with
- `!_-=` — Does not end with
- `!@=|` — Not in (multiple values)

### IN Operator

The IN operator (`@=|`) allows filtering by multiple values, similar to [Prisma's `in` filter](https://www.prisma.io/docs/orm/reference/prisma-client-reference#in). Values are separated by pipe (`|`) characters.

**Examples:**

```http
# Filter where status is ACTIVE or PENDING
?filters=status@=|ACTIVE|PENDING

# Filter where status is not INACTIVE or DELETED
?filters=status!@=|INACTIVE|DELETED

# Case-insensitive: find users named John or Jane
?filters=name@=|*John|Jane

# Multiple IN filters
?filters=status@=|ACTIVE|PENDING,role@=|USER|ADMIN

# Nested fields
?filters=organization.status@=|ACTIVE|PENDING
```

**Value parsing:**
- String values remain as strings: `name@=|John|Jane` → `['John', 'Jane']`
- Numeric values are parsed: `age@=|18|21|65` → `[18, 21, 65]`
- Boolean values are parsed: `active@=|true|false` → `[true, false]`
- Mixed types work: `value@=|test|123|true` → `['test', 123, true]`

**Pipe escaping:**
If a value contains a pipe character, escape it with a backslash:

```http
?filters=name@=|test\|value|other
# Becomes: ['test|value', 'other']
```

### Validation

While the filter syntax appears freeform, **all fields and operations are strictly validated** against your Valibot schemas:

- **Unknown fields** → 422 error (field not in filter schema)
- **Invalid operators** → 422 error (operator not allowed for field type)
- **Invalid values** → 422 error (value doesn't match schema)

The allowed operations are determined by the filter schema helpers you use:

| Schema Helper | Allowed Operators |
|---------------|-------------------|
| `stringFilterSchema()` | `==`, `!=`, `@=`, `_=`, `_-=`, `@=\|`, `!@=\|` (and `*` variants) |
| `numberFilterSchema()` | `==`, `!=`, `>`, `<`, `>=`, `<=` |
| `dateFilterSchema()` | `==`, `!=`, `>`, `<`, `>=`, `<=` (values parsed to `Date` for Prisma on these fields only) |
| `booleanFilterSchema()` | `==`, `!=` |
| `enumFilterSchema()` | `==`, `!=`, `@=\|`, `!@=\|` |

```typescript
// Only these fields can be filtered, with their allowed operations
const UserFilterSchema = createFilterSchema({
  name: stringFilterSchema(),    // Allows contains, startsWith, IN, etc.
  age: numberFilterSchema(),     // Allows >, <, >=, <=
  status: enumFilterSchema(...), // Allows equals and IN
});

// ❌ These requests return 422:
// ?filters=password@=secret          → 'password' not in schema
// ?filters=status@=ACTIVE            → contains (@=) not allowed for enums
// ?filters=age@=25                   → contains (@=) not allowed for numbers
// ?filters=age@=|18|21               → IN (@=|) not allowed for numbers
```

::: tip Security
This validation prevents users from filtering on sensitive fields or using SQL injection-like patterns. Only explicitly allowed fields and operations are processed.
:::

### Filter value parsing

Filter values are parsed in two phases:

1. **Query params** — `parseFilterValue` converts literals in the URL (`true`, `42`, …) when building the initial Prisma `where` clause. Substring operators (`@=`, `_=`, …) and pipe-separated IN lists keep raw strings. Dates stay as `YYYY-MM-DD` strings until phase 2.
2. **Merged where** — `parseWhereFilterValues` runs after user filters are merged with scope conditions. It calls Valibot `parse()` on typed filter fields (`dateFilterSchema`, `intFilterSchema`, `numberFilterSchema`, `booleanFilterSchema`), which use `pipe` + `transform` to produce Prisma-ready values.

### Sort Syntax

Sort by multiple fields with direction:

```http
?sorts=createdAt,-name
```

- Prefix with `-` for descending order
- No prefix for ascending order
- Comma-separated for multiple fields

### Nested Fields

Filter and sort by nested relation fields using dot notation:

```http
?filters=organization.name@=Acme
?sorts=organization.name
```

## Virtual Filter Mapping

Public API filter contracts do not always correspond 1:1 to database column names or physical schema shapes. For example:
- A boolean `archived: true/false` virtual filter maps to a nullability check: `archivedAt != null` or `archivedAt == null`.
- An `active: true/false` virtual filter maps to an enum column: `status == 'ACTIVE'` or `status == 'INACTIVE'`.
- A public API field `userEmail` maps to database column `email`.
- A flat filter `departmentId` maps to a relational condition `{ department: { id: ... } }`.
- A domain lifecycle status `'CLOSED'` maps to `{ OR: [{ status: 'CLOSED' }, { status: 'OPEN', deadline: { lte: now } }] }`.

Configure `mapFilters` in `createListQuery`:

```typescript
import {
  createListQuery,
  mapPresenceFilter,
  mapBooleanFilter,
  mapValueFilter,
  renameFilter,
  nestFilter,
  composeFilterMappers,
} from 'glasswork/list-query';

const query = createListQuery({
  filter: UserFilterSchema,
  sort: UserSortSchema,
  mapFilters: {
    // 1. Presence / nullability condition
    archived: mapPresenceFilter('archivedAt'),

    // 2. Boolean mapped to custom values or conditions
    active: mapBooleanFilter('status', {
      whenTrue: 'ACTIVE',
      whenFalse: 'INACTIVE',
    }),

    // 3. Dictionary value translation (handles literals, equals, not, in, notIn)
    role: mapValueFilter('role', {
      admin: 'ADMINISTRATOR',
      member: 'REGULAR_MEMBER',
    }),

    // 4. Field renaming / aliasing
    userEmail: renameFilter('email'),

    // 5. Relational path nesting
    managerEmail: nestFilter('manager.email'),

    // 6. Composing multiple mappers for one filter
    verifiedActive: composeFilterMappers(
      mapPresenceFilter('verifiedAt'),
      mapBooleanFilter('status', { whenTrue: 'ACTIVE', whenFalse: 'INACTIVE' })
    ),

    // 7. Custom mapping function
    lifecycle: (filter) => {
      const { equals } = (filter ?? {}) as { equals?: string };
      if (equals === 'CLOSED') {
        return {
          OR: [
            { status: 'CLOSED' },
            { status: 'OPEN', deadline: { lte: new Date() } },
          ],
        };
      }
      return undefined;
    },
  },
});
```

### Execution Lifecycle & Safety

Filter mappings run after query parameter parsing and Valibot schema validation, but **before** user filters are merged with CASL scopes or global search (`?search=foo`).

This provides four essential guarantees:
1. **Schema validation first:** Input parameters are strictly validated against your Valibot filter schema before any mapping runs.
2. **Clean search isolation:** Global search combines conditions in an `{ AND: [userWhere, searchWhere] }` structure; virtual fields are already transformed into real database fields, preventing collisions.
3. **Recursive mapping:** Nested filter trees (`AND`, `OR`, `NOT`) automatically map virtual fields within all branches.
4. **Data preservation:** Typed operand values like `Date` instances are preserved without loss.

### Built-in Mapping Utilities

- **`mapPresenceFilter(targetField, options?)`**:
  Maps boolean filters (`true`/`false` or `{ equals, not }`) to `{ [targetField]: { not: null } }` or `{ [targetField]: null }`.
  Pass `{ presentWhen: false }` to invert polarity (e.g., `active: true` maps to `{ archivedAt: null }`).
- **`mapBooleanFilter(targetField, { whenTrue, whenFalse })`**:
  Maps boolean filters to target values or Prisma condition objects (e.g. enum strings, arrays, or `{ in: [...] }`).
- **`mapValueFilter(targetField, valueMap)`**:
  Translates literal values and operator objects (`equals`, `not`, `in`, `notIn`) using a dictionary mapping. Unmapped values pass through unchanged.
- **`renameFilter(targetField)`**:
  Aliases an API filter field to a different database column name.
- **`nestFilter(path, innerMapper?)`**:
  Wraps the filter into nested object keys (e.g. `nestFilter('department.id')` → `{ department: { id: filter } }`). Can also wrap an inner mapper (e.g. `nestFilter('author', mapPresenceFilter('archivedAt'))`).
- **`composeFilterMappers(...mappers)`**:
  Merges the results of multiple filter mappers for a single input filter into a single condition object.
- **Custom functions `(filter: unknown) => Record<string, unknown> | undefined`**:
  Return any Prisma condition object, or `undefined` to omit.

## Pagination Headers

Pagination is enabled by default (calling `.paginate()` is optional but keeps intent explicit). When pagination is on and a Hono `context` is provided, response headers are automatically set:

| Header | Description |
|--------|-------------|
| `X-Total-Count` | Total number of items |
| `X-Total-Pages` | Total number of pages |
| `X-Current-Page` | Current page number |
| `X-Page-Size` | Items per page |

## Disabling Pagination

Use `.disablePagination()` when you need the full result set (e.g., internal exports or admin-only utilities). This removes the `take` limit and skips pagination headers; `page` and `pageSize` query parameters are ignored.

```typescript
const result = createListQuery({
  filter: UserFilterSchema,
  sort: UserSortSchema,
})
  .parse(query, context)
  .disablePagination() // pagination headers not set, all rows returned
  .execute(async (params) => {
    // params.take is undefined, so Prisma returns all matching rows
    return prisma.user.findMany(params);
  });
```

Prefer keeping pagination enabled for user-facing endpoints to avoid large responses.

## Global Search

Search across multiple fields with a single query:

```typescript
const result = createListQuery({
  filter: UserFilterSchema,
  sort: UserSortSchema,
  search: ['name', 'email', ['organization', 'name']], // Include nested fields
})
  .parse(query, context)
  .paginate()
  .execute(async (params) => {
    // params.where includes OR conditions for search
    const [data, total] = await Promise.all([
      prisma.user.findMany(params),
      prisma.user.count({ where: params.where }),
    ]);
    return { data, total };
  });
```

When a `search` query parameter is provided, it creates an OR condition across all specified fields:

```http
?search=john
```

Generates:

```typescript
{
  where: {
    OR: [
      { name: { contains: 'john', mode: 'insensitive' } },
      { email: { contains: 'john', mode: 'insensitive' } },
      { organization: { name: { contains: 'john', mode: 'insensitive' } } },
    ]
  }
}
```

## Scoping

Add application-controlled conditions that users cannot override:

```typescript
// Only show active users
createListQuery({ filter: UserFilterSchema, sort: UserSortSchema })
  .parse(query, context)
  .scope({ status: 'ACTIVE' }) // Always applied
  .paginate()
  .execute(/* ... */);

// Multi-tenant scoping
createListQuery({ filter: UserFilterSchema, sort: UserSortSchema })
  .parse(query, context)
  .scope({ organizationId: session.organizationId })
  .paginate()
  .execute(/* ... */);
```

Scope conditions are merged with user filters using AND logic.

## Default Sorting

When a request omits `sorts`, apply a default in `createListQuery`:

```typescript
createListQuery({
  filter: UserFilterSchema,
  sort: UserSortSchema,
  defaultOrderBy: [{ createdAt: 'desc' }],
```

`createPrismaListExecutor` and `executePrismaList` also accept `defaultOrderBy` as a fallback when the list query omits sort parameters.

## Prisma List Execution

Glasswork provides two complementary ways to execute list queries against Prisma:
1. **`executePrismaList`** — Direct execution in services or repositories.
2. **`createPrismaListExecutor`** — Reusable executor factory that can be passed directly to `.execute()`.

### Direct Execution with `executePrismaList`

In standard layered architectures (Route -> Service -> Repository), `executePrismaList` can be invoked directly against any Prisma model delegate without configuring a factory:

```typescript
import { executePrismaList } from 'glasswork/list-query';

export class UserRepository {
  async list(tenantId: string, params: UserListParams) {
    return executePrismaList(this.prisma.user, {
      where: {
        ...params.where,
        tenantId, // Repository/tenant scoping
      },
      orderBy: [...(params.orderBy ?? []), { id: 'asc' }],
      skip: params.skip,
      take: params.take,
      include: { profile: true },
      // Optional mapping callback: transforms database records to domain/DTO models
      map: (record) => toUserRecord(record),
    });
  }
}
```

`executePrismaList` executes `findMany`, `count`, and optional `groupBy` aggregations concurrently via `Promise.all` and returns:

```typescript
{
  data: TResult[],
  total: number,
  aggregations?: Record<string, Record<string, number>>,
}
```

### Row Transformation (`map` Callback)

Both `executePrismaList` and `createPrismaListExecutor` support an optional `map` callback. This maps each raw Prisma record to a domain entity or DTO before returning:

```typescript
const result = await executePrismaList(prisma.user, {
  ...params,
  map: (user) => ({
    id: user.id,
    fullName: `${user.firstName} ${user.lastName}`,
    email: user.email,
  }),
});

// result.data is typed as Array<{ id: string; fullName: string; email: string }>
```

### Reusable Executor Factory (`createPrismaListExecutor`)

For endpoints where the route executes the query directly or uses a shared executor instance:

```typescript
const listUsers = createPrismaListExecutor({
  delegate: () => prisma.user,
  defaultOrderBy: [{ createdAt: 'desc' }],
  include: { profile: true },
  map: toUserDto,
});

// Directly in route:
return createListQuery({ filter: UserFilterSchema, sort: UserSortSchema })
  .parse(query, context)
  .paginate()
  .execute(listUsers);
```

## Typed List Params

Infer service param types from your filter and sort schemas:

```typescript
import type { InferListParams } from 'glasswork/list-query';

type UserListParams = InferListParams<typeof UserFilterSchema, typeof UserSortSchema>;
```

Use this in service method signatures instead of hand-rolled `ServiceListParams` wrappers.

## Aggregations

Compute counts by field value for faceted search interfaces:

```typescript
const listUsers = createPrismaListExecutor({
  delegate: () => prisma.user,
});

const result = createListQuery({
  filter: UserFilterSchema,
  sort: UserSortSchema,
  aggregations: {
    byStatus: { field: 'status', type: 'groupBy' },
    byRole: { field: 'role', type: 'groupBy' },
  },
})
  .parse(query, context)
  .paginate()
  .execute(listUsers);
```

`createPrismaListExecutor` calls `runGroupByAggregations` internally. Use it directly when you need aggregations outside the standard list flow:

```typescript
import { runGroupByAggregations } from 'glasswork/list-query';

const aggregations = await runGroupByAggregations(prisma.user, params.aggregations);
```

Aggregation results return counts for each value:

```json
{
  "data": [...],
  "total": 100,
  "aggregations": {
    "byStatus": { "ACTIVE": 75, "INACTIVE": 20, "PENDING": 5 },
    "byRole": { "USER": 80, "ADMIN": 15, "MODERATOR": 5 }
  }
}
```

### Faceted Search Behavior

Aggregations use a **faceted search pattern**: all filters apply to the aggregation *except* the filter on the aggregated field itself. This lets users see counts for all options, not just the currently selected one.

**Example:** When filtering users by `status==ACTIVE`:

- The `data` results only show active users
- The `byStatus` aggregation shows counts for ALL statuses (ACTIVE, INACTIVE, PENDING)
- The `byRole` aggregation only counts active users (other filters still apply)

This enables UI patterns like:

```plaintext
Status:  ● Active (75)  ○ Inactive (20)  ○ Pending (5)
Role:    ● All  ○ User (60)  ○ Admin (12)  ○ Moderator (3)
```

Users can see how many results each filter option would return, even while a filter is active.

## Transform

Modify the built params before execution:

```typescript
createListQuery({ filter: UserFilterSchema, sort: UserSortSchema })
  .parse(query, context)
  .transform((params) => ({
    ...params,
    // Add includes
    include: { organization: true, posts: { take: 5 } },
    // Modify where
    where: { ...params.where, deletedAt: null },
  }))
  .execute(/* ... */);
```

## CASL Integration

Scope queries based on user permissions using [CASL Prisma](https://casl.js.org/v6/en/package/casl-prisma):

```typescript
import { withCaslScope } from 'glasswork/list-query';
import { accessibleBy } from '@casl/prisma';

// Using withCaslScope helper
createListQuery({ filter: UserFilterSchema, sort: UserSortSchema })
  .parse(query, context)
  .scope(withCaslScope(ability, 'read', 'User'))
  .paginate()
  .execute(/* ... */);

// Or create scope manually
const caslWhere = accessibleBy(ability, 'read').ofType('User');
createListQuery({ filter: UserFilterSchema, sort: UserSortSchema })
  .parse(query, context)
  .scope(caslWhere)
  .execute(/* ... */);
```

::: tip
CASL Prisma's `accessibleBy()` generates Prisma `where` conditions from your ability rules. This integrates seamlessly with the `.scope()` method.
:::

## Schema Helpers

### Filter Schemas

```typescript
import { stringFilterSchema, numberFilterSchema, dateFilterSchema, booleanFilterSchema, enumFilterSchema, relationFilterSchema, createFilterSchema } from 'glasswork/list-query';

// String fields (contains, startsWith, endsWith, etc.)
stringFilterSchema()

// Numeric fields (gt, gte, lt, lte, equals)
numberFilterSchema()

// Date fields (gt, gte, lt, lte, equals)
dateFilterSchema()

// Boolean fields (equals, not)
booleanFilterSchema()

// Enum fields with specific values
enumFilterSchema(picklist(['VALUE1', 'VALUE2']))

// Nested relation filters
// First, define the filter schema for the related model
const OrganizationFilterSchema = createFilterSchema({
  name: stringFilterSchema(),
  industry: stringFilterSchema(),
});

// Then use it in the parent schema
relationFilterSchema(OrganizationFilterSchema)

// Combine into a complete filter schema
const UserFilterSchema = createFilterSchema({
  name: stringFilterSchema(),
  age: numberFilterSchema(),
  isActive: booleanFilterSchema(),
  status: enumFilterSchema(picklist(['ACTIVE', 'INACTIVE'])),
  organization: relationFilterSchema(OrganizationFilterSchema),
});
```

### Sort Schema

```typescript
import { createSortSchema, sortDirectionSchema } from 'glasswork/list-query';

const UserSortSchema = createSortSchema({
  name: sortDirectionSchema(),
  createdAt: sortDirectionSchema(),
  // Nested fields
  'organization.name': sortDirectionSchema(),
});
```

## Complete Example

```typescript
import { createRoutes } from 'glasswork/http';
import { createListQuery, ListQuerySchema, createFilterSchema, createSortSchema, stringFilterSchema, enumFilterSchema, dateFilterSchema, sortDirectionSchema } from 'glasswork/list-query';
import { object, array, string, picklist } from 'valibot';

// Schemas
const UserFilterSchema = createFilterSchema({
  name: stringFilterSchema(),
  email: stringFilterSchema(),
  status: enumFilterSchema(picklist(['ACTIVE', 'INACTIVE', 'PENDING'])),
  createdAt: dateFilterSchema(),
});

const UserSortSchema = createSortSchema({
  name: sortDirectionSchema(),
  email: sortDirectionSchema(),
  createdAt: sortDirectionSchema(),
});

const UserDto = object({
  id: string(),
  name: string(),
  email: string(),
  status: string(),
});

const UsersListDto = object({
  data: array(UserDto),
  total: number(),
});

// Route
export const userRoutes = createRoutes<{ prisma: PrismaClient }>(
  (router, { prisma }, route) => {
    router.get('/', ...route({
      summary: 'List users with filtering, sorting, and pagination',
      query: ListQuerySchema,
      responses: { 200: UsersListDto },
      handler: async ({ query, context, session }) => {
        return createListQuery({
          filter: UserFilterSchema,
          sort: UserSortSchema,
          search: ['name', 'email'],
        })
          .parse(query, context)
          .scope({ organizationId: session.organizationId }) // Multi-tenant
          .paginate()
          .execute(async (params) => {
            const [data, total] = await Promise.all([
              prisma.user.findMany(params),
              prisma.user.count({ where: params.where }),
            ]);
            return { data, total };
          });
      },
    }));
  }
);
```

## API Request Examples

```bash
# Basic list with pagination
GET /api/users?page=1&pageSize=20

# Filter by status
GET /api/users?filters=status==ACTIVE

# Multiple filters
GET /api/users?filters=status==ACTIVE,createdAt>=2024-01-01

# Search
GET /api/users?search=john

# Sort by name ascending, then createdAt descending
GET /api/users?sorts=name,-createdAt

# Filter by multiple statuses using IN operator
GET /api/users?filters=status@=|ACTIVE|PENDING

# Filter by multiple roles and status
GET /api/users?filters=status@=|ACTIVE|PENDING,role@=|USER|ADMIN

# Combined
GET /api/users?filters=status==ACTIVE&search=john&sorts=-createdAt&page=1&pageSize=10
```

## Learn More

- [Prisma Client Queries](https://www.prisma.io/docs/orm/prisma-client/queries) - Prisma query overview
- [Prisma Aggregation & Grouping](https://www.prisma.io/docs/orm/prisma-client/queries/aggregation-grouping-summarizing) - `groupBy()`, `count()`, and aggregation functions
- [CASL Prisma](https://casl.js.org/v6/en/package/casl-prisma) - Authorization with Prisma integration
