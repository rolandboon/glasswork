import type {
  BinaryExpression,
  Expression,
  LogicalExpression,
  PathExpression,
} from './expression.js';
import type { EachNode, IfNode, TemplateNode } from './template-tree.js';
import type { InferredType } from './types.js';

/**
 * Infers the context interface from what a template does with each value.
 *
 * - A printed value is a string, an operand of arithmetic or of `<`, `>`, `<=` and `>=` a
 *   number, a value compared with a literal has the literal's type, and a value that is
 *   only tested (`@if isPremium`, `!isPremium`, `a && b`) is a boolean.
 * - `@each` makes a value an array; an item that is printed makes it a `string[]`.
 * - A value is optional when the template copes with it being missing: it is only tested,
 *   it has a fallback (`??`, `||`), it is read through `?.`, or every use is inside a block
 *   that tested it first, such as `@if shippingAddress` around `{{shippingAddress.city}}`.
 * - `length` is a number, and arrays and printed strings have it already.
 */

type LiteralType = 'string' | 'number' | 'boolean';

interface Use {
  kind: 'print' | 'number' | 'test' | 'compare';
  /** The type of the literal that the value is compared with. */
  literal?: LiteralType;
  /** The template copes with a missing value, as on the left of `??`. */
  optional?: boolean;
}

/** Everything the template does with one value. */
class Shape {
  printed = false;
  numeric = false;
  tested = false;
  iterated = false;
  /** Used where a missing value would break the template or show nothing. */
  required = false;
  readonly literals = new Set<LiteralType>();
  readonly properties = new Map<string, Shape>();
  item: Shape | undefined;

  property(name: string): Shape {
    let shape = this.properties.get(name);
    if (!shape) {
      shape = new Shape();
      this.properties.set(name, shape);
    }
    return shape;
  }

  element(): Shape {
    this.item ??= new Shape();
    return this.item;
  }

  get used(): boolean {
    return (
      this.printed ||
      this.numeric ||
      this.tested ||
      this.iterated ||
      this.literals.size > 0 ||
      this.properties.size > 0
    );
  }
}

type Binding = { kind: 'item'; shape: Shape } | { kind: 'index' };
type Known = ReadonlySet<Shape>;

const COMPARISONS: ReadonlySet<string> = new Set(['<', '>', '<=', '>=', '===', '!==', '==', '!=']);

function withKnown(known: Known, shapes: Iterable<Shape>): Known {
  const result = new Set(known);
  for (const shape of shapes) result.add(shape);
  return result;
}

function literalTypeOf(expression: Expression): LiteralType | undefined {
  if (expression.kind !== 'literal') return undefined;
  const type = typeof expression.value;
  return type === 'string' || type === 'number' || type === 'boolean' ? type : undefined;
}

function isTruthyLiteral(expression: Expression): boolean {
  return expression.kind === 'literal' && Boolean(expression.value);
}

/** `'Total: ' + amount` concatenates; `price + fee` adds. */
function isConcatenation(expression: Expression): boolean {
  if (expression.kind === 'literal') return typeof expression.value === 'string';
  if (expression.kind !== 'binary' || expression.operator !== '+') return false;
  return isConcatenation(expression.left) || isConcatenation(expression.right);
}

function operandUse(
  expression: BinaryExpression,
  other: Expression,
  optional: boolean | undefined
): Use {
  switch (expression.operator) {
    case '+':
      return { kind: isConcatenation(expression) ? 'print' : 'number', optional };
    case '-':
    case '*':
    case '/':
    case '%':
      return { kind: 'number', optional };
    case '<':
    case '>':
    case '<=':
    case '>=':
      return literalTypeOf(other) === 'string'
        ? { kind: 'compare', literal: 'string', optional }
        : { kind: 'number', optional };
    default:
      // Comparing with null or undefined checks presence, like a test.
      if (other.kind === 'literal' && (other.value === null || other.value === undefined)) {
        return { kind: 'test' };
      }
      return { kind: 'compare', literal: literalTypeOf(other), optional };
  }
}

function applyUse(shape: Shape, use: Use, known: Known): void {
  if (use.kind === 'test') {
    shape.tested = true;
    return;
  }
  if (use.kind === 'print') shape.printed = true;
  else if (use.kind === 'number') shape.numeric = true;
  else if (use.literal) shape.literals.add(use.literal);
  if (!use.optional && !known.has(shape)) shape.required = true;
}

class Inference {
  readonly context = new Shape();
  private readonly scopes: Array<ReadonlyMap<string, Binding>> = [];

  walk(nodes: readonly TemplateNode[], known: Known): void {
    for (const node of nodes) {
      if (node.kind === 'output') this.analyze(node.expression, { kind: 'print' }, known);
      else if (node.kind === 'if') this.visitIf(node, known);
      else if (node.kind === 'each') this.visitEach(node, known);
    }
  }

  private visitIf(node: IfNode, known: Known): void {
    for (const branch of node.branches) {
      this.analyze(branch.condition, { kind: 'test' }, known);
      this.walk(branch.body, withKnown(known, this.truthy(branch.condition)));
    }
    if (node.alternate) this.walk(node.alternate, known);
  }

  private visitEach(node: EachNode, known: Known): void {
    const array = this.resolve(node.array, known);
    // Iterating over a loop index is reported when the render function is generated.
    if (!array) return;
    array.iterated = true;
    if (!known.has(array)) array.required = true;
    const scope = new Map<string, Binding>([
      [node.token.itemName, { kind: 'item', shape: array.element() }],
    ]);
    if (node.token.indexName) scope.set(node.token.indexName, { kind: 'index' });
    this.scopes.push(scope);
    // Inside the loop the array has items, so `{{items.length}}` there is safe.
    this.walk(node.body, withKnown(known, [array]));
    this.scopes.pop();
  }

  private lookup(name: string): Binding | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index--) {
      const binding = this.scopes[index].get(name);
      if (binding) return binding;
    }
    return undefined;
  }

  /**
   * The shape a path refers to, recording that every part before the last is read. A part
   * read with `.` must be present unless a test made it known; `?.` copes with a missing one.
   */
  private resolve(path: PathExpression, known: Known): Shape | undefined {
    const binding = this.lookup(path.root);
    if (binding?.kind === 'index') return undefined;
    let shape = binding ? binding.shape : this.context.property(path.root);
    for (const member of path.members) {
      if (!member.optional && !known.has(shape)) shape.required = true;
      shape = shape.property(member.name);
    }
    return shape;
  }

  private analyze(expression: Expression, use: Use, known: Known): void {
    switch (expression.kind) {
      case 'path': {
        const shape = this.resolve(expression, known);
        if (shape) applyUse(shape, use, known);
        return;
      }
      case 'unary':
        this.analyze(
          expression.argument,
          expression.operator === '!'
            ? { kind: 'test' }
            : { kind: 'number', optional: use.optional },
          known
        );
        return;
      case 'binary':
        this.analyze(
          expression.left,
          operandUse(expression, expression.right, use.optional),
          known
        );
        this.analyze(
          expression.right,
          operandUse(expression, expression.left, use.optional),
          known
        );
        return;
      case 'logical':
        this.analyzeLogical(expression, use, known);
        return;
      case 'conditional':
        this.analyze(expression.test, { kind: 'test' }, known);
        this.analyze(expression.consequent, use, withKnown(known, this.truthy(expression.test)));
        this.analyze(expression.alternate, use, known);
        return;
      default:
        return;
    }
  }

  private analyzeLogical(expression: LogicalExpression, use: Use, known: Known): void {
    if (expression.operator === '&&') {
      this.analyze(expression.left, { kind: 'test' }, known);
      this.analyze(expression.right, use, withKnown(known, this.truthy(expression.left)));
      return;
    }
    // The left side of || and ?? may be missing; its value is used when it is there.
    if (expression.operator === '||') this.analyze(expression.left, { kind: 'test' }, known);
    if (use.kind !== 'test' || expression.operator === '??') {
      this.analyze(expression.left, { ...use, optional: true }, known);
    }
    this.analyze(expression.right, use, known);
  }

  /** The shapes that are certainly present when an expression is truthy. */
  private truthy(expression: Expression): Shape[] {
    switch (expression.kind) {
      case 'path':
        return this.chain(expression, true);
      case 'logical':
        return expression.operator === '&&'
          ? [...this.truthy(expression.left), ...this.truthy(expression.right)]
          : [];
      case 'binary':
        return COMPARISONS.has(expression.operator) ? this.comparedShapes(expression) : [];
      default:
        return [];
    }
  }

  /**
   * A comparison only evaluates when the parts before the last of each path exist, and
   * `status === 'paid'` also makes `status` itself present.
   */
  private comparedShapes(expression: BinaryExpression): Shape[] {
    const equality = expression.operator === '===' || expression.operator === '==';
    const sides: Array<[Expression, Expression]> = [
      [expression.left, expression.right],
      [expression.right, expression.left],
    ];
    return sides.flatMap(([side, other]) =>
      side.kind === 'path' ? this.chain(side, equality && isTruthyLiteral(other)) : []
    );
  }

  /** The existing shapes along a path, with or without the last one. */
  private chain(path: PathExpression, includeLast: boolean): Shape[] {
    const binding = this.lookup(path.root);
    if (binding?.kind === 'index') return [];
    const shapes: Shape[] = [];
    let shape = binding ? binding.shape : this.context.properties.get(path.root);
    for (const member of path.members) {
      if (!shape) return shapes;
      shapes.push(shape);
      shape = shape.properties.get(member.name);
    }
    if (shape && includeLast) shapes.push(shape);
    return shapes;
  }
}

function leafType(shape: Shape): InferredType['type'] {
  if (shape.numeric) return 'number';
  if (shape.printed) return 'string';
  const [literal, ...others] = shape.literals;
  if (literal) return others.length === 0 ? literal : 'string';
  return shape.tested ? 'boolean' : 'string';
}

function isObject(shape: Shape): boolean {
  // An item that the loop never reads accepts any value.
  if (!shape.used) return true;
  if (shape.properties.size === 0) return false;
  // `{{name}}` with `{{name.length}}` is a string, not an object.
  return !(shape.printed && [...shape.properties.keys()].every((key) => key === 'length'));
}

function toInferredType(name: string, shape: Shape, path: string, isItem: boolean): InferredType {
  const optional = !isItem && !shape.required;
  if (shape.iterated) {
    const property = [...shape.properties.keys()].find((key) => key !== 'length');
    if (property) {
      throw new Error(
        `${path} is used as a list in @each and as an object with "${property}"; pass that value as a separate variable`
      );
    }
    const item = toInferredType('item', shape.item ?? new Shape(), `${path}[]`, true);
    return { name, type: 'array', optional, itemType: item };
  }
  if (!isObject(shape)) return { name, type: leafType(shape), optional };
  const properties: Record<string, InferredType> = {};
  for (const [key, child] of shape.properties) {
    properties[key] =
      key === 'length'
        ? { name: key, type: 'number', optional: !child.required }
        : toInferredType(key, child, `${path}.${key}`, false);
  }
  return { name, type: 'object', optional, properties };
}

/** Infers the context variables of a parsed template, in order of first use. */
export function inferContextTypes(nodes: readonly TemplateNode[]): Map<string, InferredType> {
  const inference = new Inference();
  inference.walk(nodes, new Set());
  const types = new Map<string, InferredType>();
  for (const [name, shape] of inference.context.properties) {
    types.set(name, toInferredType(name, shape, name, false));
  }
  return types;
}
