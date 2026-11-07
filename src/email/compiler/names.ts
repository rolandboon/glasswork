/**
 * JavaScript reserved words and literals. They cannot name a loop variable or an import in
 * generated code, and they are not context variables in a template expression.
 */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/** Names the generated loop bodies call, so a loop variable cannot shadow them. */
const GENERATED_NAMES: ReadonlySet<string> = new Set([
  'ctx',
  'escapeHtml',
  'sanitizeUrl',
  'String',
]);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Explains why a name cannot be a loop variable, or returns undefined when it can. Names
 * starting with two underscores are reserved for generated code such as `__index`.
 */
export function loopVariableNameProblem(name: string): string | undefined {
  if (!IDENTIFIER.test(name)) return 'is not a valid name';
  if (RESERVED_WORDS.has(name)) return 'is a reserved word';
  if (GENERATED_NAMES.has(name) || name.startsWith('__')) {
    return 'is used by the generated render function';
  }
  return undefined;
}

/** The escape sequence for a character in a single-quoted JavaScript string. */
function escapeStringCharacter(character: string): string {
  if (character === '\\' || character === "'") return `\\${character}`;
  const code = character.charCodeAt(0);
  if (code === 0x0a) return '\\n';
  if (code === 0x0d) return '\\r';
  // Line and paragraph separators end a line in older JavaScript engines.
  if (code === 0x2028 || code === 0x2029) return `\\u${code.toString(16)}`;
  if (code < 0x20 || code === 0x7f) return `\\x${code.toString(16).padStart(2, '0')}`;
  return character;
}

/** A single-quoted JavaScript string literal for any text. */
export function quoteString(value: string): string {
  return `'${value.replace(/[^ -&(-[\]-~]/g, escapeStringCharacter)}'`;
}

/**
 * The prefix of a template's context interface: `order-confirmation` becomes
 * `OrderConfirmation`. Characters that cannot appear in a name are dropped, and a name that
 * would start with a digit gets an underscore.
 */
export function toTypeName(templateName: string): string {
  const pascal = templateName
    .split(/[-_\s.]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
    .replace(/[^\w$]/g, '');
  return /^[A-Za-z_$]/.test(pascal) ? pascal : `_${pascal}`;
}

/**
 * The name under which the generated index imports a template: `order-confirmation` becomes
 * `orderConfirmation`. A reserved word such as `default` gets a `Template` suffix.
 */
export function toImportName(templateName: string): string {
  const camel = templateName
    .replace(/[-_.\s]+(.)?/g, (_separator, next: string | undefined) => next?.toUpperCase() ?? '')
    .replace(/[^\w$]/g, '')
    .replace(/^[A-Z]/, (first) => first.toLowerCase());
  const name = /^[A-Za-z_$]/.test(camel) ? camel : `_${camel}`;
  return RESERVED_WORDS.has(name) ? `${name}Template` : name;
}
