import { SpfDmarcError } from './errors';
import { LOOKUP_LIMIT } from './limits';
import { checkSpf, type SpfReport } from './spf-check';
import { parseSpf } from './spf-parse';
import { visible } from './visible';

/** A pasted record: the name it was published under (or null) and its text. A TxtRecord fits. */
export interface TreeRecordInput {
  label: string | null;
  text: string;
}

/** One record of the tree, listed in the order it was first reached. */
export interface TreeRow {
  /** The place of the record in the records given, from 0. */
  index: number;
  label: string;
  /** The term that led here, as written, or an empty text for the first record. */
  reachedFrom: string;
  /** The terms of this record that cause lookups. */
  lookups: number;
  /** How many times the record was reached. A record reached twice by different routes is evaluated, and counted, twice. */
  times: number;
  notes: string[];
}

export interface TreeLoop {
  from: string;
  to: string;
}

export interface TreeCount {
  /** The terms that cause lookups along the whole tree, stopping at 11. */
  total: number;
  /** True when the real total could be higher than `total`: a name was not pasted, a name holds a macro, a loop was cut, or the count stopped at 11. */
  lowerBound: boolean;
  /** True when counting stopped at 11, so the total reads 11 or more. */
  stopped: boolean;
  rows: TreeRow[];
  /** The names of includes and redirects that were not pasted, as written, once each. */
  missing: string[];
  loops: TreeLoop[];
  /** The names that hold a macro and were not followed. */
  skipped: string[];
}

const STOP = LOOKUP_LIMIT + 1;
const SHOWN_NAME = 200;

/** A name as it is matched: lower case, one trailing period removed. */
function normalise(name: string): string {
  const lower = name.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

/**
 * Counts the terms that cause DNS lookups along a whole tree of records (RFC 7208 section 4.6.4: the limit counts the terms
 * of the included and redirected records too). The page makes no query, so the tree is followed only through the records
 * that were pasted, matched to the name in an include or a redirect (letter case ignored, one trailing period ignored).
 * A loop is cut at once and named; a name that was not pasted is listed and makes the total a lower bound; counting stops
 * at 11. A record reached by two routes is evaluated twice, so it counts twice.
 */
export function countLookups(records: ReadonlyArray<TreeRecordInput>, mainIndex: number): TreeCount {
  const main = records[mainIndex];
  if (main === undefined) {
    throw new SpfDmarcError('The SPF box holds no record to start from.', 'spf');
  }
  const byLabel = new Map<string, number>();
  records.forEach((record, i) => {
    if (record.label === null) return;
    const key = normalise(record.label);
    if (!byLabel.has(key)) byLabel.set(key, i);
  });
  const reports = new Map<number, SpfReport>();
  const reportOf = (i: number): SpfReport => {
    let report = reports.get(i);
    if (report === undefined) {
      report = checkSpf(parseSpf(records[i]?.text ?? ''));
      reports.set(i, report);
    }
    return report;
  };
  const labelOf = (i: number): string => {
    const label = records[i]?.label ?? null;
    if (label !== null) return visible(label, SHOWN_NAME);
    return i === 0 ? '(first record)' : `(record ${i + 1})`;
  };

  const result: TreeCount = {
    total: 0,
    lowerBound: false,
    stopped: false,
    rows: [],
    missing: [],
    loops: [],
    skipped: [],
  };
  const rowOf = new Map<number, TreeRow>();
  const missingKeys = new Set<string>();
  const loopKeys = new Set<string>();
  const skippedKeys = new Set<string>();

  const visit = (i: number, reachedFrom: string, path: readonly number[]): void => {
    const report = reportOf(i);
    let row = rowOf.get(i);
    if (row === undefined) {
      const notes: string[] = [];
      if (!report.record.isSpf) notes.push('This is not an SPF record, so it adds nothing.');
      else if (report.record.errors.length > 0) {
        notes.push('This record has a syntax error; the terms that read without a problem are counted.');
      }
      row = { index: i, label: labelOf(i), reachedFrom, lookups: report.lookupCount, times: 1, notes };
      rowOf.set(i, row);
      result.rows.push(row);
    } else {
      row.times++;
    }
    for (const lookup of report.lookups) {
      result.total++;
      if (result.total >= STOP) {
        result.stopped = true;
        return;
      }
      if (lookup.kind !== 'include' && lookup.kind !== 'redirect') continue;
      const term = report.record.terms[lookup.termIndex - 1];
      const domain = term?.domain ?? null;
      if (domain === null) continue;
      if (domain.includes('%')) {
        const key = domain.toLowerCase();
        if (!skippedKeys.has(key)) {
          skippedKeys.add(key);
          result.skipped.push(visible(domain, SHOWN_NAME));
        }
        continue;
      }
      const key = normalise(domain);
      const target = byLabel.get(key);
      if (target === undefined) {
        if (!missingKeys.has(key)) {
          missingKeys.add(key);
          result.missing.push(visible(domain, SHOWN_NAME));
        }
        continue;
      }
      if (path.includes(target)) {
        const from = labelOf(i);
        const to = labelOf(target);
        const loopKey = `${from}\n${to}`;
        if (!loopKeys.has(loopKey)) {
          loopKeys.add(loopKey);
          result.loops.push({ from, to });
        }
        continue;
      }
      visit(target, visible(lookup.term, SHOWN_NAME), [...path, target]);
      if (result.stopped) return;
    }
  };

  visit(mainIndex, '', [mainIndex]);
  result.lowerBound =
    result.stopped || result.missing.length > 0 || result.skipped.length > 0 || result.loops.length > 0;
  return result;
}
