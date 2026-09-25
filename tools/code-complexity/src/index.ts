/**
 * Cyclomatic complexity and length for every function, method, class field
 * initializer and class static block in pasted JavaScript or TypeScript.
 * Parses with `@babel/parser` to a syntax tree and walks it with an explicit
 * stack (never recursion, so deeply nested input cannot overflow the call
 * stack); the code is never run (D-70).
 *
 * Counting rules are ported from the installed `eslint` package's own
 * `lib/rules/complexity.js` (eslint 9.39.5, `classic` variant -- the
 * default): a code path starts at complexity 1; `IfStatement`,
 * `ConditionalExpression`, `LogicalExpression`, `ForStatement`,
 * `ForInStatement`, `ForOfStatement`, `WhileStatement`, `DoWhileStatement`,
 * `CatchClause` and `AssignmentPattern` (a default parameter or destructuring
 * default) each add one; a `SwitchCase` with its own test (not `default`)
 * adds one, the `SwitchStatement` itself adds nothing; a logical assignment
 * (`&&=`, `||=`, `??=`) adds one; an optional member access (`?.foo`) or
 * optional call (`?.()`) each add one. Code paths are reported for
 * functions, class field initializers and class static blocks; top-level
 * code outside any of those is not reported (`eslint`'s own rule excludes
 * "program" for the same reason). `eslint` is a devDependency-only oracle
 * used in tests, never a runtime dependency.
 */
import meta from './meta.json';
import { parse } from '@babel/parser';
import type { ParserPlugin } from '@babel/parser';

export { meta };

export class CodeComplexityError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'CodeComplexityError';
    this.line = line;
    this.column = column;
  }
}

export type ComplexityLanguage = 'javascript' | 'typescript' | 'tsx';

export interface AnalyseComplexityOptions {
  language?: ComplexityLanguage;
  /** A row above this complexity is listed in `over`. Defaults to 10. */
  threshold?: number;
}

export interface ComplexityRow {
  name: string;
  kind: string;
  line: number;
  column: number;
  complexity: number;
  lines: number;
  codeLines: number;
}

export interface AnalyseComplexityResult {
  functions: ComplexityRow[];
  over: ComplexityRow[];
  highest: number;
  average: number;
}

// --- Minimal shape of the Babel AST this file reads --------------------
interface Loc {
  start: { line: number; column: number };
  end: { line: number; column: number };
}
interface AstNode {
  type: string;
  [key: string]: unknown;
  loc?: Loc | null;
}

const PLUGINS_BY_LANGUAGE: Record<ComplexityLanguage, ParserPlugin[]> = {
  javascript: ['jsx'],
  typescript: ['typescript'],
  tsx: ['typescript', 'jsx'],
};

// --- Reported-unit detection -------------------------------------------

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);

const CLASS_FIELD_TYPES = new Set(['ClassProperty', 'ClassPrivateProperty', 'PropertyDefinition']);

function isClassFieldWithInitializer(node: AstNode): boolean {
  return CLASS_FIELD_TYPES.has(node.type) && node.value != null;
}

function isReportingBoundary(node: AstNode): boolean {
  return FUNCTION_TYPES.has(node.type) || node.type === 'StaticBlock' || isClassFieldWithInitializer(node);
}

// --- Naming: "the declaration, variable, property or method that holds the function" -----

function keyName(key: unknown, computed: unknown): string | null {
  if (!key || typeof key !== 'object') return null;
  const k = key as AstNode;
  if (!computed && k.type === 'Identifier') return k.name as string;
  if (k.type === 'PrivateName' || k.type === 'PrivateIdentifier') {
    const inner = (k.id as AstNode | undefined)?.name ?? (k.name as string | undefined);
    return inner ? `#${inner}` : null;
  }
  if (k.type === 'StringLiteral') return String(k.value);
  if (k.type === 'NumericLiteral') return String(k.value);
  return null;
}

const CLASS_METHOD_KIND: Record<string, string> = { constructor: 'constructor', get: 'getter', set: 'setter' };

function describeUnit(node: AstNode, parent: AstNode | null): { name: string; kind: string } {
  if (node.type === 'StaticBlock') return { name: '(static block)', kind: 'class static block' };

  if (isClassFieldWithInitializer(node)) {
    const name = keyName(node.key, node.computed) ?? '(anonymous)';
    return { name, kind: 'class field initializer' };
  }

  if (node.type === 'ClassMethod' || node.type === 'ClassPrivateMethod') {
    const name = keyName(node.key, node.computed) ?? '(anonymous)';
    return { name, kind: CLASS_METHOD_KIND[node.kind as string] ?? 'method' };
  }

  if (node.type === 'ObjectMethod') {
    const name = keyName(node.key, node.computed) ?? '(anonymous)';
    return { name, kind: node.kind === 'get' ? 'getter' : node.kind === 'set' ? 'setter' : 'method' };
  }

  if (node.type === 'FunctionDeclaration') {
    const id = node.id as AstNode | null | undefined;
    return { name: (id?.name as string | undefined) ?? '(anonymous)', kind: 'function declaration' };
  }

  const isArrow = node.type === 'ArrowFunctionExpression';

  if (parent) {
    if (parent.type === 'VariableDeclarator' && (parent.id as AstNode | undefined)?.type === 'Identifier') {
      return { name: (parent.id as AstNode).name as string, kind: isArrow ? 'arrow function' : 'function expression' };
    }
    if ((parent.type === 'ObjectProperty' || parent.type === 'Property') && parent.value === node) {
      const name = keyName(parent.key, parent.computed);
      if (name) return { name, kind: 'method' };
    }
    if (
      parent.type === 'AssignmentExpression' &&
      parent.right === node &&
      (parent.left as AstNode)?.type === 'Identifier'
    ) {
      return {
        name: (parent.left as AstNode).name as string,
        kind: isArrow ? 'arrow function' : 'function expression',
      };
    }
  }

  if (!isArrow) {
    const id = (node as { id?: AstNode | null }).id;
    if (id?.type === 'Identifier') return { name: id.name as string, kind: 'function expression' };
  }

  return { name: '(anonymous)', kind: isArrow ? 'arrow function' : 'function expression' };
}

// --- Complexity counting for one node, added to the CURRENT unit --------

const LOGICAL_ASSIGNMENT_OPERATORS = new Set(['&&=', '||=', '??=']);

function complexityDelta(node: AstNode): number {
  switch (node.type) {
    case 'IfStatement':
    case 'ConditionalExpression':
    case 'LogicalExpression':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'CatchClause':
    case 'AssignmentPattern':
      return 1;
    case 'SwitchCase':
      return node.test != null ? 1 : 0;
    case 'AssignmentExpression':
      return LOGICAL_ASSIGNMENT_OPERATORS.has(node.operator as string) ? 1 : 0;
    // Babel's non-estree AST marks EVERY link of a chain once any link in it
    // used `?.` as `Optional*`, but only the link that actually wrote `?.`
    // carries `optional: true` -- matching ESLint's own espree-based check
    // (`node.optional === true`) means checking that field here too, not
    // treating every `Optional*` node as a hit.
    case 'MemberExpression':
    case 'OptionalMemberExpression':
    case 'CallExpression':
    case 'OptionalCallExpression':
      return node.optional === true ? 1 : 0;
    default:
      return 0;
  }
}

// --- Generic, non-recursive child walk (no dependency on @babel/traverse) --

const SKIP_KEYS = new Set([
  'type',
  'loc',
  'start',
  'end',
  'range',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'extra',
  'tokens',
  'comments',
]);

function isAstNode(v: unknown): v is AstNode {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}

interface Frame {
  node: AstNode;
  parent: AstNode | null;
  unit: MutableRow | null;
}

interface MutableRow {
  name: string;
  kind: string;
  line: number;
  column: number;
  complexity: number;
  startLine: number;
  endLine: number;
}

function pushChildren(node: AstNode, unit: MutableRow | null, stack: Frame[]): void {
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) stack.push({ node: item, parent: node, unit });
      }
    } else if (isAstNode(value)) {
      stack.push({ node: value, parent: node, unit });
    }
  }
}

function locOf(node: AstNode): { line: number; column: number } {
  const loc = node.loc;
  if (!loc) return { line: 0, column: 0 };
  return { line: loc.start.line, column: loc.start.column + 1 };
}

function walk(program: AstNode): MutableRow[] {
  const rows: MutableRow[] = [];
  const stack: Frame[] = [];
  pushChildren(program, null, stack);

  while (stack.length > 0) {
    const frame = stack.pop()!;
    const { node, parent } = frame;
    let unit = frame.unit;

    if (isReportingBoundary(node)) {
      const { name, kind } = describeUnit(node, parent);
      const { line, column } = locOf(node);
      const newRow: MutableRow = {
        name,
        kind,
        line,
        column,
        complexity: 1,
        startLine: node.loc?.start.line ?? line,
        endLine: node.loc?.end.line ?? line,
      };
      rows.push(newRow);
      unit = newRow;
    } else if (unit) {
      unit.complexity += complexityDelta(node);
    }

    pushChildren(node, unit, stack);
  }

  return rows;
}

// --- Physical and code-line length ---------------------------------------

interface CommentSpan {
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
}

function countCodeLines(sourceLines: string[], startLine: number, endLine: number, comments: CommentSpan[]): number {
  let count = 0;
  for (let line = startLine; line <= endLine; line++) {
    let text = sourceLines[line - 1] ?? '';
    for (const c of comments) {
      if (line < c.startLine || line > c.endLine) continue;
      const from = line === c.startLine ? c.startCol : 0;
      const to = line === c.endLine ? c.endCol : text.length;
      if (to > from) text = text.slice(0, from) + ' '.repeat(to - from) + text.slice(to);
    }
    if (text.trim().length > 0) count++;
  }
  return count;
}

/**
 * Parses `source` and reports cyclomatic complexity and length for every
 * function, method, class field initializer and class static block. Never
 * runs `source`: only `@babel/parser`'s `parse` is called on it.
 */
export function analyseComplexity(source: string, options: AnalyseComplexityOptions = {}): AnalyseComplexityResult {
  const { language = 'javascript', threshold = 10 } = options;

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: PLUGINS_BY_LANGUAGE[language],
    });
  } catch (err) {
    const e = err as { loc?: { line: number; column: number }; message: string };
    if (e.loc) {
      throw new CodeComplexityError(e.message, e.loc.line, e.loc.column + 1);
    }
    throw new CodeComplexityError(e.message ?? 'The input could not be parsed.', 0, 0);
  }

  const sourceLines = source.split('\n');
  const comments: CommentSpan[] = (ast.comments ?? []).map((c) => ({
    startLine: c.loc!.start.line,
    endLine: c.loc!.end.line,
    startCol: c.loc!.start.column,
    endCol: c.loc!.end.column,
  }));

  const rows = walk(ast.program as unknown as AstNode);

  const functions: ComplexityRow[] = rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    line: r.line,
    column: r.column,
    complexity: r.complexity,
    lines: r.endLine - r.startLine + 1,
    codeLines: countCodeLines(sourceLines, r.startLine, r.endLine, comments),
  }));

  const over = functions.filter((f) => f.complexity > threshold);
  const highest = functions.reduce((max, f) => Math.max(max, f.complexity), 0);
  const average = functions.length === 0 ? 0 : functions.reduce((sum, f) => sum + f.complexity, 0) / functions.length;

  return { functions, over, highest, average };
}
