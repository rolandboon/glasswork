import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplates } from '../../src/email/compiler/compile-templates.js';

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

  it('should compile a single template', () => {
    const templateContent = '<mjml><mj-body><mj-text>Hello {{name}}</mj-text></mj-body></mjml>';
    const templatePath = join(sourceDir, 'greeting.mjml');
    writeFileSync(templatePath, templateContent);

    const result = compileTemplates({
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

  it('should compile multiple templates', () => {
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

    const result = compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(3);
    expect(result.templates).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should extract subject from mj-title', () => {
    const templateContent = `<mjml>
<mj-head>
  <mj-title>Welcome Email</mj-title>
</mj-head>
<mj-body>
  <mj-text>Hello {{name}}</mj-text>
</mj-body>
</mjml>`;
    writeFileSync(join(sourceDir, 'welcome.mjml'), templateContent);

    const result = compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.templates[0].subject).toBe('Welcome Email');
  });

  it('should handle templates without subject', () => {
    const templateContent = '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>';
    writeFileSync(join(sourceDir, 'no-subject.mjml'), templateContent);

    const result = compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.templates[0].subject).toBeUndefined();
  });

  it('should exclude layout directory by default', () => {
    mkdirSync(join(sourceDir, 'layouts'), { recursive: true });
    writeFileSync(join(sourceDir, 'layouts', 'base.mjml'), '<mjml><mj-body></mj-body></mjml>');
    writeFileSync(
      join(sourceDir, 'template.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );

    const result = compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(1);
    expect(result.templates[0].name).toBe('template');
  });

  it('should handle custom exclude directories', () => {
    mkdirSync(join(sourceDir, 'partials'), { recursive: true });
    writeFileSync(join(sourceDir, 'partials', 'header.mjml'), '<mjml><mj-body></mj-body></mjml>');
    writeFileSync(
      join(sourceDir, 'template.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );

    const result = compileTemplates({
      sourceDir,
      outputDir,
      excludeDirs: ['partials'],
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(1);
  });

  it('should handle MJML compilation errors', () => {
    const errorMjmlCompile = vi.fn(() => ({
      html: '',
      errors: [{ message: 'Invalid MJML syntax' }],
    }));

    writeFileSync(join(sourceDir, 'invalid.mjml'), '<invalid>content</invalid>');

    const result = compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: errorMjmlCompile,
    });

    expect(result.count).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].template).toBe('invalid');
    expect(result.errors[0].error).toContain('MJML compilation errors');
  });

  it('should generate index file by default', () => {
    writeFileSync(
      join(sourceDir, 'template1.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );
    writeFileSync(
      join(sourceDir, 'template2.mjml'),
      '<mjml><mj-body><mj-text>World</mj-text></mj-body></mjml>'
    );

    compileTemplates({
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

  it('should skip index generation when disabled', () => {
    writeFileSync(
      join(sourceDir, 'template.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );

    compileTemplates({
      sourceDir,
      outputDir,
      generateIndex: false,
      mjmlCompile: mockMjmlCompile,
    });

    const indexPath = join(outputDir, 'index.ts');
    expect(existsSync(indexPath)).toBe(false);
  });

  it('should handle layout file wrapping', () => {
    const layoutContent = '<mjml><mj-body><!-- content --></mj-body></mjml>';
    const layoutPath = join(tempDir, 'layout.mjml');
    writeFileSync(layoutPath, layoutContent);

    const templateContent = '<mj-text>Hello {{name}}</mj-text>';
    writeFileSync(join(sourceDir, 'partial.mjml'), templateContent);

    const result = compileTemplates({
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

  it('should handle custom template extension', () => {
    writeFileSync(
      join(sourceDir, 'template.email'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );

    const result = compileTemplates({
      sourceDir,
      outputDir,
      templateExtension: '.email',
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(1);
    expect(result.templates[0].name).toBe('template');
  });

  it('should handle nested directories', () => {
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

    const result = compileTemplates({
      sourceDir,
      outputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(result.count).toBe(2);
  });

  it('should create output directory if it does not exist', () => {
    const newOutputDir = join(tempDir, 'new-output');
    writeFileSync(
      join(sourceDir, 'template.mjml'),
      '<mjml><mj-body><mj-text>Hello</mj-text></mj-body></mjml>'
    );

    const result = compileTemplates({
      sourceDir,
      outputDir: newOutputDir,
      mjmlCompile: mockMjmlCompile,
    });

    expect(existsSync(newOutputDir)).toBe(true);
    expect(result.count).toBe(1);
  });
});
