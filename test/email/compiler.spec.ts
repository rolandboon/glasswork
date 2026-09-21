import { describe, expect, it } from 'vitest';
import { compile } from '../../src/email/compiler/compiler';

// Mock MJML compiler for testing
// In real usage, the actual mjml package would be passed in
function mockMjmlCompile(mjml: string): { html: string; errors: Array<{ message: string }> } {
  // Simple mock that wraps content in basic HTML structure
  // and preserves our control flow markers
  const html = `<!doctype html>
<html>
<body>
${mjml}
</body>
</html>`;
  return { html, errors: [] };
}

function loadRender(source: string): (context: unknown) => { html: string; text: string } {
  const javascript = source
    .replace(
      /export interface \w+Context \{[\s\S]*?\n\}\n\nexport function render/,
      'function render'
    )
    .replace(
      /function render\(ctx: \w+Context\): \{ html: string; text: string \}/,
      'function render(ctx)'
    )
    .replace(/function htmlToText\(html: string\): string/, 'function htmlToText(html)')
    .replace(/function escapeHtml\(value: unknown\): string/, 'function escapeHtml(value)')
    .replace(/const entities: Record<string, string>/, 'const entities')
    .replace(/function sanitizeUrl\(value: unknown\): string/, 'function sanitizeUrl(value)');

  return new Function(`${javascript}\nreturn render;`)() as (context: unknown) => {
    html: string;
    text: string;
  };
}

describe('compiler', () => {
  describe('compile', () => {
    it.each([
      '<a href="{{url}}?x=1">x</a>',
      '<a href="https://example.com/{{path}}">x</a>',
      '<img src="{{prefix}}{{url}}">',
      '<a href="{{{url}}}">x</a>',
      '<a href={{url}}>x</a>',
      '<div title={{name}}>x</div>',
    ])('rejects ambiguous dynamic attribute contexts: %s', async (source) => {
      await expect(compile(source, 'unsafe', mockMjmlCompile)).rejects.toThrow(/Dynamic/);
    });

    it('should compile a simple template', async () => {
      const source = '<div>Hello {{name}}</div>';
      const result = await compile(source, 'greeting', mockMjmlCompile);

      expect(result.name).toBe('greeting');
      expect(result.source).toContain('export interface GreetingContext');
      expect(result.source).toContain('name: string;');
      expect(result.source).toContain('export function render');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal in generated code
      expect(result.source).toContain('${escapeHtml(ctx.name)}');
    });

    it('should generate correct interface for nested objects', async () => {
      const source = '<div>{{user.address.city}}</div>';
      const result = await compile(source, 'address', mockMjmlCompile);

      expect(result.contextInterface).toContain('user: {');
      expect(result.contextInterface).toContain('address: {');
      expect(result.contextInterface).toContain('city: string;');
    });

    it('should handle optional variables with defaults', async () => {
      const source = "<div>{{name ?? 'Guest'}}</div>";
      const result = await compile(source, 'greeting', mockMjmlCompile);

      expect(result.contextInterface).toContain('name?: string;');
      expect(result.source).toContain("ctx.name ?? 'Guest'");
    });

    it('should compile @if conditionals', async () => {
      const source = '<!-- @if isActive --><span>Active</span><!-- @end -->';
      const result = await compile(source, 'status', mockMjmlCompile);

      expect(result.contextInterface).toContain('isActive: string;');
      expect(result.source).toContain('ctx.isActive ? `');
      expect(result.source).toContain("` : ''");
    });

    it('should compile @if-@else conditionals', async () => {
      const source = '<!-- @if isActive -->Active<!-- @else -->Inactive<!-- @end -->';
      const result = await compile(source, 'status', mockMjmlCompile);

      expect(result.source).toContain('ctx.isActive ? `Active');
      expect(result.source).toContain('Inactive');
    });

    it('should compile @each loops', async () => {
      const source = '<!-- @each items as item --><li>{{item.name}}</li><!-- @end -->';
      const result = await compile(source, 'list', mockMjmlCompile);

      expect(result.contextInterface).toContain('items: Array<{');
      expect(result.contextInterface).toContain('name: string;');
      expect(result.source).toContain('__array.map((item, __index)');
      expect(result.source).toContain(".join(''))(ctx.items)");
    });

    it('should compile @each with index', async () => {
      const source = '<!-- @each items as item, i --><li>{{i}}: {{item.name}}</li><!-- @end -->';
      const result = await compile(source, 'list', mockMjmlCompile);

      expect(result.source).toContain('__array.map((item, i)');
    });

    it('should handle @index loop context variable', async () => {
      const source = '<!-- @each items as item --><li>Item #{{@index}}</li><!-- @end -->';
      const result = await compile(source, 'list', mockMjmlCompile);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal
      expect(result.source).toContain('${escapeHtml(__index)}');
    });

    it('should handle @first loop context variable', async () => {
      const source =
        '<!-- @each items as item --><!-- @if @first --><span>First!</span><!-- @end --><!-- @end -->';
      const result = await compile(source, 'list', mockMjmlCompile);

      expect(result.source).toContain('(__index === 0)');
    });

    it('should handle @last loop context variable', async () => {
      const source =
        '<!-- @each items as item --><!-- @if @last --><span>Last!</span><!-- @end --><!-- @end -->';
      const result = await compile(source, 'list', mockMjmlCompile);

      expect(result.source).toContain('(__index === __array.length - 1)');
    });

    it('should handle @length loop context variable', async () => {
      const source = '<!-- @each items as item --><li>Item of {{@length}}</li><!-- @end -->';
      const result = await compile(source, 'list', mockMjmlCompile);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal
      expect(result.source).toContain('${escapeHtml(__array.length)}');
    });

    it('should handle default for loop variable access with default value', async () => {
      const source = "<!-- @each items as item --><li>{{item.name ?? 'Unknown'}}</li><!-- @end -->";
      const result = await compile(source, 'list', mockMjmlCompile);

      // Loop variable access with default value
      expect(result.source).toContain("item.name ?? 'Unknown'");
    });

    it('should handle @elseif conditionals', async () => {
      const source =
        '<!-- @if isActive -->Active<!-- @elseif isPending -->Pending<!-- @else -->Unknown<!-- @end -->';
      const result = await compile(source, 'status', mockMjmlCompile);

      expect(result.source).toContain('ctx.isActive ? `');
      expect(result.source).toContain('ctx.isPending ? `');
    });

    it('should handle unknown loop context variables', async () => {
      const source = '<!-- @each items as item --><li>{{@custom}}</li><!-- @end -->';
      const result = await compile(source, 'list', mockMjmlCompile);

      // Unknown @variables are converted to just the variable name
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal
      expect(result.source).toContain('${escapeHtml(custom)}');
    });

    it('should handle @first as standalone variable', async () => {
      const source = '<!-- @each items as item --><li>{{@first}}</li><!-- @end -->';
      const result = await compile(source, 'list', mockMjmlCompile);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal
      expect(result.source).toContain('${escapeHtml(__index === 0)}');
    });

    it('should handle @last as standalone variable', async () => {
      const source = '<!-- @each items as item --><li>{{@last}}</li><!-- @end -->';
      const result = await compile(source, 'list', mockMjmlCompile);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal
      expect(result.source).toContain('${escapeHtml(__index === __array.length - 1)}');
    });

    it('should handle nested @if inside @each', async () => {
      const source = `
<!-- @each items as item -->
<li>
  {{item.name}}
  <!-- @if item.onSale -->
  <span>SALE!</span>
  <!-- @end -->
</li>
<!-- @end -->`;
      const result = await compile(source, 'products', mockMjmlCompile);

      expect(result.contextInterface).toContain('items: Array<{');
      expect(result.contextInterface).toContain('name: string;');
      expect(result.contextInterface).toContain('onSale: string;');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal in generated code
      expect(result.source).toContain('${escapeHtml(item.name)}');
      expect(result.source).toContain('${item.onSale ?');
    });

    it('should prefix context variables in arithmetic expressions', async () => {
      const source = '<div>Total: {{total + fee}}</div>';
      const result = await compile(source, 'totals', mockMjmlCompile);

      expect(result.source).toContain('ctx.total + ctx.fee');
    });

    it('should not prefix loop item variables in arithmetic expressions', async () => {
      const source =
        '<!-- @each products as product --><div>{{product.price - discount}}</div><!-- @end -->';
      const result = await compile(source, 'cart', mockMjmlCompile);

      // product.price should not have ctx prefix, but discount should
      expect(result.source).toContain('product.price - ctx.discount');
    });

    // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal escaping
    it('should escape literal ${} and backticks in content', async () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Test input with literal ${}
      const source = '<div>Value ${amount} with `code`</div>';
      const result = await compile(source, 'escape-test', mockMjmlCompile);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing escaped output
      expect(result.source).toContain('\\${amount}');
      expect(result.source).toContain('\\`code\\`');
    });

    it('should include htmlToText function', async () => {
      const source = '<div>Hello {{name}}</div>';
      const result = await compile(source, 'greeting', mockMjmlCompile);

      expect(result.source).toContain('function htmlToText(html: string): string');
      expect(result.source).toContain('const text = htmlToText(html)');
    });

    it('escapes rendered values and allows explicit trusted HTML', async () => {
      const source = '<div>{{name}}</div><div>{{{trustedHtml}}}</div>';
      const result = await compile(source, 'safe-output', mockMjmlCompile);
      const render = loadRender(result.source);

      const rendered = render({
        name: `&<>"'<a href="https://evil.example">click</a>`,
        trustedHtml: '<strong>Approved markup</strong>',
      });

      expect(rendered.html).toContain(
        '&amp;&lt;&gt;&quot;&#39;&lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt;'
      );
      expect(rendered.html).toContain('<strong>Approved markup</strong>');
      expect(rendered.html).not.toContain('<a href="https://evil.example">click</a>');
    });

    it('rejects unsafe schemes in standalone dynamic URL attributes', async () => {
      const source = '<a href="{{url}}">Open</a><img src="{{imageUrl}}">';
      const result = await compile(source, 'safe-links', mockMjmlCompile);
      const render = loadRender(result.source);

      const unsafe = render({ url: 'javascript:alert(1)', imageUrl: 'data:text/html,bad' });
      const safe = render({
        url: 'https://example.com/?a=1&b=2',
        imageUrl: 'cid:logo',
      });

      expect(unsafe.html).toContain('<a href="#">');
      expect(unsafe.html).toContain('<img src="#">');
      expect(unsafe.html).not.toContain('javascript:');
      expect(safe.html).toContain('href="https://example.com/?a=1&amp;b=2"');
      expect(safe.html).toContain('src="cid:logo"');
    });

    it('should throw on MJML compilation errors', async () => {
      const errorCompiler = () => ({
        html: '',
        errors: [{ message: 'Invalid MJML' }],
      });

      await expect(compile('<invalid />', 'test', errorCompiler)).rejects.toThrow(
        /MJML compilation errors/
      );
    });

    it('should handle complex template with multiple features', async () => {
      const source = `
<div>
  <h1>Hello {{name ?? 'there'}},</h1>
  <p>Order #{{orderNumber}}</p>

  <!-- @if items && items.length -->
  <h2>Your items:</h2>
  <ul>
    <!-- @each items as item -->
    <li>
      {{item.name}} - {{item.price}}
      <!-- @if item.quantity -->
      <span>x{{item.quantity}}</span>
      <!-- @end -->
    </li>
    <!-- @end -->
  </ul>
  <p><strong>Total: {{total}}</strong></p>
  <!-- @else -->
  <p>Your cart is empty.</p>
  <!-- @end -->

  <!-- @if shippingAddress -->
  <h2>Shipping to:</h2>
  <p>{{shippingAddress.street}}</p>
  <p>{{shippingAddress.city}}, {{shippingAddress.zip}}</p>
  <!-- @end -->
</div>`;

      const result = await compile(source, 'order-confirmation', mockMjmlCompile);

      // Check interface has all expected properties
      expect(result.contextInterface).toContain('name?: string;');
      expect(result.contextInterface).toContain('orderNumber: string;');
      expect(result.contextInterface).toContain('items: Array<{');
      expect(result.contextInterface).toContain('total: string;');
      expect(result.contextInterface).toContain('shippingAddress: {');

      // Check the render function compiles
      expect(result.source).toContain('export function render');
      expect(result.source).toContain('return { html, text };');
    });

    it('should preserve reserved words in conditions without ctx prefix', async () => {
      const source = '<!-- @if true && item.isValid -->Valid<!-- @end -->';
      const result = await compile(source, 'test', mockMjmlCompile);

      // 'true' should not get ctx prefix
      expect(result.source).toContain('true && ctx.item.isValid');
      expect(result.source).not.toContain('ctx.true');
    });

    it('should handle expressions with @index in calculations', async () => {
      // Test expressions that exercise the prefixContextVariables function
      const source =
        '<!-- @each items as item --><div>Row {{@index + 1}}: {{item.name}}</div><!-- @end -->';
      const result = await compile(source, 'test', mockMjmlCompile);

      // The @index should be transformed and ctx should not prefix internal vars
      expect(result.source).toContain('__index');
      expect(result.source).not.toContain('ctx.__index');
    });
  });

  describe('PascalCase naming', () => {
    it('should convert kebab-case to PascalCase', async () => {
      const source = '{{name}}';
      const result = await compile(source, 'order-confirmation', mockMjmlCompile);

      expect(result.source).toContain('OrderConfirmationContext');
    });

    it('should convert snake_case to PascalCase', async () => {
      const source = '{{name}}';
      const result = await compile(source, 'order_confirmation', mockMjmlCompile);

      expect(result.source).toContain('OrderConfirmationContext');
    });

    it('should handle dots in names', async () => {
      const source = '{{name}}';
      const result = await compile(source, 'login-code.nl-nl', mockMjmlCompile);

      expect(result.source).toContain('LoginCodeNlNlContext');
    });
  });
});
