import { describe, expect, test, vi } from 'vitest';
import { type RawRuleOf, PureAbility } from '@casl/ability';
import { prismaQuery } from '@casl/prisma';
import { object, optional } from 'valibot';
import { createCaslScope, withCaslScope } from '../../src/list-query/casl.js';
import { createListQuery } from '../../src/list-query/builder.js';
import { stringFilterSchema } from '../../src/list-query/schema-helpers.js';

// Mock CASL ability with Prisma condition matcher
type Actions = 'read' | 'create' | 'update' | 'delete';
type Subjects = 'User' | 'Organization' | 'all';
type TestAbility = PureAbility<[Actions, Subjects]>;

function createAbility(rules: RawRuleOf<TestAbility>[] = []) {
	return new PureAbility<[Actions, Subjects]>(rules, {
		conditionsMatcher: prismaQuery,
	});
}

describe('CASL integration', () => {
	describe('createCaslScope', () => {
		test('should create a scope function that applies CASL conditions', () => {
			const ability = createAbility([
				{ action: 'read', subject: 'User', conditions: { organizationId: 'org-123' } },
			]);

			const scopeFn = createCaslScope(ability, 'User');

			const builder = createListQuery({
				filter: object({ name: optional(stringFilterSchema()) }),
			}).parse({});

			const result = scopeFn(builder);

			// Should return the builder (for chaining)
			expect(result).toBe(builder);

			// Build and check that conditions were applied
			// CASL wraps single rules in OR array
			const params = builder.build();
			expect(params.where).toEqual({ OR: [{ organizationId: 'org-123' }] });
		});

		test('should handle multiple CASL conditions', () => {
			const ability = createAbility([
				{
					action: 'read',
					subject: 'User',
					conditions: { organizationId: 'org-123', active: true },
				},
			]);

			const scopeFn = createCaslScope(ability, 'User');

			const builder = createListQuery({
				filter: object({ name: optional(stringFilterSchema()) }),
			}).parse({});

			scopeFn(builder);

			const params = builder.build();
			expect(params.where).toEqual({ OR: [{ organizationId: 'org-123', active: true }] });
		});

		test('should work with empty CASL conditions', () => {
			const ability = createAbility([{ action: 'read', subject: 'User' }]);

			const scopeFn = createCaslScope(ability, 'User');

			const builder = createListQuery({
				filter: object({ name: optional(stringFilterSchema()) }),
			}).parse({ filters: 'name@=test' });

			scopeFn(builder);

			const params = builder.build();
			// Should only have the user filter, not CASL conditions
			expect(params.where).toEqual({ name: { contains: 'test' } });
		});
	});

	describe('withCaslScope', () => {
		test('should create a scope helper that accepts ability', () => {
			const ability = createAbility([
				{ action: 'read', subject: 'Organization', conditions: { active: true } },
			]);

			const scopeOrganizations = withCaslScope('Organization');

			const builder = createListQuery({
				filter: object({ name: optional(stringFilterSchema()) }),
			}).parse({});

			const result = scopeOrganizations(builder, ability);

			// Should return the builder (for chaining)
			expect(result).toBe(builder);

			const params = builder.build();
			expect(params.where).toEqual({ OR: [{ active: true }] });
		});

		test('should merge CASL scope with user filters', () => {
			const ability = createAbility([
				{ action: 'read', subject: 'User', conditions: { organizationId: 'org-123' } },
			]);

			const scopeUsers = withCaslScope('User');

			const builder = createListQuery({
				filter: object({ name: optional(stringFilterSchema()) }),
			}).parse({ filters: 'name@=john' });

			scopeUsers(builder, ability);

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

			const scopeUsers = withCaslScope('User');
			const scopeOrganizations = withCaslScope('Organization');

			const userBuilder = createListQuery({
				filter: object({}),
			}).parse({});

			const orgBuilder = createListQuery({
				filter: object({}),
			}).parse({});

			scopeUsers(userBuilder, ability);
			scopeOrganizations(orgBuilder, ability);

			expect(userBuilder.build().where).toEqual({ OR: [{ userId: '123' }] });
			expect(orgBuilder.build().where).toEqual({ OR: [{ orgId: '456' }] });
		});
	});
});

