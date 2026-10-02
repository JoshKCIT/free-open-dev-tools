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

/** A problem with what was pasted, as opposed to a result: it names the part it is in and where, when libxml2 said. */
export class XsdValidatorError extends Error {
  readonly part: 'schema' | 'document';
  readonly line?: number;
  readonly column?: number;
  /** Every diagnostic libxml2 gave for the problem, warnings included, in the order it gave them. */
  readonly issues: XsdIssue[];

  constructor(
    message: string,
    part: 'schema' | 'document',
    detail: { line?: number; column?: number; issues?: XsdIssue[] } = {},
  ) {
    super(message);
    this.name = 'XsdValidatorError';
    this.part = part;
    this.line = detail.line;
    this.column = detail.column;
    this.issues = detail.issues ?? [];
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
 * A problem libxml2 reported while reading or compiling one of the pasted texts, as an error that names the part
 * and the first real error's position. The warnings that came with it stay available in `issues`.
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

/**
 * Validates `xmlText` against the XML Schema in `schemaText` with libxml2 and lists every error with its line.
 * Returns null when either text is blank, so nothing is shown and no work is done. A DOCTYPE in either text is
 * refused before anything is parsed. Nothing either text names is ever read: the engine's own network and external
 * entity loading are switched off, and no input provider is registered.
 */
export function validateXml(
  engine: Libxml2Engine,
  schemaText: string,
  xmlText: string,
  options: { showWarnings: boolean },
): XsdValidationResult | null {
  if (schemaText.trim() === '' || xmlText.trim() === '') return null;

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
      validator = engine.XsdValidator.fromDoc(schemaDoc);
    } catch (err) {
      if (isLibxmlError(engine, err)) throw inputProblem(err, 'schema');
      throw err;
    }
    try {
      doc = engine.XmlDocument.fromString(xmlText, parse);
    } catch (err) {
      if (isLibxmlError(engine, err)) throw inputProblem(err, 'document');
      throw err;
    }

    const found: XsdIssue[] = doc.warnings.map((detail) => issueFrom(detail, 'document'));
    try {
      validator.validate(doc);
    } catch (err) {
      if (!isLibxmlError(engine, err)) throw err;
      for (const detail of err.details) found.push(issueFrom(detail, 'document'));
    }

    const listed = options.showWarnings ? found : found.filter((issue) => issue.level !== 'warning');
    return {
      valid: !found.some((issue) => issue.level !== 'warning'),
      issues: listed,
      total: listed.length,
      notLoaded: [],
    };
  } finally {
    doc?.dispose();
    validator?.dispose();
    schemaDoc?.dispose();
  }
}
