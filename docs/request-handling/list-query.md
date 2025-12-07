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
import {
  createFilterSchema,
  createSortSchema,
  stringFilterSchema,
  enumFilterSchema,
  dateFilterSchema,
  sortDirectionSchema,
} from 'glasswork';
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

```typescript
import { createListQuery, ListQuerySchema } from 'glasswork';

export const userRoutes = createRoutes<{ userService: UserService }>(
  (router, { userService }, route) => {
    router.get('/', ...route({
      summary: 'List users',
      query: ListQuerySchema,
      responses: { 200: UsersResponseDto },
      handler: async ({ query, context }) => {
        return createListQuery({
          filter: UserFilterSchema,
          sort: UserSortSchema,
        })
          .parse(query, context)
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

## Query Parameters

The `ListQuerySchema` accepts these query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `filters` | string | Filter expression (see syntax below) |
| `sorts` | string | Sort expression (see syntax below) |
| `page` | number | Page number (default: 1) |
| `pageSize` | number | Items per page (default: 10, max: 100) |
| `search` | string | Global search term |

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
| `dateFilterSchema()` | `==`, `!=`, `>`, `<`, `>=`, `<=` |
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

## Aggregations

Compute counts by field value for faceted search interfaces:

```typescript
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
  .execute(async (params) => {
    const [data, total, statusAgg, roleAgg] = await Promise.all([
      prisma.user.findMany(params),
      prisma.user.count({ where: params.where }),
      prisma.user.groupBy(params.aggregations!.byStatus),
      prisma.user.groupBy(params.aggregations!.byRole),
    ]);

    // Transform Prisma groupBy results into count objects
    // Prisma returns: [{ status: 'ACTIVE', _count: { _all: 75 } }, ...]
    // We want: { 'ACTIVE': 75, 'INACTIVE': 20, ... }
    const transformGroupBy = (results: any[], field: string) => {
      return results.reduce((acc, item) => {
        acc[item[field]] = item._count._all;
        return acc;
      }, {} as Record<string, number>);
    };

    return {
      data,
      total,
      aggregations: {
        byStatus: transformGroupBy(statusAgg, 'status'),
        byRole: transformGroupBy(roleAgg, 'role'),
      },
    };
  });
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
import { createCaslScope, withCaslScope } from 'glasswork';
import { accessibleBy } from '@casl/prisma';

// Using withCaslScope helper
createListQuery({ filter: UserFilterSchema, sort: UserSortSchema })
  .parse(query, context)
  .scope(withCaslScope(ability, 'read', 'User'))
  .paginate()
  .execute(/* ... */);

// Or create scope manually
const caslWhere = accessibleBy(ability, 'read').User;
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
import {
  stringFilterSchema,
  numberFilterSchema,
  dateFilterSchema,
  booleanFilterSchema,
  enumFilterSchema,
  relationFilterSchema,
  createFilterSchema,
} from 'glasswork';

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
import { createSortSchema, sortDirectionSchema } from 'glasswork';

const UserSortSchema = createSortSchema({
  name: sortDirectionSchema(),
  createdAt: sortDirectionSchema(),
  // Nested fields
  'organization.name': sortDirectionSchema(),
});
```

## Complete Example

```typescript
import {
  createRoutes,
  createListQuery,
  ListQuerySchema,
  createFilterSchema,
  createSortSchema,
  stringFilterSchema,
  enumFilterSchema,
  dateFilterSchema,
  sortDirectionSchema,
} from 'glasswork';
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
