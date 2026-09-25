/**
 * Converts pasted HTML or SVG markup into JSX source text. Parses with
 * `htmlparser2`'s `parseDocument` -- a tokeniser that builds a plain object
 * tree, never a DOM, so nothing in the input ever loads or runs while
 * parsing it (D-70). Inline event handler attributes and `script` elements
 * are dropped with a warning; their text is never turned into code, read as
 * an expression, or evaluated in any way.
 *
 * Attribute names are looked up in `REACT_ATTRIBUTE_NAMES`, transcribed from
 * React DOM's own `possibleStandardNames.js`. SVG element names are looked
 * up in `SVG_TAG_NAMES`, transcribed from the HTML Living Standard's own
 * parser table, and are only remapped while inside an `<svg>` subtree.
 */
import meta from './meta.json';
import { parseDocument } from 'htmlparser2';
import { REACT_ATTRIBUTE_NAMES } from './react-attribute-names';
import { SVG_TAG_NAMES } from './svg-tag-names';

export { meta };

export class JsxConverterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsxConverterError';
  }
}

export type JsxConverterOutput = 'jsx' | 'component' | 'typescript';

export interface ConvertToJsxOptions {
  output?: JsxConverterOutput;
  componentName?: string;
  /** Rewrites `value`/`checked` on form controls to `defaultValue`/`defaultChecked`. Defaults to true. */
  defaultValues?: boolean;
}

export interface ConvertToJsxResult {
  output: string;
  warnings: string[];
}

// --- Minimal shape of the htmlparser2/domhandler tree this file reads -----
// (Only the fields this file touches; the real nodes carry more.)
interface RawNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: RawNode[];
}

interface RenderCtx {
  insideSvg: boolean;
  defaultValues: boolean;
  droppedHandlers: Set<string>;
  scriptState: { count: number };
}

const FORM_CONTROL_TAGS = new Set(['input', 'textarea', 'select']);
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// --- Attribute and tag name mapping ----------------------------------------

/** Looks up `rawName`'s lower-cased form in the React attribute table; unknown names (including data-* and aria-*) are kept exactly as written. */
function attributeName(rawName: string): string {
  const mapped = REACT_ATTRIBUTE_NAMES[rawName.toLowerCase()];
  return mapped ?? rawName;
}

/** The tag name to write for `node`, given whether it sits inside an `<svg>` subtree. Only an SVG-context name gets the camelCase table lookup. */
function tagNameFor(nameLower: string, insideSvg: boolean): string {
  if (insideSvg) {
    const mapped = SVG_TAG_NAMES[nameLower];
    if (mapped) return mapped;
  }
  return nameLower;
}

// --- Style attribute: declaration string to a JSX style object -------------

/** Splits a `style` attribute's declarations on `;`, but not inside quotes or parentheses (so `url(a;b)` or `content: ";"` are not split). */
function splitDeclarations(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote && raw[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) {
      out.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  if (start < raw.length) out.push(raw.slice(start));
  return out;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** camelCase, no leading-segment capitalisation: `background-color` -> `backgroundColor`. */
function camelSegments(lowerKebab: string): string {
  const parts = lowerKebab.split('-').filter(Boolean);
  if (parts.length === 0) return lowerKebab;
  return parts[0] + parts.slice(1).map(capitalize).join('');
}

/**
 * A CSS property name to the JSX style-object key React expects: a custom
 * property (`--x`) is kept exactly as written (a quoted key, T-05-… below);
 * `-webkit-`/`-moz-`/`-o-` vendor prefixes become a capitalised prefix plus
 * PascalCase; `-ms-` stays lower-case `ms` (CSSOM historical convention,
 * which React's own inline-style handling follows); anything else becomes
 * plain camelCase.
 */
function styleKey(rawProp: string): { key: string; isCustom: boolean } {
  const lower = rawProp.toLowerCase();
  if (lower.startsWith('--')) return { key: rawProp, isCustom: true };
  if (lower.startsWith('-webkit-'))
    return { key: `Webkit${capitalize(camelSegments(lower.slice(8)))}`, isCustom: false };
  if (lower.startsWith('-moz-')) return { key: `Moz${capitalize(camelSegments(lower.slice(5)))}`, isCustom: false };
  if (lower.startsWith('-ms-')) return { key: `ms${capitalize(camelSegments(lower.slice(4)))}`, isCustom: false };
  if (lower.startsWith('-o-')) return { key: `O${capitalize(camelSegments(lower.slice(3)))}`, isCustom: false };
  return { key: camelSegments(lower), isCustom: false };
}

/** A single-quoted JS string literal for `value`, escaping backslashes, single quotes and newlines. */
function singleQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function renderStyleAttribute(raw: string): string | null {
  const props: string[] = [];
  for (const decl of splitDeclarations(raw)) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const rawProp = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (!rawProp || !value) continue;
    const { key, isCustom } = styleKey(rawProp);
    props.push(`${isCustom ? `'${key}'` : key}: ${singleQuote(value)}`);
  }
  if (props.length === 0) return null;
  return `style={{ ${props.join(', ')} }}`;
}

// --- Attribute value and text/comment escaping ------------------------------

function renderAttrValueLiteral(value: string): string {
  const isSafe = !/["\\`{}\n\r]/.test(value);
  return isSafe ? `"${value}"` : `{${JSON.stringify(value)}}`;
}

function renderAttribute(rawName: string, rawValue: string, tagLower: string, ctx: RenderCtx): string | null {
  const lowerName = rawName.toLowerCase();
  if (lowerName.startsWith('on')) {
    ctx.droppedHandlers.add(lowerName);
    return null;
  }
  if (lowerName === 'style') {
    return renderStyleAttribute(rawValue);
  }
  let propName = attributeName(rawName);
  if (ctx.defaultValues && FORM_CONTROL_TAGS.has(tagLower) && (propName === 'value' || propName === 'checked')) {
    propName = propName === 'value' ? 'defaultValue' : 'defaultChecked';
  }
  if (rawValue === '') return propName; // a bare/empty attribute is a boolean prop: `name` means `name={true}`
  return `${propName}=${renderAttrValueLiteral(rawValue)}`;
}

/** Escapes the four JSX-significant characters in plain text so they render as literal characters, not markup or an expression. */
function escapeText(raw: string): string {
  return raw.replace(/[{}<>]/g, (c) => {
    switch (c) {
      case '{':
        return "{'{'}";
      case '}':
        return "{'}'}";
      case '<':
        return "{'<'}";
      default:
        return "{'>'}";
    }
  });
}

const WHITESPACE_ONLY_RE = /^[ \t\r\n]*$/;

/**
 * Renders one text node. A whitespace-only run containing a line break is
 * insignificant markup layout and is dropped entirely; a whitespace-only run
 * with no line break (typically one space between two inline elements) is
 * kept, but explicitly as `{' '}` -- this printer puts each child on its own
 * indented line, which would otherwise swallow that single space the way
 * plain JSX text never would.
 */
function renderTextChild(raw: string): string | null {
  if (raw === '') return null;
  if (WHITESPACE_ONLY_RE.test(raw)) {
    return raw.includes('\n') ? null : "{' '}";
  }
  return escapeText(raw);
}

/** A comment-closing sequence inside a comment's own text would end the JSX comment early; escaped so it stays inside it. */
function renderComment(data: string): string {
  return `{/*${data.replace(/\*\//g, '*\\/')}*/}`;
}

/** A `<style>` element's text content becomes a template literal (backticks and `${` escaped), since raw CSS text is not valid JSX text. */
function styleElementChildren(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `{\`${escaped}\`}`;
}

// --- Element tree walk -------------------------------------------------------

function attrString(parts: string[]): string {
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function renderNode(node: RawNode, ctx: RenderCtx, indent: number): string | null {
  if (node.type === 'text') return renderTextChild(node.data ?? '');
  if (node.type === 'comment') return renderComment(node.data ?? '');
  if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return null; // directive (DOCTYPE), CDATA, or anything else this printer does not carry over

  const nameLower = (node.name ?? '').toLowerCase();

  if (nameLower === 'script') {
    ctx.scriptState.count += 1;
    return null;
  }

  const insideSvg = ctx.insideSvg || nameLower === 'svg';
  const tagName = tagNameFor(nameLower, insideSvg);

  const attrParts: string[] = [];
  for (const [rawName, rawValue] of Object.entries(node.attribs ?? {})) {
    const rendered = renderAttribute(rawName, rawValue, nameLower, ctx);
    if (rendered !== null) attrParts.push(rendered);
  }
  const attrs = attrString(attrParts);

  if (nameLower === 'style') {
    const text = (node.children ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.data ?? '')
      .join('');
    return `<${tagName}${attrs}>${styleElementChildren(text)}</${tagName}>`;
  }

  const childCtx: RenderCtx = { ...ctx, insideSvg };
  const renderedChildren: string[] = [];
  for (const child of node.children ?? []) {
    const rendered = renderNode(child, childCtx, indent + 1);
    if (rendered !== null) renderedChildren.push(rendered);
  }

  if (renderedChildren.length === 0) {
    // Valid JSX for any element, void or not; also self-closes an element
    // this printer received self-closed with nothing between its tags.
    return `<${tagName}${attrs} />`;
  }
  if (renderedChildren.length === 1 && !renderedChildren[0]!.includes('\n')) {
    return `<${tagName}${attrs}>${renderedChildren[0]}</${tagName}>`;
  }
  const pad = '  '.repeat(indent + 1);
  const closePad = '  '.repeat(indent);
  const inner = renderedChildren.map((c) => pad + c.split('\n').join(`\n${pad}`)).join('\n');
  return `<${tagName}${attrs}>\n${inner}\n${closePad}</${tagName}>`;
}

function tagNameOfRoot(node: RawNode): string | null {
  if (node.type !== 'tag') return null;
  const nameLower = (node.name ?? '').toLowerCase();
  return SVG_TAG_NAMES[nameLower] ?? nameLower;
}

// --- Component wrapping ------------------------------------------------------

function isValidComponentName(name: string): boolean {
  return typeof name === 'string' && IDENTIFIER_RE.test(name);
}

function indentBlock(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Inserts `{...props}` into the single root element's opening tag, just before its `>` or self-closing `/>`. */
function spreadPropsOnRoot(jsx: string, tagName: string): string {
  const re = new RegExp(`^<${escapeRegExp(tagName)}(\\s[^<>]*)?( /)?>`);
  const match = re.exec(jsx);
  if (!match) return jsx; // defensive: leave unchanged if the shape is not what this printer itself produces
  const attrs = match[1] ?? '';
  const selfClosing = Boolean(match[2]);
  return `<${tagName}${attrs} {...props}${selfClosing ? ' />' : '>'}${jsx.slice(match[0].length)}`;
}

/**
 * Converts `markup` (HTML or SVG) to JSX source text. `output` is `'jsx'`
 * (bare JSX, the default), `'component'` (wrapped in a named function
 * component) or `'typescript'` (the same, with the root element's props
 * typed as `ComponentProps<'<root tag>'>`; a fragment root -- more than one
 * top-level element -- takes no props and no type import is added).
 */
export function convertToJsx(markup: string, options: ConvertToJsxOptions = {}): ConvertToJsxResult {
  const { output = 'jsx', componentName: requestedName = 'Markup', defaultValues = true } = options;

  let doc: { children?: RawNode[] };
  try {
    doc = parseDocument(markup, {
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
      recognizeSelfClosing: true,
    }) as unknown as { children?: RawNode[] };
  } catch (err) {
    throw new JsxConverterError(err instanceof Error ? err.message : 'The markup could not be parsed.');
  }

  const ctx: RenderCtx = {
    insideSvg: false,
    defaultValues,
    droppedHandlers: new Set<string>(),
    scriptState: { count: 0 },
  };

  const rootNodes = (doc.children ?? []).filter((n) => n.type !== 'directive');
  const roots: { node: RawNode; text: string }[] = [];
  for (const node of rootNodes) {
    const text = renderNode(node, ctx, 0);
    if (text !== null) roots.push({ node, text });
  }

  if (roots.length === 0) {
    throw new JsxConverterError('There is no markup to convert.');
  }

  let bodyJsx: string;
  let rootTagName: string | null;
  if (roots.length === 1) {
    bodyJsx = roots[0]!.text;
    rootTagName = tagNameOfRoot(roots[0]!.node);
  } else {
    const inner = roots.map((r) => `  ${r.text.split('\n').join('\n  ')}`).join('\n');
    bodyJsx = `<>\n${inner}\n</>`;
    rootTagName = null;
  }

  const warnings: string[] = [];
  if (ctx.droppedHandlers.size > 0) {
    const names = [...ctx.droppedHandlers].sort();
    warnings.push(`Dropped event handler attribute${names.length === 1 ? '' : 's'}: ${names.join(', ')}.`);
  }
  if (ctx.scriptState.count > 0) {
    warnings.push(`Dropped ${ctx.scriptState.count} script element${ctx.scriptState.count === 1 ? '' : 's'}.`);
  }

  let componentName = requestedName;
  if (output !== 'jsx' && !isValidComponentName(requestedName)) {
    warnings.push(`"${requestedName}" is not a valid component name, so "Markup" was used instead.`);
    componentName = 'Markup';
  }

  let out: string;
  if (output === 'jsx') {
    out = `${bodyJsx}\n`;
  } else if (output === 'component') {
    out = `export default function ${componentName}() {\n  return (\n${indentBlock(bodyJsx, 4)}\n  );\n}\n`;
  } else {
    const hasProps = rootTagName !== null;
    const rootJsx = hasProps ? spreadPropsOnRoot(bodyJsx, rootTagName!) : bodyJsx;
    const importLine = hasProps ? `import type { ComponentProps } from 'react';\n\n` : '';
    const propsParam = hasProps ? `props: ComponentProps<'${rootTagName}'>` : '';
    out = `${importLine}export default function ${componentName}(${propsParam}) {\n  return (\n${indentBlock(rootJsx, 4)}\n  );\n}\n`;
  }

  return { output: out, warnings };
}
