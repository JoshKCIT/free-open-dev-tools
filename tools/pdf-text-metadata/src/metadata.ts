/** Scaffold: the tests for this module are written first; the implementation follows in the next commit. */
export const INFO_KEYS = [
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
  'Trapped',
] as const;

export interface MetadataRows {
  info: [string, string][];
  xmp: [string, string][];
  notes: string[];
}

export function pdfDateToIso(_raw: string): string | null {
  throw new Error('not implemented');
}

export function describeMetadata(
  _info: Record<string, unknown>,
  _xmp: Iterable<[string, unknown]> | null,
): MetadataRows {
  throw new Error('not implemented');
}
