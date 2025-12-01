import { describe, expect, it } from 'vitest';
import { tokenize } from '../../src/email/compiler/tokenizer';

describe('tokenizer', () => {
  describe('text tokens', () => {
    it('should tokenize plain text', () => {
      const tokens = tokenize('Hello, world!');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'text',
        content: 'Hello, world!',
      });
    });

    it('should preserve whitespace in text', () => {
      const tokens = tokenize('  Hello  \n  World  ');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'text',
        content: '  Hello  \n  World  ',
      });
    });
  });

  describe('variable tokens', () => {
    it('should tokenize simple variables', () => {
      const tokens = tokenize('Hello {{name}}!');
      expect(tokens).toHaveLength(3);
      expect(tokens[0]).toMatchObject({ type: 'text', content: 'Hello ' });
      expect(tokens[1]).toMatchObject({
        type: 'variable',
        expression: 'name',
        path: ['name'],
      });
      expect(tokens[2]).toMatchObject({ type: 'text', content: '!' });
    });

    it('should tokenize nested property access', () => {
      const tokens = tokenize('{{user.address.city}}');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'variable',
        expression: 'user.address.city',
        path: ['user', 'address', 'city'],
      });
    });

    it('should tokenize variables with default values', () => {
      const tokens = tokenize("{{name ?? 'Guest'}}");
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'variable',
        path: ['name'],
        defaultValue: 'Guest',
      });
    });

    it('should handle whitespace in variable expressions', () => {
      const tokens = tokenize('{{ name }}');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'variable',
        expression: 'name',
        path: ['name'],
      });
    });

    it('should tokenize multiple variables', () => {
      const tokens = tokenize('{{first}} and {{second}}');
      expect(tokens).toHaveLength(3);
      expect(tokens[0]).toMatchObject({ type: 'variable', path: ['first'] });
      expect(tokens[1]).toMatchObject({ type: 'text', content: ' and ' });
      expect(tokens[2]).toMatchObject({ type: 'variable', path: ['second'] });
    });
  });

  describe('conditional tokens', () => {
    it('should tokenize @if directive', () => {
      const tokens = tokenize('<!-- @if isActive -->content<!-- @end -->');
      expect(tokens).toHaveLength(3);
      expect(tokens[0]).toMatchObject({
        type: 'if',
        condition: 'isActive',
      });
      expect(tokens[1]).toMatchObject({ type: 'text', content: 'content' });
      expect(tokens[2]).toMatchObject({ type: 'end' });
    });

    it('should tokenize @if with complex condition', () => {
      const tokens = tokenize('<!-- @if items && items.length -->');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'if',
        condition: 'items && items.length',
      });
    });

    it('should tokenize negated conditions', () => {
      const tokens = tokenize('<!-- @if !isGuest -->');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'if',
        condition: '!isGuest',
      });
    });

    it('should tokenize @elseif directive', () => {
      const tokens = tokenize('<!-- @elseif isPending -->');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'elseif',
        condition: 'isPending',
      });
    });

    it('should tokenize @else directive', () => {
      const tokens = tokenize('<!-- @else -->');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: 'else' });
    });

    it('should tokenize complete if-elseif-else-end chain', () => {
      const tokens = tokenize('<!-- @if a -->A<!-- @elseif b -->B<!-- @else -->C<!-- @end -->');
      expect(tokens).toHaveLength(7);
      expect(tokens.map((t) => t.type)).toEqual([
        'if',
        'text',
        'elseif',
        'text',
        'else',
        'text',
        'end',
      ]);
    });
  });

  describe('loop tokens', () => {
    it('should tokenize @each directive', () => {
      const tokens = tokenize('<!-- @each items as item -->');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'each',
        arrayPath: 'items',
        itemName: 'item',
        indexName: undefined,
      });
    });

    it('should tokenize @each with index', () => {
      const tokens = tokenize('<!-- @each items as item, i -->');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'each',
        arrayPath: 'items',
        itemName: 'item',
        indexName: 'i',
      });
    });

    it('should tokenize @each with nested path', () => {
      const tokens = tokenize('<!-- @each order.items as item -->');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'each',
        arrayPath: 'order.items',
        itemName: 'item',
      });
    });

    it('should throw on invalid @each syntax', () => {
      expect(() => tokenize('<!-- @each items -->')).toThrow(/Invalid @each syntax/);
    });
  });

  describe('complex templates', () => {
    it('should tokenize a complete template', () => {
      const template = `
<div>Hello {{name ?? 'there'}},</div>
<!-- @if hasItems -->
<ul>
<!-- @each items as item -->
<li>{{item.name}}: {{item.price}}</li>
<!-- @end -->
</ul>
<!-- @else -->
<p>No items</p>
<!-- @end -->
`;
      const tokens = tokenize(template);

      // Check that we have all expected token types
      const types = tokens.map((t) => t.type);
      expect(types).toContain('text');
      expect(types).toContain('variable');
      expect(types).toContain('if');
      expect(types).toContain('each');
      expect(types).toContain('else');
      expect(types).toContain('end');
    });

    it('should preserve HTML in text tokens', () => {
      const tokens = tokenize('<div class="greeting">Hello</div>');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'text',
        content: '<div class="greeting">Hello</div>',
      });
    });
  });
});
