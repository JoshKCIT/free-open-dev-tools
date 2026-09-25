import meta from './meta.json';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { findDoctype, DOCTYPE_REFUSAL_MESSAGE } from './xml-doctype';

export { meta };

export class XPathTesterError extends Error {
  readonly kind: 'xml' | 'expression';
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, kind: 'xml' | 'expression', detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'XPathTesterError';
    this.kind = kind;
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface XPathNodeResult {
  type: 'element' | 'attribute' | 'text' | 'comment' | 'processing-instruction' | 'other';
  name: string;
  path: string;
  value: string;
  markup: string;
}

export interface XPathEvaluateResult {
  kind: 'nodeset' | 'string' | 'number' | 'boolean';
  /**
   * For `'string'` the raw string value; for `'number'` the value already
   * formatted by XPath 1.0's own number-to-string rule (never the host's
   * default); for `'boolean'` the boolean itself.
   */
  value?: string | boolean;
  nodes?: XPathNodeResult[];
  total?: number;
}

export interface EvaluateXPathOptions {
  /** Namespace prefix to URI map, used to resolve a prefixed name in the expression. */
  namespaces?: Record<string, string>;
  /** Cap on the number of node-set rows returned. Default 1000. */
  maxNodes?: number;
  /** Also resolve a prefix from an `xmlns:prefix` declaration on the document's root element. Default true. */
  rootNamespaces?: boolean;
}

const MAX_MARKUP_LENGTH = 500;

/**
 * Formats a number the way XPath 1.0 section 4.2 (the `string` function)
 * specifies: NaN, Infinity and -Infinity keep those exact spellings, an
 * integer has no decimal point, a negative zero is "0", and any other
 * number is decimal form with as many digits as needed to round-trip and no
 * more -- the same "shortest round-trip decimal" rule ECMA-262's own
 * Number::toString algorithm already implements for every finite value in
 * the range this tool's inputs realistically reach. A magnitude large or
 * small enough that JavaScript would switch to exponential notation is
 * named in `limits` rather than reimplemented here.
 */
function formatXPathNumber(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  if (n === 0) return '0'; // covers both +0 and -0 (XPath 1.0 section 4.2)
  const text = n.toString(10);
  return text;
}

type XmldomNode = {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  parentNode?: XmldomNode | null;
  ownerElement?: XmldomNode | null;
  childNodes?: ArrayLike<XmldomNode>;
  toString(): string;
};

const ELEMENT_NODE = 1;
const ATTRIBUTE_NODE = 2;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const PROCESSING_INSTRUCTION_NODE = 7;
const COMMENT_NODE = 8;
const DOCUMENT_NODE = 9;

function stepTest(node: XmldomNode): string {
  switch (node.nodeType) {
    case ELEMENT_NODE:
      return node.nodeName;
    case TEXT_NODE:
    case CDATA_SECTION_NODE:
      return 'text()';
    case PROCESSING_INSTRUCTION_NODE:
      return 'processing-instruction()';
    case COMMENT_NODE:
      return 'comment()';
    default:
      return node.nodeName;
  }
}

function matchesStep(node: XmldomNode, step: string): boolean {
  if (step === 'text()') return node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE;
  if (step === 'processing-instruction()') return node.nodeType === PROCESSING_INSTRUCTION_NODE;
  if (step === 'comment()') return node.nodeType === COMMENT_NODE;
  return node.nodeType === ELEMENT_NODE && node.nodeName === step;
}

/** 1-based position of `node` among its siblings that match the same location step (XPath 1.0 section 2.5's `position()`). */
function siblingPosition(node: XmldomNode): number {
  const parent = node.parentNode;
  if (!parent || !parent.childNodes) return 1;
  const step = stepTest(node);
  let position = 0;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const sibling = parent.childNodes[i]!;
    if (matchesStep(sibling, step)) {
      position++;
      if (sibling === node) return position;
    }
  }
  return position || 1;
}

/** A path like `/catalog[1]/book[2]/@id` locating `node` from the document root. */
function computeNodePath(node: XmldomNode): string {
  if (node.nodeType === ATTRIBUTE_NODE) {
    const owner = node.ownerElement;
    return (owner ? computeNodePath(owner) : '') + '/@' + node.nodeName;
  }
  const segments: string[] = [];
  let current: XmldomNode | null | undefined = node;
  while (current && current.nodeType !== DOCUMENT_NODE) {
    segments.unshift(`${stepTest(current)}[${siblingPosition(current)}]`);
    current = current.parentNode;
  }
  return '/' + segments.join('/');
}

function nodeResultType(node: XmldomNode): XPathNodeResult['type'] {
  switch (node.nodeType) {
    case ELEMENT_NODE:
      return 'element';
    case ATTRIBUTE_NODE:
      return 'attribute';
    case TEXT_NODE:
    case CDATA_SECTION_NODE:
      return 'text';
    case COMMENT_NODE:
      return 'comment';
    case PROCESSING_INSTRUCTION_NODE:
      return 'processing-instruction';
    default:
      return 'other';
  }
}

function describeNode(node: XmldomNode, maxMarkupLength: number): XPathNodeResult {
  const markup = node.toString();
  const value = xpath.select1('string(.)', node as unknown as Node) as unknown as string;
  return {
    type: nodeResultType(node),
    name: node.nodeName,
    path: computeNodePath(node),
    value,
    markup: markup.length > maxMarkupLength ? markup.slice(0, maxMarkupLength) : markup,
  };
}

/**
 * Evaluates an XPath 1.0 expression against an XML document, refusing a
 * DOCTYPE before any parser reads it (D-74). Parses with `@xmldom/xmldom`'s
 * `DOMParser`, collecting every parser problem through `onError` so nothing
 * reaches the console, then evaluates with the `xpath` package -- one
 * engine, shared with the browser page (D-73).
 */
export function evaluateXPath(
  xml: string,
  expression: string,
  options: EvaluateXPathOptions = {},
): XPathEvaluateResult {
  const { namespaces = {}, maxNodes = 1000, rootNamespaces: useRootNamespaces = true } = options;

  const doctype = findDoctype(xml);
  if (doctype) throw new XPathTesterError(DOCTYPE_REFUSAL_MESSAGE, 'xml', doctype);

  let blocking: { message: string; line?: number; column?: number } | null = null;
  const parser = new DOMParser({
    locator: true,
    onError: (level, message, context) => {
      if (level === 'warning') return;
      if (blocking) return;
      const locator = (context as { locator?: { lineNumber?: number; columnNumber?: number } } | undefined)?.locator;
      blocking = { message, line: locator?.lineNumber, column: locator?.columnNumber };
    },
  });

  let doc: unknown;
  try {
    doc = parser.parseFromString(xml, 'text/xml');
  } catch (err) {
    const locator = (err as { locator?: { lineNumber?: number; columnNumber?: number } } | undefined)?.locator;
    const message = err instanceof Error ? err.message : 'The document could not be parsed.';
    throw new XPathTesterError(message, 'xml', { line: locator?.lineNumber, column: locator?.columnNumber });
  }
  if (blocking) {
    const b: { message: string; line?: number; column?: number } = blocking;
    throw new XPathTesterError(b.message, 'xml', { line: b.line, column: b.column });
  }

  const rootElement = (doc as { documentElement?: XmldomNode }).documentElement;
  const rootDeclaredNamespaces: Record<string, string> = {};
  if (useRootNamespaces) {
    const rootAttributes = (rootElement as unknown as { attributes?: ArrayLike<{ name: string; value: string }> })
      ?.attributes;
    if (rootAttributes) {
      for (let i = 0; i < rootAttributes.length; i++) {
        const attr = rootAttributes[i]!;
        if (attr.name === 'xmlns') rootDeclaredNamespaces[''] = attr.value;
        else if (attr.name.startsWith('xmlns:')) rootDeclaredNamespaces[attr.name.slice('xmlns:'.length)] = attr.value;
      }
    }
  }

  const resolver = {
    lookupNamespaceURI(prefix: string | null): string | null {
      const key = prefix ?? '';
      if (Object.prototype.hasOwnProperty.call(namespaces, key)) return namespaces[key]!;
      if (Object.prototype.hasOwnProperty.call(rootDeclaredNamespaces, key)) return rootDeclaredNamespaces[key]!;
      return null;
    },
  };

  let result: unknown;
  try {
    result = xpath.selectWithResolver(expression, doc as Node, resolver, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'This expression could not be evaluated.';
    throw new XPathTesterError(message, 'expression');
  }

  if (typeof result === 'boolean') return { kind: 'boolean', value: result };
  if (typeof result === 'number') return { kind: 'number', value: formatXPathNumber(result) };
  if (typeof result === 'string') return { kind: 'string', value: result };

  const nodes = result as XmldomNode[];
  const total = nodes.length;
  const limited = nodes.slice(0, Math.max(0, maxNodes));
  return {
    kind: 'nodeset',
    total,
    nodes: limited.map((node) => describeNode(node, MAX_MARKUP_LENGTH)),
  };
}
