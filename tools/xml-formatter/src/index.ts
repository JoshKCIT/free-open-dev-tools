import meta from './meta.json';
import { XMLValidator } from 'fast-xml-parser';
import { findDoctype, positionAt, DOCTYPE_REFUSAL_MESSAGE } from './xml-doctype';

export { meta };

export class XmlFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'XmlFormatterError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export type FormatMode = 'format' | 'minify' | 'check';

export interface FormatXmlOptions {
  mode?: FormatMode;
  /** Spaces per indent level, used by 'format'. Default 2. */
  indent?: number;
  /** Remove comments, used by 'minify'. Default false. */
  removeComments?: boolean;
}

export interface FormatXmlResult {
  output: string;
  /** Count of XML elements read. */
  elements: number;
  /** Count of XML attributes read, across every element. */
  attributes: number;
  /** Deepest element nesting level found (the root element is level 1). */
  maxDepth: number;
}

const PREDEFINED_ENTITY_NAMES = new Set(['amp', 'lt', 'gt', 'apos', 'quot']);

function isXmlSpaceChar(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

function isWhitespaceOnly(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (!isXmlSpaceChar(text[i])) return false;
  }
  return true;
}

/**
 * Scans `text[start, end)` for entity references (`&name;`), refusing any
 * that is not one of the five predefined XML entities (XML 1.0 section 4.6)
 * or a decimal/hexadecimal numeric character reference (XML 1.0 section
 * 4.1). No DOCTYPE is ever read by this tool (a document declaring one is
 * refused before this scan runs), so no other entity name can ever be
 * declared -- Well-formedness constraint: Entity Declared (XML 1.0 section
 * 4.1). A single left-to-right pass; every character is visited a bounded
 * number of times, so this cannot backtrack catastrophically.
 */
function checkEntityReferences(text: string, start: number, end: number): void {
  let i = start;
  while (i < end) {
    if (text[i] !== '&') {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < end && text[j] !== ';') j++;
    if (j >= end) {
      i++;
      continue;
    }
    const body = text.slice(i + 1, j);
    const isNumeric = /^#x[0-9a-fA-F]+$/.test(body) || /^#[0-9]+$/.test(body);
    if (!isNumeric && !PREDEFINED_ENTITY_NAMES.has(body)) {
      const pos = positionAt(text, i);
      throw new XmlFormatterError(
        `"&${body};" is not one of the five predefined entities or a numeric character reference, and no DOCTYPE was read to declare it.`,
        pos,
      );
    }
    i = j + 1;
  }
}

interface TagScanResult {
  raw: string;
  end: number;
  name: string;
  selfClosing: boolean;
  attributeCount: number;
  attrValueSpans: { start: number; end: number }[];
}

/**
 * Reads a start tag or empty-element tag beginning at `text[start] === '<'`,
 * tracking quote state so a literal `>` inside an attribute value (XML 1.0
 * permits one) never ends the scan early. A single left-to-right pass.
 */
function scanStartOrEmptyTag(text: string, start: number): TagScanResult {
  let i = start + 1;
  const nameStart = i;
  while (i < text.length && !isXmlSpaceChar(text[i]) && text[i] !== '>' && text[i] !== '/') i++;
  const name = text.slice(nameStart, i);
  let attributeCount = 0;
  let selfClosing = false;
  const attrValueSpans: { start: number; end: number }[] = [];

  while (i < text.length) {
    while (i < text.length && isXmlSpaceChar(text[i])) i++;
    if (text[i] === '/') {
      selfClosing = true;
      i++;
      continue;
    }
    if (text[i] === '>') {
      i++;
      break;
    }
    const attrNameStart = i;
    while (i < text.length && text[i] !== '=' && !isXmlSpaceChar(text[i]) && text[i] !== '>' && text[i] !== '/') i++;
    if (i === attrNameStart) {
      // Not making progress (should not happen on already-validated text); advance to avoid an infinite loop.
      i++;
      continue;
    }
    while (i < text.length && isXmlSpaceChar(text[i])) i++;
    if (text[i] === '=') {
      i++;
      while (i < text.length && isXmlSpaceChar(text[i])) i++;
      const quote = text[i];
      if (quote === '"' || quote === "'") {
        i++;
        const valueStart = i;
        while (i < text.length && text[i] !== quote) i++;
        attrValueSpans.push({ start: valueStart, end: i });
        i++; // closing quote
        attributeCount++;
      }
    }
  }
  return { raw: text.slice(start, i), end: i, name, selfClosing, attributeCount, attrValueSpans };
}

/** Reads `xml:space="preserve"|"default"` (either quote style) from a start tag's raw text. */
function extractXmlSpace(tagRaw: string): 'default' | 'preserve' | null {
  const match = /\bxml:space\s*=\s*"([^"]*)"|\bxml:space\s*=\s*'([^']*)'/.exec(tagRaw);
  if (!match) return null;
  const value = match[1] ?? match[2] ?? '';
  return value === 'preserve' ? 'preserve' : 'default';
}

interface ElementNode {
  type: 'element';
  name: string;
  startRaw: string;
  endRaw: string | null;
  selfClosing: boolean;
  start: number;
  end: number;
  children: XmlNode[];
  xmlSpace: 'default' | 'preserve' | null;
}
interface TextNode {
  type: 'text';
  text: string;
  start: number;
  end: number;
}
interface RawNode {
  type: 'comment' | 'cdata' | 'pi' | 'decl';
  raw: string;
  start: number;
  end: number;
}
type XmlNode = ElementNode | TextNode | RawNode;

interface TreeResult {
  roots: XmlNode[];
  elements: number;
  attributes: number;
  maxDepth: number;
}

/**
 * Splits already-validated well-formed XML text into a tree of tokens: the
 * XML declaration, processing instructions, comments, CDATA sections, start
 * tags (kept verbatim, quote-aware), end tags and text -- XML 1.0 section
 * 2.1 (document), 2.8 (prolog), 3.1 (start and end tags). A single
 * left-to-right pass with no backtracking regular expressions over the bulk
 * of the text, so a large document scans in time proportional to its length.
 * Also refuses (Well-formedness constraint: Entity Declared, section 4.1) an
 * entity reference other than the five predefined ones or a numeric
 * character reference, found in a text node or an attribute value.
 */
function buildTree(text: string): TreeResult {
  let i = 0;
  const roots: XmlNode[] = [];
  const stack: ElementNode[] = [];
  let elements = 0;
  let attributes = 0;
  let maxDepth = 0;
  let sawFirstToken = false;

  const currentChildren = (): XmlNode[] => (stack.length ? stack[stack.length - 1]!.children : roots);

  while (i < text.length) {
    if (text[i] === '<') {
      if (text.startsWith('<!--', i)) {
        const close = text.indexOf('-->', i + 4);
        const end = close === -1 ? text.length : close + 3;
        currentChildren().push({ type: 'comment', raw: text.slice(i, end), start: i, end });
        i = end;
      } else if (text.startsWith('<![CDATA[', i)) {
        const close = text.indexOf(']]>', i + 9);
        const end = close === -1 ? text.length : close + 3;
        currentChildren().push({ type: 'cdata', raw: text.slice(i, end), start: i, end });
        i = end;
      } else if (text.startsWith('<?', i)) {
        const close = text.indexOf('?>', i + 2);
        const end = close === -1 ? text.length : close + 2;
        const raw = text.slice(i, end);
        const isDecl = !sawFirstToken && /^<\?xml[\s?]/i.test(raw);
        currentChildren().push({ type: isDecl ? 'decl' : 'pi', raw, start: i, end });
        i = end;
      } else if (text.startsWith('</', i)) {
        const close = text.indexOf('>', i + 2);
        const end = close === -1 ? text.length : close + 1;
        const top = stack.pop();
        if (top) {
          top.endRaw = text.slice(i, end);
          top.end = end;
        }
        i = end;
      } else {
        const scan = scanStartOrEmptyTag(text, i);
        elements++;
        attributes += scan.attributeCount;
        const depth = stack.length + 1;
        if (depth > maxDepth) maxDepth = depth;
        for (const span of scan.attrValueSpans) checkEntityReferences(text, span.start, span.end);
        const node: ElementNode = {
          type: 'element',
          name: scan.name,
          startRaw: scan.raw,
          endRaw: null,
          selfClosing: scan.selfClosing,
          start: i,
          end: scan.end,
          children: [],
          xmlSpace: extractXmlSpace(scan.raw),
        };
        currentChildren().push(node);
        if (!scan.selfClosing) stack.push(node);
        i = scan.end;
      }
      sawFirstToken = true;
    } else {
      const next = text.indexOf('<', i);
      const end = next === -1 ? text.length : next;
      if (end > i) {
        checkEntityReferences(text, i, end);
        currentChildren().push({ type: 'text', text: text.slice(i, end), start: i, end });
      }
      sawFirstToken = true;
      i = end;
    }
  }
  return { roots, elements, attributes, maxDepth };
}

/** True when every child is a comment, processing instruction, CDATA section or element, with any text child whitespace-only. */
function isElementOnlyContent(children: XmlNode[]): boolean {
  for (const child of children) {
    if (child.type === 'text' && !isWhitespaceOnly(child.text)) return false;
  }
  return true;
}

function indentOf(depth: number, size: number): string {
  return ' '.repeat(depth * size);
}

function renderFormattedNode(
  node: XmlNode,
  depth: number,
  inheritedSpace: 'default' | 'preserve',
  source: string,
  indentSize: number,
  out: string[],
): void {
  if (node.type === 'text') return; // top-level whitespace-only text is dropped, regenerated by the parent
  if (node.type !== 'element') {
    out.push(indentOf(depth, indentSize) + node.raw);
    return;
  }
  const effectiveSpace = node.xmlSpace ?? inheritedSpace;
  if (node.selfClosing || node.children.length === 0) {
    out.push(indentOf(depth, indentSize) + node.startRaw + (node.endRaw ?? ''));
    return;
  }
  if (effectiveSpace === 'preserve' || !isElementOnlyContent(node.children)) {
    out.push(indentOf(depth, indentSize) + source.slice(node.start, node.end));
    return;
  }
  out.push(indentOf(depth, indentSize) + node.startRaw);
  for (const child of node.children) renderFormattedNode(child, depth + 1, effectiveSpace, source, indentSize, out);
  out.push(indentOf(depth, indentSize) + (node.endRaw ?? ''));
}

function renderFormatted(roots: XmlNode[], source: string, indentSize: number): string {
  const out: string[] = [];
  for (const root of roots) renderFormattedNode(root, 0, 'default', source, indentSize, out);
  return out.join('\n');
}

function renderMinifiedNode(
  node: XmlNode,
  inheritedSpace: 'default' | 'preserve',
  source: string,
  removeComments: boolean,
  out: string[],
): void {
  if (node.type === 'text') return;
  if (node.type === 'comment') {
    if (!removeComments) out.push(node.raw);
    return;
  }
  if (node.type !== 'element') {
    out.push(node.raw);
    return;
  }
  const effectiveSpace = node.xmlSpace ?? inheritedSpace;
  if (node.selfClosing || node.children.length === 0) {
    out.push(node.startRaw + (node.endRaw ?? ''));
    return;
  }
  if (effectiveSpace === 'preserve' || !isElementOnlyContent(node.children)) {
    out.push(source.slice(node.start, node.end));
    return;
  }
  out.push(node.startRaw);
  for (const child of node.children) renderMinifiedNode(child, effectiveSpace, source, removeComments, out);
  out.push(node.endRaw ?? '');
}

function renderMinified(roots: XmlNode[], source: string, removeComments: boolean): string {
  const out: string[] = [];
  for (const root of roots) renderMinifiedNode(root, 'default', source, removeComments, out);
  return out.join('');
}

/**
 * Checks XML 1.0 well-formedness, formats with indentation or minifies,
 * changing only whitespace between markup -- text, attributes, tags and
 * CDATA are never rewritten. Any document with a DOCTYPE is refused before
 * parsing (XML 1.0 section 2.8), and any entity reference other than the
 * five predefined entities or a numeric character reference is refused
 * (Well-formedness constraint: Entity Declared, section 4.1), since no
 * DOCTYPE is ever read to declare one.
 */
export function formatXml(source: string, options: FormatXmlOptions = {}): FormatXmlResult {
  const { mode = 'format', indent = 2, removeComments = false } = options;
  const indentSize = Math.max(0, indent);

  const doctype = findDoctype(source);
  if (doctype) throw new XmlFormatterError(DOCTYPE_REFUSAL_MESSAGE, doctype);

  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    const { err } = validation;
    throw new XmlFormatterError(err.msg, { line: err.line, column: err.col });
  }

  const { roots, elements, attributes, maxDepth } = buildTree(source);

  let output: string;
  if (mode === 'check') {
    output = source;
  } else if (mode === 'minify') {
    output = renderMinified(roots, source, removeComments);
  } else {
    output = renderFormatted(roots, source, indentSize);
  }

  return { output, elements, attributes, maxDepth };
}
