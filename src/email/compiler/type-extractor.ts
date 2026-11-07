import { parseTemplate } from './template-tree.js';
import { inferContextTypes } from './type-inference.js';
import type { InferredType, Token } from './types.js';

/**
 * Extracts and infers TypeScript types from template tokens.
 * Analyzes variable usage to build a context interface. Blocks follow the template
 * structure: an `@end` closes the innermost open block, so loop variables stay in scope
 * until the end of their own `@each`. Unclosed blocks end with the tokens, which allows
 * analyzing part of a template; `compile()` rejects them.
 */
export function extractTypes(tokens: Token[]): Map<string, InferredType> {
  return inferContextTypes(parseTemplate(tokens, { strict: false }));
}

/**
 * Generates a TypeScript interface from extracted types. Optional properties also accept
 * `undefined`, so they work with `exactOptionalPropertyTypes`.
 */
export function generateInterface(name: string, types: Map<string, InferredType>): string {
  const lines: string[] = [`export interface ${name} {`];

  for (const [, type] of types) {
    lines.push(...generateProperty(type, 1));
  }

  lines.push('}');
  return lines.join('\n');
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function propertyKey(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

function generateProperty(type: InferredType, indent: number): string[] {
  const prefix = '  '.repeat(indent);
  const lines = typeLines(type, indent);
  lines[0] = `${prefix}${propertyKey(type.name)}${type.optional ? '?' : ''}: ${lines[0]}`;
  lines[lines.length - 1] += type.optional ? ' | undefined;' : ';';
  return lines;
}

/** The lines of a type expression; nested lines carry their own indentation. */
function typeLines(type: InferredType, indent: number): string[] {
  if (type.type === 'array') {
    if (!type.itemType) return ['unknown[]'];
    const item = typeLines(type.itemType, indent);
    if (item.length === 1) return [`${item[0]}[]`];
    item[0] = `Array<${item[0]}`;
    item[item.length - 1] += '>';
    return item;
  }
  if (type.type === 'object' && type.properties) {
    const properties = Object.values(type.properties).flatMap((property) =>
      generateProperty(property, indent + 1)
    );
    return ['{', ...properties, `${'  '.repeat(indent)}}`];
  }
  return [type.type];
}
