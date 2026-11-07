import { decodeHtmlEntities } from './entities.js';
import { quoteString, RESERVED_WORDS } from './names.js';

/**
 * Template expressions: the part of the JavaScript expression syntax that templates need.
 *
 * Supported: variable paths with `.` and `?.`, string, number and boolean literals, `null`
 * and `undefined`, the loop variables `@index`, `@first`, `@last` and `@length`, the
 * operators `!`, unary `-` and `+`, `* / %`, `+ -`, `< > <= >=`, `=== !== == !=`, `&&`, `||`,
 * `??`, the conditional operator and parentheses. Calls and computed member access are not
 * supported: templates receive prepared values, and the compiler can only type plain paths.
 */

export type LoopVariableName = 'index' | 'first' | 'last' | 'length';
export type UnaryOperator = '!' | '-' | '+';
export type LogicalOperator = '&&' | '||' | '??';
export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '<'
  | '>'
  | '<='
  | '>='
  | '==='
  | '!=='
  | '=='
  | '!=';

interface ExpressionBase {
  /** Written in parentheses, which allows `??` next to `&&` or `||`. */
  parenthesized?: boolean;
}

export interface LiteralExpression extends ExpressionBase {
  kind: 'literal';
  value: string | number | boolean | null | undefined;
}

export interface PathMember {
  name: string;
  /** Accessed with `?.`. */
  optional: boolean;
}

/** A variable with optional property access, such as `user.address?.city`. */
export interface PathExpression extends ExpressionBase {
  kind: 'path';
  root: string;
  members: PathMember[];
}

export interface LoopVariableExpression extends ExpressionBase {
  kind: 'loop';
  name: LoopVariableName;
}

export interface UnaryExpression extends ExpressionBase {
  kind: 'unary';
  operator: UnaryOperator;
  argument: Expression;
}

export interface BinaryExpression extends ExpressionBase {
  kind: 'binary';
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
}

export interface LogicalExpression extends ExpressionBase {
  kind: 'logical';
  operator: LogicalOperator;
  left: Expression;
  right: Expression;
}

export interface ConditionalExpression extends ExpressionBase {
  kind: 'conditional';
  test: Expression;
  consequent: Expression;
  alternate: Expression;
}

export type Expression =
  | LiteralExpression
  | PathExpression
  | LoopVariableExpression
  | UnaryExpression
  | BinaryExpression
  | LogicalExpression
  | ConditionalExpression;

type LexToken =
  | { type: 'identifier' | 'loop' | 'punctuator'; text: string }
  | { type: 'number'; text: string; value: number }
  | { type: 'string'; text: string; value: string }
  | { type: 'end'; text: '' };

const LOOP_VARIABLES: ReadonlySet<string> = new Set(['index', 'first', 'last', 'length']);

const LITERAL_WORDS: ReadonlyMap<string, boolean | null | undefined> = new Map([
  ['true', true],
  ['false', false],
  ['null', null],
  ['undefined', undefined],
]);

// Longest first, so `===` is not read as `==` and `=`.
const PUNCTUATORS = [
  '===',
  '!==',
  '??',
  '?.',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
  '?',
  ':',
  '.',
  '(',
  ')',
  '[',
  ']',
  ',',
] as const;

const BINARY_LEVELS: ReadonlyArray<ReadonlyArray<BinaryOperator | '&&' | '||'>> = [
  ['||'],
  ['&&'],
  ['===', '!==', '==', '!='],
  ['<', '>', '<=', '>='],
  ['+', '-'],
  ['*', '/', '%'],
];

const IDENTIFIER_PATTERN = /[A-Za-z_$][\w$]*/y;
const NUMBER_PATTERN = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

const STRING_ESCAPES: Readonly<Record<string, string>> = {
  0: '\0',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

function matchAt(pattern: RegExp, source: string, index: number): string | undefined {
  pattern.lastIndex = index;
  return pattern.exec(source)?.[0];
}

function readEscape(source: string, index: number): { value: string; end: number } {
  const character = source[index];
  if (character === undefined) throw new Error('the string is not closed');
  if (character !== 'u' && character !== 'x') {
    return { value: STRING_ESCAPES[character] ?? character, end: index + 1 };
  }
  const length = character === 'u' ? 4 : 2;
  const hex = source.slice(index + 1, index + 1 + length);
  if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) {
    throw new Error(`\\${character} needs ${length} hexadecimal digits`);
  }
  return { value: String.fromCharCode(Number.parseInt(hex, 16)), end: index + 1 + length };
}

function readString(source: string, start: number): { token: LexToken; end: number } {
  const quote = source[start];
  let value = '';
  let index = start + 1;
  while (index < source.length && source[index] !== quote) {
    const character = source[index];
    if (character === '\n' || character === '\r') break;
    if (character === '\\') {
      const sequence = readEscape(source, index + 1);
      value += sequence.value;
      index = sequence.end;
    } else {
      value += character;
      index++;
    }
  }
  if (source[index] !== quote) throw new Error('the string is not closed');
  return { token: { type: 'string', text: source.slice(start, index + 1), value }, end: index + 1 };
}

function readToken(source: string, index: number): { token: LexToken; end: number } {
  const character = source[index];
  if (character === '"' || character === "'") return readString(source, index);
  if (character === '@') {
    const name = matchAt(IDENTIFIER_PATTERN, source, index + 1);
    if (!name) throw new Error('@ must be followed by a loop variable such as @index');
    return { token: { type: 'loop', text: name }, end: index + 1 + name.length };
  }
  const identifier = matchAt(IDENTIFIER_PATTERN, source, index);
  if (identifier)
    return { token: { type: 'identifier', text: identifier }, end: index + identifier.length };
  const number = matchAt(NUMBER_PATTERN, source, index);
  if (number) {
    return {
      token: { type: 'number', text: number, value: Number(number) },
      end: index + number.length,
    };
  }
  // `a?.5:1` is a conditional, not optional chaining.
  const punctuator = PUNCTUATORS.find(
    (candidate) =>
      source.startsWith(candidate, index) &&
      !(candidate === '?.' && /\d/.test(source[index + 2] ?? ''))
  );
  if (punctuator)
    return { token: { type: 'punctuator', text: punctuator }, end: index + punctuator.length };
  throw new Error(`unexpected character ${JSON.stringify(character)}`);
}

function lex(source: string): LexToken[] {
  const tokens: LexToken[] = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index++;
      continue;
    }
    const { token, end } = readToken(source, index);
    tokens.push(token);
    index = end;
  }
  tokens.push({ type: 'end', text: '' });
  return tokens;
}

function describe(token: LexToken): string {
  return token.type === 'end' ? 'end of expression' : `"${token.text}"`;
}

function isMixedWithNullish(expression: Expression): boolean {
  return expression.kind === 'logical' && expression.operator !== '??' && !expression.parenthesized;
}

class ExpressionParser {
  private readonly tokens: LexToken[];
  private position = 0;

  constructor(source: string) {
    this.tokens = lex(source);
  }

  parse(): Expression {
    if (this.peek().type === 'end') throw new Error('the expression is empty');
    const expression = this.conditional();
    const rest = this.peek();
    if (rest.type !== 'end') throw new Error(`unexpected ${describe(rest)}`);
    return expression;
  }

  private peek(): LexToken {
    return this.tokens[this.position];
  }

  private next(): LexToken {
    const token = this.tokens[this.position];
    if (token.type !== 'end') this.position++;
    return token;
  }

  private accept(punctuator: string): boolean {
    const token = this.peek();
    if (token.type !== 'punctuator' || token.text !== punctuator) return false;
    this.position++;
    return true;
  }

  private expect(punctuator: string): void {
    if (!this.accept(punctuator)) {
      throw new Error(`expected "${punctuator}" but found ${describe(this.peek())}`);
    }
  }

  private conditional(): Expression {
    const test = this.coalesce();
    if (!this.accept('?')) return test;
    const consequent = this.conditional();
    this.expect(':');
    const alternate = this.conditional();
    return { kind: 'conditional', test, consequent, alternate };
  }

  private coalesce(): Expression {
    let left = this.binary(0);
    while (this.accept('??')) {
      const right = this.binary(0);
      // JavaScript itself rejects `a || b ?? c`, because the order is unclear.
      if (isMixedWithNullish(left) || isMixedWithNullish(right)) {
        throw new Error('use parentheses to combine ?? with && or ||');
      }
      left = { kind: 'logical', operator: '??', left, right };
    }
    return left;
  }

  private binary(level: number): Expression {
    const operators = BINARY_LEVELS[level];
    if (!operators) return this.unary();
    let left = this.binary(level + 1);
    for (let operator = this.acceptAny(operators); operator; operator = this.acceptAny(operators)) {
      const right = this.binary(level + 1);
      left =
        operator === '&&' || operator === '||'
          ? { kind: 'logical', operator, left, right }
          : { kind: 'binary', operator, left, right };
    }
    return left;
  }

  private acceptAny<T extends string>(operators: ReadonlyArray<T>): T | undefined {
    const token = this.peek();
    const operator = operators.find((candidate) => candidate === token.text);
    if (token.type !== 'punctuator' || !operator) return undefined;
    this.position++;
    return operator;
  }

  private unary(): Expression {
    for (const operator of ['!', '-', '+'] as const) {
      if (this.accept(operator)) return { kind: 'unary', operator, argument: this.unary() };
    }
    return this.postfix(this.primary());
  }

  private primary(): Expression {
    const token = this.next();
    switch (token.type) {
      case 'number':
      case 'string':
        return { kind: 'literal', value: token.value };
      case 'loop':
        return this.loopVariable(token.text);
      case 'identifier':
        return this.identifier(token.text);
      case 'punctuator':
        if (token.text === '(') {
          const expression = this.conditional();
          this.expect(')');
          return { ...expression, parenthesized: true };
        }
        throw new Error(`unexpected ${describe(token)}`);
      case 'end':
        throw new Error('the expression ends too early');
    }
  }

  private loopVariable(name: string): Expression {
    if (!LOOP_VARIABLES.has(name)) {
      throw new Error(`@${name} is not a loop variable; use @index, @first, @last or @length`);
    }
    return { kind: 'loop', name: name as LoopVariableName };
  }

  private identifier(name: string): Expression {
    if (LITERAL_WORDS.has(name)) return { kind: 'literal', value: LITERAL_WORDS.get(name) };
    if (RESERVED_WORDS.has(name))
      throw new Error(`"${name}" cannot be used in a template expression`);
    const members: PathMember[] = [];
    for (let optional = this.peek().text === '?.'; optional || this.peek().text === '.'; ) {
      this.next();
      members.push({ name: this.propertyName(optional), optional });
      optional = this.peek().text === '?.';
    }
    return { kind: 'path', root: name, members };
  }

  private propertyName(optional: boolean): string {
    const token = this.peek();
    if (token.type !== 'identifier') {
      // `a?.(…)` and `a?.[…]` get the same explanation as `a(…)` and `a[…]`.
      if (token.type === 'punctuator' && (token.text === '(' || token.text === '[')) {
        this.postfix({ kind: 'literal', value: undefined });
      }
      throw new Error(`expected a property name after "${optional ? '?.' : '.'}"`);
    }
    this.position++;
    if (token.text === '__proto__')
      throw new Error('"__proto__" cannot be used in a template expression');
    return token.text;
  }

  /** Rejects calls, computed access and properties of anything but a variable. */
  private postfix(expression: Expression): Expression {
    const token = this.peek();
    if (token.type !== 'punctuator') return expression;
    if (token.text === '(') {
      throw new Error('calls are not supported; pass the prepared value in the context instead');
    }
    if (token.text === '[') {
      throw new Error('computed member access is not supported; use a dotted path');
    }
    if (token.text === '.' || token.text === '?.') {
      throw new Error('only variables can have properties');
    }
    return expression;
  }
}

/**
 * Parses a template expression. HTML entities are decoded first, because MJML and editors
 * may write `&&` as `&amp;&amp;` and quotes as `&quot;`. Throws an `Error` that describes the
 * problem; callers add where the expression appears.
 */
export function parseExpression(source: string): Expression {
  return new ExpressionParser(decodeHtmlEntities(source)).parse();
}

/** Calls `visit` for an expression and every expression inside it. */
export function walkExpression(expression: Expression, visit: (node: Expression) => void): void {
  visit(expression);
  switch (expression.kind) {
    case 'unary':
      walkExpression(expression.argument, visit);
      return;
    case 'binary':
    case 'logical':
      walkExpression(expression.left, visit);
      walkExpression(expression.right, visit);
      return;
    case 'conditional':
      walkExpression(expression.test, visit);
      walkExpression(expression.consequent, visit);
      walkExpression(expression.alternate, visit);
      return;
    default:
      return;
  }
}

/** How generated code refers to variables, which depends on the enclosing loops. */
export interface EmitScope {
  /** The JavaScript for the root of a path: a loop variable or a context property. */
  root(name: string, hasMembers: boolean): string;
  /** The JavaScript for `@index`, `@first`, `@last` or `@length` of the innermost loop. */
  loopVariable(name: LoopVariableName): string;
}

const BINARY_PRECEDENCE: Readonly<Record<BinaryOperator | LogicalOperator, number>> = {
  '??': 2,
  '||': 2,
  '&&': 3,
  '===': 4,
  '!==': 4,
  '==': 4,
  '!=': 4,
  '<': 5,
  '>': 5,
  '<=': 5,
  '>=': 5,
  '+': 6,
  '-': 6,
  '*': 7,
  '/': 7,
  '%': 7,
};

const CONDITIONAL_PRECEDENCE = 1;
const UNARY_PRECEDENCE = 8;
const PRIMARY_PRECEDENCE = 9;

/** How tightly an expression binds; higher binds tighter. */
export function precedenceOf(expression: Expression): number {
  switch (expression.kind) {
    case 'conditional':
      return CONDITIONAL_PRECEDENCE;
    case 'binary':
    case 'logical':
      return BINARY_PRECEDENCE[expression.operator];
    case 'unary':
      return UNARY_PRECEDENCE;
    default:
      return PRIMARY_PRECEDENCE;
  }
}

function parenthesize(code: string, needed: boolean): string {
  return needed ? `(${code})` : code;
}

function needsParentheses(
  parent: BinaryExpression | LogicalExpression,
  child: Expression,
  side: 'left' | 'right'
): boolean {
  // JavaScript requires parentheses when ?? meets && or ||, whatever the precedence.
  if (parent.kind === 'logical' && child.kind === 'logical') {
    if ((parent.operator === '??') !== (child.operator === '??')) return true;
  }
  const parentPrecedence = precedenceOf(parent);
  const childPrecedence = precedenceOf(child);
  return side === 'left' ? childPrecedence < parentPrecedence : childPrecedence <= parentPrecedence;
}

function emitLiteral(value: LiteralExpression['value']): string {
  if (typeof value === 'string') return quoteString(value);
  return String(value);
}

function emitUnary(expression: UnaryExpression, scope: EmitScope): string {
  const argument = emitExpression(expression.argument, scope);
  // `-(-x)` must not become the decrement operator `--x`.
  const needed =
    precedenceOf(expression.argument) < UNARY_PRECEDENCE ||
    (expression.operator !== '!' && argument.startsWith(expression.operator));
  return `${expression.operator}${parenthesize(argument, needed)}`;
}

/**
 * Generates JavaScript for an expression. Parentheses appear where the structure needs them;
 * the result needs no outer parentheses as a function argument.
 */
export function emitExpression(expression: Expression, scope: EmitScope): string {
  switch (expression.kind) {
    case 'literal':
      return emitLiteral(expression.value);
    case 'path': {
      const members = expression.members.map(
        ({ name, optional }) => `${optional ? '?.' : '.'}${name}`
      );
      return scope.root(expression.root, members.length > 0) + members.join('');
    }
    case 'loop':
      return scope.loopVariable(expression.name);
    case 'unary':
      return emitUnary(expression, scope);
    case 'binary':
    case 'logical': {
      const left = emitExpression(expression.left, scope);
      const right = emitExpression(expression.right, scope);
      return `${parenthesize(left, needsParentheses(expression, expression.left, 'left'))} ${expression.operator} ${parenthesize(right, needsParentheses(expression, expression.right, 'right'))}`;
    }
    case 'conditional': {
      const test = emitExpression(expression.test, scope);
      const testNeedsParentheses = precedenceOf(expression.test) <= CONDITIONAL_PRECEDENCE;
      return `${parenthesize(test, testNeedsParentheses)} ? ${emitExpression(expression.consequent, scope)} : ${emitExpression(expression.alternate, scope)}`;
    }
  }
}
