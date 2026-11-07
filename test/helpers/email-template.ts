import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compile } from '../../src/email/compiler/compiler';

/**
 * Helpers for testing compiled email templates the way applications use them: the
 * generated module is imported and called, and type-checked with strict settings.
 */

const require = createRequire(import.meta.url);
const TSC = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc');
const directory = mkdtempSync(join(tmpdir(), 'glasswork-email-'));
let counter = 0;

export type RenderFn = (context: unknown) => { html: string; text: string };

/** Stands in for MJML in tests about the template syntax: the source inside an HTML body. */
export function wrapInHtml(source: string): { html: string; errors: Array<{ message: string }> } {
  return { html: `<!doctype html>\n<html>\n<body>\n${source}\n</body>\n</html>`, errors: [] };
}

/** The part of a page rendered from wrapInHtml output that came from the template. */
export function bodyOf(html: string): string {
  return html.slice(html.indexOf('<body>\n') + 7, html.lastIndexOf('\n</body>'));
}

/** Imports a generated module, so a test calls the render function the compiler wrote. */
export async function loadRender(source: string): Promise<RenderFn> {
  const file = join(directory, `template-${counter++}.ts`);
  writeFileSync(file, source);
  const module = (await import(file)) as { render: RenderFn };
  return module.render;
}

/** Compiles a template without MJML and returns a function rendering its body. */
export async function renderBody(source: string): Promise<(context: unknown) => string> {
  const render = await loadRender((await compile(source, 'test', wrapInHtml)).source);
  return (context) => bodyOf(render(context).html);
}

/** The strictest settings an application may use; generated code must compile with them. */
const STRICT_COMPILER_OPTIONS = {
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noImplicitReturns: true,
  noEmit: true,
  target: 'ES2022',
  module: 'NodeNext',
  moduleResolution: 'NodeNext',
  lib: ['ES2022'],
  types: [],
};

/**
 * Type-checks TypeScript files with tsc and returns its diagnostics, which are empty when
 * the files compile. Files may import each other with `./name.js`.
 */
export function typecheck(files: Record<string, string>): string {
  const project = join(directory, `project-${counter++}`);
  mkdirSync(project);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(project, name), content);
  }
  writeFileSync(
    join(project, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: STRICT_COMPILER_OPTIONS, include: ['*.ts'] })
  );
  const result = spawnSync(process.execPath, [TSC, '-p', project], { encoding: 'utf8' });
  return `${result.stdout}${result.stderr}`.trim();
}
