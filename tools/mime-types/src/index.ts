import meta from './meta.json';

export { meta };

export interface MediaTypeRow {
  type: string;
  extensions: string[];
  ianaRegistered: boolean;
  source?: string;
  charset?: string;
  compressible?: boolean;
}

export interface LookupResult {
  direction: 'type' | 'extension';
  rows: MediaTypeRow[];
}

export interface Citation {
  label: string;
  url: string;
}

export const MIME_DB_VERSION = 'not-implemented';

export function normaliseMediaType(_input: string): string {
  throw new Error('not implemented');
}

export function typesForExtension(_query: string): MediaTypeRow[] {
  throw new Error('not implemented');
}

export function extensionsForType(_type: string): string[] {
  throw new Error('not implemented');
}

export function lookup(_query: string): LookupResult {
  throw new Error('not implemented');
}

export function citationFor(_row: MediaTypeRow): Citation {
  throw new Error('not implemented');
}
