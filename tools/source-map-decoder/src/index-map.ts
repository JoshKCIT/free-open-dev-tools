import { addFinding, SourceMapError, type Finding } from './errors';
import { MAX_POSITION, MAX_SECTIONS, withCommas } from './limits';
import type { ParsedIndexMap, ParsedMap } from './parse-map';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own(object: Json, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function wholeNumberInRange(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_POSITION;
}

/**
 * Reads an index map (ECMA-426 section 6; `json` holds a `sections` field). Each section's map is read by `readSub` and
 * inherits nothing from the index map. The rules the strict reader enforces: `sections` is a list of at most 20,000
 * entries; each entry has an `offset` with whole-number `line` and `column` from 0 to 4,294,967,295 and a `map` object;
 * offsets strictly increase (equal offsets are refused: the suite's overlap case); there is no top level `mappings`;
 * and a section's map is not itself an index map. Faults are findings; only too many sections are refused.
 */
export function parseSections(
  json: Json,
  label: string,
  bytes: number,
  map: number,
  readSub: (inner: Json, label: string) => ParsedMap,
): ParsedIndexMap {
  const findings: Finding[] = [];
  const result: ParsedIndexMap = { kind: 'index', label, file: null, sections: [], findings, bytes, usable: true };
  const sections = own(json, 'sections');
  if (!Array.isArray(sections)) {
    addFinding(findings, 'error', 'The sections field is not a list.');
    result.usable = false;
    return result;
  }
  if (sections.length > MAX_SECTIONS) {
    throw new SourceMapError(
      `Map ${map} has ${withCommas(sections.length)} sections. The limit is ${withCommas(MAX_SECTIONS)} sections.`,
      'maps',
      { map },
    );
  }
  if (own(json, 'version') !== 3) addFinding(findings, 'warn', 'The version field is missing or not 3.');
  const fileField = own(json, 'file');
  if (fileField !== undefined) {
    if (typeof fileField === 'string') result.file = fileField;
    else addFinding(findings, 'warn', 'The file field is not a string.');
  }
  if (Object.hasOwn(json, 'mappings')) {
    addFinding(findings, 'error', 'An index map must not also have a top level mappings field.');
  }
  let previousLine = -1;
  let previousColumn = -1;
  for (let i = 0; i < sections.length; i++) {
    const section: unknown = sections[i];
    const where = `Section ${i + 1}`;
    if (!isObject(section)) {
      addFinding(findings, 'error', `${where} is not an object.`);
      continue;
    }
    const offset = own(section, 'offset');
    if (!isObject(offset)) {
      addFinding(findings, 'error', `${where} has no offset object.`);
      continue;
    }
    const line = own(offset, 'line');
    const column = own(offset, 'column');
    if (!wholeNumberInRange(line)) {
      addFinding(
        findings,
        'error',
        `${where} has an offset line that is not a whole number from 0 to ${withCommas(MAX_POSITION)}.`,
      );
      continue;
    }
    if (!wholeNumberInRange(column)) {
      addFinding(
        findings,
        'error',
        `${where} has an offset column that is not a whole number from 0 to ${withCommas(MAX_POSITION)}.`,
      );
      continue;
    }
    const inner = own(section, 'map');
    if (!isObject(inner)) {
      addFinding(findings, 'error', `${where} has no map object.`);
      continue;
    }
    if (line < previousLine || (line === previousLine && column <= previousColumn)) {
      addFinding(
        findings,
        'error',
        `${where} does not start after the section before it; offsets must strictly increase.`,
      );
    }
    previousLine = line;
    previousColumn = column;
    if (Object.hasOwn(inner, 'sections')) {
      addFinding(findings, 'error', `${where} holds an index map; nested index maps are not read.`);
      continue;
    }
    result.sections.push({ line, column, map: readSub(inner, `${label} section ${i + 1}`) });
  }
  return result;
}

/**
 * The section that holds the zero based generated position (line, column): the last one whose offset is at or before
 * it, found by binary search. Returns -1 when the position is before the first section. The sections are never
 * expanded line by line, so an offset of billions of lines costs nothing.
 */
export function sectionAt(map: ParsedIndexMap, line: number, column: number): number {
  const sections = map.sections;
  let low = 0;
  let high = sections.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const section = sections[middle];
    if (!section) break;
    if (section.line < line || (section.line === line && section.column <= column)) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}
