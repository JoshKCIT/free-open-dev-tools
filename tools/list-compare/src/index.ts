import meta from './meta.json';

export { meta };

export class ListCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListCompareError';
  }
}

export interface ListCompareOptions {
  /** Default false. Compares using the default Unicode lower-casing mapping, never a locale variant. */
  ignoreCase?: boolean;
  /** Default true. Trims leading and trailing whitespace from each line before comparing. */
  trim?: boolean;
  /** Default false. Keeps blank lines as items instead of dropping them. */
  keepBlank?: boolean;
  /** Default false. Applies UAX #15 Normalization Form C to each line before comparing. */
  normalize?: boolean;
}

export interface ListCompareCounts {
  union: number;
  intersection: number;
  onlyA: number;
  onlyB: number;
  symmetric: number;
  /** Lines within list A that collapsed into an already-seen item. */
  duplicatesA: number;
  /** Lines within list B that collapsed into an already-seen item. */
  duplicatesB: number;
}

export interface ListCompareResult {
  union: string[];
  intersection: string[];
  onlyA: string[];
  onlyB: string[];
  symmetric: string[];
  counts: ListCompareCounts;
}

/** Splits on CRLF, LF or CR, so any of the three common line endings are read as line breaks. */
function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split(/\r\n|\r|\n/);
}

interface Item {
  /** The first-seen text for this item, used in every result list. */
  text: string;
  /** The comparison key, after the chosen normalisation/case options are applied. */
  key: string;
}

/** Splits `text` into lines, applying trim/keepBlank, then collapses to one Item per comparison key, first occurrence wins. */
function toItems(text: string, options: Required<ListCompareOptions>): { items: Item[]; duplicates: number } {
  let lines = splitLines(text);
  if (options.trim) lines = lines.map((line) => line.trim());
  if (!options.keepBlank) lines = lines.filter((line) => line !== '');

  const items: Item[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const line of lines) {
    let key = line;
    if (options.normalize) key = key.normalize('NFC');
    if (options.ignoreCase) key = key.toLowerCase();

    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    items.push({ text: line, key });
  }

  return { items, duplicates };
}

/**
 * Compares two line-separated lists and gives every set operation at once.
 * Each list first collapses to its first occurrence of each comparison key
 * (NFC when `normalize`, then lower-cased when `ignoreCase`); result lists
 * hold the first-seen text, never the comparison key.
 */
export function compareLists(a: string, b: string, options: ListCompareOptions = {}): ListCompareResult {
  const resolved: Required<ListCompareOptions> = {
    ignoreCase: options.ignoreCase ?? false,
    trim: options.trim ?? true,
    keepBlank: options.keepBlank ?? false,
    normalize: options.normalize ?? false,
  };

  const { items: aItems, duplicates: duplicatesA } = toItems(a, resolved);
  const { items: bItems, duplicates: duplicatesB } = toItems(b, resolved);

  const aKeys = new Set(aItems.map((item) => item.key));
  const bKeys = new Set(bItems.map((item) => item.key));

  const intersection = aItems.filter((item) => bKeys.has(item.key)).map((item) => item.text);
  const onlyA = aItems.filter((item) => !bKeys.has(item.key)).map((item) => item.text);
  const onlyBItems = bItems.filter((item) => !aKeys.has(item.key));
  const onlyB = onlyBItems.map((item) => item.text);
  const union = [...aItems.map((item) => item.text), ...onlyBItems.map((item) => item.text)];
  const symmetric = [...onlyA, ...onlyB];

  return {
    union,
    intersection,
    onlyA,
    onlyB,
    symmetric,
    counts: {
      union: union.length,
      intersection: intersection.length,
      onlyA: onlyA.length,
      onlyB: onlyB.length,
      symmetric: symmetric.length,
      duplicatesA,
      duplicatesB,
    },
  };
}
