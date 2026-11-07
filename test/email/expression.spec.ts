import { describe, expect, it } from 'vitest';
import {
  type EmitScope,
  emitExpression,
  parseExpression,
} from '../../src/email/compiler/expression';

const contextScope: EmitScope = {
  root: (name) => `ctx.${name}`,
  loopVariable: (name) => `__${name}`,
};

const emit = (source: string) => emitExpression(parseExpression(source), contextScope);

/** Evaluates generated code against a context, the way a render function does. */
const evaluate = (source: string, ctx: Record<string, unknown>) =>
  new Function('ctx', `return ${emit(source)};`)(ctx);

describe('template expressions', () => {
  describe('parsing and generating code', () => {
    it.each([
      ['name', 'ctx.name'],
      ['  user.address.city  ', 'ctx.user.address.city'],
      ['user?.address?.city', 'ctx.user?.address?.city'],
      ['item.default', 'ctx.item.default'],
      ["status === 'paid'", "ctx.status === 'paid'"],
      ['count >= 2 && count < 10', 'ctx.count >= 2 && ctx.count < 10'],
      ["name ?? 'Guest'", "ctx.name ?? 'Guest'"],
      ['name || "there"', "ctx.name || 'there'"],
      ["isPro ? 'Pro' : 'Free'", "ctx.isPro ? 'Pro' : 'Free'"],
      ['a ? b : c ? d : e', 'ctx.a ? ctx.b : ctx.c ? ctx.d : ctx.e'],
      ['(a ? b : c) ? d : e', '(ctx.a ? ctx.b : ctx.c) ? ctx.d : ctx.e'],
      ['!(a && b)', '!(ctx.a && ctx.b)'],
      ['!!flag', '!!ctx.flag'],
      ['-(-a)', '-(-ctx.a)'],
      ['- -a', '-(-ctx.a)'],
      ['a - (b - c)', 'ctx.a - (ctx.b - ctx.c)'],
      ['(a - b) - c', 'ctx.a - ctx.b - ctx.c'],
      ['a * (b + c)', 'ctx.a * (ctx.b + ctx.c)'],
      ['(a || b) ?? c', '(ctx.a || ctx.b) ?? ctx.c'],
      ['a ?? (b && c)', 'ctx.a ?? (ctx.b && ctx.c)'],
      ['a ?? b ?? c', 'ctx.a ?? ctx.b ?? ctx.c'],
      ['(a && b) || c', 'ctx.a && ctx.b || ctx.c'],
      ['a && (b || c)', 'ctx.a && (ctx.b || ctx.c)'],
      ['@index + 1', '__index + 1'],
      ['1.5 * 2e3', '1.5 * 2000'],
      [
        'flag === true || value === null || other !== undefined',
        'ctx.flag === true || ctx.value === null || ctx.other !== undefined',
      ],
      ['$price', 'ctx.$price'],
    ])('reads %s as %s', (source, code) => {
      expect(emit(source)).toBe(code);
    });

    it('decodes HTML entities, which MJML and editors may write', () => {
      expect(emit('a &amp;&amp; b &gt; 1')).toBe('ctx.a && ctx.b > 1');
      expect(emit('name ?? &quot;Tom &amp; Jerry&quot;')).toBe("ctx.name ?? 'Tom & Jerry'");
      expect(emit('name ?? &quot;it&#x27;s&#34;')).toBe("ctx.name ?? 'it\\'s'");
    });

    it('generates string literals that keep every character', () => {
      const backslash = '\\';
      const source = [
        `'quote ${backslash}' and "double" ${backslash}${backslash} back'`,
        `"${backslash}n${backslash}t"`,
        `'${backslash}u00e9${backslash}x41'`,
        `'${'$'}{x}'`,
        "'`'",
      ].join(' + ');

      expect(evaluate(source, {})).toBe(
        `quote ' and "double" \\ back\n\t${String.fromCharCode(0xe9)}A\${x}\``
      );
    });

    it('evaluates like JavaScript', () => {
      const ctx = { a: 0, b: '', c: 'c', n: 5, user: { name: 'Ada' }, missing: undefined };

      expect(evaluate('a ?? c', ctx)).toBe(0);
      expect(evaluate('a || c', ctx)).toBe('c');
      expect(evaluate('missing?.name', ctx)).toBeUndefined();
      expect(evaluate('user?.name', ctx)).toBe('Ada');
      expect(evaluate('n % 2 === 1 ? "odd" : "even"', ctx)).toBe('odd');
      expect(evaluate('-n + 10 - (2 - 1)', ctx)).toBe(4);
      expect(evaluate('"Total: " + n + 1', ctx)).toBe('Total: 51');
      expect(evaluate('n + 1 + " items"', ctx)).toBe('6 items');
    });
  });

  describe('errors', () => {
    it.each([
      ['', 'the expression is empty'],
      ['   ', 'the expression is empty'],
      ['a +', 'the expression ends too early'],
      ['a b', 'unexpected "b"'],
      ['(a', 'expected ")"'],
      ['a ? b', 'expected ":"'],
      ["'open", 'the string is not closed'],
      ["'line\nbreak'", 'the string is not closed'],
      ["'\\u12'", '\\u needs 4 hexadecimal digits'],
      ['name.toUpperCase()', 'calls are not supported'],
      ['format(date)', 'calls are not supported'],
      ['items?.(0)', 'calls are not supported'],
      ['items[0]', 'computed member access is not supported'],
      ['items?.[0]', 'computed member access is not supported'],
      ["'abc'.length", 'only variables can have properties'],
      ['(a || b).c', 'only variables can have properties'],
      ['@index.value', 'only variables can have properties'],
      ['a..b', 'expected a property name after "."'],
      ['typeof a', '"typeof" cannot be used in a template expression'],
      ['new Date', '"new" cannot be used in a template expression'],
      ['this.name', '"this" cannot be used in a template expression'],
      ['user.__proto__', '"__proto__" cannot be used in a template expression'],
      ['@custom', '@custom is not a loop variable'],
      ['@ index', '@ must be followed by a loop variable'],
      ['a ?? b || c', 'use parentheses to combine ?? with && or ||'],
      ['a && b ?? c', 'use parentheses to combine ?? with && or ||'],
      ['`template`', 'unexpected character "`"'],
      ['a = 1', 'unexpected character "="'],
      ['a, b', 'unexpected ","'],
    ])('rejects %j: %s', (source, message) => {
      expect(() => parseExpression(source)).toThrow(message);
    });
  });
});
