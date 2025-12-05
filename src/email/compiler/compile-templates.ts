import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createLogger } from '../../utils/logger.js';
import { compile } from './compiler.js';

const logger = createLogger('TemplateCompiler');

/**
 * Options for the template compiler
 */
export interface CompileOptions {
  /** Source directory containing MJML templates */
  sourceDir: string;
  /** Output directory for compiled TypeScript files */
  outputDir: string;
  /** Base layout file to wrap templates (optional) */
  layoutFile?: string;
  /** Layout content marker to replace with template content */
  layoutMarker?: string;
  /** Whether to generate an index file */
  generateIndex?: boolean;
  /** File extension for templates (default: .mjml) */
  templateExtension?: string;
  /** Subdirectories to exclude (default: ['layouts']) */
  excludeDirs?: string[];
  /** MJML compiler function (must be provided) */
  mjmlCompile: (mjml: string) => { html: string; errors: Array<{ message: string }> };
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

/**
 * Compiles all MJML templates in a directory
 *
 * @example
 * ```typescript
 * import mjml2html from 'mjml';
 * import { compileTemplates } from '@glasswork/email/compiler';
 *
 * const result = await compileTemplates({
 *   sourceDir: './src/templates',
 *   outputDir: './src/templates.compiled',
 *   mjmlCompile: (source) => mjml2html(source, { validationLevel: 'soft' }),
 * });
 *
 * console.log(`Compiled ${result.count} templates`);
 * ```
 */
export function compileTemplates(options: CompileOptions): CompileResult {
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
  let layout: string | null = null;
  if (layoutFile && existsSync(layoutFile)) {
    layout = readFileSync(layoutFile, 'utf-8');
  }

  // Find all template files
  const templateFiles = findTemplateFiles(sourceDir, templateExtension, excludeDirs);

  const result: CompileResult = {
    count: 0,
    templates: [],
    errors: [],
  };

  // Compile each template
  for (const templatePath of templateFiles) {
    const templateName = basename(templatePath, templateExtension);

    try {
      // Read template content
      let source = readFileSync(templatePath, 'utf-8');

      // If layout is provided and template doesn't have full MJML structure, wrap it
      if (layout && !source.trim().startsWith('<mjml')) {
        source = layout.replace(layoutMarker, source);
      }

      // Compile the template
      const compiled = compile(source, templateName, mjmlCompile);

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
 * Escapes a string for use in a JavaScript string literal
 */
function escapeString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Finds all template files in a directory recursively
 */
function findTemplateFiles(dir: string, extension: string, excludeDirs: string[]): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) {
    return files;
  }

  const entries = readdirSync(dir, { withFileTypes: true });

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

  for (const template of templates) {
    const varName = toCamelCase(template.name);
    imports.push(`import * as ${varName} from './${template.name}.js';`);

    // Include subject if available
    if (template.subject) {
      registrations.push(
        `  .register('${template.name}', ${varName}.render, { subject: '${escapeString(template.subject)}' })`
      );
    } else {
      registrations.push(`  .register('${template.name}', ${varName}.render)`);
    }
  }

  return `// This file is auto-generated. Do not edit manually.
import {
  createTemplateRegistry,
  type TemplatedEmailService,
  type TemplateRegistry,
} from 'glasswork';

${imports.join('\n')}

/**
 * Registry of all compiled email templates
 */
export const templates = createTemplateRegistry()
${registrations.join('\n')};

// Re-export individual templates for direct access
${templates.map((t) => `export * as ${toCamelCase(t.name)} from './${t.name}.js';`).join('\n')}

// Type utilities for dependency injection
type InferTemplates<T> = T extends TemplateRegistry<infer U> ? U : never;

/** Template definitions for type-safe email sending */
export type Templates = InferTemplates<typeof templates>;

/** Typed email service for dependency injection */
export type EmailService = TemplatedEmailService<Templates>;
`;
}

/**
 * Converts a string to camelCase
 */
function toCamelCase(str: string): string {
  return str
    .replace(/[-_.]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ''))
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}
