import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createLogger } from '../../utils/logger.js';
import { compile } from './compiler.js';
import { quoteString, toImportName } from './names.js';

const logger = createLogger('TemplateCompiler');

/**
 * Options for the template compiler
 */
export interface CompileOptions {
  /** Source directory containing MJML templates */
  sourceDir: string;
  /** Output directory for compiled TypeScript files */
  outputDir: string;
  /** Base layout file to wrap templates without an `<mjml>` root (optional) */
  layoutFile?: string;
  /** Layout content marker to replace with template content */
  layoutMarker?: string;
  /** Whether to generate an index file */
  generateIndex?: boolean;
  /** File extension for templates (default: .mjml) */
  templateExtension?: string;
  /** Subdirectories to exclude (default: ['layouts']) */
  excludeDirs?: string[];
  /** MJML compiler function (must be provided; MJML 5+ returns a Promise) */
  mjmlCompile: import('./compiler.js').MjmlCompileFn;
}

/**
 * Compiled template info
 */
export interface CompiledTemplateInfo {
  /** Template name */
  name: string;
  /** Subject line (if found in template) */
  subject?: string;
}

/**
 * Result of compiling templates
 */
export interface CompileResult {
  /** Number of templates compiled */
  count: number;
  /** List of compiled template info */
  templates: CompiledTemplateInfo[];
  /** Any errors encountered */
  errors: Array<{ template: string; error: string }>;
}

/** A template with an `<mjml>` root, possibly after an XML declaration or comments. */
const FULL_DOCUMENT = /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<mjml[\s>]/i;

const BYTE_ORDER_MARK = 0xfeff;

/** Whether a template is a complete MJML document rather than a fragment for the layout. */
function isFullDocument(source: string): boolean {
  const text = source.charCodeAt(0) === BYTE_ORDER_MARK ? source.slice(1) : source;
  return FULL_DOCUMENT.test(text);
}

/**
 * Compiles all MJML templates in a directory
 *
 * Templates are compiled in path order, so the generated index is the same on every
 * machine. Each template name must be unique across subdirectories, because all compiled
 * files share the output directory.
 *
 * @example
 * ```typescript
 * import mjml2html from 'mjml';
 * import { compileTemplates } from 'glasswork/email';
 *
 * const result = await compileTemplates({
 *   sourceDir: './src/templates',
 *   outputDir: './src/templates.compiled',
 *   mjmlCompile: (source, filePath) =>
 *     mjml2html(source, { validationLevel: 'soft', filePath, ignoreIncludes: false }),
 * });
 *
 * console.log(`Compiled ${result.count} templates`);
 * ```
 */
export async function compileTemplates(options: CompileOptions): Promise<CompileResult> {
  const {
    sourceDir,
    outputDir,
    layoutFile,
    layoutMarker = '<!-- content -->',
    generateIndex = true,
    templateExtension = '.mjml',
    excludeDirs = ['layouts'],
    mjmlCompile,
  } = options;

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  // Read layout if provided
  const layout = layoutFile && existsSync(layoutFile) ? readFileSync(layoutFile, 'utf-8') : null;

  // Find all template files
  const templateFiles = findTemplateFiles(sourceDir, templateExtension, excludeDirs);

  const result: CompileResult = {
    count: 0,
    templates: [],
    errors: [],
  };
  const pathsByName = new Map<string, string>();
  const namesByImport = new Map<string, string>();

  // Compile each template
  for (const templatePath of templateFiles) {
    const templateName = basename(templatePath, templateExtension);

    try {
      assertUniqueName(templateName, templatePath, pathsByName, namesByImport);

      // Read template content and wrap a fragment in the layout
      const source = applyLayout(readFileSync(templatePath, 'utf-8'), {
        layout,
        layoutFile,
        layoutMarker,
      });

      // Compile the template
      const compiled = await compile(source, templateName, mjmlCompile, templatePath);

      // Write the compiled output
      const outputPath = join(outputDir, `${templateName}.ts`);
      writeFileSync(outputPath, compiled.source);

      result.count++;
      result.templates.push({
        name: templateName,
        subject: compiled.subject,
      });

      logger.info(
        `✓ Compiled ${templateName}${compiled.subject ? ` (subject: "${compiled.subject}")` : ''}`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({ template: templateName, error: errorMessage });
      logger.error(`✗ Failed to compile ${templateName}: ${errorMessage}`);
    }
  }

  // Generate index file
  if (generateIndex && result.templates.length > 0) {
    const indexContent = generateIndexFile(result.templates);
    writeFileSync(join(outputDir, 'index.ts'), indexContent);
    logger.info('✓ Generated index.ts');
  }

  return result;
}

/**
 * Compiled files share the output directory and the index imports every template under a
 * camelCase name, so two templates may not end up with the same file or import name.
 */
function assertUniqueName(
  templateName: string,
  templatePath: string,
  pathsByName: Map<string, string>,
  namesByImport: Map<string, string>
): void {
  const existingPath = pathsByName.get(templateName);
  if (existingPath) {
    throw new Error(`Template name "${templateName}" is already used by ${existingPath}`);
  }
  const importName = toImportName(templateName);
  const existingName = namesByImport.get(importName);
  if (existingName) {
    throw new Error(
      `Templates "${existingName}" and "${templateName}" would both be exported as "${importName}"; rename one of them`
    );
  }
  pathsByName.set(templateName, templatePath);
  namesByImport.set(importName, templateName);
}

/** Wraps a template without an `<mjml>` root in the layout. */
function applyLayout(
  source: string,
  options: { layout: string | null; layoutFile: string | undefined; layoutMarker: string }
): string {
  const { layout, layoutFile, layoutMarker } = options;
  if (!layoutFile || isFullDocument(source)) return source;
  if (layout === null) {
    throw new Error(`Layout file not found: ${layoutFile}`);
  }
  if (!layout.includes(layoutMarker)) {
    throw new Error(`Layout file ${layoutFile} does not contain the marker ${layoutMarker}`);
  }
  // A replacement function, so `$&` or `$'` in the template is not a replacement pattern.
  return layout.replace(layoutMarker, () => source);
}

/**
 * Finds all template files in a directory recursively, sorted by name
 */
function findTemplateFiles(dir: string, extension: string, excludeDirs: string[]): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) {
    return files;
  }

  // readdirSync returns entries in file system order, which differs between machines.
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!excludeDirs.includes(entry.name)) {
        files.push(...findTemplateFiles(fullPath, extension, excludeDirs));
      }
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Generates an index file that re-exports all templates
 */
function generateIndexFile(templates: CompiledTemplateInfo[]): string {
  const imports: string[] = [];
  const registrations: string[] = [];
  const reexports: string[] = [];

  for (const template of templates) {
    const varName = toImportName(template.name);
    const modulePath = quoteString(`./${template.name}.js`);
    imports.push(`import * as ${varName} from ${modulePath};`);
    reexports.push(`export * as ${varName} from ${modulePath};`);

    // Include subject if available
    const subject = template.subject ? `, { subject: ${quoteString(template.subject)} }` : '';
    registrations.push(`  .register(${quoteString(template.name)}, ${varName}.render${subject})`);
  }

  return `// This file is auto-generated. Do not edit manually.
import {
  createTemplateRegistry,
  type TemplatedEmailService,
  type TemplateRegistry,
} from 'glasswork/email';

${imports.join('\n')}

/**
 * Registry of all compiled email templates
 */
export const templates = createTemplateRegistry()
${registrations.join('\n')};

// Re-export individual templates for direct access
${reexports.join('\n')}

// Type utilities for dependency injection
type InferTemplates<T> = T extends TemplateRegistry<infer U> ? U : never;

/** Template definitions for type-safe email sending */
export type Templates = InferTemplates<typeof templates>;

/** Typed email service for dependency injection */
export type EmailService = TemplatedEmailService<Templates>;
`;
}
