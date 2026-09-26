/**
 * Reads only the literal values out of a JavaScript syntax tree (an acorn
 * ESTree node), reporting everything else -- an identifier reference, a
 * member expression, a call, a spread, a computed key, a template literal
 * with an expression inside it, a function -- as "could not read
 * statically" with its position and a short description. Nothing here ever
 * evaluates, imports or requires the code the tree came from (D-107); it
 * only reads literal syntax already present in the parsed tree.
 */
import type { Node } from 'acorn';
import { setOwn } from './own-property';

export interface CouldNotRead {
  line: number;
  column: number;
  what: string;
}

export interface ReadLiteralResult {
  value: unknown;
  couldNotRead: CouldNotRead[];
}

interface LiteralNode extends Node {
  type: 'Literal';
  value?: string | boolean | null | number | RegExp | bigint;
}

interface IdentifierNode extends Node {
  type: 'Identifier';
  name: string;
}

interface ObjectExpressionNode extends Node {
  type: 'ObjectExpression';
  properties: Node[];
}

interface PropertyNode extends Node {
  type: 'Property';
  key: Node;
  value: Node;
  computed: boolean;
  shorthand: boolean;
  method: boolean;
  kind: 'init' | 'get' | 'set';
}

interface ArrayExpressionNode extends Node {
  type: 'ArrayExpression';
  elements: (Node | null)[];
}

interface UnaryExpressionNode extends Node {
  type: 'UnaryExpression';
  operator: string;
  argument: Node;
}

interface CallExpressionNode extends Node {
  type: 'CallExpression' | 'NewExpression';
  arguments: Node[];
}

interface TemplateLiteralNode extends Node {
  type: 'TemplateLiteral';
  expressions: Node[];
  quasis: { value: { cooked: string | null; raw: string } }[];
}

function position(node: Node): { line: number; column: number } {
  const loc = node.loc;
  if (!loc) return { line: 1, column: 1 };
  return { line: loc.start.line, column: loc.start.column + 1 };
}

function describe(node: Node): string {
  switch (node.type) {
    case 'Identifier':
      return `a reference to the variable "${(node as IdentifierNode).name}"`;
    case 'CallExpression':
    case 'NewExpression':
      return 'a function call';
    case 'MemberExpression':
      return 'a member access';
    case 'SpreadElement':
      return 'a spread';
    case 'TemplateLiteral':
      return 'a template literal containing an expression';
    case 'ConditionalExpression':
      return 'a conditional (ternary) expression';
    case 'LogicalExpression':
    case 'BinaryExpression':
      return 'an expression that is not a plain literal';
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return 'a function';
    case 'AwaitExpression':
      return 'an await expression';
    default:
      return `a ${node.type} node`;
  }
}

/**
 * Reads a syntax tree node as a literal value: object and array literals
 * (recursing into their entries), string/number/boolean/null literals,
 * negated numeric literals, a template literal with no expressions
 * (`` `text` ``, read as its cooked string), and an identifier or string
 * used as a property key. Any other node reads as `undefined` and is
 * appended to `couldNotRead` with its position and a short description.
 * A call's own literal object/array arguments are still read (each nested
 * value inside them is reported the same way), but the call's own effect
 * is unknown, so the call node itself is separately reported by the caller
 * wherever it appears as a value.
 */
export function readLiteralConfig(node: Node | null | undefined): ReadLiteralResult {
  const couldNotRead: CouldNotRead[] = [];
  const value = readNode(node, couldNotRead);
  return { value, couldNotRead };
}

function readNode(node: Node | null | undefined, couldNotRead: CouldNotRead[]): unknown {
  if (node == null) return undefined;

  switch (node.type) {
    case 'Literal': {
      const lit = node as LiteralNode;
      if (lit.value instanceof RegExp) {
        couldNotRead.push({ ...position(node), what: 'a regular expression literal' });
        return undefined;
      }
      if (typeof lit.value === 'bigint') {
        couldNotRead.push({ ...position(node), what: 'a BigInt literal' });
        return undefined;
      }
      return lit.value ?? null;
    }
    case 'ObjectExpression': {
      const obj: Record<string, unknown> = {};
      for (const prop of (node as ObjectExpressionNode).properties) {
        if (prop.type === 'SpreadElement') {
          couldNotRead.push({ ...position(prop), what: describe(prop) });
          continue;
        }
        const property = prop as PropertyNode;
        if (property.method || property.kind !== 'init') {
          couldNotRead.push({ ...position(property), what: 'a method or accessor property' });
          continue;
        }
        let key: string | undefined;
        if (property.computed) {
          couldNotRead.push({ ...position(property.key), what: 'a computed property key' });
          continue;
        }
        if (property.key.type === 'Identifier') key = (property.key as IdentifierNode).name;
        else if (property.key.type === 'Literal') {
          const keyValue = (property.key as LiteralNode).value;
          key = keyValue === null || keyValue === undefined ? undefined : String(keyValue);
        }
        if (key === undefined) {
          couldNotRead.push({ ...position(property.key), what: 'a property key that is not a plain name or string' });
          continue;
        }
        // A visitor-supplied key -- including __proto__ or constructor --
        // must become an ordinary own property, never reach the real
        // prototype chain or shadow the wrong thing (own-property.ts).
        setOwn(obj, key, readNode(property.value, couldNotRead));
      }
      return obj;
    }
    case 'ArrayExpression': {
      const arr: unknown[] = [];
      for (const el of (node as ArrayExpressionNode).elements) {
        if (el === null) {
          arr.push(null);
          continue;
        }
        if (el.type === 'SpreadElement') {
          couldNotRead.push({ ...position(el), what: describe(el) });
          continue;
        }
        arr.push(readNode(el, couldNotRead));
      }
      return arr;
    }
    case 'UnaryExpression': {
      const unary = node as UnaryExpressionNode;
      if ((unary.operator === '-' || unary.operator === '+') && unary.argument.type === 'Literal') {
        const inner = (unary.argument as LiteralNode).value;
        if (typeof inner === 'number') return unary.operator === '-' ? -inner : inner;
      }
      couldNotRead.push({ ...position(node), what: describe(node) });
      return undefined;
    }
    case 'TemplateLiteral': {
      const tpl = node as TemplateLiteralNode;
      if (tpl.expressions.length === 0 && tpl.quasis.length === 1) {
        return tpl.quasis[0]!.value.cooked ?? tpl.quasis[0]!.value.raw;
      }
      couldNotRead.push({ ...position(node), what: describe(node) });
      return undefined;
    }
    case 'CallExpression':
    case 'NewExpression': {
      couldNotRead.push({ ...position(node), what: describe(node) });
      // The call's own return value is unknown, but a literal object or
      // array passed INTO it is still worth reading -- each such argument's
      // own could-not-read entries (from a nested spread, call, etc.) are
      // still recorded, so an issue several levels inside a plugin-factory
      // call is never lost. The read value itself is discarded: it is
      // "read from inside that call, whose own effect is unknown."
      for (const arg of (node as CallExpressionNode).arguments) {
        if (arg.type === 'ObjectExpression' || arg.type === 'ArrayExpression') {
          readNode(arg, couldNotRead);
        }
      }
      return undefined;
    }
    case 'MemberExpression':
    case 'Identifier':
    case 'SpreadElement':
    case 'ConditionalExpression':
    case 'LogicalExpression':
    case 'BinaryExpression':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'AwaitExpression':
      couldNotRead.push({ ...position(node), what: describe(node) });
      return undefined;
    default:
      couldNotRead.push({ ...position(node), what: describe(node) });
      return undefined;
  }
}
