import { attributesInOrder } from './dom';
import { MAX_SHOWN_LINES } from './limits';

export interface FormattedXml {
  /** The formatted text, cut at `MAX_SHOWN_LINES` lines. */
  text: string;
  /** The number of lines the whole formatted message has. */
  lines: number;
  /** The number of lines left out of `text`. */
  omitted: number;
}

type Item = { node: Node; depth: number } | { line: string };

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;
const PI = 7;
const COMMENT = 8;

function escapeText(text: string): string {
  return text.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
}

function escapeAttribute(text: string): string {
  return text.replace(/[&<"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&quot;'));
}

function newlines(text: string): number {
  let count = 0;
  let at = text.indexOf('\n');
  while (at !== -1) {
    count++;
    at = text.indexOf('\n', at + 1);
  }
  return count;
}

function startTag(element: Element): string {
  let out = `<${element.tagName}`;
  for (const attribute of attributesInOrder(element)) out += ` ${attribute.name}="${escapeAttribute(attribute.value)}"`;
  return out;
}

function textOrCdata(node: Node): string {
  const data = (node as CharacterData).data;
  return node.nodeType === CDATA ? `<![CDATA[${data}]]>` : escapeText(data);
}

/**
 * Writes the message as indented XML: one element per line, attributes in the order they were written, comments, CDATA
 * sections and processing instructions kept, and the text of an element that holds only text kept as it is on the element's
 * own line. White space between elements is dropped. The walk uses an explicit stack, so nesting never uses the call stack,
 * and the output stops at `MAX_SHOWN_LINES` lines while the whole count is still made.
 */
export function formatXml(document: Document): FormattedXml {
  const out: string[] = [];
  let total = 0;
  let shown = 0;
  let full = false;
  const emit = (line: string): void => {
    const count = newlines(line) + 1;
    total += count;
    if (full) return;
    if (shown + count > MAX_SHOWN_LINES) {
      full = true;
      return;
    }
    out.push(line);
    shown += count;
  };
  const stack: Item[] = [];
  const pushChildren = (parent: Node, depth: number): void => {
    const nodes = parent.childNodes;
    for (let i = nodes.length - 1; i >= 0; i--) stack.push({ node: nodes[i]!, depth });
  };
  pushChildren(document, 0);
  while (stack.length > 0) {
    const item = stack.pop()!;
    if ('line' in item) {
      emit(item.line);
      continue;
    }
    const { node, depth } = item;
    const pad = '  '.repeat(depth);
    if (node.nodeType === ELEMENT) {
      const element = node as Element;
      const kids = element.childNodes;
      let onlyText = true;
      for (let i = 0; i < kids.length; i++) {
        const type = kids[i]!.nodeType;
        if (type !== TEXT && type !== CDATA) {
          onlyText = false;
          break;
        }
      }
      if (kids.length === 0) emit(`${pad}${startTag(element)}/>`);
      else if (onlyText) {
        let inner = '';
        for (let i = 0; i < kids.length; i++) inner += textOrCdata(kids[i]!);
        emit(`${pad}${startTag(element)}>${inner}</${element.tagName}>`);
      } else {
        emit(`${pad}${startTag(element)}>`);
        stack.push({ line: `${pad}</${element.tagName}>` });
        pushChildren(element, depth + 1);
      }
    } else if (node.nodeType === TEXT) {
      const text = (node as CharacterData).data.trim();
      if (text !== '') emit(`${pad}${escapeText(text)}`);
    } else if (node.nodeType === CDATA) {
      emit(`${pad}<![CDATA[${(node as CharacterData).data}]]>`);
    } else if (node.nodeType === COMMENT) {
      emit(`${pad}<!--${(node as CharacterData).data}-->`);
    } else if (node.nodeType === PI) {
      const instruction = node as ProcessingInstruction;
      if (instruction.target !== 'xml')
        emit(`${pad}<?${instruction.target}${instruction.data === '' ? '' : ` ${instruction.data}`}?>`);
    }
  }
  return { text: out.join('\n'), lines: total, omitted: total - shown };
}
