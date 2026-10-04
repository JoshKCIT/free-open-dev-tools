import { DEFAULT_MANIFEST_URL, DEFAULT_PAGE_URL, resolveAddress } from './address';
import { splitAscii, stripAscii } from './ascii';
import { ManifestBuilderError } from './errors';
import { MAX_ICONS, MAX_JSON_BYTES, MAX_SHORTCUTS, checkFieldLength, withCommas } from './limits';

/**
 * The text a visitor typed, one value per member. Every value is optional: an empty field (or one holding only spaces)
 * leaves its member out. `icons` rows are [src, sizes, type, purpose] and `shortcuts` rows are [name, url]; a row with
 * nothing in it is skipped and a short row reads as empty in the cells it lacks.
 */
export interface ManifestFields {
  name?: string;
  shortName?: string;
  id?: string;
  startUrl?: string;
  scope?: string;
  display?: string;
  /** Display modes written one after another, separated by commas or spaces. */
  displayOverride?: string;
  orientation?: string;
  dir?: string;
  lang?: string;
  themeColor?: string;
  backgroundColor?: string;
  icons?: string[][];
  shortcuts?: string[][];
}

/** The text of one field, checked against the limit and stripped of ASCII whitespace. */
function field(value: string | undefined, place: string): string {
  if (value === undefined) return '';
  checkFieldLength(value, place);
  return stripAscii(value);
}

/** The cells of a grid as stripped text, skipping rows that hold nothing, and refusing too many rows or long cells. */
function rowsOf(
  grid: string[][] | undefined,
  member: string,
  columns: number,
  maximum: number,
  noun: string,
): string[][] {
  const kept: string[][] = [];
  (grid ?? []).forEach((row, index) => {
    const cells: string[] = [];
    for (let column = 0; column < columns; column++) {
      cells.push(field(row[column], `${member} row ${index + 1}, column ${column + 1}`));
    }
    if (cells.some((cell) => cell !== '')) kept.push(cells);
  });
  if (kept.length > maximum) {
    throw new ManifestBuilderError(
      `This manifest has ${withCommas(kept.length)} ${noun}. The limit is ${maximum} ${noun} because a longer list would make the page slow to answer.`,
    );
  }
  return kept;
}

/**
 * Turns the typed fields into a manifest object. Members are written in one fixed order whatever order the fields were
 * filled in: name, short_name, id, start_url, scope, display, display_override, orientation, dir, lang, theme_color,
 * background_color, icons, shortcuts. Icons and shortcuts keep their row order. Nothing is checked here beyond size;
 * `processManifest` says what a browser would make of the result.
 */
export function buildManifest(fields: ManifestFields): Record<string, unknown> {
  const manifest: Record<string, unknown> = {};
  const put = (member: string, value: string): void => {
    if (value !== '') manifest[member] = value;
  };
  put('name', field(fields.name, 'name field'));
  put('short_name', field(fields.shortName, 'short_name field'));
  put('id', field(fields.id, 'id field'));
  put('start_url', field(fields.startUrl, 'start_url field'));
  put('scope', field(fields.scope, 'scope field'));
  put('display', field(fields.display, 'display field'));
  const override = field(fields.displayOverride, 'display_override field');
  const tokens = splitAscii(override.replace(/,/g, ' '));
  if (tokens.length > 0) manifest['display_override'] = tokens;
  put('orientation', field(fields.orientation, 'orientation field'));
  put('dir', field(fields.dir, 'dir field'));
  put('lang', field(fields.lang, 'lang field'));
  put('theme_color', field(fields.themeColor, 'theme_color field'));
  put('background_color', field(fields.backgroundColor, 'background_color field'));

  const icons = rowsOf(fields.icons, 'icons', 4, MAX_ICONS, 'icons');
  if (icons.length > 0) {
    manifest['icons'] = icons.map(([src = '', sizes = '', type = '', purpose = '']) => {
      const icon: Record<string, string> = {};
      if (src !== '') icon['src'] = src;
      if (sizes !== '') icon['sizes'] = sizes;
      if (type !== '') icon['type'] = type;
      if (purpose !== '') icon['purpose'] = purpose;
      return icon;
    });
  }
  const shortcuts = rowsOf(fields.shortcuts, 'shortcuts', 2, MAX_SHORTCUTS, 'shortcuts');
  if (shortcuts.length > 0) {
    manifest['shortcuts'] = shortcuts.map(([name = '', url = '']) => {
      const shortcut: Record<string, string> = {};
      if (name !== '') shortcut['name'] = name;
      if (url !== '') shortcut['url'] = url;
      return shortcut;
    });
  }

  const bytes = new TextEncoder().encode(JSON.stringify(manifest)).length;
  if (bytes > MAX_JSON_BYTES) {
    throw new ManifestBuilderError(
      `This manifest would be ${withCommas(bytes)} bytes of JSON. The limit is ${withCommas(MAX_JSON_BYTES)} bytes because a larger file would make the page slow to answer.`,
    );
  }
  return manifest;
}

/** The manifest as JSON text, written by JSON.stringify with two spaces of indentation. */
export function manifestToJson(manifest: Record<string, unknown>): string {
  return JSON.stringify(manifest, null, 2);
}

const ATTRIBUTE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
]);

function escapeAttribute(text: string): string {
  let out = '';
  for (const ch of text) out += ATTRIBUTE_ESCAPES.get(ch) ?? ch;
  return out;
}

/**
 * The link tag that points a page at the manifest. When the manifest is on the page's own origin the address is written
 * from the root of that origin; otherwise it is the whole address. The value is escaped for an HTML attribute. An
 * address that cannot be read is replaced by the example address, as `processManifest` does.
 */
export function manifestLinkTag(manifestUrl: string, pageUrl: string): string {
  const manifest = resolveAddress(manifestUrl, DEFAULT_MANIFEST_URL).url;
  const page = resolveAddress(pageUrl, DEFAULT_PAGE_URL).url;
  const address = manifest.origin === page.origin ? manifest.pathname + manifest.search : manifest.href;
  return `<link rel="manifest" href="${escapeAttribute(address)}">`;
}
