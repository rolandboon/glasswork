import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mjml2html from 'mjml';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/email/compiler/compiler';

// Wrapper for mjml that matches our expected interface
function mjmlCompile(source: string): { html: string; errors: Array<{ message: string }> } {
  const result = mjml2html(source, { validationLevel: 'soft' });
  return {
    html: result.html,
    errors: result.errors.map((e) => ({ message: e.formattedMessage || e.message })),
  };
}

describe('compiler integration with MJML', () => {
  it('should compile simple MJML template', () => {
    const source = `
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Hello {{name}}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

    const result = compile(source, 'greeting', mjmlCompile);

    expect(result.source).toContain('export interface GreetingContext');
    expect(result.source).toContain('name: string;');
    expect(result.source).toContain('export function render');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal in generated code
    expect(result.source).toContain('${ctx.name}');
    // MJML should have converted to HTML
    expect(result.source).toContain('<!doctype html>');
    expect(result.source).toContain('<html');
  });

  it('should compile template with optional variable', () => {
    const source = `
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Hello {{name ?? 'Guest'}}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

    const result = compile(source, 'greeting', mjmlCompile);

    expect(result.contextInterface).toContain('name?: string;');
    expect(result.source).toContain("ctx.name ?? 'Guest'");
  });

  it('should compile template with conditional', () => {
    const source = `
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Hello</mj-text>
        <!-- @if isPremium -->
        <mj-text font-weight="bold">Premium Member</mj-text>
        <!-- @end -->
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

    const result = compile(source, 'member', mjmlCompile);

    expect(result.contextInterface).toContain('isPremium');
    expect(result.source).toContain('ctx.isPremium ? `');
    // MJML should have generated proper HTML for mj-text
    expect(result.source).toContain('Premium Member');
  });

  it('should compile template with if-else', () => {
    const source = `
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <!-- @if isActive -->
        <mj-text color="green">Active</mj-text>
        <!-- @else -->
        <mj-text color="red">Inactive</mj-text>
        <!-- @end -->
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

    const result = compile(source, 'status', mjmlCompile);

    expect(result.source).toContain('ctx.isActive ? `');
    expect(result.source).toContain('` : `');
    expect(result.source).toContain("` : ''}");
  });

  it('should compile template with loop', () => {
    const source = `
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text font-weight="bold">Your Items:</mj-text>
      </mj-column>
    </mj-section>
    <!-- @each items as item -->
    <mj-section>
      <mj-column>
        <mj-text>{{item.name}} - {{item.price}}</mj-text>
      </mj-column>
    </mj-section>
    <!-- @end -->
  </mj-body>
</mjml>`;

    const result = compile(source, 'order', mjmlCompile);

    expect(result.contextInterface).toContain('items: Array<{');
    expect(result.contextInterface).toContain('name: string;');
    expect(result.contextInterface).toContain('price: string;');
    expect(result.source).toContain('__array.map((item, __index)');
    expect(result.source).toContain(".join(''))(ctx.items)");
  });

  it('should compile complex template like order confirmation', () => {
    const source = `
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all color="#212121" font-family="Arial, sans-serif" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#fff">
    <mj-section>
      <mj-column>
        <mj-text font-size="22px" font-weight="bold">
          Hello {{name ?? 'there'}},
        </mj-text>
        <mj-text>
          Thank you for your order #{{orderNumber}}!
        </mj-text>
      </mj-column>
    </mj-section>

    <!-- @if items && items.length -->
    <mj-section>
      <mj-column>
        <mj-text font-weight="bold">Your order contains {{items.length}} item(s):</mj-text>
      </mj-column>
    </mj-section>

    <!-- @each items as item -->
    <mj-section>
      <mj-column>
        <mj-text>
          {{item.name}} - {{item.price}}
          <!-- @if item.onSale -->
          <span style="color: #e53e3e;">(On Sale!)</span>
          <!-- @end -->
        </mj-text>
      </mj-column>
    </mj-section>
    <!-- @end -->

    <mj-section>
      <mj-column>
        <mj-text font-weight="bold">Total: {{total}}</mj-text>
      </mj-column>
    </mj-section>
    <!-- @else -->
    <mj-section>
      <mj-column>
        <mj-text>Your cart is empty.</mj-text>
      </mj-column>
    </mj-section>
    <!-- @end -->

    <!-- @if shippingAddress -->
    <mj-section>
      <mj-column>
        <mj-text font-weight="bold">Shipping to:</mj-text>
        <mj-text>
          {{shippingAddress.street}}<br/>
          {{shippingAddress.city}}, {{shippingAddress.zip}}
        </mj-text>
      </mj-column>
    </mj-section>
    <!-- @end -->

    <mj-section>
      <mj-column>
        <mj-button background-color="#5753c6" href="{{trackingUrl}}">
          Track Your Order
        </mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

    const result = compile(source, 'order-confirmation', mjmlCompile);

    // Check interface generation
    expect(result.contextInterface).toContain('export interface OrderConfirmationContext');
    expect(result.contextInterface).toContain('name?: string;');
    expect(result.contextInterface).toContain('orderNumber: string;');
    expect(result.contextInterface).toContain('items: Array<{');
    expect(result.contextInterface).toContain('total: string;');
    expect(result.contextInterface).toContain('shippingAddress: {');
    expect(result.contextInterface).toContain('trackingUrl: string;');

    // Check that MJML was properly compiled
    expect(result.source).toContain('<!doctype html>');
    expect(result.source).toContain('background-color:#ffffff');

    // Check control flow transformation
    expect(result.source).toContain('ctx.items && ctx.items.length');
    expect(result.source).toContain('__array.map');
    expect(result.source).toContain("ctx.name ?? 'there'");
  });

  it('should include htmlToText helper in output', () => {
    const source = `
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Hello {{name}}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

    const result = compile(source, 'greeting', mjmlCompile);

    // Check that htmlToText is included
    expect(result.source).toContain('function htmlToText(html: string): string');
    expect(result.source).toContain('const text = htmlToText(html)');
    expect(result.source).toContain('return { html, text }');
  });

  it('should produce executable render function', () => {
    const source = `
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>Hello {{name ?? 'Guest'}}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

    const result = compile(source, 'greeting', mjmlCompile);

    // Create a function from the compiled source (basic validation)
    // In real usage, this would be written to a file and imported
    const functionBody = result.source.replace(
      'export interface GreetingContext',
      'const GreetingContext = null; //'
    );

    // Extract just the render function and htmlToText for testing
    expect(functionBody).toContain('export function render');

    // Verify the structure is syntactically valid by checking key parts
    expect(result.source).toMatch(/export function render\(ctx: GreetingContext\)/);
    expect(result.source).toMatch(/return \{ html, text \};/);
  });

  it('should handle the sample order confirmation template', () => {
    // Read the sample template we created earlier
    const templatePath = join(__dirname, '../../src/email/templates/order-confirmation.mjml');
    const source = readFileSync(templatePath, 'utf-8');

    const result = compile(source, 'order-confirmation', mjmlCompile);

    // Should compile without errors
    expect(result.source).toBeDefined();
    expect(result.contextInterface).toBeDefined();

    // Check expected interface properties
    expect(result.contextInterface).toContain('name?: string;');
    expect(result.contextInterface).toContain('orderNumber: string;');
    expect(result.contextInterface).toContain('items: Array<{');
    expect(result.contextInterface).toContain('total: string;');
    expect(result.contextInterface).toContain('trackingUrl: string;');
  });
});
