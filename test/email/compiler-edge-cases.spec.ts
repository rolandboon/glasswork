import { describe, expect, it } from 'vitest';
import { compile } from '../../src/email/compiler/compiler';
import { renderBody, typecheck, wrapInHtml } from '../helpers/email-template';

const compileBody = (source: string, name = 'test') => compile(source, name, wrapInHtml);

describe('compiler edge cases', () => {
  describe('blocks', () => {
    it('rejects an unclosed block', async () => {
      await expect(compileBody('<!-- @if a -->A')).rejects.toThrow(
        'Unclosed @if block, add an <!-- @end -->: <!-- @if a -->'
      );
      await expect(compileBody('<ul><!-- @each items as item --><li>x</li></ul>')).rejects.toThrow(
        'Unclosed @each block, add an <!-- @end -->: <!-- @each items as item -->'
      );
    });

    it('rejects an @end without an open block', async () => {
      await expect(compileBody('A<!-- @end -->B')).rejects.toThrow(
        '@end without an open @if or @each block: <!-- @end -->'
      );
    });

    it('closes the innermost block with every @end', async () => {
      const render = await renderBody(
        '<!-- @if visible -->[<!-- @each items as item --><!-- @if item.on -->+<!-- @elseif item.half -->~<!-- @else -->-<!-- @end -->{{item.n}}<!-- @end -->]<!-- @else -->none<!-- @end -->'
      );
      const items = [{ on: true, n: 1 }, { half: true, n: 2 }, { n: 3 }];

      expect(render({ visible: true, items })).toBe('[+1~2-3]');
      expect(render({ visible: false, items })).toBe('none');
    });
  });

  describe('loops', () => {
    it('reads a name from the context outside the loop that declares it', async () => {
      const render = await renderBody(
        '<p>{{name}}</p><!-- @each people as name --><i>{{name}}</i><!-- @end --><p>{{name}}</p>'
      );

      expect(render({ name: 'Top', people: ['a', 'b'] })).toBe(
        '<p>Top</p><i>a</i><i>b</i><p>Top</p>'
      );
    });

    it('loops over a property of the outer item and over nested arrays', async () => {
      const render = await renderBody(
        '<!-- @each orders as order -->#{{order.number}}:<!-- @each order.lines as line -->{{line.name}},<!-- @end -->;<!-- @end -->|<!-- @each rows as row --><!-- @each row as cell -->{{cell}}<!-- @end -->/<!-- @end -->'
      );

      expect(
        render({
          orders: [
            { number: 1, lines: [{ name: 'a' }, { name: 'b' }] },
            { number: 2, lines: [] },
          ],
          rows: [['x', 'y'], ['z']],
        })
      ).toBe('#1:a,b,;#2:;|xy/z/');
    });

    it('gives the loop variables of the innermost loop, also with a named index', async () => {
      const render = await renderBody(
        "<!-- @each groups as group, g --><!-- @each group.items as item, i -->{{g}}.{{i}}:{{@index}}/{{@length}}{{@first ? 'F' : ''}}{{@last ? 'L' : ''}};<!-- @end --><!-- @end -->"
      );

      expect(render({ groups: [{ items: ['a', 'b'] }, { items: ['c'] }] })).toBe(
        '0.0:0/2F;0.1:1/2L;1.0:0/1FL;'
      );
    });

    it('lets an inner loop variable shadow an outer one', async () => {
      const render = await renderBody(
        '<!-- @each groups as item --><!-- @each item.members as item -->{{item.email}},<!-- @end -->{{item.title}};<!-- @end -->'
      );

      expect(render({ groups: [{ title: 'G', members: [{ email: 'e' }, { email: 'f' }] }] })).toBe(
        'e,f,G;'
      );
    });

    it.each([
      ['ctx', 'is used by the generated render function'],
      ['escapeHtml', 'is used by the generated render function'],
      ['sanitizeUrl', 'is used by the generated render function'],
      ['String', 'is used by the generated render function'],
      ['__index', 'is used by the generated render function'],
      ['class', 'is a reserved word'],
      ['undefined', 'is a reserved word'],
    ])('rejects the loop variable name %s', async (name, problem) => {
      await expect(compileBody(`<!-- @each items as ${name} -->x<!-- @end -->`)).rejects.toThrow(
        `Loop variable "${name}" ${problem}`
      );
    });

    it('rejects an item and index with the same name', async () => {
      await expect(compileBody('<!-- @each items as item, item -->x<!-- @end -->')).rejects.toThrow(
        'The item and index of a loop need different names'
      );
    });

    it('rejects looping over an index, reading its properties and loop variables outside a loop', async () => {
      await expect(
        compileBody(
          '<!-- @each items as item, i --><!-- @each i as x -->x<!-- @end --><!-- @end -->'
        )
      ).rejects.toThrow('Cannot loop over the loop index "i"');
      await expect(
        compileBody('<!-- @each items as item, i -->{{i.value}}<!-- @end -->')
      ).rejects.toThrow('Loop index "i" is a number and has no properties: {{i.value}}');
      await expect(compileBody('<p>{{@index}}</p>')).rejects.toThrow(
        '@index can only be used inside an @each block: {{@index}}'
      );
      await expect(compileBody('<!-- @if @first -->x<!-- @end -->')).rejects.toThrow(
        '@first can only be used inside an @each block: <!-- @if @first -->'
      );
    });
  });

  describe('expressions', () => {
    it('compares with string literals, which may contain hyphens', async () => {
      const render = await renderBody(
        "<!-- @if status === 'paid' -->Paid<!-- @elseif status !== 'pre-order' -->Open<!-- @else -->Soon<!-- @end -->"
      );

      expect(render({ status: 'paid' })).toBe('Paid');
      expect(render({ status: 'open' })).toBe('Open');
      expect(render({ status: 'pre-order' })).toBe('Soon');
    });

    it('supports optional chaining, conditional expressions, fallbacks and arithmetic', async () => {
      const render = await renderBody(
        "{{user?.name ?? 'Guest'}}|{{isPro ? 'Pro' : 'Free'}}|{{nickname || 'there'}}|{{count ?? 0}}|{{total + fee}}|{{price * quantity}}|<!-- @if user?.isAdmin -->admin<!-- @end -->"
      );

      expect(render({ isPro: true, nickname: '', total: 1, fee: 2, price: 2.5, quantity: 4 })).toBe(
        'Guest|Pro|there|0|3|10|'
      );
      expect(
        render({
          user: { name: 'Ada', isAdmin: true },
          count: 7,
          total: 1,
          fee: 1,
          price: 1,
          quantity: 1,
        })
      ).toBe('Ada|Free|there|7|2|1|admin');
    });

    it('decodes entities in conditions and inserts raw HTML from a logical expression', async () => {
      const render = await renderBody(
        '<!-- @if a &amp;&amp; b &gt; 1 -->yes<!-- @end -->{{{intro || fallbackHtml}}}'
      );

      expect(render({ a: true, b: 2, intro: '', fallbackHtml: '<b>hi</b>' })).toBe('yes<b>hi</b>');
    });

    it('names the template location of an invalid expression', async () => {
      await expect(compileBody('<p>{{name.toUpperCase()}}</p>')).rejects.toThrow(
        'Invalid expression in {{name.toUpperCase()}}: calls are not supported'
      );
      await expect(compileBody('<!-- @if items[0] -->x<!-- @end -->')).rejects.toThrow(
        'Invalid expression in <!-- @if items[0] -->: computed member access is not supported'
      );
      await expect(compileBody('<p>{{a +}}</p>')).rejects.toThrow(
        'Invalid expression in {{a +}}: the expression ends too early'
      );
    });
  });

  describe('literal text', () => {
    it('keeps backslashes, backticks and ${ in the HTML', async () => {
      const text = ['C:', 'temp', 'new'].join('\\').concat(' `code` $', '{price} ');
      const render = await renderBody(`<p>${text}{{name}}</p>`);

      expect(render({ name: 'Ada' })).toBe(`<p>${text}Ada</p>`);
    });

    it("keeps $& and $' in defaults and text", async () => {
      const render = await renderBody("<p>{{symbol ?? '$'}}{{amount}} $& $' $$ US$'s</p>");

      expect(render({ amount: '12' })).toBe("<p>$12 $& $' $$ US$'s</p>");
    });

    it('treats text that looks like generated code as text', async () => {
      const text = '__GW_EXPR_START__$'.concat('{1 + 1}__GW_EXPR_END__ __GW_EXPR_PLACEHOLDER_0__');
      const render = await renderBody(`<p>${text}</p>`);

      expect(render({})).toBe(`<p>${text}</p>`);
    });
  });

  describe('generated module', () => {
    it('declares only the helpers and parameters a template uses', async () => {
      const staticTemplate = await compileBody('<p>Hello</p>', 'static-template');
      const textOnly = await compileBody('<p>{{name}}</p>');
      const unusedLoopVariables = await compileBody(
        '<!-- @each items as item, i -->•<!-- @end --><!-- @each list as entry, j -->{{entry}}<!-- @end -->'
      );

      expect(staticTemplate.source).toContain(
        'export function render(_ctx: StaticTemplateContext)'
      );
      expect(staticTemplate.source).not.toContain('function escapeHtml');
      expect(staticTemplate.source).not.toContain('function sanitizeUrl');
      expect(textOnly.source).toContain('function escapeHtml');
      expect(textOnly.source).not.toContain('function sanitizeUrl');
      expect(unusedLoopVariables.source).toContain('__array.map((__item, __index) =>');
      expect(unusedLoopVariables.source).toContain('__array.map((entry, __index) =>');
    });

    it('type-checks with strict compiler options, together with an application that renders it', async () => {
      const invitation = await compileBody(
        `<!-- @if hasLogo --><img src="{{logoUrl}}" alt="{{organizer}}"><!-- @end -->
<h1>{{title}}</h1>
<!-- @each prizes as prize -->
  <p>{{prize.label}}</p>
  <!-- @if prize.imageUrl --><img src="{{prize.imageUrl}}" alt=""><!-- @end -->
<!-- @end -->
<!-- @if message --><!-- @each message.lines as line --><p>{{line}}</p><!-- @end --><!-- @end -->
<a href="{{pageUrl}}">Open</a>
<!-- @if showBrand --><p>Made with Example</p><!-- @end -->`,
        'invitation'
      );
      const others = await Promise.all([
        compileBody('<p>Hello</p>', 'static'),
        compileBody(
          '<!-- @each orders as order, o --><!-- @each order.lines as line -->{{o}}{{@index + 1}}{{line.name}}<!-- @end --><!-- @end -->',
          'nested'
        ),
        compileBody(
          "<p>{{total - discount}} {{{html || 'none'}}} {{status === 'paid' ? 'Paid' : 'Open'}}</p>",
          'expressions'
        ),
      ]);

      expect(invitation.contextInterface).toBe(
        [
          'export interface InvitationContext {',
          '  hasLogo?: boolean | undefined;',
          '  logoUrl: string;',
          '  organizer: string;',
          '  title: string;',
          '  prizes: Array<{',
          '    label: string;',
          '    imageUrl?: string | undefined;',
          '  }>;',
          '  message?: {',
          '    lines: string[];',
          '  } | undefined;',
          '  pageUrl: string;',
          '  showBrand?: boolean | undefined;',
          '}',
        ].join('\n')
      );
      const application = `import { render } from './invitation.js';

const base = {
  logoUrl: 'https://example.com/logo.png',
  organizer: 'Ada',
  title: 'Christmas raffle',
  prizes: [{ label: 'Bike' }, { label: 'Book', imageUrl: 'https://example.com/book.png' }],
  pageUrl: 'https://example.com/p/1',
};

render(base);
render({ ...base, hasLogo: true, showBrand: false, message: { lines: ['Hi', 'all'] } });
render({ ...base, hasLogo: undefined, prizes: [{ label: 'Bike', imageUrl: undefined }] });

// @ts-expect-error A value that is only tested is a boolean.
render({ ...base, hasLogo: 'yes' });
// @ts-expect-error A printed value is required.
render({ ...base, title: undefined });
// @ts-expect-error Loop items need the properties the loop prints.
render({ ...base, prizes: [{ imageUrl: 'https://example.com/x.png' }] });
`;

      expect(
        typecheck({
          'invitation.ts': invitation.source,
          'static.ts': others[0].source,
          'nested.ts': others[1].source,
          'expressions.ts': others[2].source,
          'application.ts': application,
        })
      ).toBe('');
    });
  });

  describe('dynamic attributes', () => {
    it('allows text that looks like an attribute', async () => {
      const render = await renderBody('<p>total={{total}} href={{url}}</p>');

      expect(render({ total: 3, url: 'x' })).toBe('<p>total=3 href=x</p>');
    });

    it('rejects a variable as an attribute or tag name', async () => {
      await expect(compileBody('<a {{attributes}}>x</a>')).rejects.toThrow(
        'Variables inside an HTML tag must be in a quoted attribute value'
      );
      await expect(compileBody('<{{tag}}>x</{{tag}}>')).rejects.toThrow(
        'A variable cannot be an HTML tag name'
      );
    });

    it('checks URLs in single quotes and in Outlook conditional comments', async () => {
      const render = await renderBody("<a href='{{url}}'>x</a>");

      expect(render({ url: 'javascript:alert(1)' })).toBe("<a href='#'>x</a>");
      await expect(
        compileBody('<!--[if mso]><v:fill src="{{base}}/bg.png" /><![endif]-->')
      ).rejects.toThrow(
        'Dynamic href/src attributes must contain one complete double-brace URL expression'
      );
    });
  });

  describe('subject', () => {
    it('decodes entities and collapses whitespace', async () => {
      const result = await compileBody(
        '<mj-title>Tom &amp; Jerry\n   say &quot;hi&quot; &#8211; again</mj-title><p>x</p>'
      );

      expect(result.subject).toBe(`Tom & Jerry say "hi" ${String.fromCharCode(8211)} again`);
    });

    it('has no default subject when the title contains a variable', async () => {
      expect(
        (await compileBody('<mj-title>Hello {{name}}</mj-title><p>x</p>')).subject
      ).toBeUndefined();
    });

    it('falls back to the title in the compiled HTML', async () => {
      const result = await compile('<p>x</p>', 'test', () => ({
        html: '<html><head><title> From HTML </title></head><body><p>x</p></body></html>',
        errors: [],
      }));

      expect(result.subject).toBe('From HTML');
    });
  });
});
