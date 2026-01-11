# Abilities (CASL)

Glasswork provides utilities for building type-safe CASL abilities that integrate seamlessly with Prisma. Abilities define what actions users can perform on which resources.

## Defining Abilities

### Role-Based Configuration

Use `defineRoleAbilities()` for a declarative, role-based approach:

```typescript
import { defineRoleAbilities } from 'glasswork';
import type { Subjects } from '@casl/prisma';
import type { User, Project, Organization } from '@prisma/client';

// Define your subject types from Prisma models
type AppSubjects = Subjects<{
  User: User;
  Project: Project;
  Organization: Organization;
}> | 'all';

type AppAction = 'create' | 'read' | 'update' | 'delete' | 'manage';
type AppRole = 'admin' | 'member' | 'viewer';

export const abilities = defineRoleAbilities<AppSubjects, AppAction, AppRole>({
  admin: ({ can }) => {
    can('manage', 'all'); // Full access to everything
  },

  member: ({ can, cannot, user }) => {
    // Organization-scoped access
    can('read', 'Organization', { id: user.tenantId });
    can('manage', 'Project', { organizationId: user.tenantId });
    cannot('delete', 'Project'); // Override: no delete even with manage
  },

  viewer: ({ can, user }) => {
    can('read', 'Organization', { id: user.tenantId });
    can('read', 'Project', { organizationId: user.tenantId });
  },
});
```

### Factory Pattern

For more complex logic, use `createAbilityFactory()`:

```typescript
import { createAbilityFactory } from 'glasswork';

type AppSubjects = 'Project' | 'Organization' | 'all';
type AppAction = 'create' | 'read' | 'update' | 'delete' | 'manage';

const defineAbility = createAbilityFactory<AppSubjects, AppAction>()(
  (can, cannot, user) => {
    switch (user.role) {
      case 'admin':
        can('manage', 'all');
        break;
        
      case 'member':
        can('read', 'Project', { organizationId: user.tenantId });
        can('create', 'Project', { organizationId: user.tenantId });
        can('update', 'Project', { createdBy: user.id });
        break;
        
      default:
        // Guest: no abilities
    }
  }
);

// Usage
const ability = defineAbility(user);
```

## Permission Checks

### Using `assertCan`

Throw an exception if the user lacks permission:

```typescript
import { assertCan, subject } from 'glasswork';

// Check permission on a subject type
assertCan(ability, 'create', 'Project');

// Check permission on a specific resource
const project = await projectService.findById(id);
assertCan(ability, 'update', subject('Project', project));

// Custom error message
assertCan(ability, 'delete', subject('Project', project), 'Cannot delete this project');
```

### Using `can`

Check permission without throwing:

```typescript
import { can, subject } from 'glasswork';

if (can(ability, 'delete', subject('Project', project))) {
  // Show delete button
}
```

### In Route Handlers

Use the `authorize` option for automatic enforcement:

```typescript
router.post('/projects', ...route({
  authorize: { action: 'create', subject: 'Project' },
  body: CreateProjectSchema,
  handler: async ({ body, ability, user }) => {
    // Route won't execute unless user can create Project
    return projectService.create(body, user!.id);
  },
}));
```

Or check manually in the handler:

```typescript
handler: async ({ params, ability }) => {
  const project = await projectService.findById(params.id);
  if (!project) throw new NotFoundException('Project not found');
  
  assertCan(ability, 'update', subject('Project', project));
  
  return projectService.update(params.id, body);
}
```

## Prisma Integration

### Filtering with `accessibleBy`

CASL's Prisma integration lets you filter database queries based on abilities:

```typescript
import { accessibleBy } from '@casl/prisma';
import type { AppAbility } from './abilities';

export class ProjectService {
  constructor(private prisma: PrismaClient) {}

  async findAll(ability: AppAbility): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: accessibleBy(ability).Project,
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

This automatically filters to only projects the user can access based on their abilities.

### Combining with Other Filters

```typescript
async findByStatus(ability: AppAbility, status: string): Promise<Project[]> {
  return this.prisma.project.findMany({
    where: {
      AND: [
        accessibleBy(ability).Project,
        { status },
      ],
    },
  });
}
```

## Type Safety

### Inferring Ability Type

```typescript
import type { InferAbility } from 'glasswork';

// Extract ability type from your definition
type AppAbility = ReturnType<typeof abilities.for>;

// Or use InferAbility helper
type AppAbility = InferAbility<typeof defineAbility>;
```

### Type-Safe Subject Helper

The `subject()` helper ensures type safety when checking permissions on instances:

```typescript
import { subject } from 'glasswork';

// TypeScript ensures project matches Project model
const project: Project = await projectService.findById(id);
assertCan(ability, 'update', subject('Project', project));

// Compile error: 'Foo' is not a valid subject
assertCan(ability, 'update', subject('Foo', project)); // ❌ Type error
```

## Common Patterns

### Multi-Tenancy

Restrict access to resources within a tenant:

```typescript
member: ({ can, user }) => {
  // User can only access resources in their organization
  can('read', 'Project', { organizationId: user.tenantId });
  can('read', 'User', { organizationId: user.tenantId });
  can('read', 'Organization', { id: user.tenantId });
},
```

### Ownership-Based Access

Allow users to manage only their own resources:

```typescript
member: ({ can, user }) => {
  // Can read all projects in org
  can('read', 'Project', { organizationId: user.tenantId });
  
  // Can only update/delete own projects
  can('update', 'Project', { createdBy: user.id });
  can('delete', 'Project', { createdBy: user.id });
},
```

### Field-Level Permissions

Restrict which fields can be updated:

```typescript
member: ({ can, user }) => {
  // Can update name and description
  can('update', 'Project', ['name', 'description'], { 
    organizationId: user.tenantId 
  });
  
  // Cannot update status (admin only)
},
```

### Hierarchical Roles

Build role hierarchies where higher roles inherit lower role permissions:

```typescript
const basePermissions = (can, user) => {
  can('read', 'Project', { organizationId: user.tenantId });
};

const memberPermissions = (can, user) => {
  basePermissions(can, user);
  can('create', 'Project', { organizationId: user.tenantId });
};

const adminPermissions = (can, user) => {
  memberPermissions(can, user);
  can('manage', 'Project', { organizationId: user.tenantId });
};

export const abilities = defineRoleAbilities({
  admin: ({ can, user }) => adminPermissions(can, user),
  member: ({ can, user }) => memberPermissions(can, user),
  viewer: ({ can, user }) => basePermissions(can, user),
});
```

## Testing Abilities

Test abilities in isolation:

```typescript
import { abilities } from './abilities';
import { subject } from 'glasswork';

describe('abilities', () => {
  describe('admin', () => {
    const ability = abilities.forRole('admin');

    it('can manage all resources', () => {
      expect(ability.can('manage', 'all')).toBe(true);
      expect(ability.can('delete', 'Project')).toBe(true);
    });
  });

  describe('member', () => {
    const ability = abilities.forRole('member', {
      id: 'user-1',
      tenantId: 'org-1',
    });

    it('can read projects in their organization', () => {
      expect(ability.can('read', subject('Project', {
        organizationId: 'org-1',
      }))).toBe(true);
    });

    it('cannot read projects in other organizations', () => {
      expect(ability.can('read', subject('Project', {
        organizationId: 'org-2',
      }))).toBe(false);
    });

    it('can only update projects they created', () => {
      expect(ability.can('update', subject('Project', {
        organizationId: 'org-1',
        createdBy: 'user-1',
      }))).toBe(true);

      expect(ability.can('update', subject('Project', {
        organizationId: 'org-1',
        createdBy: 'user-2',
      }))).toBe(false);
    });
  });
});
```

## Next Steps

- [Middleware](./middleware) - Configure auth middleware with abilities
- [Testing](./testing) - Testing patterns for auth flows
