import type {
  EachToken,
  ElseIfToken,
  ElseToken,
  EndToken,
  IfToken,
  TextToken,
  Token,
  VariableToken,
} from './types.js';

/**
 * Regex patterns for tokenizing templates
 */
const PATTERNS = {
  // Control flow markers in HTML comments
  control: /<!--\s*@(if|elseif|else|each|end)(?:\s+([^-]*?))?\s*-->/g,
  // Variable interpolation
  variable: /\{\{([^}]+)\}\}/g,
};

/**
 * Tokenizes a template string into a stream of tokens.
 * Handles both control flow markers (<!-- @if -->) and variable interpolation ({{var}}).
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;

  // Find all control flow markers and variables
  const allMatches: Array<{
    match: RegExpExecArray;
    type: 'control' | 'variable';
  }> = [];

  // Collect control flow matches
  const controlRegex = new RegExp(PATTERNS.control.source, 'g');
  let match: RegExpExecArray | null = controlRegex.exec(input);
  while (match !== null) {
    allMatches.push({ match, type: 'control' });
    match = controlRegex.exec(input);
  }

  // Collect variable matches
  const variableRegex = new RegExp(PATTERNS.variable.source, 'g');
  match = variableRegex.exec(input);
  while (match !== null) {
    allMatches.push({ match, type: 'variable' });
    match = variableRegex.exec(input);
  }

  // Sort by position
  allMatches.sort((a, b) => a.match.index - b.match.index);

  // Process matches in order
  for (const { match, type } of allMatches) {
    const start = match.index;
    const end = start + match[0].length;

    // Skip if this match is inside a previous match
    if (start < lastIndex) {
      continue;
    }

    // Add text token for content before this match
    if (start > lastIndex) {
      tokens.push(createTextToken(input, lastIndex, start));
    }

    if (type === 'control') {
      tokens.push(createControlToken(match));
    } else {
      tokens.push(createVariableToken(match));
    }

    lastIndex = end;
  }

  // Add remaining text
  if (lastIndex < input.length) {
    tokens.push(createTextToken(input, lastIndex, input.length));
  }

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

function createControlToken(match: RegExpExecArray): Token {
  const [raw, directive, args] = match;
  const start = match.index;
  const end = start + raw.length;
  const trimmedArgs = args?.trim();

  switch (directive) {
    case 'if':
      return {
        type: 'if',
        raw,
        start,
        end,
        condition: trimmedArgs || '',
      } satisfies IfToken;

    case 'elseif':
      return {
        type: 'elseif',
        raw,
        start,
        end,
        condition: trimmedArgs || '',
      } satisfies ElseIfToken;

    case 'else':
      return {
        type: 'else',
        raw,
        start,
        end,
      } satisfies ElseToken;

    case 'each':
      return parseEachToken(raw, trimmedArgs || '', start, end);

    case 'end':
      return {
        type: 'end',
        raw,
        start,
        end,
      } satisfies EndToken;

    default:
      throw new Error(`Unknown directive: ${directive}`);
  }
}

function parseEachToken(raw: string, args: string, start: number, end: number): EachToken {
  // Parse: "items as item" or "items as item, index"
  const eachMatch = args.match(/^(\S+)\s+as\s+(\w+)(?:\s*,\s*(\w+))?$/);
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
  const [raw, expression] = match;
  const start = match.index;
  const end = start + raw.length;
  const trimmedExpr = expression.trim();

  // Check for default value: {{name ?? 'default'}}
  const defaultMatch = trimmedExpr.match(/^(.+?)\s*\?\?\s*['"]([^'"]*)['"]\s*$/);
  let path: string;
  let defaultValue: string | undefined;

  if (defaultMatch) {
    path = defaultMatch[1].trim();
    defaultValue = defaultMatch[2];
  } else {
    path = trimmedExpr;
  }

  return {
    type: 'variable',
    raw,
    start,
    end,
    expression: trimmedExpr,
    path: path.split('.'),
    defaultValue,
  };
}
