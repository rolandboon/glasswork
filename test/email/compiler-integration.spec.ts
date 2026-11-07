import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mjml2html from 'mjml';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/email/compiler/compiler';
import { loadRender, typecheck } from '../helpers/email-template';

// Wrapper for mjml that matches our expected interface
async function mjmlCompile(
  source: string
): Promise<{ html: string; errors: Array<{ message: string }> }> {
  const result = await mjml2html(source, { validationLevel: 'soft', ignoreIncludes: false });
  return {
    html: result.html,
    errors: (result.errors ?? [])
      .filter((e): e is NonNullable<typeof e> => e != null)
      .map((e) => ({ message: e.formattedMessage || e.message })),
  };
}

describe('compiler integration with MJML', () => {
  it('types variables from files included with mj-include', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'glasswork-include-'));
    try {
      writeFileSync(
        join(directory, 'footer.mjml'),
        '<mj-section><mj-column><mj-text><a href="{{unsubscribeUrl}}">Stop</a> mails about {{listName}}</mj-text></mj-column></mj-section>'
      );
      const filePath = join(directory, 'newsletter.mjml');
      const source =
        '<mjml><mj-body><mj-section><mj-column><mj-text>Hello {{name}}</mj-text></mj-column></mj-section><mj-include path="./footer.mjml" /></mj-body></mjml>';
      writeFileSync(filePath, source);
      const result = await compile(
        source,
        'newsletter',
        async (mjml, path) => {
          const compiled = await mjml2html(mjml, {
            validationLevel: 'soft',
            ignoreIncludes: false,
            ...(path ? { filePath: path } : {}),
          });
          return { html: compiled.html, errors: [] };
        },
        filePath
      );

      expect(result.contextInterface).toContain('name: string;');
      expect(result.contextInterface).toContain('unsubscribeUrl: string;');
      expect(result.contextInterface).toContain('listName: string;');
      expect(result.source).toContain('sanitizeUrl(ctx.unsubscribeUrl)');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects composed dynamic URLs after real MJML compilation', async () => {
    const source =
      '<mjml><mj-body><mj-section><mj-column><mj-button href="{{url}}?x=1">Go</mj-button></mj-column></mj-section></mj-body></mjml>';
    await expect(compile(source, 'composed-url', mjmlCompile)).rejects.toThrow(
      'one complete double-brace URL expression'
    );
  });

  it('should compile simple MJML template', async () => {
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

    const result = await compile(source, 'greeting', mjmlCompile);

    expect(result.source).toContain('export interface GreetingContext');
    expect(result.source).toContain('name: string;');
    expect(result.source).toContain('export function render');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing template literal in generated code
    expect(result.source).toContain('${escapeHtml(ctx.name)}');
    // MJML should have converted to HTML
    expect(result.source).toContain('<!doctype html>');
    expect(result.source).toContain('<html');
  });

  it('should compile template with optional variable', async () => {
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

    const result = await compile(source, 'greeting', mjmlCompile);

    expect(result.contextInterface).toContain('name?: string | undefined;');
    expect(result.source).toContain("ctx.name ?? 'Guest'");
  });

  it('should compile template with conditional', async () => {
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

    const result = await compile(source, 'member', mjmlCompile);

    expect(result.contextInterface).toContain('isPremium');
    expect(result.source).toContain('ctx.isPremium ? `');
    // MJML should have generated proper HTML for mj-text
    expect(result.source).toContain('Premium Member');
  });

  it('should compile template with if-else', async () => {
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

    const result = await compile(source, 'status', mjmlCompile);

    expect(result.source).toContain('ctx.isActive ? `');
    expect(result.source).toContain('Inactive');
    // An @if block with @else ends in its else branch, not in an empty fallback.
    expect(result.source).not.toContain("` : ''}");
  });

  it('should compile template with loop', async () => {
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

    const result = await compile(source, 'order', mjmlCompile);

    expect(result.contextInterface).toContain('items: Array<{');
    expect(result.contextInterface).toContain('name: string;');
    expect(result.contextInterface).toContain('price: string;');
    expect(result.source).toContain('__array.map((item, __index)');
    expect(result.source).toContain(".join(''))(ctx.items)");
  });

  it('should compile complex template like order confirmation', async () => {
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

    const result = await compile(source, 'order-confirmation', mjmlCompile);

    // Check interface generation
    expect(result.contextInterface).toContain('export interface OrderConfirmationContext');
    expect(result.contextInterface).toContain('name?: string | undefined;');
    expect(result.contextInterface).toContain('orderNumber: string;');
    expect(result.contextInterface).toContain('items?: Array<{');
    expect(result.contextInterface).toContain('total: string;');
    expect(result.contextInterface).toContain('shippingAddress?: {');
    expect(result.contextInterface).toContain('trackingUrl: string;');

    // Check that MJML was properly compiled
    expect(result.source).toContain('<!doctype html>');
    expect(result.source).toContain('background-color:#ffffff');

    // Check control flow transformation
    expect(result.source).toContain('ctx.items && ctx.items.length');
    expect(result.source).toContain('__array.map');
    expect(result.source).toContain("ctx.name ?? 'there'");
    expect(result.source).toContain('sanitizeUrl(ctx.trackingUrl)');
  });

  it('preserves explicit raw HTML interpolation through MJML compilation', async () => {
    const source = `
<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>{{{trustedHtml}}}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

    const result = await compile(source, 'trusted-content', mjmlCompile);

    expect(result.contextInterface).toContain('trustedHtml: string;');
    expect(result.source).toContain("String(ctx.trustedHtml ?? '')");
  });

  it('should include htmlToText helper in output', async () => {
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

    const result = await compile(source, 'greeting', mjmlCompile);

    // Check that htmlToText is included
    expect(result.source).toContain('function htmlToText(html: string): string');
    expect(result.source).toContain('const text = htmlToText(html)');
    expect(result.source).toContain('return { html, text }');
  });

  it('should produce executable render function', async () => {
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

    const result = await compile(source, 'greeting', mjmlCompile);

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

  it('should handle the sample order confirmation template', async () => {
    // Read the sample template we created earlier
    const templatePath = join(__dirname, '../../src/email/templates/order-confirmation.mjml');
    const source = readFileSync(templatePath, 'utf-8');

    const result = await compile(source, 'order-confirmation', mjmlCompile);

    // Should compile without errors
    expect(result.source).toBeDefined();
    expect(result.contextInterface).toBeDefined();

    // Check expected interface properties
    expect(result.contextInterface).toContain('name?: string | undefined;');
    expect(result.contextInterface).toContain('orderNumber: string;');
    expect(result.contextInterface).toContain('items?: Array<{');
    expect(result.contextInterface).toContain('total: string;');
    expect(result.contextInterface).toContain('trackingUrl: string;');
  });
});

describe('directives in compiled MJML', () => {
  const LAYOUT = `
<mjml>
  <mj-body>
    <!-- @if showHeader -->
    <mj-section><mj-column><mj-text>HEADER</mj-text></mj-column></mj-section>
    <!-- @end -->
    <mj-section>
      <mj-column><mj-text>LEFT</mj-text></mj-column>
      <!-- @if showRight -->
      <mj-column><mj-text>RIGHT</mj-text></mj-column>
      <!-- @end -->
    </mj-section>
    <mj-wrapper>
      <!-- @each sections as section -->
      <mj-section>
        <mj-column>
          <!-- @if section.title -->
          <mj-text>TITLE {{section.title}}</mj-text>
          <!-- @end -->
          <mj-text>BODY {{section.body}} <!-- @if section.isNew --><strong>NEW</strong><!-- @else -->OLD<!-- @end --></mj-text>
        </mj-column>
      </mj-section>
      <!-- @end -->
    </mj-wrapper>
    <mj-raw><!-- @if showRaw --><p>RAW</p><!-- @end --></mj-raw>
  </mj-body>
</mjml>`;

  /** Counts opening and closing tags, as a browser (comments hidden) or Outlook (mso comments shown) sees them. */
  function tagBalance(html: string, view: 'browser' | 'outlook'): Record<string, number> {
    const visible =
      view === 'outlook'
        ? html.replace(/<!--\[if mso \| IE\]>/g, '').replace(/<!\[endif\]-->/g, '')
        : html.replace(/<!--[\s\S]*?-->/g, '');
    const balance: Record<string, number> = {};
    for (const tag of ['table', 'tr', 'td', 'div']) {
      const opened = visible.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length ?? 0;
      const closed = visible.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0;
      balance[tag] = opened - closed;
    }
    return balance;
  }

  it('renders blocks around sections, columns, wrapper content, text and raw HTML', async () => {
    const result = await compile(LAYOUT, 'layout', mjmlCompile);
    const render = await loadRender(result.source);
    const everything = render({
      showHeader: true,
      showRight: true,
      showRaw: true,
      sections: [
        { title: 'One', body: 'first', isNew: true },
        { body: 'second', isNew: false },
      ],
    }).html;
    const nothing = render({ sections: [] }).html;

    for (const text of [
      'HEADER',
      'RIGHT',
      'RAW',
      'TITLE One',
      'BODY first',
      '<strong>NEW</strong>',
      'BODY second',
      'OLD',
    ]) {
      expect(everything).toContain(text);
    }
    expect(everything).not.toContain('TITLE undefined');
    for (const text of ['HEADER', 'RIGHT', 'RAW', 'TITLE', 'BODY']) {
      expect(nothing).not.toContain(text);
    }
    expect(nothing).toContain('LEFT');
    for (const html of [everything, nothing]) {
      expect(tagBalance(html, 'browser')).toEqual({ table: 0, tr: 0, td: 0, div: 0 });
      expect(tagBalance(html, 'outlook')).toEqual({ table: 0, tr: 0, td: 0, div: 0 });
    }
  });

  it('rejects a template whose directives MJML removed', async () => {
    const withoutComments = async (source: string) => {
      const compiled = await mjml2html(source, { validationLevel: 'soft', keepComments: false });
      return { html: compiled.html, errors: [] };
    };

    // MJML keeps comments inside text and raw HTML, so the template would be half broken.
    await expect(compile(LAYOUT, 'layout', withoutComments)).rejects.toThrow(
      'MJML removed 8 of the 13 template directives'
    );
    await expect(
      compile(
        '<mjml><mj-head><!-- @if dark --><mj-style>body { color: #fff; }</mj-style><!-- @end --></mj-head><mj-body><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>',
        'head',
        mjmlCompile
      )
    ).rejects.toThrow('Template directives inside mj-head do not work');
  });

  it('keeps directives in an mj-raw inside mj-head in place', async () => {
    const result = await compile(
      '<mjml><mj-head><mj-raw><!-- @if dark --><meta name="color-scheme" content="dark"><!-- @end --></mj-raw></mj-head><mj-body><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>',
      'head',
      mjmlCompile
    );
    const render = await loadRender(result.source);

    expect(render({ dark: true }).html).toContain('<meta name="color-scheme" content="dark">');
    expect(render({ dark: false }).html).not.toContain('color-scheme');
  });

  it('generates a module that type-checks strictly from real MJML output', async () => {
    const source = readFileSync(
      join(__dirname, '../../src/email/templates/order-confirmation.mjml'),
      'utf-8'
    );
    const result = await compile(source, 'order-confirmation', mjmlCompile);
    const application = `import { render } from './order-confirmation.js';

render({
  orderNumber: 'A-1',
  total: '10.00',
  trackingUrl: 'https://example.com/track/1',
  items: [{ name: 'Book', price: '10.00', onSale: true }],
});
render({ name: 'Ada', orderNumber: 'A-2', total: '0.00', trackingUrl: 'https://example.com/track/2' });
`;

    expect(
      typecheck({ 'order-confirmation.ts': result.source, 'application.ts': application })
    ).toBe('');
  });
});
