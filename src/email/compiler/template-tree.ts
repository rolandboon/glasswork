import { type Expression, type PathExpression, parseExpression } from './expression.js';
import { loopVariableNameProblem } from './names.js';
import type {
  EachToken,
  ElseIfToken,
  ElseToken,
  IfToken,
  TextToken,
  Token,
  VariableToken,
} from './types.js';

/**
 * The structure of a template: text and output between nested `@if` and `@each` blocks.
 * Type inference and code generation both read this tree, so they always agree on which
 * block an `@end` closes and which loop variables are in scope.
 */
export type TemplateNode = TextNode | OutputNode | IfNode | EachNode;

export interface TextNode {
  kind: 'text';
  token: TextToken;
}

export interface OutputNode {
  kind: 'output';
  token: VariableToken;
  expression: Expression;
}

export interface ConditionalBranch {
  token: IfToken | ElseIfToken;
  condition: Expression;
  body: TemplateNode[];
}

export interface IfNode {
  kind: 'if';
  token: IfToken;
  /** The `@if` branch followed by its `@elseif` branches. */
  branches: ConditionalBranch[];
  /** The `@else` branch. */
  alternate?: TemplateNode[];
}

export interface EachNode {
  kind: 'each';
  token: EachToken;
  array: PathExpression;
  body: TemplateNode[];
}

export interface ParseTemplateOptions {
  /**
   * Reject a template whose blocks do not match: an unclosed block, an `@end` without a
   * block, or an `@else` or `@elseif` in the wrong place. Without `strict`, unclosed blocks
   * end with the template and misplaced markers are skipped, which suits analyzing a part
   * of a template.
   */
  strict: boolean;
}

type Frame =
  | { kind: 'if'; node: IfNode; target: TemplateNode[]; hasElse: boolean }
  | { kind: 'each'; node: EachNode; target: TemplateNode[] };

function parseIn(source: string, location: string): Expression {
  try {
    return parseExpression(source);
  } catch (error) {
    throw new Error(`Invalid expression in ${location}: ${(error as Error).message}`);
  }
}

function assertLoopVariableNames(token: EachToken): void {
  for (const name of [token.itemName, token.indexName]) {
    const problem = name === undefined ? undefined : loopVariableNameProblem(name);
    if (problem) throw new Error(`Loop variable "${name}" ${problem}: ${token.raw}`);
  }
  if (token.itemName === token.indexName) {
    throw new Error(`The item and index of a loop need different names: ${token.raw}`);
  }
}

class TreeBuilder {
  private readonly root: TemplateNode[] = [];
  private readonly stack: Frame[] = [];

  constructor(private readonly strict: boolean) {}

  add(token: Token): void {
    switch (token.type) {
      case 'text':
        this.target().push({ kind: 'text', token });
        return;
      case 'variable':
        this.target().push({
          kind: 'output',
          token,
          expression: parseIn(token.expression, token.raw),
        });
        return;
      case 'if':
        this.openIf(token);
        return;
      case 'elseif':
        this.addElseIf(token);
        return;
      case 'else':
        this.addElse(token);
        return;
      case 'each':
        this.openEach(token);
        return;
      case 'end':
        this.close(token.raw);
        return;
    }
  }

  finish(): TemplateNode[] {
    const unclosed = this.stack.at(-1);
    if (unclosed && this.strict) {
      throw new Error(
        `Unclosed @${unclosed.kind} block, add an <!-- @end -->: ${unclosed.node.token.raw}`
      );
    }
    return this.root;
  }

  private target(): TemplateNode[] {
    return this.stack.at(-1)?.target ?? this.root;
  }

  private openIf(token: IfToken): void {
    const body: TemplateNode[] = [];
    const node: IfNode = {
      kind: 'if',
      token,
      branches: [{ token, condition: parseIn(token.condition, token.raw), body }],
    };
    this.target().push(node);
    this.stack.push({ kind: 'if', node, target: body, hasElse: false });
  }

  /** The innermost open `@if` block, when an `@elseif` or `@else` may follow there. */
  private openIfFor(token: ElseIfToken | ElseToken): Extract<Frame, { kind: 'if' }> | undefined {
    const directive = token.type === 'else' ? '@else' : '@elseif';
    const frame = this.stack.at(-1);
    if (frame?.kind !== 'if') {
      if (this.strict) throw new Error(`${directive} must be inside an @if block`);
      return undefined;
    }
    if (frame.hasElse) {
      if (this.strict) {
        throw new Error(
          token.type === 'else'
            ? 'An @if block can have only one @else'
            : '@elseif must come before @else'
        );
      }
      return undefined;
    }
    return frame;
  }

  private addElseIf(token: ElseIfToken): void {
    const frame = this.openIfFor(token);
    if (!frame) return;
    const body: TemplateNode[] = [];
    frame.node.branches.push({ token, condition: parseIn(token.condition, token.raw), body });
    frame.target = body;
  }

  private addElse(token: ElseToken): void {
    const frame = this.openIfFor(token);
    if (!frame) return;
    const body: TemplateNode[] = [];
    frame.node.alternate = body;
    frame.target = body;
    frame.hasElse = true;
  }

  private openEach(token: EachToken): void {
    assertLoopVariableNames(token);
    const array = parseIn(token.arrayPath, token.raw);
    if (array.kind !== 'path') throw new Error(`@each needs a variable path: ${token.raw}`);
    const body: TemplateNode[] = [];
    const node: EachNode = { kind: 'each', token, array, body };
    this.target().push(node);
    this.stack.push({ kind: 'each', node, target: body });
  }

  private close(raw: string): void {
    if (!this.stack.pop() && this.strict) {
      throw new Error(`@end without an open @if or @each block: ${raw}`);
    }
  }
}

/** Builds the block structure of a tokenized template. */
export function parseTemplate(
  tokens: readonly Token[],
  options: ParseTemplateOptions
): TemplateNode[] {
  const builder = new TreeBuilder(options.strict);
  for (const token of tokens) builder.add(token);
  return builder.finish();
}
