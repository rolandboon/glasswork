import type { EachToken, TextToken, Token, VariableToken } from './types.js';

/**
 * One left-to-right scan for directives (`<!-- @if … -->`) and variables (`{{…}}` and
 * `{{{…}}}`). A directive argument may contain any character except the `-->` that ends
 * the comment, such as the hyphen in `status !== 'pre-order'`.
 */
const TOKEN_PATTERN = /<!--\s*@([A-Za-z][\w-]*)([\s\S]*?)-->|\{\{\{([^}]+)\}\}\}|\{\{([^}]+)\}\}/g;

const NAME = '[A-Za-z_$][\\w$]*';
const EACH_PATTERN = new RegExp(
  `^(${NAME}(?:\\.${NAME})*)\\s+as\\s+(${NAME})(?:\\s*,\\s*(${NAME}))?$`
);
const SIMPLE_PATH = /^@?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const DEFAULT_VALUE = /^(.+?)\s*\?\?\s*['"]([^'"]*)['"]\s*$/;

/** Suggestions for directives written as in other template languages. */
const DIRECTIVE_HINTS: Readonly<Record<string, string>> = {
  elif: '@elseif',
  'else-if': '@elseif',
  elsif: '@elseif',
  endeach: '@end',
  endfor: '@end',
  endif: '@end',
  for: '@each',
  foreach: '@each',
};

/**
 * Tokenizes a template string into a stream of tokens.
 * Handles both control flow markers (<!-- @if -->) and variable interpolation ({{var}}).
 * Throws when a directive is misspelled or malformed, because the template would otherwise
 * render the directive as an ordinary comment.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  for (const match of input.matchAll(TOKEN_PATTERN)) {
    const start = match.index;
    if (start > lastIndex) tokens.push(createTextToken(input, lastIndex, start));
    tokens.push(match[1] === undefined ? createVariableToken(match) : createDirectiveToken(match));
    lastIndex = start + match[0].length;
  }
  if (lastIndex < input.length) tokens.push(createTextToken(input, lastIndex, input.length));
  return tokens;
}

function createTextToken(input: string, start: number, end: number): TextToken {
  return {
    type: 'text',
    raw: input.slice(start, end),
    content: input.slice(start, end),
    start,
    end,
  };
}

function unknownDirective(name: string, raw: string): Error {
  const lowercase = name.toLowerCase();
  const hint = ['if', 'elseif', 'else', 'each', 'end'].includes(lowercase)
    ? `@${lowercase}`
    : DIRECTIVE_HINTS[lowercase];
  return new Error(
    `Unknown template directive @${name} in ${raw}${hint ? `; did you mean ${hint}?` : ''}. Use @if, @elseif, @else, @each or @end.`
  );
}

function createDirectiveToken(match: RegExpExecArray): Token {
  const [raw, name, rawArgs] = match;
  const start = match.index;
  const end = start + raw.length;
  const args = rawArgs.trim();

  switch (name) {
    case 'if':
    case 'elseif':
      if (!args) throw new Error(`@${name} needs a condition: ${raw}`);
      return { type: name, raw, start, end, condition: args };
    case 'else':
      if (args) throw new Error(`@else does not take a condition; use @elseif: ${raw}`);
      return { type: 'else', raw, start, end };
    case 'end':
      if (args) throw new Error(`@end does not take arguments: ${raw}`);
      return { type: 'end', raw, start, end };
    case 'each':
      return parseEachToken(raw, args, start, end);
    default:
      throw unknownDirective(name, raw);
  }
}

function parseEachToken(raw: string, args: string, start: number, end: number): EachToken {
  // Parse: "items as item" or "items as item, index"
  const eachMatch = args.match(EACH_PATTERN);
  if (!eachMatch) {
    throw new Error(
      `Invalid @each syntax: "${args}". Expected: "array as item" or "array as item, index"`
    );
  }

  return {
    type: 'each',
    raw,
    start,
    end,
    arrayPath: eachMatch[1],
    itemName: eachMatch[2],
    indexName: eachMatch[3],
  };
}

function createVariableToken(match: RegExpExecArray): VariableToken {
  // Groups 1 and 2 belong to directives; 3 is {{{…}}} and 4 is {{…}}.
  const [raw, , , rawExpression, escapedExpression] = match;
  const expression = (rawExpression ?? escapedExpression).trim();
  const start = match.index;
  if (!expression) throw new Error(`Empty template expression: ${raw}`);

  // A default value such as {{name ?? 'Guest'}} makes the variable optional.
  const defaultMatch = expression.match(DEFAULT_VALUE);
  const path = defaultMatch ? defaultMatch[1].trim() : expression;

  return {
    type: 'variable',
    raw,
    start,
    end: start + raw.length,
    expression,
    path: SIMPLE_PATH.test(path) ? path.split('.') : [],
    defaultValue: defaultMatch?.[2],
    unescaped: rawExpression !== undefined,
  };
}
