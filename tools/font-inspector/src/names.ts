import { ByteReader } from './bytes';
import { MAX_LICENCE_CHARS, MAX_NAME_DECODE_BYTES, MAX_NAME_RECORDS } from './limits';

/** The name IDs the OpenType specification defines (0 to 25), by the plain label the page shows. */
export const NAME_ID_LABELS: ReadonlyMap<number, string> = new Map([
  [0, 'Copyright notice'],
  [1, 'Family'],
  [2, 'Subfamily'],
  [3, 'Unique identifier'],
  [4, 'Full name'],
  [5, 'Version'],
  [6, 'PostScript name'],
  [7, 'Trademark'],
  [8, 'Manufacturer'],
  [9, 'Designer'],
  [10, 'Description'],
  [11, 'Vendor address'],
  [12, 'Designer address'],
  [13, 'Licence description'],
  [14, 'Licence address'],
  [15, 'Reserved'],
  [16, 'Typographic family'],
  [17, 'Typographic subfamily'],
  [18, 'Compatible full name (Mac)'],
  [19, 'Sample text'],
  [20, 'PostScript CID name'],
  [21, 'WWS family'],
  [22, 'WWS subfamily'],
  [23, 'Light background palette'],
  [24, 'Dark background palette'],
  [25, 'Variations PostScript name prefix'],
]);

/** A few common Windows language identifiers, so a record reads as a language and not only a number. */
const WINDOWS_LANGUAGES: ReadonlyMap<number, string> = new Map([
  [0x0409, 'en-US'],
  [0x0809, 'en-GB'],
  [0x0c09, 'en-AU'],
  [0x0407, 'de-DE'],
  [0x040c, 'fr-FR'],
  [0x0c0a, 'es-ES'],
  [0x040a, 'es-ES (traditional)'],
  [0x0410, 'it-IT'],
  [0x0413, 'nl-NL'],
  [0x0416, 'pt-BR'],
  [0x0816, 'pt-PT'],
  [0x0419, 'ru-RU'],
  [0x0411, 'ja-JP'],
  [0x0412, 'ko-KR'],
  [0x0804, 'zh-CN'],
  [0x0404, 'zh-TW'],
  [0x041d, 'sv-SE'],
  [0x0415, 'pl-PL'],
  [0x041f, 'tr-TR'],
]);

export interface NameRecord {
  platform: number;
  encoding: number;
  /** The language identifier exactly as the record states it. */
  language: number;
  /** A short label for the language: a known tag, a language tag from a version 1 table, or the number. */
  languageLabel: string;
  id: number;
  /** The decoded text, or null when the platform and encoding are not decoded or the string is outside the table. */
  text: string | null;
  /** Why text is null, in a fixed phrase. */
  undecoded?: string;
  /** True when the string was longer than MAX_LICENCE_CHARS and was cut. */
  cut: boolean;
}

export interface NameTable {
  version: number;
  records: NameRecord[];
  /** How many records the table states. */
  total: number;
  notes: string[];
}

const decoders = new Map<string, TextDecoder | null>();

/** A shared decoder for one of the encodings names use; null when this runtime does not know it. */
function decoderFor(label: string): TextDecoder | null {
  const known = decoders.get(label);
  if (known !== undefined) return known;
  let made: TextDecoder | null = null;
  try {
    made = new TextDecoder(label, { fatal: false });
  } catch {
    made = null;
  }
  decoders.set(label, made);
  return made;
}

/** The encoding label for a name record's platform and encoding, or null with the phrase to show instead. */
export function encodingFor(platform: number, encoding: number): { label: string } | { skip: string } {
  if (platform === 0) return { label: 'utf-16be' };
  if (platform === 1) {
    if (encoding === 0) return { label: 'macintosh' };
    return { skip: 'Mac encoding not decoded' };
  }
  if (platform === 2) {
    if (encoding === 0) return { label: 'windows-1252' };
    if (encoding === 1) return { label: 'utf-16be' };
    if (encoding === 2) return { label: 'windows-1252' };
    return { skip: 'ISO encoding not decoded' };
  }
  if (platform === 3) {
    if (encoding === 3) return { label: 'gbk' };
    if (encoding === 4) return { label: 'big5' };
    if (encoding === 5) return { label: 'euc-kr' };
    return { label: 'utf-16be' };
  }
  return { skip: 'platform not decoded' };
}

/** Decodes a name string for a platform and encoding; null when this runtime has no decoder for it. */
export function decodeNameBytes(platform: number, encoding: number, raw: Uint8Array): string | null {
  const choice = encodingFor(platform, encoding);
  if ('skip' in choice) return null;
  const decoder = decoderFor(choice.label);
  if (!decoder) return null;
  return decoder.decode(raw);
}

/**
 * Reads the name table: every record's platform, encoding, language and name ID, and its string decoded as the
 * platform and encoding say (UTF-16BE for platform 0 and for platform 3 apart from the three legacy code pages, Mac
 * Roman for platform 1 encoding 0, the 936, 950 and 949 code pages for platform 3 encodings 3 to 5). The record count is
 * compared with the bytes that remain, and the total number of string bytes decoded is capped, so a table full of
 * records that point at one long string costs a fixed amount.
 */
export function readNameTable(bytes: Uint8Array, offset: number, length: number): NameTable {
  const r = new ByteReader(bytes);
  const notes: string[] = [];
  const end = offset + length;
  if (length < 6) {
    return { version: 0, records: [], total: 0, notes: ['The name table is too short to hold a header.'] };
  }
  const version = r.u16(offset);
  const total = r.u16(offset + 2);
  const storage = offset + r.u16(offset + 4);
  const room = Math.floor((length - 6) / 12);
  let count = Math.min(total, MAX_NAME_RECORDS);
  if (count > room) {
    count = room;
    notes.push('The name table states more records than it has room for; the ones that fit are shown.');
  }
  if (total > MAX_NAME_RECORDS) {
    notes.push(
      `The name table holds ${total.toLocaleString('en-US')} records; only the first ${MAX_NAME_RECORDS.toLocaleString('en-US')} are read.`,
    );
  }

  // Version 1 adds language tags for language IDs from 0x8000.
  const langTags: string[] = [];
  if (version === 1) {
    const afterRecords = offset + 6 + 12 * total;
    if (total <= room && r.has(afterRecords, 2)) {
      const tagCount = Math.min(r.u16(afterRecords), 1000);
      for (let i = 0; i < tagCount; i++) {
        const at = afterRecords + 2 + 4 * i;
        if (!r.has(at, 4)) break;
        const len = r.u16(at);
        const off = storage + r.u16(at + 2);
        if (len > 0 && off + len <= end && r.has(off, len)) {
          langTags.push(decodeNameBytes(0, 0, r.slice(off, len)) ?? '');
        } else {
          langTags.push('');
        }
      }
    }
  }

  const records: NameRecord[] = [];
  let budget = MAX_NAME_DECODE_BYTES;
  let skippedForBudget = 0;
  for (let i = 0; i < count; i++) {
    const at = offset + 6 + 12 * i;
    const platform = r.u16(at);
    const encoding = r.u16(at + 2);
    const language = r.u16(at + 4);
    const id = r.u16(at + 6);
    const len = r.u16(at + 8);
    const off = storage + r.u16(at + 10);
    let label = `0x${language.toString(16).toUpperCase().padStart(4, '0')}`;
    if (platform === 3) {
      const known = WINDOWS_LANGUAGES.get(language);
      if (known) label = known;
    }
    if (language >= 0x8000 && version === 1) {
      const tag = langTags[language - 0x8000];
      if (tag) label = tag;
    }
    const record: NameRecord = { platform, encoding, language, languageLabel: label, id, text: null, cut: false };
    const choice = encodingFor(platform, encoding);
    if ('skip' in choice) {
      record.undecoded = choice.skip;
    } else if (off < storage || off + len > end || !r.has(off, len)) {
      record.undecoded = 'string outside the table';
    } else if (len > budget) {
      record.undecoded = 'not decoded, the name strings are too large';
      skippedForBudget++;
    } else {
      budget -= len;
      const decoded = decodeNameBytes(platform, encoding, r.slice(off, len));
      if (decoded === null) {
        record.undecoded = 'encoding not available here';
      } else if (decoded.length > MAX_LICENCE_CHARS) {
        record.text = decoded.slice(0, MAX_LICENCE_CHARS);
        record.cut = true;
      } else {
        record.text = decoded;
      }
    }
    records.push(record);
  }
  if (skippedForBudget > 0) {
    notes.push(
      `${skippedForBudget.toLocaleString('en-US')} name strings were not decoded because the strings together are too large.`,
    );
  }
  return { version, records, total, notes };
}

/**
 * The text of a name ID, preferring the Windows English record, then any Windows record, then Unicode platform records,
 * then Mac English, then any record that decoded. Returns undefined when no record of that ID has text.
 */
export function pickName(table: NameTable | null, id: number): string | undefined {
  if (!table) return undefined;
  let best: NameRecord | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const record of table.records) {
    if (record.id !== id || record.text === null || record.text === '') continue;
    let rank = 9;
    if (record.platform === 3 && record.language === 0x0409) rank = 0;
    else if (record.platform === 3) rank = 1;
    else if (record.platform === 0) rank = 2;
    else if (record.platform === 1 && record.language === 0) rank = 3;
    else rank = 4;
    if (rank < bestRank) {
      best = record;
      bestRank = rank;
    }
  }
  return best?.text ?? undefined;
}
