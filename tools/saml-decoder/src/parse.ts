import { DOMParser } from '@xmldom/xmldom';
import { SamlDecoderError } from './errors';

export interface ParsedSaml {
  document: Document;
  /** Fixed sentences for problems the reader accepted but a strict reader would refuse. Each names a line and column. */
  warnings: string[];
}

interface ReaderEvent {
  level: string;
  message: string;
  line?: number;
  column?: number;
}

/**
 * Turns a message of the XML reader into one fixed sentence. The reader's own words can repeat pasted markup, so none of
 * them is ever passed on: only the kind of problem is read from them.
 */
export function describeReaderMessage(message: string): string {
  const text = message.toLowerCase();
  if (text.includes('mismatch')) return 'A closing tag does not match the tag that opened it.';
  if (text.includes('missing root')) return 'The message holds no root element.';
  if (text.includes('only one element') || text.includes('extra content')) {
    return 'The text holds more than one root element, or content after the root element.';
  }
  if (text.includes('redefined')) return 'An attribute is written twice on one element.';
  if (text.includes('namespace') || text.includes('prefix'))
    return 'A namespace prefix is used without being declared.';
  if (text.includes('entity')) return 'A reference to a named character or entity cannot be read here.';
  if (text.includes('comment')) return 'A comment is not written correctly.';
  if (text.includes('tagname') || text.includes('tag name')) {
    return 'A tag name is not valid, or a less-than sign stands in the text.';
  }
  if (text.includes('attribute') || text.includes('quot')) return 'An attribute value is not written correctly.';
  return 'The XML is not well formed.';
}

function where(event: ReaderEvent): string {
  if (event.line === undefined || event.line < 1) return '';
  return event.column !== undefined && event.column >= 1
    ? ` (line ${event.line}, column ${event.column})`
    : ` (line ${event.line})`;
}

/**
 * Reads the message as namespace-aware XML with `@xmldom/xmldom`. The text has already passed the DOCTYPE and entity
 * refusal and the size pre-scan, so the reader never meets a DTD. Every problem it reports becomes a fixed sentence with a
 * line and column; the first error stops the read.
 */
export function parseSaml(text: string): ParsedSaml {
  const events: ReaderEvent[] = [];
  const parser = new DOMParser({
    locator: true,
    onError: (level, message, context) => {
      const locator = (context as { locator?: { lineNumber?: number; columnNumber?: number } } | undefined)?.locator;
      events.push({ level, message: String(message), line: locator?.lineNumber, column: locator?.columnNumber });
    },
  });
  let document: Document | null = null;
  try {
    document = parser.parseFromString(text, 'text/xml') as unknown as Document;
  } catch {
    document = null;
  }
  const blocking = events.find((event) => event.level === 'error' || event.level === 'fatalError');
  if (blocking || document === null || !document.documentElement) {
    const event = blocking ?? events[0];
    const sentence = event ? describeReaderMessage(event.message) : 'The XML is not well formed.';
    const place = event ? where(event) : '';
    const line = event?.line !== undefined && event.line >= 1 ? event.line : undefined;
    const column = line !== undefined && event?.column !== undefined && event.column >= 1 ? event.column : undefined;
    throw new SamlDecoderError(`${sentence}${place} The message was not read.`, 'message', line, column);
  }
  const warnings = events
    .filter((event) => event.level === 'warning')
    .slice(0, 20)
    .map((event) => `${describeReaderMessage(event.message)}${where(event)} A strict XML reader would refuse this.`);
  return { document, warnings };
}
