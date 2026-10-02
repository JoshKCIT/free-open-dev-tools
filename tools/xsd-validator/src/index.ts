import meta from './meta.json';
import type * as Libxml2 from 'libxml2-wasm';
import { findDoctype, DOCTYPE_REFUSAL_MESSAGE } from './xml-doctype';

export { meta };

/**
 * The libxml2-wasm module, handed in by the caller. This package only imports its types: the engine's WebAssembly
 * sits inside that module, and the page's background worker is the one place that loads it, so the engine is never
 * part of a page chunk and a copy of this folder works with whichever copy of the module the caller installed.
 */
export type Libxml2Engine = typeof Libxml2;

/** The largest document accepted, in UTF-8 bytes (10 MiB). */
export const MAX_INSTANCE_BYTES = 10485760;
/** The largest schema accepted, in UTF-8 bytes (2 MiB). */
export const MAX_SCHEMA_BYTES = 2097152;
/** At most this many errors are listed; the total is still counted. */
export const MAX_LISTED_ISSUES = 200;

/** A problem with what was pasted, as opposed to a result: it names the part it is in and where, when libxml2 said. */
export class XsdValidatorError extends Error {
  readonly part: 'schema' | 'document';
  readonly line?: number;
  readonly column?: number;
  /** Every diagnostic libxml2 gave for the problem, warnings included, in the order it gave them. */
  readonly issues: XsdIssue[];
  /** The locations the schema names that were not loaded, when the problem is in a schema that could be read. */
  readonly notLoaded: NotLoadedReference[];

  constructor(
    message: string,
    part: 'schema' | 'document',
    detail: { line?: number; column?: number; issues?: XsdIssue[]; notLoaded?: NotLoadedReference[] } = {},
  ) {
    super(message);
    this.name = 'XsdValidatorError';
    this.part = part;
    this.line = detail.line;
    this.column = detail.column;
    this.issues = detail.issues ?? [];
    this.notLoaded = detail.notLoaded ?? [];
  }
}

export interface XsdIssue {
  level: 'warning' | 'error' | 'fatal';
  message: string;
  /** 1-based line of the pasted text; absent when libxml2 gave none. */
  line?: number;
  /** 1-based column; only well-formedness errors have one, validation errors do not. */
  column?: number;
  part: 'schema' | 'document';
}

export interface XsdValidationResult {
  valid: boolean;
  issues: XsdIssue[];
  total: number;
  notLoaded: NotLoadedReference[];
}

export interface NotLoadedReference {
  kind: 'import' | 'include' | 'redefine' | 'override';
  location: string;
  line: number;
}

/**
 * The parse options used for every XML text this package reads: no external entity is ever loaded, nothing is
 * fetched over a network, and lines above 65,535 are counted exactly.
 */
export function xmlParseOptions(engine: Libxml2Engine): Libxml2.ParseOption {
  const option = engine.ParseOption;
  return option.XML_PARSE_NO_XXE | option.XML_PARSE_NONET | option.XML_PARSE_BIG_LINES;
}

const LEVELS = ['warning', 'error', 'fatal'] as const;

/** libxml2 ends its messages with a newline; the page shows the sentence only. */
function issueFrom(detail: Libxml2.ErrorDetail, part: 'schema' | 'document'): XsdIssue {
  const issue: XsdIssue = {
    level: LEVELS[Math.min(Math.max(detail.level, 1), 3) - 1] ?? 'error',
    message: detail.message.trim(),
    part,
  };
  if (detail.line > 0) issue.line = detail.line;
  if (detail.col > 0) issue.column = detail.col;
  return issue;
}

function isLibxmlError(engine: Libxml2Engine, err: unknown): err is Libxml2.XmlLibError {
  return err instanceof engine.XmlLibError;
}

/**
 * A problem libxml2 reported while reading one of the pasted texts, as an error that names the part and the first
 * real error's position. The warnings that came with it stay available in `issues`.
 */
function inputProblem(err: Libxml2.XmlLibError, part: 'schema' | 'document'): XsdValidatorError {
  const issues = err.details.map((detail) => issueFrom(detail, part));
  const first = issues.find((issue) => issue.level !== 'warning') ?? issues[0];
  return new XsdValidatorError(first?.message ?? err.message.trim(), part, {
    line: first?.line,
    column: first?.column,
    issues,
  });
}

const XML_SCHEMA_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';
const REFERENCE_KINDS = ['import', 'include', 'redefine', 'override'] as const;

/**
 * Every xs:import, xs:include, xs:redefine and xs:override that names a location, found with a namespace-aware
 * query through the engine (never a pattern over the text). They are listed, never loaded.
 */
function findNotLoaded(engine: Libxml2Engine, schemaDoc: Libxml2.XmlDocument): NotLoadedReference[] {
  const found: NotLoadedReference[] = [];
  const query = REFERENCE_KINDS.map((kind) => `//xs:${kind}`).join(' | ');
  for (const node of schemaDoc.find(query, { xs: XML_SCHEMA_NAMESPACE })) {
    if (!(node instanceof engine.XmlElement)) continue;
    const kind = REFERENCE_KINDS.find((candidate) => candidate === node.name);
    const location = node.attr('schemaLocation')?.value;
    if (kind && location) found.push({ kind, location, line: node.line });
  }
  return found;
}

/** The plain sentence for a schema problem that comes from a location libxml2 was never allowed to load. */
function plainReferenceProblem(
  detail: Libxml2.ErrorDetail,
  notLoaded: NotLoadedReference[],
): { message: string; line: number } | null {
  if (detail.level < 2) return null;
  for (const ref of notLoaded) {
    if (ref.kind === 'include' && detail.message.includes(`'${ref.location}' for inclusion`)) {
      return {
        message: `This schema includes ${ref.location}, which is not loaded. Paste the included declarations into the schema to use them.`,
        line: ref.line,
      };
    }
    if (ref.kind === 'redefine' && detail.message.includes(`'${ref.location}' for redefinition`)) {
      return {
        message: `This schema redefines declarations from ${ref.location}, which is not loaded. Paste the redefined declarations into the schema to use them.`,
        line: ref.line,
      };
    }
    if (ref.kind === 'override' && /override$/.test(detail.xpath ?? '')) {
      return {
        message: `This schema overrides declarations from ${ref.location}, which is not loaded and which libxml2 does not read (xs:override is XML Schema 1.1). Paste the overridden declarations into the schema to use them.`,
        line: ref.line,
      };
    }
  }
  return null;
}

/** A problem libxml2 reported while compiling the schema, with the plain sentences for locations never loaded. */
function schemaProblem(err: Libxml2.XmlLibError, notLoaded: NotLoadedReference[]): XsdValidatorError {
  const issues = err.details.map((detail) => {
    const issue = issueFrom(detail, 'schema');
    const plain = plainReferenceProblem(detail, notLoaded);
    if (plain) {
      issue.message = plain.message;
      issue.line = plain.line;
    }
    return issue;
  });
  const first = issues.find((issue) => issue.level !== 'warning') ?? issues[0];
  return new XsdValidatorError(first?.message ?? err.message.trim(), 'schema', {
    line: first?.line,
    column: first?.column,
    issues,
    notLoaded,
  });
}

function utf8Length(text: string, limit: number): number {
  // A UTF-16 unit is at most three UTF-8 bytes, so a text that short cannot be over the limit and is not encoded.
  return text.length * 3 <= limit ? 0 : new TextEncoder().encode(text).length;
}

function sizeProblem(part: 'schema' | 'document', bytes: number, limit: number, limitName: string): XsdValidatorError {
  const verb = part === 'schema' ? 'compiled' : 'checked';
  return new XsdValidatorError(
    `This ${part} is ${bytes.toLocaleString('en-US')} bytes. The limit is ${limitName} (${limit.toLocaleString('en-US')} bytes) because the whole ${part} is held in memory while it is ${verb}.`,
    part,
  );
}

/**
 * Refuses a schema over 2 MiB or a document over 10 MiB, counted in UTF-8 bytes, before anything is parsed. The page
 * calls this before it starts a worker, and `validateXml` calls it again, so no engine ever sees an oversize text.
 */
export function checkInputSizes(schemaText: string, xmlText: string): void {
  const schemaBytes = utf8Length(schemaText, MAX_SCHEMA_BYTES);
  if (schemaBytes > MAX_SCHEMA_BYTES) throw sizeProblem('schema', schemaBytes, MAX_SCHEMA_BYTES, '2 MiB');
  const xmlBytes = utf8Length(xmlText, MAX_INSTANCE_BYTES);
  if (xmlBytes > MAX_INSTANCE_BYTES) throw sizeProblem('document', xmlBytes, MAX_INSTANCE_BYTES, '10 MiB');
}

/**
 * Validates `xmlText` against the XML Schema in `schemaText` with libxml2 and lists every error with its line.
 * Returns null when either text is blank, so nothing is shown and no work is done. A text over its size limit, or
 * with a DOCTYPE, is refused before anything is parsed. Nothing either text names is ever read: the engine's own
 * network and external entity loading are switched off, no input provider is registered, and the locations a schema
 * names are listed as not loaded.
 */
export function validateXml(
  engine: Libxml2Engine,
  schemaText: string,
  xmlText: string,
  options: { showWarnings: boolean },
): XsdValidationResult | null {
  if (schemaText.trim() === '' || xmlText.trim() === '') return null;
  checkInputSizes(schemaText, xmlText);

  const schemaDoctype = findDoctype(schemaText);
  if (schemaDoctype) {
    throw new XsdValidatorError(DOCTYPE_REFUSAL_MESSAGE, 'schema', {
      line: schemaDoctype.line,
      column: schemaDoctype.column,
    });
  }
  const xmlDoctype = findDoctype(xmlText);
  if (xmlDoctype) {
    throw new XsdValidatorError(DOCTYPE_REFUSAL_MESSAGE, 'document', {
      line: xmlDoctype.line,
      column: xmlDoctype.column,
    });
  }

  const parse = { option: xmlParseOptions(engine) };
  let schemaDoc: Libxml2.XmlDocument | null = null;
  let validator: Libxml2.XsdValidator | null = null;
  let doc: Libxml2.XmlDocument | null = null;
  try {
    try {
      schemaDoc = engine.XmlDocument.fromString(schemaText, parse);
    } catch (err) {
      if (isLibxmlError(engine, err)) throw inputProblem(err, 'schema');
      throw err;
    }
    const notLoaded = findNotLoaded(engine, schemaDoc);
    try {
      validator = engine.XsdValidator.fromDoc(schemaDoc);
    } catch (err) {
      if (isLibxmlError(engine, err)) throw schemaProblem(err, notLoaded);
      throw err;
    }
    try {
      doc = engine.XmlDocument.fromString(xmlText, parse);
    } catch (err) {
      if (isLibxmlError(engine, err)) throw inputProblem(err, 'document');
      throw err;
    }

    const found: XsdIssue[] = [
      ...schemaDoc.warnings.map((detail) => issueFrom(detail, 'schema')),
      ...doc.warnings.map((detail) => issueFrom(detail, 'document')),
    ];
    try {
      validator.validate(doc);
    } catch (err) {
      if (!isLibxmlError(engine, err)) throw err;
      for (const detail of err.details) found.push(issueFrom(detail, 'document'));
    }

    const listed = options.showWarnings ? found : found.filter((issue) => issue.level !== 'warning');
    return {
      valid: !found.some((issue) => issue.level !== 'warning'),
      issues: listed.slice(0, MAX_LISTED_ISSUES),
      total: listed.length,
      notLoaded,
    };
  } finally {
    doc?.dispose();
    validator?.dispose();
    schemaDoc?.dispose();
  }
}
