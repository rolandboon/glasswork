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

describe('compiler', () => {
  describe('compile', () => {
    it('should compile a simple template', () => {
      const source = '<div>Hello {{name}}</div>';
      const result = compile(source, 'greeting', mockMjmlCompile);

      expect(result.name).toBe('greeting');
      expect(result.source).toContain('export interface GreetingContext');
      expect(result.source).toContain('name: string;');
      expect(result.source).toContain('export function render');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal in generated code
      expect(result.source).toContain('${ctx.name}');
    });

    it('should generate correct interface for nested objects', () => {
      const source = '<div>{{user.address.city}}</div>';
      const result = compile(source, 'address', mockMjmlCompile);

      expect(result.contextInterface).toContain('user: {');
      expect(result.contextInterface).toContain('address: {');
      expect(result.contextInterface).toContain('city: string;');
    });

    it('should handle optional variables with defaults', () => {
      const source = "<div>{{name ?? 'Guest'}}</div>";
      const result = compile(source, 'greeting', mockMjmlCompile);

      expect(result.contextInterface).toContain('name?: string;');
      expect(result.source).toContain("ctx.name ?? 'Guest'");
    });

    it('should compile @if conditionals', () => {
      const source = '<!-- @if isActive --><span>Active</span><!-- @end -->';
      const result = compile(source, 'status', mockMjmlCompile);

      expect(result.contextInterface).toContain('isActive: string;');
      expect(result.source).toContain('ctx.isActive ? `');
      expect(result.source).toContain("` : ''");
    });

    it('should compile @if-@else conditionals', () => {
      const source = '<!-- @if isActive -->Active<!-- @else -->Inactive<!-- @end -->';
      const result = compile(source, 'status', mockMjmlCompile);

      expect(result.source).toContain('ctx.isActive ? `Active');
      expect(result.source).toContain('Inactive');
    });

    it('should compile @each loops', () => {
      const source = '<!-- @each items as item --><li>{{item.name}}</li><!-- @end -->';
      const result = compile(source, 'list', mockMjmlCompile);

      expect(result.contextInterface).toContain('items: Array<{');
      expect(result.contextInterface).toContain('name: string;');
      expect(result.source).toContain('__array.map((item, __index)');
      expect(result.source).toContain(".join(''))(ctx.items)");
    });

    it('should compile @each with index', () => {
      const source = '<!-- @each items as item, i --><li>{{i}}: {{item.name}}</li><!-- @end -->';
      const result = compile(source, 'list', mockMjmlCompile);

      expect(result.source).toContain('__array.map((item, i)');
    });

    it('should handle @index loop context variable', () => {
      const source = '<!-- @each items as item --><li>Item #{{@index}}</li><!-- @end -->';
      const result = compile(source, 'list', mockMjmlCompile);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal
      expect(result.source).toContain('${__index}');
    });

    it('should handle @first loop context variable', () => {
      const source =
        '<!-- @each items as item --><!-- @if @first --><span>First!</span><!-- @end --><!-- @end -->';
      const result = compile(source, 'list', mockMjmlCompile);

      expect(result.source).toContain('(__index === 0)');
    });

    it('should handle @last loop context variable', () => {
      const source =
        '<!-- @each items as item --><!-- @if @last --><span>Last!</span><!-- @end --><!-- @end -->';
      const result = compile(source, 'list', mockMjmlCompile);

      expect(result.source).toContain('(__index === __array.length - 1)');
    });

    it('should handle @length loop context variable', () => {
      const source = '<!-- @each items as item --><li>Item of {{@length}}</li><!-- @end -->';
      const result = compile(source, 'list', mockMjmlCompile);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal
      expect(result.source).toContain('${__array.length}');
    });

    it('should handle default for loop variable access with default value', () => {
      const source = "<!-- @each items as item --><li>{{item.name ?? 'Unknown'}}</li><!-- @end -->";
      const result = compile(source, 'list', mockMjmlCompile);

      // Loop variable access with default value
      expect(result.source).toContain("item.name ?? 'Unknown'");
    });

    it('should handle @elseif conditionals', () => {
      const source =
        '<!-- @if isActive -->Active<!-- @elseif isPending -->Pending<!-- @else -->Unknown<!-- @end -->';
      const result = compile(source, 'status', mockMjmlCompile);

      expect(result.source).toContain('ctx.isActive ? `');
      expect(result.source).toContain('ctx.isPending ? `');
    });

    it('should handle unknown loop context variables', () => {
      const source = '<!-- @each items as item --><li>{{@custom}}</li><!-- @end -->';
      const result = compile(source, 'list', mockMjmlCompile);

      // Unknown @variables are converted to just the variable name
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal
      expect(result.source).toContain('${custom}');
    });

    it('should handle @first as standalone variable', () => {
      const source = '<!-- @each items as item --><li>{{@first}}</li><!-- @end -->';
      const result = compile(source, 'list', mockMjmlCompile);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal
      expect(result.source).toContain('${__index === 0}');
    });

    it('should handle @last as standalone variable', () => {
      const source = '<!-- @each items as item --><li>{{@last}}</li><!-- @end -->';
      const result = compile(source, 'list', mockMjmlCompile);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal
      expect(result.source).toContain('${__index === __array.length - 1}');
    });

    it('should handle nested @if inside @each', () => {
      const source = `
<!-- @each items as item -->
<li>
  {{item.name}}
  <!-- @if item.onSale -->
  <span>SALE!</span>
  <!-- @end -->
</li>
<!-- @end -->`;
      const result = compile(source, 'products', mockMjmlCompile);

      expect(result.contextInterface).toContain('items: Array<{');
      expect(result.contextInterface).toContain('name: string;');
      expect(result.contextInterface).toContain('onSale: string;');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal in generated code
      expect(result.source).toContain('${item.name}');
      expect(result.source).toContain('${item.onSale ?');
    });

    it('should prefix context variables in arithmetic expressions', () => {
      const source = '<div>Total: {{total + fee}}</div>';
      const result = compile(source, 'totals', mockMjmlCompile);

      expect(result.source).toContain('ctx.total + ctx.fee');
    });

    it('should not prefix loop item variables in arithmetic expressions', () => {
      const source =
        '<!-- @each products as product --><div>{{product.price - discount}}</div><!-- @end -->';
      const result = compile(source, 'cart', mockMjmlCompile);

      // product.price should not have ctx prefix, but discount should
      expect(result.source).toContain('product.price - ctx.discount');
    });

    // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal escaping
    it('should escape literal ${} and backticks in content', () => {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Test input with literal ${}
      const source = '<div>Value ${amount} with `code`</div>';
      const result = compile(source, 'escape-test', mockMjmlCompile);

      // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing escaped output
      expect(result.source).toContain('\\${amount}');
      expect(result.source).toContain('\\`code\\`');
    });

    it('should include htmlToText function', () => {
      const source = '<div>Hello {{name}}</div>';
      const result = compile(source, 'greeting', mockMjmlCompile);

      expect(result.source).toContain('function htmlToText(html: string): string');
      expect(result.source).toContain('const text = htmlToText(html)');
    });

    it('should throw on MJML compilation errors', () => {
      const errorCompiler = () => ({
        html: '',
        errors: [{ message: 'Invalid MJML' }],
      });

      expect(() => compile('<invalid />', 'test', errorCompiler)).toThrow(
        /MJML compilation errors/
      );
    });

    it('should handle complex template with multiple features', () => {
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

      const result = compile(source, 'order-confirmation', mockMjmlCompile);

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

    it('should preserve reserved words in conditions without ctx prefix', () => {
      const source = '<!-- @if true && item.isValid -->Valid<!-- @end -->';
      const result = compile(source, 'test', mockMjmlCompile);

      // 'true' should not get ctx prefix
      expect(result.source).toContain('true && ctx.item.isValid');
      expect(result.source).not.toContain('ctx.true');
    });

    it('should handle expressions with @index in calculations', () => {
      // Test expressions that exercise the prefixContextVariables function
      const source =
        '<!-- @each items as item --><div>Row {{@index + 1}}: {{item.name}}</div><!-- @end -->';
      const result = compile(source, 'test', mockMjmlCompile);

      // The @index should be transformed and ctx should not prefix internal vars
      expect(result.source).toContain('__index');
      expect(result.source).not.toContain('ctx.__index');
    });
  });

  describe('PascalCase naming', () => {
    it('should convert kebab-case to PascalCase', () => {
      const source = '{{name}}';
      const result = compile(source, 'order-confirmation', mockMjmlCompile);

      expect(result.source).toContain('OrderConfirmationContext');
    });

    it('should convert snake_case to PascalCase', () => {
      const source = '{{name}}';
      const result = compile(source, 'order_confirmation', mockMjmlCompile);

      expect(result.source).toContain('OrderConfirmationContext');
    });

    it('should handle dots in names', () => {
      const source = '{{name}}';
      const result = compile(source, 'login-code.nl-nl', mockMjmlCompile);

      expect(result.source).toContain('LoginCodeNlNlContext');
    });
  });
});
