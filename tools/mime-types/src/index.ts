import meta from './meta.json';
import mimeDb from 'mime-db/db.json';
import mimeDbPkg from 'mime-db/package.json';

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

/** The declared version of the bundled mime-db table, read from its own installed package.json. */
export const MIME_DB_VERSION: string = mimeDbPkg.version;

interface MimeDbEntry {
  source?: string;
  extensions?: string[];
  charset?: string;
  compressible?: boolean;
}

const DB = mimeDb as unknown as Record<string, MimeDbEntry>;

/** Rank used to sort several candidate types for one extension, most authoritative first. */
const SOURCE_RANK: Record<string, number> = { iana: 0, apache: 1, nginx: 2 };
function sourceRank(source: string | undefined): number {
  return source !== undefined && source in SOURCE_RANK ? SOURCE_RANK[source]! : 3;
}

function rowFor(type: string, entry: MimeDbEntry): MediaTypeRow {
  return {
    type,
    extensions: entry.extensions ?? [],
    ianaRegistered: entry.source === 'iana',
    source: entry.source,
    charset: entry.charset,
    compressible: entry.compressible,
  };
}

/** Lower-cases a media type and strips any `;parameter` and surrounding whitespace (RFC 6838 section 4.2: names are case-insensitive). */
export function normaliseMediaType(input: string): string {
  const withoutParams = input.split(';')[0] ?? input;
  return withoutParams.trim().toLowerCase();
}

/** Reads an extension out of a bare extension, a leading-dot extension, or a filename. Lower-cased. */
function extractExtension(query: string): string {
  const trimmed = query.trim();
  const withoutLeadingDot = trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
  const lastDot = withoutLeadingDot.lastIndexOf('.');
  const ext = lastDot === -1 ? withoutLeadingDot : withoutLeadingDot.slice(lastDot + 1);
  return ext.toLowerCase();
}

/** Every media type that claims the given extension (bare, leading-dot, or from a filename), IANA-registered first, then Apache, then nginx, then unset, then by type name. */
export function typesForExtension(query: string): MediaTypeRow[] {
  const ext = extractExtension(query);
  if (ext === '') return [];
  const rows: MediaTypeRow[] = [];
  for (const [type, entry] of Object.entries(DB)) {
    if (entry.extensions?.includes(ext)) rows.push(rowFor(type, entry));
  }
  rows.sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || a.type.localeCompare(b.type));
  return rows;
}

/** The extensions registered for a media type, or an empty array when the type is unknown or has none. */
export function extensionsForType(type: string): string[] {
  const key = normaliseMediaType(type);
  return DB[key]?.extensions ?? [];
}

/** Picks the lookup direction from the query: a slash means a media type, otherwise an extension or filename. */
export function lookup(query: string): LookupResult {
  const trimmed = query.trim();
  if (trimmed.includes('/')) {
    const key = normaliseMediaType(trimmed);
    const entry = DB[key];
    return { direction: 'type', rows: entry ? [rowFor(key, entry)] : [] };
  }
  return { direction: 'extension', rows: typesForExtension(trimmed) };
}

/** The citation text and link for a row's source. */
export function citationFor(row: MediaTypeRow): Citation {
  if (row.source === 'iana') {
    return { label: 'IANA Media Types registry', url: `https://www.iana.org/assignments/media-types/${row.type}` };
  }
  if (row.source === 'apache') {
    return {
      label: 'Apache HTTP Server mime.types (not IANA-registered)',
      url: 'https://svn.apache.org/repos/asf/httpd/httpd/trunk/docs/conf/mime.types',
    };
  }
  if (row.source === 'nginx') {
    return {
      label: 'nginx mime.types (not IANA-registered)',
      url: 'https://hg.nginx.org/nginx/raw-file/default/conf/mime.types',
    };
  }
  return { label: 'mime-db (source not recorded)', url: '' };
}
