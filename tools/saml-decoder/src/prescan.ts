import { SamlDecoderError } from './errors';
import { MAX_ATTRIBUTES_PER_ELEMENT, MAX_DEPTH, MAX_TAGS, withCommas } from './limits';
import { positionAt } from './xml-doctype';

export interface PrescanResult {
  /** Start tags and empty tags. */
  tags: number;
  /** The deepest nesting of elements. */
  depth: number;
}

function refuse(text: string, index: number, sentence: (line: number, column: number) => string): never {
  const at = positionAt(text, index);
  throw new SamlDecoderError(sentence(at.line, at.column), 'message', at.line, at.column);
}

/**
 * One linear pass over the text before any parser sees it. It counts tags and nesting, skipping comments, CDATA sections and
 * processing instructions, and refuses a message over the tag, depth or attribute limit, or with a tag, comment or section
 * that is never closed. Every search moves forward only, so the pass reads each character a bounded number of times.
 */
export function prescan(text: string): PrescanResult {
  const n = text.length;
  let i = 0;
  let depth = 0;
  let deepest = 0;
  let tags = 0;
  for (;;) {
    i = text.indexOf('<', i);
    if (i === -1) break;
    const next = text.charCodeAt(i + 1);
    if (next === 33) {
      // <!-- comment -->, <![CDATA[ ... ]]> or another declaration
      if (text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i + 4);
        if (end === -1) refuse(text, i, (l, c) => `A comment that starts at line ${l}, column ${c} is never closed.`);
        i = end + 3;
      } else if (text.startsWith('<![CDATA[', i)) {
        const end = text.indexOf(']]>', i + 9);
        if (end === -1)
          refuse(text, i, (l, c) => `A CDATA section that starts at line ${l}, column ${c} is never closed.`);
        i = end + 3;
      } else {
        const end = text.indexOf('>', i + 2);
        if (end === -1)
          refuse(text, i, (l, c) => `A declaration that starts at line ${l}, column ${c} is never closed.`);
        i = end + 1;
      }
      continue;
    }
    if (next === 63) {
      const end = text.indexOf('?>', i + 2);
      if (end === -1)
        refuse(text, i, (l, c) => `A processing instruction that starts at line ${l}, column ${c} is never closed.`);
      i = end + 2;
      continue;
    }
    if (next === 47) {
      const end = text.indexOf('>', i + 2);
      if (end === -1) refuse(text, i, (l, c) => `A closing tag that starts at line ${l}, column ${c} is never closed.`);
      if (depth > 0) depth--;
      i = end + 1;
      continue;
    }
    // A start tag or an empty tag: find its end, skipping over quoted attribute values.
    let j = i + 1;
    let quote = 0;
    let attributes = 0;
    while (j < n) {
      const code = text.charCodeAt(j);
      if (quote !== 0) {
        if (code === quote) quote = 0;
      } else if (code === 34 || code === 39) {
        quote = code;
        attributes++;
        if (attributes > MAX_ATTRIBUTES_PER_ELEMENT) {
          refuse(
            text,
            i,
            (l, c) =>
              `The element at line ${l}, column ${c} has more than ${MAX_ATTRIBUTES_PER_ELEMENT} attributes, so the message was not read.`,
          );
        }
      } else if (code === 62) break;
      j++;
    }
    if (j >= n) refuse(text, i, (l, c) => `A tag that starts at line ${l}, column ${c} is never closed.`);
    tags++;
    if (tags > MAX_TAGS) {
      refuse(
        text,
        i,
        (l, c) =>
          `The message has more than ${withCommas(MAX_TAGS)} tags (the next one is at line ${l}, column ${c}), so it was not read.`,
      );
    }
    if (text.charCodeAt(j - 1) !== 47) {
      depth++;
      if (depth > deepest) deepest = depth;
      if (depth > MAX_DEPTH) {
        refuse(
          text,
          i,
          (l, c) =>
            `Elements are nested more than ${MAX_DEPTH} levels deep (at line ${l}, column ${c}), so the message was not read.`,
        );
      }
    }
    i = j + 1;
  }
  return { tags, depth: deepest };
}
