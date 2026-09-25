import meta from './meta.json';
import { parseAllDocuments, visit, isAlias, isMap, isScalar, isSeq, LineCounter } from 'yaml';

export { meta };

export type YamlFormatterMode = 'format' | 'check';

export interface FormatYamlOptions {
  /** 'format' (default) reformats the document; 'check' only reports. */
  mode?: YamlFormatterMode;
  /** Spaces per indent level in format mode. Default 2. */
  indent?: number;
  /** Soft line-wrap width in format mode; 0 disables folding. Default 80. */
  lineWidth?: number;
}

export type AnchorKind = 'scalar' | 'mapping' | 'sequence';

export interface AnchorInfo {
  name: string;
  line: number;
  column: number;
  kind: AnchorKind;
  aliasCount: number;
}

export interface AliasInfo {
  name: string;
  line: number;
  column: number;
}

export interface DuplicateKeyInfo {
  key: string;
  line: number;
  column: number;
  firstLine: number;
  firstColumn: number;
}

export interface FormatYamlResult {
  /** The reformatted document in format mode; an empty string in check mode. */
  output: string;
  documents: number;
  anchors: AnchorInfo[];
  aliases: AliasInfo[];
  duplicates: DuplicateKeyInfo[];
  warnings: string[];
}

export class YamlFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'YamlFormatterError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

const ALIAS_BOMB_MESSAGE =
  'This document uses YAML aliases that expand into too much data, so it was refused rather than risk freezing the tab.';

const DUPLICATE_KEY_MESSAGE =
  'This document has a duplicate mapping key, so it was refused rather than guess which occurrence to keep.';

/**
 * True for the ReferenceError yaml's own alias resolution throws when an
 * alias points at an anchor that was never defined -- distinct from the
 * alias-bomb ReferenceError below, and never a reason to refuse the whole
 * document, since this tool already reports the dangling alias itself.
 */
function isUnresolvedAliasError(err: unknown): boolean {
  return err instanceof ReferenceError && err.message.startsWith('Unresolved alias');
}

/** True for the ReferenceError yaml's own alias resolution throws once resolving would expand past maxAliasCount. */
function isAliasBombError(err: unknown): boolean {
  return (
    err instanceof ReferenceError &&
    (err.message.includes('Excessive alias count') || err.message.includes('Alias resolution is disabled'))
  );
}

function nodeKind(node: unknown): AnchorKind | undefined {
  if (isMap(node)) return 'mapping';
  if (isSeq(node)) return 'sequence';
  if (isScalar(node)) return 'scalar';
  return undefined;
}

interface RangedNode {
  range?: [number, number, number];
}

interface AnchoredNode extends RangedNode {
  anchor?: string;
}

/**
 * Walks one parsed document once, collecting every anchor (with its kind
 * and, once every alias is seen, how many aliases point at it), every
 * alias (including one whose anchor is never defined -- reported as a
 * warning rather than thrown, since yaml's own alias resolution would
 * otherwise abort the whole document for a single dangling alias), and
 * every duplicate mapping key found by walking each mapping's own pairs in
 * document order (the same first-occurrence-wins order yaml's own
 * uniqueKeys check encounters them in).
 */
function scanDocument(
  doc: ReturnType<typeof parseAllDocuments>[number],
  lc: LineCounter,
): { anchors: AnchorInfo[]; aliases: AliasInfo[]; duplicates: DuplicateKeyInfo[]; warnings: string[] } {
  const anchors: AnchorInfo[] = [];
  const aliases: AliasInfo[] = [];
  const duplicates: DuplicateKeyInfo[] = [];
  const warnings: string[] = [];

  visit(doc, (_key, node) => {
    if (node == null) return;

    if (isAlias(node)) {
      const range = (node as RangedNode).range;
      const pos = range ? lc.linePos(range[0]) : { line: 0, col: 0 };
      aliases.push({ name: node.source, line: pos.line, column: pos.col });
      return;
    }

    const anchored = node as AnchoredNode;
    if (typeof anchored.anchor === 'string' && anchored.anchor.length > 0) {
      const pos = anchored.range ? lc.linePos(anchored.range[0]) : { line: 0, col: 0 };
      const kind = nodeKind(node);
      if (kind) {
        anchors.push({ name: anchored.anchor, line: pos.line, column: pos.col, kind, aliasCount: 0 });
      }
    }

    if (isMap(node)) {
      const seen = new Map<string, { line: number; column: number }>();
      for (const pair of node.items) {
        if (!isScalar(pair.key)) continue;
        const text = String(pair.key.value);
        const keyRange = (pair.key as RangedNode).range;
        if (!keyRange) continue;
        const pos = lc.linePos(keyRange[0]);
        const first = seen.get(text);
        if (first) {
          duplicates.push({
            key: text,
            line: pos.line,
            column: pos.col,
            firstLine: first.line,
            firstColumn: first.column,
          });
        } else {
          seen.set(text, { line: pos.line, column: pos.col });
        }
      }
    }
  });

  const anchorByName = new Map(anchors.map((a) => [a.name, a]));
  for (const alias of aliases) {
    const anchor = anchorByName.get(alias.name);
    if (anchor) {
      anchor.aliasCount += 1;
    } else {
      warnings.push(`Alias "${alias.name}" (line ${alias.line}) has no matching anchor.`);
    }
  }

  return { anchors, aliases, duplicates, warnings };
}

/**
 * Parses a YAML 1.2 stream (one or more documents), reporting anchors,
 * aliases and duplicate mapping keys throughout. In `format` mode returns
 * each document reformatted, keeping comments and flow/block styles; a
 * document with a duplicate mapping key is refused rather than guessing
 * which occurrence to keep, since YAML 1.2 requires mapping keys to be
 * unique. In `check` mode the document is never rewritten, only reported
 * on, and `output` is an empty string.
 */
export function formatYaml(source: string, options: FormatYamlOptions = {}): FormatYamlResult {
  const { mode = 'format', indent = 2, lineWidth = 80 } = options;

  const lc = new LineCounter();
  const docs = parseAllDocuments(source, {
    uniqueKeys: true,
    logLevel: 'error',
    prettyErrors: false,
    lineCounter: lc,
  });

  if (docs.length === 0) {
    return { output: '', documents: 0, anchors: [], aliases: [], duplicates: [], warnings: [] };
  }

  const anchors: AnchorInfo[] = [];
  const aliases: AliasInfo[] = [];
  const duplicates: DuplicateKeyInfo[] = [];
  const warnings: string[] = [];

  for (const doc of docs) {
    const nonDuplicateErrors = doc.errors.filter((e) => e.code !== 'DUPLICATE_KEY');
    if (nonDuplicateErrors.length > 0) {
      const err = nonDuplicateErrors[0]!;
      const pos = lc.linePos(err.pos[0]);
      throw new YamlFormatterError(err.message, { line: pos.line, column: pos.col });
    }

    const scan = scanDocument(doc, lc);
    anchors.push(...scan.anchors);
    aliases.push(...scan.aliases);
    duplicates.push(...scan.duplicates);
    warnings.push(...scan.warnings);
    warnings.push(...doc.warnings.map((w) => w.message));

    try {
      doc.toJS({ maxAliasCount: 100 });
    } catch (err) {
      if (isAliasBombError(err)) throw new YamlFormatterError(ALIAS_BOMB_MESSAGE);
      if (isUnresolvedAliasError(err)) {
        // Already reported by scanDocument's own warning above.
      } else {
        throw err;
      }
    }
  }

  if (mode === 'check') {
    return { output: '', documents: docs.length, anchors, aliases, duplicates, warnings };
  }

  if (duplicates.length > 0) {
    const first = duplicates[0]!;
    throw new YamlFormatterError(DUPLICATE_KEY_MESSAGE, { line: first.line, column: first.column });
  }

  const output = docs.map((doc) => doc.toString({ indent, lineWidth })).join('---\n');
  return { output, documents: docs.length, anchors, aliases, duplicates, warnings };
}
