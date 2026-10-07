import { addFinding, SourceMapError, type Finding } from './errors';
import { parseSections } from './index-map';
import { MAX_FINDINGS, MAX_NAMES_AND_SOURCES, withCommas } from './limits';

/** A map in the ordinary form: one `mappings` string over a list of sources. */
export interface ParsedMap {
  kind: 'map';
  /** What the map is called on the page: a number or an opened file's name. */
  label: string;
  /** The `file` field: the generated file the map says it belongs to, or null. */
  file: string | null;
  /** The `sources` entries with the `sourceRoot` put in front as ECMA-426 5.2 says. Shown as text, never fetched. */
  sources: (string | null)[];
  sourcesContent: (string | null)[];
  names: string[];
  mappings: string;
  /** Indexes into `sources` that the map's ignore list names. */
  ignored: ReadonlySet<number>;
  findings: Finding[];
  /** The size of the map text in bytes. */
  bytes: number;
  /** False when the map cannot be read at all (not JSON, no `sources` list or no `mappings` string). */
  usable: boolean;
}

/** One section of an index map: the offset where its map starts and the map itself, which inherits nothing. */
export interface IndexSection {
  line: number;
  column: number;
  map: ParsedMap;
}

/** A map made of sections (ECMA-426 section 6). */
export interface ParsedIndexMap {
  kind: 'index';
  label: string;
  file: string | null;
  sections: IndexSection[];
  findings: Finding[];
  bytes: number;
  usable: boolean;
}

export type AnyMap = ParsedMap | ParsedIndexMap;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Reads an own property, so a key such as constructor or __proto__ never finds something on the prototype. */
function own(object: Json, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function emptyMap(label: string, bytes: number, findings: Finding[]): ParsedMap {
  return {
    kind: 'map',
    label,
    file: null,
    sources: [],
    sourcesContent: [],
    names: [],
    mappings: '',
    ignored: new Set(),
    findings,
    bytes,
    usable: false,
  };
}

/** The sources prefix of ECMA-426 5.2: the sourceRoot up to its last slash, or the sourceRoot and a slash. */
function sourcePrefix(root: string): string {
  const slash = root.lastIndexOf('/');
  return slash === -1 ? root + '/' : root.slice(0, slash + 1);
}

/** A list field that holds strings (and, when `allowNull`, nulls). Faults are findings and the entry becomes null or ''. */
function stringList(json: Json, key: string, allowNull: boolean, findings: Finding[], map: number): (string | null)[] {
  const value = own(json, key);
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    addFinding(findings, 'warn', `${key} is not a list.`);
    return [];
  }
  if (value.length > MAX_NAMES_AND_SOURCES) {
    throw new SourceMapError(
      `Map ${map} has ${withCommas(value.length)} entries in ${key}. The limit is ${withCommas(MAX_NAMES_AND_SOURCES)} entries in sources and names together.`,
      'maps',
      { map },
    );
  }
  const out: (string | null)[] = new Array<string | null>(value.length);
  for (let i = 0; i < value.length; i++) {
    const item: unknown = value[i];
    if (typeof item === 'string') out[i] = item;
    else {
      if (!(allowNull && item === null))
        addFinding(findings, 'warn', `Entry ${i + 1} of ${key} is not a string${allowNull ? ' or null' : ''}.`);
      out[i] = allowNull ? null : '';
    }
  }
  return out;
}

/** Reads one map of the ordinary form (`json` is a parsed object). Faults are findings. */
function readOrdinary(json: Json, label: string, bytes: number, map: number): ParsedMap {
  const findings: Finding[] = [];
  const version = own(json, 'version');
  if (version !== 3)
    addFinding(
      findings,
      'warn',
      version === undefined ? 'The version field is missing; it must be 3.' : 'The version field is not 3.',
    );
  const mappings = own(json, 'mappings');
  if (typeof mappings !== 'string') {
    addFinding(findings, 'error', 'The mappings field is not a string.');
    return emptyMap(label, bytes, findings);
  }
  const rawSources = own(json, 'sources');
  if (!Array.isArray(rawSources)) {
    addFinding(findings, 'error', 'The sources field is not a list.');
    return emptyMap(label, bytes, findings);
  }
  const sources = stringList(json, 'sources', true, findings, map);
  const sourcesContent = stringList(json, 'sourcesContent', true, findings, map);
  const names = stringList(json, 'names', false, findings, map) as string[];
  if (sources.length + names.length > MAX_NAMES_AND_SOURCES) {
    throw new SourceMapError(
      `Map ${map} has ${withCommas(sources.length + names.length)} entries in sources and names together. The limit is ${withCommas(MAX_NAMES_AND_SOURCES)}.`,
      'maps',
      { map },
    );
  }
  const fileField = own(json, 'file');
  let file: string | null = null;
  if (fileField !== undefined) {
    if (typeof fileField === 'string') file = fileField;
    else addFinding(findings, 'warn', 'The file field is not a string.');
  }
  const rootField = own(json, 'sourceRoot');
  let prefix = '';
  if (rootField !== undefined) {
    if (typeof rootField !== 'string') addFinding(findings, 'warn', 'The sourceRoot field is not a string.');
    // An empty sourceRoot adds nothing: read literally, ECMA-426 5.2 would put a slash in front of every source.
    else if (rootField !== '') prefix = sourcePrefix(rootField);
  }
  const joined = prefix === '' ? sources : sources.map((source) => (source === null ? null : prefix + source));

  const ignored = new Set<number>();
  const listField = own(json, 'ignoreList');
  const listKey = listField !== undefined ? 'ignoreList' : 'x_google_ignoreList';
  const list = listField !== undefined ? listField : own(json, 'x_google_ignoreList');
  if (list !== undefined) {
    if (!Array.isArray(list)) addFinding(findings, 'warn', `The ${listKey} field is not a list.`);
    else {
      for (let i = 0; i < list.length && i < MAX_NAMES_AND_SOURCES; i++) {
        const item: unknown = list[i];
        if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) {
          addFinding(findings, 'warn', `Entry ${i + 1} of ${listKey} is not a whole number from 0 up.`);
        } else if (item >= sources.length) {
          addFinding(findings, 'warn', `Entry ${i + 1} of ${listKey} points past the end of sources.`);
        } else ignored.add(item);
      }
    }
  }
  return {
    kind: 'map',
    label,
    file,
    sources: joined,
    sourcesContent,
    names,
    mappings,
    ignored,
    findings,
    bytes,
    usable: true,
  };
}

/**
 * Reads the text of one map. Anything wrong with it is a finding, never a thrown error: `JSON.parse` messages are
 * replaced by one fixed sentence. Only a map that is too big for the page to hold (more than 1,000,000 entries in
 * sources and names, more than 20,000 sections) is refused with an error that names the map number.
 *
 * `number` is the map's place among the maps given (from 1), used only in refusals.
 */
export function parseMap(text: string, label: string, number = 1, bytes: number = text.length): AnyMap {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const findings: Finding[] = [];
    addFinding(findings, 'error', 'The text is not valid JSON.');
    return emptyMap(label, bytes, findings);
  }
  if (!isObject(json)) {
    const findings: Finding[] = [];
    addFinding(findings, 'error', 'The map is not a JSON object.');
    return emptyMap(label, bytes, findings);
  }
  return Object.hasOwn(json, 'sections')
    ? parseSections(json, label, bytes, number, (inner, innerLabel) => readOrdinary(inner, innerLabel, 0, number))
    : readOrdinary(json, label, bytes, number);
}

/**
 * Every finding of a map and its sections, in order, with a section's findings starting with the section's name.
 * Holds at most MAX_FINDINGS entries, the last of which says how many were left out.
 */
export function collectFindings(map: AnyMap): Finding[] {
  const out: Finding[] = [];
  let left = 0;
  const push = (finding: Finding): void => {
    if (out.length < MAX_FINDINGS) out.push(finding);
    else left++;
  };
  for (const finding of map.findings) push(finding);
  if (map.kind === 'index') {
    for (let i = 0; i < map.sections.length; i++) {
      const section = map.sections[i];
      if (!section) continue;
      for (const finding of section.map.findings)
        push({ level: finding.level, message: `Section ${i + 1}: ${finding.message}` });
    }
  }
  if (left > 0) out.push({ level: 'warn', message: `${withCommas(left)} more findings were left out.` });
  return out;
}
