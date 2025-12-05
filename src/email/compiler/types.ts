/**
 * Token types for template control flow syntax
 */
export type TokenType = 'text' | 'variable' | 'if' | 'elseif' | 'else' | 'each' | 'end';

/**
 * Base token interface
 */
interface BaseToken {
  type: TokenType;
  raw: string;
  start: number;
  end: number;
}

/**
 * Plain text content
 */
export interface TextToken extends BaseToken {
  type: 'text';
  content: string;
}

/**
 * Variable interpolation: {{name}} or {{name ?? 'default'}}
 */
export interface VariableToken extends BaseToken {
  type: 'variable';
  expression: string;
  path: string[];
  defaultValue?: string;
}

/**
 * Conditional start: <!-- @if condition -->
 */
export interface IfToken extends BaseToken {
  type: 'if';
  condition: string;
}

/**
 * Else-if branch: <!-- @elseif condition -->
 */
export interface ElseIfToken extends BaseToken {
  type: 'elseif';
  condition: string;
}

/**
 * Else branch: <!-- @else -->
 */
export interface ElseToken extends BaseToken {
  type: 'else';
}

/**
 * Loop start: <!-- @each array as item --> or <!-- @each array as item, index -->
 */
export interface EachToken extends BaseToken {
  type: 'each';
  arrayPath: string;
  itemName: string;
  indexName?: string;
}

/**
 * End marker: <!-- @end -->
 */
export interface EndToken extends BaseToken {
  type: 'end';
}

export type Token =
  | TextToken
  | VariableToken
  | IfToken
  | ElseIfToken
  | ElseToken
  | EachToken
  | EndToken;

/**
 * Inferred type from template analysis
 */
export interface InferredType {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  optional: boolean;
  properties?: Record<string, InferredType>;
  itemType?: InferredType;
}

/**
 * Result of template parsing
 */
export interface ParseResult {
  tokens: Token[];
  variables: Map<string, InferredType>;
}

/**
 * Compiled template output
 */
export interface CompiledTemplate {
  /** TypeScript source code for the render function */
  source: string;
  /** Inferred context interface definition */
  contextInterface: string;
  /** Template name (derived from filename) */
  name: string;
  /** Subject line extracted from <mj-title> or <title> tag */
  subject?: string;
}

/**
 * Compiler options
 */
export interface CompilerOptions {
  /** Source directory for MJML templates */
  sourceDir: string;
  /** Output directory for compiled TypeScript */
  outputDir: string;
  /** Whether to generate plain text version */
  generateText?: boolean;
}
