import { describe, expect, it } from 'vitest';
import { tokenize } from '../../src/email/compiler/tokenizer';
import { extractTypes, generateInterface } from '../../src/email/compiler/type-extractor';

describe('type-extractor', () => {
  describe('extractTypes', () => {
    it('should extract simple variable types', () => {
      const tokens = tokenize('{{name}}');
      const types = extractTypes(tokens);

      expect(types.has('name')).toBe(true);
      expect(types.get('name')).toMatchObject({
        name: 'name',
        type: 'string',
        optional: false,
      });
    });

    it('should mark variables with defaults as optional', () => {
      const tokens = tokenize("{{name ?? 'Guest'}}");
      const types = extractTypes(tokens);

      expect(types.get('name')).toMatchObject({
        name: 'name',
        type: 'string',
        optional: true,
      });
    });

    it('should extract nested object types', () => {
      const tokens = tokenize('{{user.address.city}}');
      const types = extractTypes(tokens);

      expect(types.has('user')).toBe(true);
      const userType = types.get('user');
      if (!userType) throw new Error('Expected user type');
      expect(userType.type).toBe('object');
      expect(userType.properties?.address).toBeDefined();
      expect(userType.properties?.address.properties?.city).toMatchObject({
        name: 'city',
        type: 'string',
      });
    });

    it('should extract array types from @each', () => {
      const tokens = tokenize('<!-- @each items as item -->{{item.name}}<!-- @end -->');
      const types = extractTypes(tokens);

      expect(types.has('items')).toBe(true);
      const itemsType = types.get('items');
      if (!itemsType) throw new Error('Expected items type');
      expect(itemsType.type).toBe('array');
      expect(itemsType.itemType).toBeDefined();
      expect(itemsType.itemType?.properties?.name).toMatchObject({
        name: 'name',
        type: 'string',
      });
    });

    it('should extract multiple properties from loop items', () => {
      const tokens = tokenize(
        '<!-- @each items as item -->{{item.name}} - {{item.price}}<!-- @end -->'
      );
      const types = extractTypes(tokens);

      const itemsType = types.get('items');
      if (!itemsType) throw new Error('Expected items type');
      expect(itemsType.itemType?.properties?.name).toBeDefined();
      expect(itemsType.itemType?.properties?.price).toBeDefined();
    });

    it('should extract types from conditions', () => {
      const tokens = tokenize('<!-- @if isActive -->content<!-- @end -->');
      const types = extractTypes(tokens);

      expect(types.has('isActive')).toBe(true);
    });

    it('should extract nested types from conditions', () => {
      const tokens = tokenize('<!-- @if user.isAdmin -->admin<!-- @end -->');
      const types = extractTypes(tokens);

      expect(types.has('user')).toBe(true);
      const userType = types.get('user');
      if (!userType) throw new Error('Expected user type');
      expect(userType.properties?.isAdmin).toBeDefined();
    });

    it('should handle complex conditions with && and ||', () => {
      const tokens = tokenize('<!-- @if items && items.length -->');
      const types = extractTypes(tokens);

      expect(types.has('items')).toBe(true);
    });

    it('should skip loop context variables like @index', () => {
      const tokens = tokenize('<!-- @each items as item -->{{@index}}<!-- @end -->');
      const types = extractTypes(tokens);

      // Should not have @index as a type
      expect(types.has('@index')).toBe(false);
    });

    it('should extract nested array paths', () => {
      const tokens = tokenize('<!-- @each user.orders as order -->{{order.id}}<!-- @end -->');
      const types = extractTypes(tokens);

      expect(types.has('user')).toBe(true);
      const userType = types.get('user');
      if (!userType) throw new Error('Expected user type');
      expect(userType.type).toBe('object');
      expect(userType.properties?.orders).toBeDefined();
      expect(userType.properties?.orders.type).toBe('array');
      expect(userType.properties?.orders.itemType?.properties?.id).toBeDefined();
    });

    it('should handle conditions with @index inside loops', () => {
      const tokens = tokenize(
        '<!-- @each items as item --><!-- @if @index -->{{item.name}}<!-- @end --><!-- @end -->'
      );
      const types = extractTypes(tokens);

      // Should extract items type but not @index
      expect(types.has('items')).toBe(true);
      expect(types.has('@index')).toBe(false);
    });

    it('should extract deep nested array paths', () => {
      const tokens = tokenize(
        '<!-- @each department.teams.members as member -->{{member.name}}<!-- @end -->'
      );
      const types = extractTypes(tokens);

      expect(types.has('department')).toBe(true);
      const deptType = types.get('department');
      if (!deptType) throw new Error('Expected department type');
      expect(deptType.properties?.teams).toBeDefined();
      expect(deptType.properties?.teams.properties?.members).toBeDefined();
      expect(deptType.properties?.teams.properties?.members.type).toBe('array');
    });

    it('should handle loop item property access in conditions', () => {
      const tokens = tokenize(
        '<!-- @each items as item --><!-- @if item.isActive -->{{item.name}}<!-- @end --><!-- @end -->'
      );
      const types = extractTypes(tokens);

      const itemsType = types.get('items');
      if (!itemsType) throw new Error('Expected items type');
      expect(itemsType.itemType?.properties?.isActive).toBeDefined();
      expect(itemsType.itemType?.properties?.name).toBeDefined();
    });
  });

  describe('generateInterface', () => {
    it('should generate interface for simple types', () => {
      const tokens = tokenize('{{name}} - {{email}}');
      const types = extractTypes(tokens);
      const iface = generateInterface('UserContext', types);

      expect(iface).toContain('export interface UserContext');
      expect(iface).toContain('name: string;');
      expect(iface).toContain('email: string;');
    });

    it('should generate interface with optional properties', () => {
      const tokens = tokenize("{{name ?? 'Guest'}}");
      const types = extractTypes(tokens);
      const iface = generateInterface('Context', types);

      expect(iface).toContain('name?: string;');
    });

    it('should generate interface with nested objects', () => {
      const tokens = tokenize('{{user.name}}');
      const types = extractTypes(tokens);
      const iface = generateInterface('Context', types);

      expect(iface).toContain('user: {');
      expect(iface).toContain('name: string;');
    });

    it('should generate interface with arrays', () => {
      const tokens = tokenize('<!-- @each items as item -->{{item.name}}<!-- @end -->');
      const types = extractTypes(tokens);
      const iface = generateInterface('Context', types);

      expect(iface).toContain('items: Array<{');
      expect(iface).toContain('name: string;');
      expect(iface).toContain('}>;');
    });

    it('should generate interface with simple array items', () => {
      // Test case where item type is not an object with properties
      const types = new Map();
      types.set('tags', {
        name: 'tags',
        type: 'array',
        optional: false,
        itemType: { name: 'item', type: 'string', optional: false },
      });

      const iface = generateInterface('Context', types);

      expect(iface).toContain('tags: string[];');
    });
  });
});
