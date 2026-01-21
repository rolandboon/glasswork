import { type ConditionsMatcher, PureAbility, type RawRuleOf } from '@casl/ability';
import { accessibleBy, prismaQuery } from '@casl/prisma';
import { object, optional } from 'valibot';
import { describe, expect, test } from 'vitest';
import { createListQuery } from '../../src/list-query/builder.js';
import { registerCasl, withCaslScope } from '../../src/list-query/casl.js';
import { stringFilterSchema } from '../../src/list-query/schema-helpers.js';

// Mock CASL ability with Prisma condition matcher
type Actions = 'read' | 'create' | 'update' | 'delete';
type Subjects = 'User' | 'Organization' | 'all';
type TestAbility = PureAbility<[Actions, Subjects]>;

registerCasl({ accessibleBy });

function createAbility(rules: RawRuleOf<TestAbility>[] = []) {
  return new PureAbility<[Actions, Subjects]>(rules, {
    conditionsMatcher: prismaQuery as ConditionsMatcher<unknown>,
  });
}

describe('CASL integration', () => {
  describe('withCaslScope', () => {
    test('should return conditions that can be passed to scope', () => {
      const ability = createAbility([
        { action: 'read', subject: 'Organization', conditions: { active: true } },
      ]);

      const conditions = withCaslScope(ability, 'read', 'Organization');

      // Should return the conditions object
      expect(conditions).toEqual({ OR: [{ active: true }] });

      const builder = createListQuery({
        filter: object({ name: optional(stringFilterSchema()) }),
      }).parse({});

      builder.scope(conditions);
      const params = builder.build();

      expect(params.where).toEqual({ OR: [{ active: true }] });
    });

    test('should merge CASL scope with user filters', () => {
      const ability = createAbility([
        { action: 'read', subject: 'User', conditions: { organizationId: 'org-123' } },
      ]);

      const builder = createListQuery({
        filter: object({ name: optional(stringFilterSchema()) }),
      }).parse({ filters: 'name@=john' });

      // Apply scope directly using withCaslScope result
      builder.scope(withCaslScope(ability, 'read', 'User'));

      const params = builder.build();
      expect(params.where).toEqual({
        AND: [{ name: { contains: 'john' } }, { OR: [{ organizationId: 'org-123' }] }],
      });
    });

    test('should work with different subjects', () => {
      const ability = createAbility([
        { action: 'read', subject: 'User', conditions: { userId: '123' } },
        { action: 'read', subject: 'Organization', conditions: { orgId: '456' } },
      ]);

      const userBuilder = createListQuery({
        filter: object({}),
      }).parse({});

      const orgBuilder = createListQuery({
        filter: object({}),
      }).parse({});

      userBuilder.scope(withCaslScope(ability, 'read', 'User'));
      orgBuilder.scope(withCaslScope(ability, 'read', 'Organization'));

      expect(userBuilder.build().where).toEqual({ OR: [{ userId: '123' }] });
      expect(orgBuilder.build().where).toEqual({ OR: [{ orgId: '456' }] });
    });
  });
});
