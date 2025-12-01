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

      expect(result.source).toContain('ctx.isActive ? `');
      expect(result.source).toContain('` : `');
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
