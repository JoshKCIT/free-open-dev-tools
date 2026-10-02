import type * as Libxml2 from 'libxml2-wasm';
import { XmlFormatterError } from './errors';
import { DOCTYPE_REFUSAL_MESSAGE, findDoctype, positionAt } from './xml-doctype';

/**
 * The libxml2-wasm module, handed in by the caller. This package only imports its types: the engine's WebAssembly
 * sits inside that module, and the page's background worker is the one place that loads it, so the engine is never
 * part of a page chunk and a copy of this folder works with whichever copy of the module the caller installed.
 */
export type Libxml2Engine = typeof Libxml2;

/** Canonical XML 1.0, Exclusive Canonical XML 1.0 or Canonical XML 1.1. */
export type C14nMode = '1.0' | 'exclusive' | '1.1';

export interface C14nOptions {
  mode: C14nMode;
  /** Keep comments in the canonical form (the "WithComments" variants of the recommendations). */
  withComments: boolean;
}

export interface CompareResult {
  equivalent: boolean;
  /** When the documents differ: both canonical forms and the 0-based offset of the first character that differs. */
  first?: { a: string; b: string; offset: number };
}

/** The largest document accepted by the canonical and compare modes, in UTF-8 bytes (10 MiB). */
export const MAX_C14N_BYTES = 10485760;

/**
 * The parse options used for every document the canonical and compare modes read. Internal entities are expanded
 * (there are none a DOCTYPE could declare, since a DOCTYPE is refused first, and the five predefined ones always
 * work), no external entity or DTD is ever loaded, nothing is fetched over a network, lines above 65,535 are counted
 * exactly, and the encoding named in an XML declaration is ignored because pasted text is already text.
 */
export function c14nParseOptions(engine: Libxml2Engine): Libxml2.ParseOption {
  const option = engine.ParseOption;
  return (
    option.XML_PARSE_NOENT |
    option.XML_PARSE_NO_XXE |
    option.XML_PARSE_NONET |
    option.XML_PARSE_BIG_LINES |
    option.XML_PARSE_IGNORE_ENC
  );
}

/** The only words the engine gives when canonicalization fails after a successful parse, with no detail attached. */
const CANONICALIZE_FAILED = 'Failed to canonicalize XML document';

/**
 * Canonical XML 1.0 does not allow a relative URI as a namespace name (section 1.2), and libxml2 2.15.1 reads a name
 * with no scheme (x, foo/bar, /x, ../x) as relative. The engine then says only that canonicalization failed, with no
 * position, so the tool says what it means. A one-letter scheme such as x:y is not named here on purpose: the
 * engine package turns on Windows drive-path handling only when it runs under Node on Windows, so it refuses x:y
 * there and accepts it everywhere else, in a browser included.
 */
const RELATIVE_NAMESPACE_MESSAGE =
  'libxml2 could not canonicalize this XML. One known cause is a namespace name that libxml2 reads as a relative address, such as a name with no scheme (x or foo/bar); Canonical XML does not allow those. Use an absolute name such as urn:x or http://example.com/ns.';

function engineMode(engine: Libxml2Engine, mode: C14nMode): 0 | 1 | 2 {
  if (mode === 'exclusive') return engine.XmlC14NMode.XML_C14N_EXCLUSIVE_1_0;
  if (mode === '1.1') return engine.XmlC14NMode.XML_C14N_1_1;
  return engine.XmlC14NMode.XML_C14N_1_0;
}

function utf8Length(text: string): number {
  // A UTF-16 unit is at most three UTF-8 bytes, so a text that short cannot be over the limit and is not encoded.
  return text.length * 3 <= MAX_C14N_BYTES ? 0 : new TextEncoder().encode(text).length;
}

/**
 * Refuses a document over 10 MiB, counted in UTF-8 bytes, before anything is parsed. The page calls this before it
 * starts a worker, and the canonical functions call it again, so no engine ever sees an oversize text.
 */
export function checkC14nSize(text: string, part?: 'first' | 'second'): void {
  const bytes = utf8Length(text);
  if (bytes > MAX_C14N_BYTES) {
    const which = part === 'first' ? 'first ' : part === 'second' ? 'second ' : '';
    throw new XmlFormatterError(
      `This ${which}document is ${bytes.toLocaleString('en-US')} bytes. The limit is 10 MiB (${MAX_C14N_BYTES.toLocaleString('en-US')} bytes) because the whole document is held in memory while it is canonicalized.`,
      { part },
    );
  }
}

function refuseDoctype(text: string, part?: 'first' | 'second'): void {
  const doctype = findDoctype(text);
  if (doctype) throw new XmlFormatterError(DOCTYPE_REFUSAL_MESSAGE, { ...doctype, part });
}

/**
 * Everything that is refused before an engine is involved: a document over 10 MiB, then a document with a DOCTYPE
 * (so an entity bomb or an external entity is never read). The page calls this before it starts a worker, and the
 * canonical functions call it again, so no engine ever sees such a text.
 */
export function checkC14nInput(text: string, part?: 'first' | 'second'): void {
  checkC14nSize(text, part);
  refuseDoctype(text, part);
}

function parse(engine: Libxml2Engine, text: string, part?: 'first' | 'second'): Libxml2.XmlDocument {
  try {
    return engine.XmlDocument.fromString(text, { option: c14nParseOptions(engine) });
  } catch (err) {
    if (err instanceof engine.XmlLibError) {
      const detail = err.details.find((candidate) => candidate.level >= 2) ?? err.details[0];
      const message = (detail?.message ?? err.message).trim();
      const line = detail && detail.line > 0 ? detail.line : undefined;
      const column = detail && detail.col > 0 ? detail.col : undefined;
      throw new XmlFormatterError(message, { line, column, part });
    }
    throw err;
  }
}

/**
 * The inner function the public path wraps after its DOCTYPE refusal: parses `text` with libxml2 and writes its
 * canonical form. `subtreeXPath` (used only by the tests, for the Exclusive Canonical XML example that
 * canonicalizes one element) selects the element to canonicalize instead of the whole document. The document is
 * disposed before returning.
 */
export function c14nWithEngine(
  engine: Libxml2Engine,
  text: string,
  options: C14nOptions,
  subtreeXPath?: string,
  part?: 'first' | 'second',
): string {
  const doc = parse(engine, text, part);
  try {
    const settings = { mode: engineMode(engine, options.mode), withComments: options.withComments };
    if (subtreeXPath === undefined) return doc.canonicalizeToString(settings);
    const node = doc.get(subtreeXPath);
    if (!node) throw new XmlFormatterError(`Nothing in the document matches ${subtreeXPath}.`);
    return node.canonicalizeToString(settings);
  } catch (err) {
    if (err instanceof XmlFormatterError) throw err;
    if (err instanceof Error && err.message === CANONICALIZE_FAILED) {
      throw new XmlFormatterError(RELATIVE_NAMESPACE_MESSAGE, { part });
    }
    throw err;
  } finally {
    doc.dispose();
  }
}

/**
 * Writes the canonical form of one document: Canonical XML 1.0, Exclusive Canonical XML 1.0 or Canonical XML 1.1,
 * with or without comments, computed by libxml2. A document over 10 MiB or with a DOCTYPE is refused before it is
 * parsed, so an entity bomb or an external entity is never read; nothing a document names is ever loaded.
 */
export function canonicalizeXml(engine: Libxml2Engine, text: string, options: C14nOptions): string {
  checkC14nInput(text);
  return c14nWithEngine(engine, text, options);
}

/** The 0-based offset of the first character at which two strings differ, or -1 when they are equal. */
function firstDifference(a: string, b: string): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) return i;
  }
  return a.length === b.length ? -1 : shared;
}

/** The 1-based line and column of an offset in a canonical form, for the page's message. */
export function positionInCanonical(text: string, offset: number): { line: number; column: number } {
  return positionAt(text, offset);
}

/**
 * Says whether two documents are equivalent once both are canonicalized in the same mode, comments excluded. The
 * canonical form normalizes attribute order, quote style, empty-element form, whitespace inside tags and the spelling
 * of character and entity references. It does not normalize whitespace between elements or the choice of namespace
 * prefix, so documents that differ only in those are reported as different. A document over 10 MiB or with a DOCTYPE
 * is refused before parsing, naming which one.
 */
export function compareXml(
  engine: Libxml2Engine,
  first: string,
  second: string,
  options: { mode: C14nMode },
): CompareResult {
  checkC14nInput(first, 'first');
  checkC14nInput(second, 'second');
  const settings = { mode: options.mode, withComments: false };
  const a = c14nWithEngine(engine, first, settings, undefined, 'first');
  const b = c14nWithEngine(engine, second, settings, undefined, 'second');
  const offset = firstDifference(a, b);
  if (offset === -1) return { equivalent: true };
  return { equivalent: false, first: { a, b, offset } };
}
