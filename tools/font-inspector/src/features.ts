import { ByteReader } from './bytes';
import { MAX_FEATURE_RECORDS, MAX_SCRIPT_RECORDS } from './limits';
import { tableBytes, type TableEntry } from './sfnt';

/** Most script and language pairings recorded over all features of one table, so a hostile table costs a fixed amount. */
const MAX_USES = 200_000;

export interface FeatureTable {
  /** The distinct feature tags, sorted. */
  tags: string[];
  /** For each tag, the script and language systems that list it as `script/language`, sorted (`dflt` is a script's default). */
  uses: Map<string, string[]>;
  /** How many feature records the table states, and how many were read. */
  stated: number;
  read: number;
  notes: string[];
}

/**
 * Reads the script list and feature list of a GSUB or GPOS table: which feature tags the font has and which scripts and
 * languages use each. Lookups themselves are not read. Counts are compared with the bytes that remain before they are
 * used, the number of records read is capped, and tags are keys of `Map`s only.
 */
export function readFeatures(bytes: Uint8Array, entry: TableEntry | undefined): FeatureTable | null {
  const data = tableBytes(bytes, entry);
  if (!data) return null;
  const notes: string[] = [];
  if (data.length < 10)
    return {
      tags: [],
      uses: new Map(),
      stated: 0,
      read: 0,
      notes: ['The layout table is too short to hold a header.'],
    };
  const r = new ByteReader(data);
  const scriptList = r.u16(4);
  const featureList = r.u16(6);

  const featureTags: string[] = [];
  let stated = 0;
  if (featureList !== 0 && r.has(featureList, 2)) {
    stated = r.u16(featureList);
    const room = Math.floor((data.length - featureList - 2) / 6);
    const count = Math.min(stated, room, MAX_FEATURE_RECORDS);
    if (stated > room)
      notes.push('The feature list states more features than it has room for; the ones that fit are read.');
    else if (stated > MAX_FEATURE_RECORDS) {
      notes.push(
        `The feature list holds ${stated.toLocaleString('en-US')} features; only the first ${MAX_FEATURE_RECORDS.toLocaleString('en-US')} are read.`,
      );
    }
    for (let i = 0; i < count; i++) featureTags.push(r.tag(featureList + 2 + 6 * i));
  }

  const uses = new Map<string, Set<string>>();
  let recorded = 0;
  const add = (index: number, label: string): void => {
    const tag = featureTags[index];
    if (tag === undefined || recorded >= MAX_USES) return;
    let set = uses.get(tag);
    if (!set) {
      set = new Set();
      uses.set(tag, set);
    }
    if (!set.has(label)) {
      set.add(label);
      recorded++;
    }
  };
  // Every feature index read, listed again or not, is charged here, so language systems that each claim thousands of
  // indexes cost a fixed amount in all.
  let indexReads = MAX_USES;
  let cut = false;
  const readLangSys = (at: number, label: string): void => {
    if (!r.has(at, 6)) return;
    const required = r.u16(at + 2);
    const count = r.u16(at + 4);
    if (required !== 0xffff) add(required, label);
    const fit = Math.min(count, Math.floor((data.length - at - 6) / 2));
    for (let k = 0; k < fit; k++) {
      if (indexReads-- <= 0) {
        cut = true;
        return;
      }
      add(r.u16(at + 6 + 2 * k), label);
    }
  };
  if (scriptList !== 0 && r.has(scriptList, 2)) {
    const scripts = Math.min(r.u16(scriptList), Math.floor((data.length - scriptList - 2) / 6), MAX_SCRIPT_RECORDS);
    let budget = MAX_SCRIPT_RECORDS;
    for (let s = 0; s < scripts; s++) {
      const scriptTag = r.tag(scriptList + 2 + 6 * s);
      const script = scriptList + r.u16(scriptList + 2 + 6 * s + 4);
      if (!r.has(script, 4)) continue;
      const defaultLang = r.u16(script);
      if (defaultLang !== 0) readLangSys(script + defaultLang, `${scriptTag}/dflt`);
      const langs = Math.min(r.u16(script + 2), Math.floor((data.length - script - 4) / 6));
      for (let l = 0; l < langs && budget > 0; l++) {
        budget--;
        const langTag = r.tag(script + 4 + 6 * l);
        readLangSys(script + r.u16(script + 4 + 6 * l + 4), `${scriptTag}/${langTag}`);
      }
    }
    if (budget === 0) notes.push('The script list holds so many languages that only the first were read.');
    if (cut) notes.push('The script list gives its languages so many features that only the first were read.');
  }

  const sortedUses = new Map<string, string[]>();
  for (const [tag, set] of [...uses].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    sortedUses.set(tag, [...set].sort());
  }
  return { tags: [...new Set(featureTags)].sort(), uses: sortedUses, stated, read: featureTags.length, notes };
}
