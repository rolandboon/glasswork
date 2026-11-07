import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplates } from '../../src/email/compiler/compile-templates.js';
import { typecheck } from '../helpers/email-template';

describe('compileTemplates', () => {
  let tempDir: string;
  let sourceDir: string;
  let outputDir: string;

  beforeEach(() => {
    // Create temporary directories for testing
    tempDir = join(process.cwd(), 'test-temp-compile');
    sourceDir = join(tempDir, 'templates');
    outputDir = join(tempDir, 'compiled');

    // Clean up if exists
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }

    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const mockMjmlCompile = vi.fn((mjml: string) => {
    // Simple mock that wraps content in basic HTML structure
    // Only add title if mj-title is present in source
    const hasTitle = mjml.includes('<mj-title>');
    const html = `<!doctype html>
<html>
${hasTitle ? '<head><title>Test</title></head>' : '<head></head>'}
<body>
${mjml}
</body>
</html>`;
    return { html, errors: [] };
  });

  it('should compile a single template', async () => {
    const templateContent = '<mjml><mj-body><mj-text>Hello {{name}}</mj-text></mj-body></mjml>';
    const templatePath = join(sourceDir, 'greeting.mjml');
    writeFileSync(templatePath, templateContent);

    const result = await compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(1);
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0].name).toBe('greeting');
    expect(result.errors).toHaveLength(0);

    // Check that compiled file exists
    const compiledPath = join(outputDir, 'greeting.ts');
    expect(existsSync(compiledPath)).toBe(true);

    // Check compiled content
    const compiledContent = readFileSync(compiledPath, 'utf-8');
    expect(compiledContent).toContain('export interface GreetingContext');
    expect(compiledContent).toContain('export function render');
  });

  it('should compile multiple templates', async () => {
    writeFileSync(
      join(sourceDir, 'template1.mjml'),
      '<mjml><mj-body><mj-text>{{var1}}</mj-text></mj-body></mjml>'
    );
    writeFileSync(
      join(sourceDir, 'template2.mjml'),
      '<mjml><mj-body><mj-text>{{var2}}</mj-text></mj-body></mjml>'
    );
    writeFileSync(
      join(sourceDir, 'template3.mjml'),
      '<mjml><mj-body><mj-text>{{var3}}</mj-text></mj-body></mjml>'
    );

    const result = await compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(3);
    expect(result.templates).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should extract subject from mj-title', async () => {
    const templateContent = `<mjml>
<mj-head>
  <mj-title>Welcome Email</mj-title>
</mj-head>
<mj-body>
  <mj-text>Hello {{name}}</mj-text>
</mj-body>
</mjml>`;
    writeFileSync(join(sourceDir, 'welcome.mjml'), templateContent);

    const result = await compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.templates[0].subject).toBe('Welcome Email');
  });

  it('should handle templates without subject', async () => {
    const templateContent = '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>';
    writeFileSync(join(sourceDir, 'no-subject.mjml'), templateContent);

    const result = await compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.templates[0].subject).toBeUndefined();
  });

  it('should exclude layout directory by default', async () => {
    mkdirSync(join(sourceDir, 'layouts'), { recursive: true });
    writeFileSync(join(sourceDir, 'layouts', 'base.mjml'), '<mjml><mj-body></mj-body></mjml>');
    writeFileSync(
      join(sourceDir, 'template.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );

    const result = await compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(1);
    expect(result.templates[0].name).toBe('template');
  });

  it('should handle custom exclude directories', async () => {
    mkdirSync(join(sourceDir, 'partials'), { recursive: true });
    writeFileSync(join(sourceDir, 'partials', 'header.mjml'), '<mjml><mj-body></mj-body></mjml>');
    writeFileSync(
      join(sourceDir, 'template.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );

    const result = await compileTemplates({
      sourceDir,
      outputDir,
      excludeDirs: ['partials'],
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(1);
  });

  it('should handle MJML compilation errors', async () => {
    const errorMjmlCompile = vi.fn(() => ({
      html: '',
      errors: [{ message: 'Invalid MJML syntax' }],
    }));

    writeFileSync(join(sourceDir, 'invalid.mjml'), '<invalid>content</invalid>');

    const result = await compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: errorMjmlCompile,
    });

    expect(result.count).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].template).toBe('invalid');
    expect(result.errors[0].error).toContain('MJML compilation errors');
  });

  it('should generate index file by default', async () => {
    writeFileSync(
      join(sourceDir, 'template1.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );
    writeFileSync(
      join(sourceDir, 'template2.mjml'),
      '<mjml><mj-body><mj-text>World</mj-text></mj-body></mjml>'
    );

    await compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    const indexPath = join(outputDir, 'index.ts');
    expect(existsSync(indexPath)).toBe(true);

    const indexContent = readFileSync(indexPath, 'utf-8');
    expect(indexContent).toContain('import * as template1');
    expect(indexContent).toContain('import * as template2');
    expect(indexContent).toContain('export const templates');
  });

  it('should skip index generation when disabled', async () => {
    writeFileSync(
      join(sourceDir, 'template.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );

    await compileTemplates({
      sourceDir,
      outputDir,
      generateIndex: false,
      mjmlCompile: mockMjmlCompile,
    });

    const indexPath = join(outputDir, 'index.ts');
    expect(existsSync(indexPath)).toBe(false);
  });

  it('should handle layout file wrapping', async () => {
    const layoutContent = '<mjml><mj-body><!-- content --></mj-body></mjml>';
    const layoutPath = join(tempDir, 'layout.mjml');
    writeFileSync(layoutPath, layoutContent);

    const templateContent = '<mj-text>Hello {{name}}</mj-text>';
    writeFileSync(join(sourceDir, 'partial.mjml'), templateContent);

    const result = await compileTemplates({
      sourceDir,
      outputDir,
      layoutFile: layoutPath,
      layoutMarker: '<!-- content -->',
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(1);
    expect(mockMjmlCompile).toHaveBeenCalled();
    const callArgs = mockMjmlCompile.mock.calls[0][0];
    expect(callArgs).toContain('<mj-text>Hello {{name}}</mj-text>');
    expect(callArgs).toContain('<mjml>');
  });

  it('should handle custom template extension', async () => {
    writeFileSync(
      join(sourceDir, 'template.email'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );

    const result = await compileTemplates({
      sourceDir,
      outputDir,
      templateExtension: '.email',
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(1);
    expect(result.templates[0].name).toBe('template');
  });

  it('should handle nested directories', async () => {
    const nestedDir = join(sourceDir, 'nested');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      join(nestedDir, 'nested-template.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );
    writeFileSync(
      join(sourceDir, 'root-template.mjml'),
      '<mjml><mj-body><mj-text>World</mj-text></mj-body></mjml>'
    );

    const result = await compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(2);
  });

  it('should create output directory if it does not exist', async () => {
    const newOutputDir = join(tempDir, 'new-output');
    writeFileSync(
      join(sourceDir, 'template.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );

    const result = await compileTemplates({
      sourceDir,
      outputDir: newOutputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(existsSync(newOutputDir)).toBe(true);
    expect(result.count).toBe(1);
  });

  describe('names and order', () => {
    const fullDocument = (body: string) => `<mjml><mj-body>${body}</mj-body></mjml>`;

    it('compiles templates in path order, so the index is the same on every machine', async () => {
      mkdirSync(join(sourceDir, 'nested'));
      writeFileSync(join(sourceDir, 'b.mjml'), fullDocument('B'));
      writeFileSync(join(sourceDir, 'nested', 'c.mjml'), fullDocument('C'));
      writeFileSync(join(sourceDir, 'a.mjml'), fullDocument('A'));

      const result = await compileTemplates({ sourceDir, outputDir, mjmlCompile: mockMjmlCompile });
      const index = readFileSync(join(outputDir, 'index.ts'), 'utf-8');

      expect(result.templates.map((template) => template.name)).toEqual(['a', 'b', 'c']);
      expect(index.indexOf("from './a.js'")).toBeLessThan(index.indexOf("from './b.js'"));
      expect(index.indexOf("from './b.js'")).toBeLessThan(index.indexOf("from './c.js'"));
    });

    it('rejects a template name that another directory already uses', async () => {
      mkdirSync(join(sourceDir, 'nested'));
      writeFileSync(join(sourceDir, 'nested', 'welcome.mjml'), fullDocument('nested'));
      writeFileSync(join(sourceDir, 'welcome.mjml'), fullDocument('root'));

      const result = await compileTemplates({ sourceDir, outputDir, mjmlCompile: mockMjmlCompile });

      expect(result.count).toBe(1);
      expect(result.errors).toEqual([
        {
          template: 'welcome',
          error: `Template name "welcome" is already used by ${join(sourceDir, 'nested', 'welcome.mjml')}`,
        },
      ]);
      expect(readFileSync(join(outputDir, 'welcome.ts'), 'utf-8')).toContain('nested');
    });

    it('rejects templates that the index would export under the same name', async () => {
      writeFileSync(join(sourceDir, 'order-confirmation.mjml'), fullDocument('dash'));
      writeFileSync(join(sourceDir, 'order_confirmation.mjml'), fullDocument('underscore'));

      const result = await compileTemplates({ sourceDir, outputDir, mjmlCompile: mockMjmlCompile });

      expect(result.count).toBe(1);
      expect(result.errors[0].error).toBe(
        'Templates "order-confirmation" and "order_confirmation" would both be exported as "orderConfirmation"; rename one of them'
      );
    });

    it('generates an index that type-checks for unusual names and subjects', async () => {
      writeFileSync(
        join(sourceDir, '2fa-code.mjml'),
        `<mjml><mj-head><mj-title>Tom's "code" \\ now</mj-title></mj-head><mj-body>{{code}}</mj-body></mjml>`
      );
      writeFileSync(join(sourceDir, 'default.mjml'), fullDocument('{{name}}'));
      writeFileSync(
        join(sourceDir, 'welcome email.mjml'),
        fullDocument('<!-- @if vip -->VIP<!-- @end -->')
      );

      const result = await compileTemplates({ sourceDir, outputDir, mjmlCompile: mockMjmlCompile });
      const files: Record<string, string> = {
        'glasswork-email.d.ts': `declare module 'glasswork/email' {
  export type TemplateRenderFn<TContext> = (ctx: TContext) => { html: string; text: string };
  export interface TemplateDefinition<TContext = unknown> {
    name: string;
    render: TemplateRenderFn<TContext>;
    subject?: string;
  }
  export class TemplateRegistry<
    TTemplates extends Record<string, TemplateDefinition> = Record<string, never>,
  > {
    private readonly templates: TTemplates;
    register<TName extends string, TContext>(
      name: TName,
      render: TemplateRenderFn<TContext>,
      options?: { subject?: string }
    ): TemplateRegistry<TTemplates & Record<TName, TemplateDefinition<TContext>>>;
  }
  export function createTemplateRegistry(): TemplateRegistry;
  export class TemplatedEmailService<TTemplates extends Record<string, TemplateDefinition>> {
    private readonly templates: TTemplates;
  }
}
`,
        'usage.ts': `import { _2faCode, defaultTemplate, type Templates, welcomeEmail } from './index.js';

const code: Templates['2fa-code']['subject'] = 'x';
_2faCode.render({ code: '123456' });
defaultTemplate.render({ name: 'Ada' });
welcomeEmail.render({ vip: true });
export { code };
`,
      };
      for (const file of readdirSync(outputDir)) {
        files[file] = readFileSync(join(outputDir, file), 'utf-8');
      }

      expect(result.errors).toEqual([]);
      expect(result.templates[0]).toEqual({ name: '2fa-code', subject: 'Tom\'s "code" \\ now' });
      expect(typecheck(files)).toBe('');
    });
  });

  describe('layouts', () => {
    const layoutPath = () => join(tempDir, 'layout.mjml');

    it("keeps $& and $' in a template that the layout wraps", async () => {
      writeFileSync(layoutPath(), '<mjml><mj-body><!-- content --></mj-body></mjml>');
      writeFileSync(join(sourceDir, 'price.mjml'), "<mj-text>Price: $& $' $$ {{amount}}</mj-text>");
      const mjmlCompile = vi.fn(mockMjmlCompile);

      await compileTemplates({ sourceDir, outputDir, layoutFile: layoutPath(), mjmlCompile });

      expect(mjmlCompile.mock.lastCall?.[0]).toBe(
        "<mjml><mj-body><mj-text>Price: $& $' $$ {{amount}}</mj-text></mj-body></mjml>"
      );
    });

    it('reports a layout without its marker instead of dropping the template', async () => {
      writeFileSync(layoutPath(), '<mjml><mj-body></mj-body></mjml>');
      writeFileSync(join(sourceDir, 'fragment.mjml'), '<mj-text>Hello</mj-text>');

      const result = await compileTemplates({
        sourceDir,
        outputDir,
        layoutFile: layoutPath(),
        mjmlCompile: mockMjmlCompile,
      });

      expect(result.errors).toEqual([
        {
          template: 'fragment',
          error: `Layout file ${layoutPath()} does not contain the marker <!-- content -->`,
        },
      ]);
    });

    it('reports a missing layout file only for templates that need it', async () => {
      writeFileSync(join(sourceDir, 'fragment.mjml'), '<mj-text>Hello</mj-text>');
      writeFileSync(
        join(sourceDir, 'full.mjml'),
        '<mjml><mj-body><mj-text>Hi</mj-text></mj-body></mjml>'
      );

      const result = await compileTemplates({
        sourceDir,
        outputDir,
        layoutFile: join(tempDir, 'missing.mjml'),
        mjmlCompile: mockMjmlCompile,
      });

      expect(result.templates.map((template) => template.name)).toEqual(['full']);
      expect(result.errors).toEqual([
        { template: 'fragment', error: `Layout file not found: ${join(tempDir, 'missing.mjml')}` },
      ]);
    });

    it('does not wrap a full document that starts with a byte order mark, declaration or comment', async () => {
      writeFileSync(layoutPath(), '<mjml><mj-body><!-- content --></mj-body></mjml>');
      const source = `${String.fromCharCode(0xfeff)}<?xml version="1.0"?>\n<!-- Welcome -->\n<mjml><mj-body><mj-text>Hi</mj-text></mj-body></mjml>`;
      writeFileSync(join(sourceDir, 'full.mjml'), source);
      const mjmlCompile = vi.fn(mockMjmlCompile);

      await compileTemplates({ sourceDir, outputDir, layoutFile: layoutPath(), mjmlCompile });

      expect(mjmlCompile.mock.lastCall?.[0]).toBe(source);
    });
  });
});
