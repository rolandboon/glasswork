import { describe, expect, test } from 'vitest';
import { parse, picklist } from 'valibot';
import {
	booleanFilterSchema,
	createFilterSchema,
	createSortSchema,
	dateFilterSchema,
	enumFilterSchema,
	numberFilterSchema,
	relationFilterSchema,
	sortDirectionSchema,
	stringFilterSchema,
} from '../../src/list-query/schema-helpers.js';

describe('schema-helpers', () => {
	describe('sortDirectionSchema', () => {
		test('should validate asc', () => {
			const schema = sortDirectionSchema();
			const result = parse(schema, 'asc');
			expect(result).toBe('asc');
		});

		test('should validate desc', () => {
			const schema = sortDirectionSchema();
			const result = parse(schema, 'desc');
			expect(result).toBe('desc');
		});

		test('should reject invalid values', () => {
			const schema = sortDirectionSchema();
			expect(() => parse(schema, 'invalid')).toThrow();
		});
	});

	describe('stringFilterSchema', () => {
		test('should validate equals', () => {
			const schema = stringFilterSchema();
			const result = parse(schema, { equals: 'test' });
			expect(result).toEqual({ equals: 'test' });
		});

		test('should validate contains with mode', () => {
			const schema = stringFilterSchema();
			const result = parse(schema, { contains: 'test', mode: 'insensitive' });
			expect(result).toEqual({ contains: 'test', mode: 'insensitive' });
		});

		test('should validate startsWith', () => {
			const schema = stringFilterSchema();
			const result = parse(schema, { startsWith: 'prefix' });
			expect(result).toEqual({ startsWith: 'prefix' });
		});

		test('should validate endsWith', () => {
			const schema = stringFilterSchema();
			const result = parse(schema, { endsWith: 'suffix' });
			expect(result).toEqual({ endsWith: 'suffix' });
		});

		test('should validate not with string', () => {
			const schema = stringFilterSchema();
			const result = parse(schema, { not: 'test' });
			expect(result).toEqual({ not: 'test' });
		});

		test('should validate not with object', () => {
			const schema = stringFilterSchema();
			const result = parse(schema, { not: { equals: 'test' } });
			expect(result).toEqual({ not: { equals: 'test' } });
		});
	});

	describe('numberFilterSchema', () => {
		test('should validate equals with number string', () => {
			const schema = numberFilterSchema();
			const result = parse(schema, { equals: '42' });
			expect(result).toEqual({ equals: '42' });
		});

		test('should validate comparison operators', () => {
			const schema = numberFilterSchema();
			const result = parse(schema, { gt: '10', lte: '100' });
			expect(result).toEqual({ gt: '10', lte: '100' });
		});

		test('should validate lt and gt', () => {
			const schema = numberFilterSchema();
			const result = parse(schema, { lt: '50', gt: '10' });
			expect(result).toEqual({ lt: '50', gt: '10' });
		});

		test('should validate not', () => {
			const schema = numberFilterSchema();
			const result = parse(schema, { not: '42' });
			expect(result).toEqual({ not: '42' });
		});

		test('should allow boolean literals', () => {
			const schema = numberFilterSchema();
			const result = parse(schema, { equals: true });
			expect(result).toEqual({ equals: true });
		});
	});

	describe('dateFilterSchema', () => {
		test('should validate equals', () => {
			const schema = dateFilterSchema();
			const result = parse(schema, { equals: '2024-01-01' });
			expect(result).toEqual({ equals: '2024-01-01' });
		});

		test('should validate range with gt and lt', () => {
			const schema = dateFilterSchema();
			const result = parse(schema, { gt: '2024-01-01', lt: '2024-12-31' });
			expect(result).toEqual({ gt: '2024-01-01', lt: '2024-12-31' });
		});

		test('should validate gte and lte', () => {
			const schema = dateFilterSchema();
			const result = parse(schema, { gte: '2024-01-01', lte: '2024-12-31' });
			expect(result).toEqual({ gte: '2024-01-01', lte: '2024-12-31' });
		});

		test('should validate not', () => {
			const schema = dateFilterSchema();
			const result = parse(schema, { not: '2024-01-01' });
			expect(result).toEqual({ not: '2024-01-01' });
		});
	});

	describe('booleanFilterSchema', () => {
		test('should validate equals true', () => {
			const schema = booleanFilterSchema();
			const result = parse(schema, { equals: true });
			expect(result).toEqual({ equals: true });
		});

		test('should validate equals false', () => {
			const schema = booleanFilterSchema();
			const result = parse(schema, { equals: false });
			expect(result).toEqual({ equals: false });
		});

		test('should validate not', () => {
			const schema = booleanFilterSchema();
			const result = parse(schema, { not: true });
			expect(result).toEqual({ not: true });
		});

		test('should reject string values', () => {
			const schema = booleanFilterSchema();
			expect(() => parse(schema, { equals: 'true' })).toThrow();
		});
	});

	describe('enumFilterSchema', () => {
		test('should validate enum equals', () => {
			const RoleSchema = picklist(['ADMIN', 'USER', 'GUEST']);
			const schema = enumFilterSchema(RoleSchema);
			const result = parse(schema, { equals: 'ADMIN' });
			expect(result).toEqual({ equals: 'ADMIN' });
		});

		test('should validate enum not', () => {
			const RoleSchema = picklist(['ADMIN', 'USER', 'GUEST']);
			const schema = enumFilterSchema(RoleSchema);
			const result = parse(schema, { not: 'GUEST' });
			expect(result).toEqual({ not: 'GUEST' });
		});

		test('should reject invalid enum values', () => {
			const RoleSchema = picklist(['ADMIN', 'USER', 'GUEST']);
			const schema = enumFilterSchema(RoleSchema);
			expect(() => parse(schema, { equals: 'INVALID' })).toThrow();
		});
	});

	describe('relationFilterSchema', () => {
		test('should validate relation is', () => {
			const nestedSchema = stringFilterSchema();
			const schema = relationFilterSchema(nestedSchema);
			const result = parse(schema, { is: { equals: 'test' } });
			expect(result).toEqual({ is: { equals: 'test' } });
		});

		test('should validate relation isNot', () => {
			const nestedSchema = stringFilterSchema();
			const schema = relationFilterSchema(nestedSchema);
			const result = parse(schema, { isNot: { equals: 'test' } });
			expect(result).toEqual({ isNot: { equals: 'test' } });
		});
	});

	describe('createSortSchema', () => {
		test('should create a sort schema with multiple fields', () => {
			const schema = createSortSchema({
				name: sortDirectionSchema(),
				createdAt: sortDirectionSchema(),
			});

			const result = parse(schema, { name: 'asc', createdAt: 'desc' });
			expect(result).toEqual({ name: 'asc', createdAt: 'desc' });
		});

		test('should allow partial sort fields', () => {
			const schema = createSortSchema({
				name: sortDirectionSchema(),
				createdAt: sortDirectionSchema(),
			});

			const result = parse(schema, { name: 'asc' });
			expect(result).toEqual({ name: 'asc' });
		});

		test('should allow empty sort', () => {
			const schema = createSortSchema({
				name: sortDirectionSchema(),
			});

			const result = parse(schema, {});
			expect(result).toEqual({});
		});
	});

	describe('createFilterSchema', () => {
		test('should create a filter schema with multiple fields', () => {
			const schema = createFilterSchema({
				name: stringFilterSchema(),
				age: numberFilterSchema(),
				active: booleanFilterSchema(),
			});

			const result = parse(schema, {
				name: { contains: 'john' },
				age: { gt: '18' },
				active: { equals: true },
			});

			expect(result).toEqual({
				name: { contains: 'john' },
				age: { gt: '18' },
				active: { equals: true },
			});
		});

		test('should allow partial filters', () => {
			const schema = createFilterSchema({
				name: stringFilterSchema(),
				active: booleanFilterSchema(),
			});

			const result = parse(schema, { name: { equals: 'test' } });
			expect(result).toEqual({ name: { equals: 'test' } });
		});

		test('should allow empty filters', () => {
			const schema = createFilterSchema({
				name: stringFilterSchema(),
			});

			const result = parse(schema, {});
			expect(result).toEqual({});
		});
	});
});

