import { generateModule } from './codegen.js';
import { decodeHtmlEntities } from './entities.js';
import { toTypeName } from './names.js';
import { parseTemplate } from './template-tree.js';
import { tokenize } from './tokenizer.js';
import { generateInterface } from './type-extractor.js';
import { inferContextTypes } from './type-inference.js';
import type { CompiledTemplate } from './types.js';

/**
 * Two-pass MJML template compiler.
 *
 * Pass 1: MJML → HTML (preserving control flow markers in comments)
 * Pass 2: HTML with markers → TypeScript template literal function
 *
 * This approach allows us to:
 * 1. Use the full power of MJML at build time
 * 2. Generate zero-dependency TypeScript render functions
 * 3. Infer TypeScript types from template usage
 */

/**
 * Compiles an MJML template with control flow syntax to a TypeScript render function.
 *
 * @param source - MJML source with control flow markers
 * @param name - Template name (used for interface naming)
 * @param mjmlCompile - MJML compiler function (injected to avoid bundling MJML)
 * @param filePath - Source file path for MJML include resolution (MJML 5+)
 * @returns Compiled TypeScript source code
 */
export type MjmlCompileResult = { html: string; errors: Array<{ message: string }> };
export type MjmlCompileFn = (
  mjml: string,
  filePath?: string
) => MjmlCompileResult | Promise<MjmlCompileResult>;

export async function compile(
  source: string,
  name: string,
  mjmlCompile: MjmlCompileFn,
  filePath?: string
): Promise<CompiledTemplate> {
  // Pass 1: Compile MJML to HTML (markers are preserved in comments)
  const { html, errors } = await mjmlCompile(source, filePath);

  if (errors.length > 0) {
    const errorMessages = errors.map((e) => e.message).join('\n');
    throw new Error(`MJML compilation errors:\n${errorMessages}`);
  }

  assertNoHeadDirectives(source);
  assertDirectivesKept(source, html);
  validateDynamicAttributes(html);

  // Extract subject from <mj-title> in source or <title> in compiled HTML
  const subject = extractSubject(source, html);

  // Parse the compiled HTML, the same input the render function is generated from, so
  // variables from files that MJML includes (mj-include) are part of the context type.
  const nodes = parseTemplate(tokenize(html), { strict: true });
  const interfaceName = `${toTypeName(name)}Context`;
  const contextInterface = generateInterface(interfaceName, inferContextTypes(nodes));

  // Pass 2: Transform compiled HTML to TypeScript
  return {
    source: generateModule({ interfaceName, contextInterface, html, nodes }),
    contextInterface,
    name,
    subject,
  };
}

const DIRECTIVE_COMMENT = /<!--\s*@(?:if|elseif|else|each|end)\b/g;

/**
 * MJML moves comments inside mj-head to the end of the head, or drops them, so a directive
 * there would wrap nothing. Content of an mj-raw stays in place.
 */
function assertNoHeadDirectives(source: string): void {
  const head = /<mj-head(?:\s[^>]*)?>([\s\S]*?)<\/mj-head>/i.exec(source)?.[1] ?? '';
  const outsideRaw = head.replace(/<mj-raw(?:\s[^>]*)?>[\s\S]*?<\/mj-raw>/gi, '');
  if (outsideRaw.match(DIRECTIVE_COMMENT)) {
    throw new Error(
      'Template directives inside mj-head do not work, because MJML moves or removes comments there. Put conditional head content in an mj-raw.'
    );
  }
}

/**
 * Directives are HTML comments, and MJML removes comments in some places (inside mj-head)
 * and with some options (keepComments: false). A removed directive would silently change
 * what the template renders, so compilation stops instead.
 */
function assertDirectivesKept(source: string, html: string): void {
  const expected = source.match(DIRECTIVE_COMMENT)?.length ?? 0;
  const kept = html.match(DIRECTIVE_COMMENT)?.length ?? 0;
  if (kept < expected) {
    throw new Error(
      `MJML removed ${expected - kept} of the ${expected} template directives. Directives are HTML comments: place them inside mj-body, keep comments enabled (keepComments) and do not minify comments away.`
    );
  }
}

/** The index of the `>` that ends a start tag, skipping `>` inside quoted values. */
function tagEnd(html: string, from: number): number {
  let quote: string | undefined;
  for (let index = from; index < html.length; index++) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return html.length;
}

/** The attribute part of every start tag, so attributes are not confused with text. */
function* tagAttributes(html: string): Generator<string> {
  const tagStart = /<[A-Za-z][^\s/>]*/g;
  for (let match = tagStart.exec(html); match; match = tagStart.exec(html)) {
    const end = tagEnd(html, tagStart.lastIndex);
    yield html.slice(tagStart.lastIndex, end);
    tagStart.lastIndex = end;
  }
}

const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * Dynamic attributes must have an unambiguous HTML and URL context: a variable inside a tag
 * is only safe as (part of) a quoted attribute value, and a URL attribute must be one
 * complete expression so the render function can check its scheme.
 */
function validateDynamicAttributes(html: string): void {
  if (/<\{\{/.test(html)) throw new Error('A variable cannot be an HTML tag name');
  for (const attributes of tagAttributes(html)) {
    for (const [, name, doubleQuoted, singleQuoted, unquoted] of attributes.matchAll(ATTRIBUTE)) {
      if (unquoted?.includes('{{')) throw new Error('Dynamic HTML attributes must be quoted');
      if (name.includes('{{')) {
        throw new Error('Variables inside an HTML tag must be in a quoted attribute value');
      }
      const value = doubleQuoted ?? singleQuoted ?? '';
      if (
        value.includes('{{') &&
        /^(href|src)$/i.test(name) &&
        !/^\{\{(?!\{)[^{}]+\}\}$/.test(value)
      ) {
        throw new Error(
          'Dynamic href/src attributes must contain one complete double-brace URL expression; construct the URL in application code'
        );
      }
    }
  }
}

/**
 * Extracts subject from MJML source (<mj-title>) or compiled HTML (<title>). Entities are
 * decoded and whitespace collapsed, because the subject is plain text. A title with a
 * variable is not a usable default subject: the sender must pass one.
 */
function extractSubject(source: string, html: string): string | undefined {
  const title =
    /<mj-title(?:\s[^>]*)?>([^<]*)<\/mj-title>/i.exec(source)?.[1] ??
    /<title(?:\s[^>]*)?>([^<]*)<\/title>/i.exec(html)?.[1];
  if (title === undefined) return undefined;
  const subject = decodeHtmlEntities(title).replace(/\s+/g, ' ').trim();
  return subject && !subject.includes('{{') ? subject : undefined;
}

// Re-export types and utilities
export { tokenize } from './tokenizer.js';
export { extractTypes, generateInterface } from './type-extractor.js';
export type { CompiledTemplate, CompilerOptions, Token } from './types.js';
