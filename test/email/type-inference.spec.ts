import { describe, expect, it } from 'vitest';
import { tokenize } from '../../src/email/compiler/tokenizer';
import { extractTypes, generateInterface } from '../../src/email/compiler/type-extractor';

const contextOf = (template: string) =>
  generateInterface('Context', extractTypes(tokenize(template)));

const lines = (...body: string[]) => ['export interface Context {', ...body, '}'].join('\n');

describe('type inference', () => {
  describe('scopes', () => {
    it('keeps a loop variable in scope after an @if inside the loop ends', () => {
      const template = `
<!-- @each prizes as prize -->
  <!-- @if prize.imageUrl --><img src="{{prize.imageUrl}}"><!-- @end -->
  <p>{{prize.label}}</p>
<!-- @end -->`;

      expect(contextOf(template)).toBe(
        lines(
          '  prizes: Array<{',
          '    imageUrl?: string | undefined;',
          '    label: string;',
          '  }>;'
        )
      );
    });

    it('closes the innermost block with every @end, also after @else', () => {
      const template =
        '<!-- @each items as item --><!-- @if item.done -->{{item.doneAt}}<!-- @else -->{{item.dueAt}}<!-- @end -->{{item.title}}<!-- @end -->{{footer}}';

      expect(contextOf(template)).toBe(
        lines(
          '  items: Array<{',
          '    done?: boolean | undefined;',
          '    doneAt: string;',
          '    dueAt: string;',
          '    title: string;',
          '  }>;',
          '  footer: string;'
        )
      );
    });

    it('treats a name outside its loop as a context variable', () => {
      expect(
        contextOf(
          '<!-- @if visible --><!-- @each list as x -->{{x}}<!-- @end -->{{summary}}<!-- @end -->{{x}}'
        )
      ).toBe(
        lines(
          '  visible?: boolean | undefined;',
          '  list: string[];',
          '  summary: string;',
          '  x: string;'
        )
      );
    });

    it('types a loop over a property of the outer loop item', () => {
      const template =
        '<!-- @each orders as order -->{{order.number}}<!-- @each order.lines as line -->{{line.name}}<!-- @end --><!-- @end -->';

      expect(contextOf(template)).toBe(
        lines(
          '  orders: Array<{',
          '    number: string;',
          '    lines: Array<{',
          '      name: string;',
          '    }>;',
          '  }>;'
        )
      );
    });

    it('types a loop over the outer loop item', () => {
      expect(
        contextOf(
          '<!-- @each rows as row --><!-- @each row as cell -->{{cell}}<!-- @end --><!-- @end -->'
        )
      ).toBe(lines('  rows: string[][];'));
    });

    it('lets an inner loop variable shadow an outer one', () => {
      const template =
        '<!-- @each groups as item --><!-- @each item.members as item -->{{item.email}}<!-- @end -->{{item.title}}<!-- @end -->';

      expect(contextOf(template)).toBe(
        lines(
          '  groups: Array<{',
          '    members: Array<{',
          '      email: string;',
          '    }>;',
          '    title: string;',
          '  }>;'
        )
      );
    });

    it('does not add loop indexes, loop variables or string literals to the context', () => {
      const template =
        "<!-- @each items as item, i -->{{i}} {{@index + 1}}<!-- @if @first && !@last && item.kind === 'gift' -->{{item.name}}<!-- @end --><!-- @end -->";

      expect(contextOf(template)).toBe(
        lines('  items: Array<{', '    kind: string;', '    name: string;', '  }>;')
      );
    });

    it('accepts any item in a loop that does not read its items', () => {
      expect(contextOf('<!-- @each items as item -->•<!-- @end -->')).toBe(
        lines('  items: Array<{', '  }>;')
      );
    });
  });

  describe('optional values', () => {
    it('makes a value optional when the template copes with it missing', () => {
      const template = `
{{greeting ?? 'Hi'}} {{nickname || name}}
<!-- @if user -->{{user.name}}<!-- @end -->
<!-- @if account && account.isAdmin -->admin<!-- @end -->
<!-- @if settings.darkMode -->dark<!-- @end -->
{{profile?.bio}}
<!-- @if shipping --><!-- @each shipping.lines as line -->{{line}}<!-- @end --><!-- @end -->
{{member ? member.name : 'Guest'}}`;

      expect(contextOf(template)).toBe(
        lines(
          '  greeting?: string | undefined;',
          '  nickname?: string | undefined;',
          '  name: string;',
          '  user?: {',
          '    name: string;',
          '  } | undefined;',
          '  account?: {',
          '    isAdmin?: boolean | undefined;',
          '  } | undefined;',
          '  settings: {',
          '    darkMode?: boolean | undefined;',
          '  };',
          '  profile?: {',
          '    bio: string;',
          '  } | undefined;',
          '  shipping?: {',
          '    lines: string[];',
          '  } | undefined;',
          '  member?: {',
          '    name: string;',
          '  } | undefined;'
        )
      );
    });

    it('makes the branches of @elseif and the inside of a loop safe for what they test', () => {
      const template =
        '<!-- @if hasIntro -->{{intro}}<!-- @elseif teaser -->{{teaser.text}}<!-- @else -->{{fallback}}<!-- @end --><!-- @each items as item -->{{items.length}}<!-- @end -->';

      expect(contextOf(template)).toBe(
        lines(
          '  hasIntro?: boolean | undefined;',
          '  intro: string;',
          '  teaser?: {',
          '    text: string;',
          '  } | undefined;',
          '  fallback: string;',
          '  items: Array<{',
          '  }>;'
        )
      );
    });

    it('keeps a value required when one use is outside its test', () => {
      expect(contextOf('<!-- @if note -->{{note}}<!-- @end --> {{note}}')).toBe(
        lines('  note: string;')
      );
    });
  });

  describe('value types', () => {
    it('infers numbers, booleans and strings from the operators', () => {
      const template = `
{{price - discount}} {{count * 2}}
<!-- @if total > 100 -->big<!-- @end -->
<!-- @if status === 'paid' -->paid<!-- @end -->
<!-- @if attempts === 3 -->third<!-- @end -->
<!-- @if confirmed === true -->confirmed<!-- @end -->
<!-- @if isPremium -->premium<!-- @end -->
{{'Order ' + reference}} {{subtotal + shipping}}`;

      expect(contextOf(template)).toBe(
        lines(
          '  price: number;',
          '  discount: number;',
          '  count: number;',
          '  total: number;',
          '  status: string;',
          '  attempts: number;',
          '  confirmed: boolean;',
          '  isPremium?: boolean | undefined;',
          '  reference: string;',
          '  subtotal: number;',
          '  shipping: number;'
        )
      );
    });

    it('treats length as the number every array and string has', () => {
      const template = `
<!-- @if items.length > 0 --><!-- @each items as item -->{{item}}<!-- @end --><!-- @end -->
{{tags.length}} {{name}} {{name.length}}
<!-- @if notes && notes.length -->notes<!-- @end -->`;

      expect(contextOf(template)).toBe(
        lines(
          '  items: string[];',
          '  tags: {',
          '    length: number;',
          '  };',
          '  name: string;',
          '  notes?: {',
          '    length?: number | undefined;',
          '  } | undefined;'
        )
      );
    });

    it('rejects a value used both as a list and as an object', () => {
      expect(() =>
        contextOf('<!-- @each items as item -->{{item}}<!-- @end -->{{items.total}}')
      ).toThrow('items is used as a list in @each and as an object with "total"');
    });
  });

  describe('partial templates', () => {
    it('analyzes unclosed blocks and skips misplaced markers', () => {
      expect(contextOf('<!-- @each items as item -->{{item.name}}')).toBe(
        lines('  items: Array<{', '    name: string;', '  }>;')
      );
      expect(contextOf('{{a}}<!-- @end --><!-- @else -->{{b}}<!-- @elseif c -->')).toBe(
        lines('  a: string;', '  b: string;')
      );
    });
  });
});
