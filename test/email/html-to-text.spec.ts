import mjml2html from 'mjml';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/email/compiler/compiler';
import { htmlToText } from '../../src/email/html-to-text';

const MJML = `
<mjml owa="desktop" lang="en">
  <mj-head>
    <mj-title>Your sign-in code</mj-title>
    <mj-font name="Inter" href="https://fonts.googleapis.com/css2?family=Inter&amp;display=swap" />
    <mj-preview>{{code}} is your sign-in code.</mj-preview>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-image src="https://example.com/logo.png" alt="Example" href="https://example.com" />
        <mj-text>Enter this code:</mj-text>
        <mj-text>{{code}}</mj-text>
        <mj-button href="{{url}}">Open the app</mj-button>
        <mj-text>Or open <a href="{{url}}">{{url}}</a>. Questions &amp; answers.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

async function mjmlCompile(source: string) {
  const result = await mjml2html(source, { validationLevel: 'soft' });
  return { html: result.html, errors: [] };
}

/** Turns the generated TypeScript into a callable render function. */
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

describe('htmlToText', () => {
  it('reads an MJML email without Outlook markup, head, preheader or bullets', async () => {
    const { source } = await compile(MJML, 'sign-in-code', mjmlCompile);
    const { text } = loadRender(source)({ code: '482913', url: 'https://example.com/a?b=1&c=2' });

    expect(text).toBe(
      [
        'Example',
        '',
        'Enter this code:',
        '',
        '482913',
        '',
        'Open the app: https://example.com/a?b=1&c=2',
        '',
        'Or open https://example.com/a?b=1&c=2. Questions & answers.',
      ].join('\n')
    );
  });

  it('gives the same text in compiled templates as at runtime', async () => {
    const { source } = await compile(MJML, 'sign-in-code', mjmlCompile);
    const { html, text } = loadRender(source)({ code: '1', url: 'https://example.com' });

    expect(text).toBe(htmlToText(html));
  });

  it('does not mistake link and other li-prefixed tags for list items', () => {
    expect(
      htmlToText('<link rel="stylesheet" href="x.css"><ul><li>One</li><li class="a">Two</li></ul>')
    ).toBe('• One\n• Two');
  });

  it('decodes entities once, including numeric ones', () => {
    expect(htmlToText('&lt;b&gt; &amp;lt; &#39;x&#39; &#x2014; &quot;y&quot;')).toBe(
      `<b> &lt; 'x' — "y"`
    );
  });

  it('keeps line breaks, trims lines and allows one blank line between blocks', () => {
    expect(htmlToText('<p>  A  </p><p></p><p></p><div>B<br>C</div>')).toBe('A\n\nB\nC');
  });
});
