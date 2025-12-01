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
      const userType = types.get('user')!;
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
      const itemsType = types.get('items')!;
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

      const itemsType = types.get('items')!;
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
      const userType = types.get('user')!;
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
  });
});
