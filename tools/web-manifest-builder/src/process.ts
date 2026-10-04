import { DEFAULT_MANIFEST_URL, DEFAULT_PAGE_URL, resolveAddress } from './address';
import { asciiLowercase, stripAscii } from './ascii';
import { parseCssColour } from './colour';
import { ManifestBuilderError } from './errors';
import { MAX_ICONS, MAX_SHORTCUTS, MAX_SHOWN, countCodePoints, visible, withCommas } from './limits';
import { parseMimeEssence } from './mime';
import { parseIconPurpose, parseIconSizes } from './sizes';

/** How serious a finding is: ignored (a browser would act as if the member were absent), a warning, or information. */
export type FindingSeverity = 'ignored' | 'warning' | 'info';

/** One thing worth knowing about a member. The message says what and why, and never repeats more than 40 typed characters. */
export interface ManifestFinding {
  /** The member the finding is about, or `manifest address` or `page address`. */
  member: string;
  severity: FindingSeverity;
  message: string;
}

/** A colour member after processing. `rgba` is null when the colour was kept as written but not checked here. */
export interface ProcessedColour {
  rgba: [number, number, number, number] | null;
  /** False for colours written in CSS syntax this page cannot check. */
  checked: boolean;
  /** `rgba(r, g, b, a)` for an sRGB colour, the text as written (cut) for an unchecked one. */
  css: string;
}

export interface ProcessedIcon {
  src: string;
  sizes: string[];
  /** The MIME essence, or the empty string when no type was given. */
  type: string;
  purposes: string[];
}

export interface ProcessedShortcut {
  name: string;
  url: string;
}

/** One line of the table that shows how a browser reads the manifest. */
export interface ProcessedRow {
  member: string;
  /** What was written, cut and with control characters made visible. Empty when nothing was written. */
  written: string;
  /** What a browser makes of it. */
  processed: string;
  status: 'read' | 'default' | 'ignored' | 'not set';
}

export interface ProcessedManifest {
  /** The manifest address everything was resolved against (the example address when the typed one could not be read). */
  manifestUrl: string;
  /** The page address (the example address when the typed one could not be read). */
  pageUrl: string;
  name: string | null;
  shortName: string | null;
  id: string;
  startUrl: string;
  scope: string;
  display: string;
  /** The display modes tried when a browser does not support `display`, in order. */
  displayFallback: string[];
  displayOverride: string[] | null;
  orientation: string | null;
  dir: 'ltr' | 'rtl' | 'auto';
  lang: string | null;
  themeColor: ProcessedColour | null;
  backgroundColor: ProcessedColour | null;
  icons: ProcessedIcon[];
  shortcuts: ProcessedShortcut[];
  rows: ProcessedRow[];
}

/** How many typed characters a table cell may show. A finding shows at most 40. */
export const MAX_CELL_SHOWN = 200;

/** The members in the one order used for the written JSON, the table rows and the findings. */
export const MEMBER_ORDER: readonly string[] = [
  'name',
  'short_name',
  'id',
  'start_url',
  'scope',
  'display',
  'display_override',
  'orientation',
  'dir',
  'lang',
  'theme_color',
  'background_color',
  'icons',
  'shortcuts',
];

const FINDING_ORDER: ReadonlyMap<string, number> = new Map(
  ['manifest address', 'page address', ...MEMBER_ORDER].map((member, index) => [member, index]),
);

/** The display modes of the draft and the fallback chain of each. */
const DISPLAY_CHAINS: ReadonlyMap<string, string[]> = new Map([
  ['browser', []],
  ['minimal-ui', ['browser']],
  ['standalone', ['minimal-ui', 'browser']],
  ['fullscreen', ['standalone', 'minimal-ui', 'browser']],
]);

/** The tokens of display_override that this page knows: the four W3C display modes and two incubating ones. */
const OVERRIDE_TOKENS: ReadonlySet<string> = new Set([
  'fullscreen',
  'standalone',
  'minimal-ui',
  'browser',
  'window-controls-overlay',
  'tabbed',
]);

const ORIENTATIONS: ReadonlySet<string> = new Set([
  'any',
  'natural',
  'landscape',
  'portrait',
  'portrait-primary',
  'portrait-secondary',
  'landscape-primary',
  'landscape-secondary',
]);

const DIRECTIONS: ReadonlySet<string> = new Set(['ltr', 'rtl', 'auto']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function characters(count: number): string {
  return count === 1 ? '1 character' : `${count} characters`;
}

/** Text a person typed or pasted, safe to show in a table cell. */
function shown(text: string, max: number = MAX_CELL_SHOWN): string {
  return visible(text, max);
}

/** What was written in a member, in words or as cut text. */
function describe(value: unknown): string {
  if (typeof value === 'string') return shown(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (typeof value === 'object') return 'an object';
  return String(value);
}

/**
 * True for an http or https address. A blob: or filesystem: address has the origin of the address inside it, but it is not
 * a page a browser opens as an app, and it cannot be a base for other addresses, so it is never one of these.
 */
function isWebAddress(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/** True when both are http or https addresses with the same scheme, host and port. */
function sameOrigin(a: URL, b: URL): boolean {
  return isWebAddress(a) && isWebAddress(b) && a.origin === b.origin;
}

/**
 * The draft's "within scope" test: same origin, and the target's path (its segments joined with a slash) starts with
 * the scope's. A plain prefix of text, so /prefix-of/resource.html is within a scope of /prefix.
 */
function withinScope(target: URL, scope: URL): boolean {
  return sameOrigin(target, scope) && target.pathname.startsWith(scope.pathname);
}

function withoutFragment(url: URL): URL {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy;
}

function formatAlpha(alpha: number): string {
  return String(Number(alpha.toFixed(3)));
}

/**
 * Applies the processing steps of the W3C Web Application Manifest draft to a manifest that was already parsed from
 * JSON. Every address is resolved with the URL parser against `manifestUrl` (and the start address against `pageUrl`);
 * nothing is ever requested. A member that a browser would ignore gets a finding that says why, and the table of rows
 * shows what a browser makes of every member. Whatever is typed, a run completes: only a list over its limit throws.
 */
export function processManifest(
  json: Record<string, unknown>,
  manifestUrl: string,
  pageUrl: string,
): { processed: ProcessedManifest; findings: ManifestFinding[] } {
  // "If json is a parsing exception, or json is not an ordered map: set json to an empty ordered map."
  const root: Record<string, unknown> = isObject(json) ? json : {};
  const own = (name: string): unknown => (Object.hasOwn(root, name) ? root[name] : undefined);

  const rawIcons = own('icons');
  const rawShortcuts = own('shortcuts');
  if (Array.isArray(rawIcons) && rawIcons.length > MAX_ICONS) {
    throw new ManifestBuilderError(
      `This manifest lists ${withCommas(rawIcons.length)} icons. The limit is ${MAX_ICONS} icons because a longer list would make the page slow to answer.`,
    );
  }
  if (Array.isArray(rawShortcuts) && rawShortcuts.length > MAX_SHORTCUTS) {
    throw new ManifestBuilderError(
      `This manifest lists ${withCommas(rawShortcuts.length)} shortcuts. The limit is ${MAX_SHORTCUTS} shortcuts because a longer list would make the page slow to answer.`,
    );
  }

  const findings: ManifestFinding[] = [];
  const add = (member: string, severity: FindingSeverity, message: string): void => {
    findings.push({ member, severity, message });
  };
  const rows: ProcessedRow[] = [];

  // The two addresses everything is resolved against.
  const manifestAddress = resolveAddress(manifestUrl, DEFAULT_MANIFEST_URL, 'manifest address field');
  if (manifestAddress.problem !== null) {
    add(
      'manifest address',
      'warning',
      `The manifest address is ${manifestAddress.problem === 'empty' ? 'empty' : 'not a full http or https address'}, so ${DEFAULT_MANIFEST_URL} is used to resolve the other addresses. Write it like https://example.com/manifest.webmanifest.`,
    );
  }
  const pageAddress = resolveAddress(pageUrl, DEFAULT_PAGE_URL, 'page address field');
  if (pageAddress.problem !== null) {
    add(
      'page address',
      'warning',
      `The page address is ${pageAddress.problem === 'empty' ? 'empty' : 'not a full http or https address'}, so ${DEFAULT_PAGE_URL} is used. Write it like https://example.com/.`,
    );
  }
  const manifest = manifestAddress.url;
  const page = pageAddress.url;

  // name and short_name: text members, stripped of ASCII whitespace; lengths are counted in code points.
  function textMember(member: 'name' | 'short_name'): string | null {
    const value = own(member);
    if (value === undefined) {
      rows.push({ member, written: '', processed: 'none', status: 'not set' });
      return null;
    }
    if (typeof value !== 'string') {
      add(member, 'ignored', `${member} must be text, so it is ignored.`);
      rows.push({ member, written: describe(value), processed: 'not used', status: 'ignored' });
      return null;
    }
    const stripped = stripAscii(value);
    if (stripped === '') {
      add(member, 'warning', `${member} is empty, so it is ignored.`);
      rows.push({ member, written: shown(value), processed: 'not used', status: 'ignored' });
      return null;
    }
    rows.push({
      member,
      written: shown(value),
      processed: `${shown(stripped)} (${characters(countCodePoints(stripped))})`,
      status: 'read',
    });
    return stripped;
  }
  const name = textMember('name');
  const shortName = textMember('short_name');
  if (name === null && shortName === null) {
    add('name', 'warning', 'Neither name nor short_name is set, so a browser has no name to show for the app.');
  }
  if (name !== null && shortName !== null) {
    const nameLength = countCodePoints(name);
    const shortLength = countCodePoints(shortName);
    if (shortLength > nameLength) {
      add(
        'short_name',
        'warning',
        `short_name has ${characters(shortLength)} and name has ${characters(nameLength)}. short_name is meant to be the shorter one, for places where there is little room.`,
      );
    }
  }

  // start_url: the page address unless the member is a same-origin address (resolved against the manifest address).
  let startUrl = new URL(page.href);
  let startStatus: ProcessedRow['status'] = 'default';
  const rawStart = own('start_url');
  if (rawStart === undefined) {
    add('start_url', 'info', 'start_url is not set, so the page address is the start address.');
  } else if (typeof rawStart !== 'string') {
    add('start_url', 'ignored', 'start_url must be text, so it is ignored and the page address is the start address.');
    startStatus = 'ignored';
  } else if (rawStart === '') {
    add('start_url', 'info', 'start_url is empty, so the page address is the start address.');
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(rawStart, manifest);
    } catch {
      add(
        'start_url',
        'ignored',
        'start_url is not an address the URL parser can read, so it is ignored and the page address is the start address.',
      );
      startStatus = 'ignored';
    }
    if (parsed !== null) {
      if (sameOrigin(parsed, page)) {
        startUrl = parsed;
        startStatus = 'read';
      } else if (!isWebAddress(parsed)) {
        add(
          'start_url',
          'ignored',
          'start_url is not an http or https address, so it is ignored and the page address is the start address.',
        );
        startStatus = 'ignored';
      } else {
        add(
          'start_url',
          'ignored',
          `start_url is on another origin (${shown(parsed.origin, MAX_SHOWN)}) than the page (${shown(page.origin, MAX_SHOWN)}), so it is ignored and the page address is the start address.`,
        );
        startStatus = 'ignored';
      }
    }
  }

  // id: the start address without its fragment, unless the member is an address on the start address's origin.
  let id = withoutFragment(startUrl);
  let idStatus: ProcessedRow['status'] = 'default';
  const rawId = own('id');
  if (rawId === undefined) {
    add('id', 'info', 'id is not set, so the start address without its fragment identifies the app.');
  } else if (typeof rawId !== 'string') {
    add('id', 'ignored', 'id must be text, so it is ignored and the start address identifies the app.');
    idStatus = 'ignored';
  } else if (rawId === '') {
    add('id', 'info', 'id is empty, so the start address without its fragment identifies the app.');
  } else {
    let parsed: URL | null = null;
    try {
      // The base is the origin of the start address, so id never depends on the folder the start address is in.
      parsed = new URL(rawId, startUrl.origin);
    } catch {
      add(
        'id',
        'ignored',
        'id is not an address the URL parser can read, so it is ignored and the start address identifies the app.',
      );
      idStatus = 'ignored';
    }
    if (parsed !== null) {
      if (sameOrigin(parsed, startUrl)) {
        id = withoutFragment(parsed);
        idStatus = 'read';
      } else if (!isWebAddress(parsed)) {
        add(
          'id',
          'ignored',
          'id is not an http or https address, so it is ignored and the start address identifies the app.',
        );
        idStatus = 'ignored';
      } else {
        add(
          'id',
          'ignored',
          'id is on another origin than start_url, so it is ignored and the start address identifies the app.',
        );
        idStatus = 'ignored';
      }
    }
  }

  // scope: the folder of the start address unless the member is an address that contains the start address.
  let scope = new URL('.', startUrl);
  let scopeStatus: ProcessedRow['status'] = 'default';
  const rawScope = own('scope');
  if (rawScope === undefined) {
    add('scope', 'info', 'scope is not set, so it is the folder of the start address.');
  } else if (typeof rawScope !== 'string') {
    add('scope', 'ignored', 'scope must be text, so it is ignored and the folder of the start address is the scope.');
    scopeStatus = 'ignored';
  } else if (rawScope === '') {
    add('scope', 'info', 'scope is empty, so it is the folder of the start address.');
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(rawScope, manifest);
    } catch {
      add(
        'scope',
        'ignored',
        'scope is not an address the URL parser can read, so it is ignored and the folder of the start address is the scope.',
      );
      scopeStatus = 'ignored';
    }
    if (parsed !== null && !isWebAddress(parsed)) {
      add(
        'scope',
        'ignored',
        'scope is not an http or https address, so it is ignored and the folder of the start address is the scope.',
      );
      scopeStatus = 'ignored';
    } else if (parsed !== null) {
      parsed.search = '';
      parsed.hash = '';
      if (withinScope(startUrl, parsed)) {
        scope = parsed;
        scopeStatus = 'read';
        const scopePath = parsed.pathname;
        const startPath = startUrl.pathname;
        if (!scopePath.endsWith('/') && startPath !== scopePath && startPath[scopePath.length] !== '/') {
          add(
            'scope',
            'warning',
            `The scope ${shown(scopePath, MAX_SHOWN)} does not end with a slash, and the W3C within-scope test is a plain text prefix of the path, so it also contains ${shown(startPath, MAX_SHOWN)} and every other path that starts with the same characters. End the scope with a slash to mean one folder.`,
          );
        }
      } else {
        add(
          'scope',
          'ignored',
          'scope does not contain the start address (it must be on the same origin and its path must be a prefix of the start address path), so it is ignored and the folder of the start address is the scope.',
        );
        scopeStatus = 'ignored';
      }
    }
  }

  const written = (member: string): string => {
    const value = own(member);
    return value === undefined ? '' : describe(value);
  };
  rows.push(
    { member: 'id', written: written('id'), processed: shown(id.href), status: idStatus },
    { member: 'start_url', written: written('start_url'), processed: shown(startUrl.href), status: startStatus },
    { member: 'scope', written: written('scope'), processed: shown(scope.href), status: scopeStatus },
  );
  // textMember pushed name and short_name first; id, start_url and scope follow in the fixed member order.

  // display: one of the four W3C modes, browser when not set or not understood.
  let display = 'browser';
  let displayStatus: ProcessedRow['status'] = 'default';
  const rawDisplay = own('display');
  if (rawDisplay !== undefined) {
    if (typeof rawDisplay !== 'string') {
      add('display', 'ignored', 'display must be text, so it is ignored and browser is used.');
      displayStatus = 'ignored';
    } else {
      const value = asciiLowercase(stripAscii(rawDisplay));
      if (DISPLAY_CHAINS.has(value)) {
        display = value;
        displayStatus = 'read';
      } else {
        const hint = OVERRIDE_TOKENS.has(value)
          ? ' That value belongs in display_override, which is not part of the W3C specification.'
          : '';
        add(
          'display',
          'ignored',
          `display is not one of fullscreen, standalone, minimal-ui or browser, so it is ignored and browser is used.${hint}`,
        );
        displayStatus = 'ignored';
      }
    }
  }
  const displayFallback = DISPLAY_CHAINS.get(display) ?? [];
  rows.push({
    member: 'display',
    written: written('display'),
    processed: displayFallback.length === 0 ? display : `${display} (falls back to ${displayFallback.join(', then ')})`,
    status: displayStatus,
  });

  // display_override: not part of the W3C specification; known tokens are kept, others are reported.
  let displayOverride: string[] | null = null;
  const rawOverride = own('display_override');
  if (rawOverride === undefined) {
    rows.push({ member: 'display_override', written: '', processed: 'none', status: 'not set' });
  } else {
    add(
      'display_override',
      'info',
      'display_override is not part of the W3C specification. It comes from an incubating feature, and the list of tokens checked here (the four W3C display modes, window-controls-overlay and tabbed) is incomplete, so a browser may accept others.',
    );
    if (!Array.isArray(rawOverride)) {
      add('display_override', 'ignored', 'display_override must be a list of display modes, so it is ignored.');
      rows.push({
        member: 'display_override',
        written: describe(rawOverride),
        processed: 'not used',
        status: 'ignored',
      });
    } else {
      const kept: string[] = [];
      rawOverride.forEach((token: unknown, index: number) => {
        const value = typeof token === 'string' ? asciiLowercase(stripAscii(token)) : '';
        if (OVERRIDE_TOKENS.has(value)) {
          kept.push(value);
        } else {
          add(
            'display_override',
            'ignored',
            `Token ${index + 1} is not one of fullscreen, standalone, minimal-ui, browser, window-controls-overlay or tabbed (this list is incomplete), so it is ignored.`,
          );
        }
      });
      displayOverride = kept;
      rows.push({
        member: 'display_override',
        written: shown(
          rawOverride.map((token: unknown) => (typeof token === 'string' ? token : describe(token))).join(' '),
        ),
        processed: kept.length === 0 ? 'no known token' : kept.join(', '),
        status: 'read',
      });
    }
  }

  // orientation and dir: stripped, lowercased, then one of the listed values.
  let orientation: string | null = null;
  const rawOrientation = own('orientation');
  let orientationStatus: ProcessedRow['status'] = rawOrientation === undefined ? 'not set' : 'read';
  if (rawOrientation !== undefined) {
    const value = typeof rawOrientation === 'string' ? asciiLowercase(stripAscii(rawOrientation)) : '';
    if (ORIENTATIONS.has(value)) {
      orientation = value;
    } else {
      add(
        'orientation',
        'ignored',
        'orientation is not one of any, natural, landscape, portrait, portrait-primary, portrait-secondary, landscape-primary or landscape-secondary, so it is ignored.',
      );
      orientationStatus = 'ignored';
    }
  }
  rows.push({
    member: 'orientation',
    written: written('orientation'),
    processed: orientation ?? (orientationStatus === 'ignored' ? 'not used' : 'none'),
    status: orientationStatus,
  });

  let dir: 'ltr' | 'rtl' | 'auto' = 'auto';
  const rawDir = own('dir');
  let dirStatus: ProcessedRow['status'] = rawDir === undefined ? 'default' : 'read';
  if (rawDir !== undefined) {
    const value = typeof rawDir === 'string' ? asciiLowercase(stripAscii(rawDir)) : '';
    if (DIRECTIONS.has(value)) {
      dir = value as 'ltr' | 'rtl' | 'auto';
    } else {
      add('dir', 'ignored', 'dir is not one of ltr, rtl or auto, so it is ignored and auto is used.');
      dirStatus = 'ignored';
    }
  }
  rows.push({ member: 'dir', written: written('dir'), processed: dir, status: dirStatus });

  // lang: a structurally valid BCP 47 tag, shown in canonical form.
  let lang: string | null = null;
  const rawLang = own('lang');
  let langStatus: ProcessedRow['status'] = rawLang === undefined ? 'not set' : 'read';
  if (rawLang !== undefined) {
    if (typeof rawLang !== 'string') {
      add('lang', 'ignored', 'lang must be text, so it is ignored.');
      langStatus = 'ignored';
    } else {
      const tag = stripAscii(rawLang);
      let canonical: string | null = null;
      try {
        canonical = Intl.getCanonicalLocales(tag)[0] ?? null;
      } catch {
        canonical = null;
      }
      if (canonical === null) {
        add(
          'lang',
          'ignored',
          'lang is not a structurally valid BCP 47 language tag (for example en, en-US or zh-Hans-CN), so it is ignored.',
        );
        langStatus = 'ignored';
      } else {
        lang = canonical;
        if (canonical !== tag)
          add('lang', 'info', `lang is shown in canonical form as ${shown(canonical, MAX_SHOWN)}.`);
      }
    }
  }
  rows.push({
    member: 'lang',
    written: written('lang'),
    processed: lang ?? (langStatus === 'ignored' ? 'not used' : 'none'),
    status: langStatus,
  });

  // theme_color and background_color: kept only as sRGB colours (or CSS syntax this page cannot check).
  function colourMember(member: 'theme_color' | 'background_color'): ProcessedColour | null {
    const value = own(member);
    if (value === undefined) {
      rows.push({ member, written: '', processed: 'none', status: 'not set' });
      return null;
    }
    if (typeof value !== 'string') {
      add(member, 'ignored', `${member} must be text, so it is ignored.`);
      rows.push({ member, written: describe(value), processed: 'not used', status: 'ignored' });
      return null;
    }
    const text = stripAscii(value);
    const parsed = parseCssColour(text);
    if (parsed.kind === 'invalid') {
      add(
        member,
        'ignored',
        `${member} is not an sRGB colour a browser can read (write it as hex, rgb(), hsl(), a colour name or transparent), so it is ignored.`,
      );
      rows.push({ member, written: shown(value), processed: 'not used', status: 'ignored' });
      return null;
    }
    if (parsed.kind === 'unchecked') {
      add(
        member,
        'warning',
        `${member} uses CSS colour syntax (such as lab(), oklch() or color()) that this page cannot check. It is kept as written; a browser keeps it only if it can convert the colour to sRGB.`,
      );
      rows.push({ member, written: shown(value), processed: 'kept as written, not checked here', status: 'read' });
      return { rgba: null, checked: false, css: shown(text) };
    }
    const [red, green, blue, alpha] = parsed.rgba;
    const css = `rgba(${red}, ${green}, ${blue}, ${formatAlpha(alpha)})`;
    rows.push({ member, written: shown(value), processed: css, status: 'read' });
    return { rgba: parsed.rgba, checked: true, css };
  }
  const themeColor = colourMember('theme_color');
  const backgroundColor = colourMember('background_color');

  // icons: each is an image resource (Image Resource section 6) with a purpose (manifest draft).
  const icons: ProcessedIcon[] = [];
  const iconRows: ProcessedRow[] = [];
  if (rawIcons === undefined) {
    iconRows.push({ member: 'icons', written: '', processed: 'none', status: 'not set' });
  } else if (!Array.isArray(rawIcons)) {
    add('icons', 'ignored', 'icons must be a list, so it is ignored.');
    iconRows.push({ member: 'icons', written: describe(rawIcons), processed: 'not used', status: 'ignored' });
  } else {
    rawIcons.forEach((entry: unknown, index: number) => {
      const position = index + 1;
      const member = `icons[${position}]`;
      if (!isObject(entry)) {
        add('icons', 'ignored', `Icon ${position} is not an object, so it is ignored.`);
        iconRows.push({ member, written: describe(entry), processed: 'not used', status: 'ignored' });
        return;
      }
      const field = (key: string): unknown => (Object.hasOwn(entry, key) ? entry[key] : undefined);
      const src = field('src');
      const writtenSrc = typeof src === 'string' ? shown(src) : '';
      if (typeof src !== 'string') {
        add('icons', 'ignored', `Icon ${position} has no src (an address written as text), so it is ignored.`);
        iconRows.push({ member, written: writtenSrc, processed: 'not used', status: 'ignored' });
        return;
      }
      let url: URL;
      try {
        url = new URL(src, manifest);
      } catch {
        add(
          'icons',
          'ignored',
          `Icon ${position} has an src that is not an address the URL parser can read, so it is ignored.`,
        );
        iconRows.push({ member, written: writtenSrc, processed: 'not used', status: 'ignored' });
        return;
      }
      let sizes: string[] = [];
      const rawSizes = field('sizes');
      if (typeof rawSizes === 'string' && rawSizes.length > 0) {
        const parsed = parseIconSizes(rawSizes);
        sizes = parsed.sizes;
        if (sizes.length === 0) {
          add(
            'icons',
            'warning',
            `Icon ${position} has no size a browser can read (a size is any, or width x height in digits with no leading zero), so it has no usable size.`,
          );
        } else if (parsed.invalid.length > 0) {
          add(
            'icons',
            'warning',
            `Icon ${position} has ${parsed.invalid.length} size${parsed.invalid.length === 1 ? '' : 's'} a browser cannot read, left out.`,
          );
        }
      }
      let type = '';
      const rawType = field('type');
      if (typeof rawType === 'string' && rawType.length > 0) {
        const essence = parseMimeEssence(rawType);
        if (essence === null) {
          add(
            'icons',
            'ignored',
            `Icon ${position} has a type that is not a MIME type (such as image/png), so it is ignored.`,
          );
          iconRows.push({ member, written: writtenSrc, processed: 'not used', status: 'ignored' });
          return;
        }
        type = essence;
      }
      let purposes = ['any'];
      const rawPurpose = field('purpose');
      if (typeof rawPurpose === 'string') {
        const parsed = parseIconPurpose(rawPurpose);
        if (parsed.ignoredIcon) {
          add(
            'icons',
            'ignored',
            `Icon ${position} has a purpose with no known keyword (any, maskable or monochrome), so it is ignored.`,
          );
          iconRows.push({ member, written: writtenSrc, processed: 'not used', status: 'ignored' });
          return;
        }
        purposes = parsed.kept;
        if (parsed.dropped.length > 0) {
          add(
            'icons',
            'warning',
            `Icon ${position} has ${parsed.dropped.length} purpose keyword${parsed.dropped.length === 1 ? '' : 's'} that are not known, left out.`,
          );
        }
      }
      icons.push({ src: url.href, sizes, type, purposes });
      iconRows.push({
        member,
        written: writtenSrc,
        processed: `${shown(url.href)} (sizes: ${sizes.length === 0 ? 'none' : sizes.join(' ')}; type: ${type === '' ? 'none' : type}; purpose: ${purposes.join(' ')})`,
        status: 'read',
      });
    });
  }
  if (icons.length === 0) {
    add(
      'icons',
      'warning',
      'No icon is usable, so a browser has no picture for the app. List at least one icon with an src.',
    );
  }

  // shortcuts: a name and an address within scope, or the shortcut is dropped.
  const shortcuts: ProcessedShortcut[] = [];
  const shortcutRows: ProcessedRow[] = [];
  if (rawShortcuts === undefined) {
    shortcutRows.push({ member: 'shortcuts', written: '', processed: 'none', status: 'not set' });
  } else if (!Array.isArray(rawShortcuts)) {
    add('shortcuts', 'ignored', 'shortcuts must be a list, so it is ignored.');
    shortcutRows.push({
      member: 'shortcuts',
      written: describe(rawShortcuts),
      processed: 'not used',
      status: 'ignored',
    });
  } else {
    rawShortcuts.forEach((entry: unknown, index: number) => {
      const position = index + 1;
      const member = `shortcuts[${position}]`;
      const drop = (writtenName: string, why: string): void => {
        add('shortcuts', 'ignored', `Shortcut ${position} ${why}, so it is dropped.`);
        shortcutRows.push({ member, written: writtenName, processed: 'not used', status: 'ignored' });
      };
      if (!isObject(entry)) {
        drop(describe(entry), 'is not an object');
        return;
      }
      const field = (key: string): unknown => (Object.hasOwn(entry, key) ? entry[key] : undefined);
      const shortcutName = field('name');
      const writtenName = typeof shortcutName === 'string' ? shown(shortcutName) : '';
      if (typeof shortcutName !== 'string' || shortcutName === '') {
        drop(writtenName, 'has no name');
        return;
      }
      const rawUrl = field('url');
      if (typeof rawUrl !== 'string') {
        drop(writtenName, 'has no url (an address written as text)');
        return;
      }
      let url: URL;
      try {
        url = new URL(rawUrl, manifest);
      } catch {
        drop(writtenName, 'has a url that is not an address the URL parser can read');
        return;
      }
      if (!isWebAddress(url)) {
        drop(writtenName, 'has a url that is not an http or https address');
        return;
      }
      if (!withinScope(url, scope)) {
        drop(
          writtenName,
          'has a url that is not within the scope (same origin, and a path that starts with the scope path)',
        );
        return;
      }
      shortcuts.push({ name: shortcutName, url: url.href });
      shortcutRows.push({ member, written: writtenName, processed: shown(url.href), status: 'read' });
    });
  }

  rows.push(...iconRows, ...shortcutRows);

  // The rows were pushed as each member was handled, which is the fixed member order; the findings were pushed in the
  // order of the processing steps (start_url before id), so they are put in member order here.
  const orderedFindings = findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        (FINDING_ORDER.get(a.finding.member) ?? 99) - (FINDING_ORDER.get(b.finding.member) ?? 99) || a.index - b.index,
    )
    .map((entry) => entry.finding);

  return {
    processed: {
      manifestUrl: manifest.href,
      pageUrl: page.href,
      name,
      shortName,
      id: id.href,
      startUrl: startUrl.href,
      scope: scope.href,
      display,
      displayFallback: [...displayFallback],
      displayOverride,
      orientation,
      dir,
      lang,
      themeColor,
      backgroundColor,
      icons,
      shortcuts,
      rows,
    },
    findings: orderedFindings,
  };
}
