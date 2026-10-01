import meta from './meta.json';
import { MarkupError, assertSafeText, el, inert, schemeWarning, serialize, urlScheme, type El } from './markup';
import { isValidNonNegativeInteger } from './microsyntax';
import { CORS_KEYWORDS, LOADING_KEYWORDS, PRELOAD_KEYWORDS, TRACK_KINDS, TRACK_KIND_DEFAULTS } from './spec-data';

export { meta };
export { MarkupError } from './markup';

/** The media the builder writes, in the order the page lists them. */
export const MEDIA_KINDS = ['video', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** The label each field has on the page; a refusal names the field by this text. */
export const FIELD_LABELS = {
  kind: 'Media',
  src: 'Media address',
  mediaSources: 'Sources',
  tracks: 'Tracks',
  poster: 'Poster address',
  width: 'Width',
  height: 'Height',
  preload: 'Preload',
  loading: 'Loading',
  crossorigin: 'Crossorigin',
  controls: 'Show controls',
  autoplay: 'Autoplay',
  muted: 'Muted',
  loop: 'Loop',
  playsinline: 'Play inline',
  fallback: 'Fallback text for old browsers',
} as const;

export interface MediaSpec {
  kind: MediaKind;
  /** The address of the media file, kept exactly as typed. */
  src?: string;
  /** One source per line: address | type | media. */
  mediaSources?: string;
  /** One track per line: address | kind | language | label | default. */
  tracks?: string;
  poster?: string;
  width?: string;
  height?: string;
  preload?: string;
  loading?: string;
  crossorigin?: string;
  controls?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  playsinline?: boolean;
  /** Text inside the element that a browser without media support shows. */
  fallback?: string;
}

export interface BuiltMedia {
  tree: El[];
  /** The copyable markup. */
  html: string;
  /** The same tree with every address removed and controls shown, so nothing in it can be loaded. */
  preview: string;
  warnings: string[];
}

/** What one builder returns: the tree, and a different tree for the preview when the plan says so. */
interface Draft {
  tree: El[];
  previewTree?: El[];
  warnings: string[];
}

const MAX_LINES = 20;

function blank(value: string | undefined): boolean {
  return (value ?? '').trim() === '';
}

function text(value: string | undefined): string {
  return value ?? '';
}

function lineError(field: string, line: number, message: string): MarkupError {
  return new MarkupError(field, `line ${line}: ${message}`);
}

/** The non-blank lines of a typed list with the line number the visitor sees, counting blank lines. */
function listLines(input: string): { raw: string; line: number }[] {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, index) => ({ raw, line: index + 1 }))
    .filter(({ raw }) => raw.trim() !== '');
}

// ---- Source lines -------------------------------------------------------------------------------------------------

/** One parsed source line. An empty cell is the empty string. */
export interface SourceLine {
  /** The address, kept exactly as typed apart from the spaces around the cell. */
  url: string;
  /** A MIME type, possibly with parameters such as codecs. */
  type: string;
  /** A media query list. */
  media: string;
  line: number;
}

const MIME_TOKEN = "[!#$%&'*+.^_`~0-9A-Za-z-]+";
const MIME_PARAMETER = `\\s*;\\s*${MIME_TOKEN}=(?:${MIME_TOKEN}|"(?:[^"\\\\]|\\\\.)*")`;
const MIME_TYPE = new RegExp(`^${MIME_TOKEN}/${MIME_TOKEN}(?:${MIME_PARAMETER})*\\s*$`);

/**
 * One source per line, cells split on a vertical bar and trimmed: address, type, media. Blank lines are skipped. At
 * most 20 sources. WHATWG 4.8.2: the address is required, the type a MIME type string, the media a media query list.
 */
export function parseSourceLines(input: string): SourceLine[] {
  assertSafeText(input, FIELD_LABELS.mediaSources, { multiline: true });
  const out: SourceLine[] = [];
  for (const { raw, line } of listLines(input)) {
    const cells = raw.split('|').map((c) => c.trim());
    if (cells.length > 3) {
      throw lineError(FIELD_LABELS.mediaSources, line, 'a source line has at most three cells: address | type | media');
    }
    const [url = '', type = '', media = ''] = cells;
    if (url === '') {
      throw lineError(
        FIELD_LABELS.mediaSources,
        line,
        'the address is empty; WHATWG 4.8.2 needs the src of every source',
      );
    }
    if (type !== '' && !MIME_TYPE.test(type)) {
      throw lineError(
        FIELD_LABELS.mediaSources,
        line,
        `"${type}" is not a MIME type; WHATWG 4.8.2 wants type/subtype, for example video/webm or video/mp4; codecs="avc1.42E01E"`,
      );
    }
    out.push({ url, type, media, line });
  }
  if (out.length > MAX_LINES) {
    throw new MarkupError(
      FIELD_LABELS.mediaSources,
      `${out.length} sources, but at most ${MAX_LINES} are written; remove some`,
    );
  }
  return out;
}

function sourceElement(source: SourceLine): El {
  return el(
    'source',
    [
      ['src', source.url],
      ['type', source.type === '' ? undefined : source.type],
      ['media', source.media === '' ? undefined : source.media],
    ],
    [],
  );
}

// ---- Track lines --------------------------------------------------------------------------------------------------

/** One parsed track line. An empty cell is the empty string. */
export interface TrackLine {
  /** The address, kept exactly as typed apart from the spaces around the cell. */
  url: string;
  /** The kind as typed; empty means the attribute is not written and the standard reads it as subtitles. */
  kind: string;
  srclang: string;
  label: string;
  isDefault: boolean;
  /** The line number the visitor sees, counting blank lines. */
  line: number;
}

/** The canonical form of a well-formed language tag (BCP 47), or null when the tag is not well formed. */
function canonicalLanguage(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

/** The kinds that share the one-default rule: subtitles with captions, descriptions, chapters. Metadata has no limit. */
function defaultGroup(kind: string): string | null {
  if (kind === 'subtitles' || kind === 'captions') return 'subtitles and captions';
  if (kind === 'descriptions' || kind === 'chapters') return kind;
  return null;
}

/**
 * One track per line, cells split on a vertical bar and trimmed: address, kind, language, label, default. Blank lines
 * are skipped. At most 20 tracks. WHATWG 4.8.10: the address is required; the kind is one of five keywords and a blank
 * kind is the subtitles state; subtitles need a well-formed srclang; a label is written only when typed; at most one
 * default among subtitles and captions, one among descriptions and one among chapters; no two tracks of the same kind,
 * the same language and the same label.
 */
export function parseTrackLines(input: string): TrackLine[] {
  assertSafeText(input, FIELD_LABELS.tracks, { multiline: true });
  const out: TrackLine[] = [];
  const defaults = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const { raw, line } of listLines(input)) {
    const cells = raw.split('|').map((c) => c.trim());
    if (cells.length > 5) {
      throw lineError(
        FIELD_LABELS.tracks,
        line,
        'a track line has at most five cells: address | kind | language | label | default',
      );
    }
    const [url = '', kind = '', srclang = '', label = '', flag = ''] = cells;
    if (url === '') {
      throw lineError(FIELD_LABELS.tracks, line, 'the address is empty; WHATWG 4.8.10 needs the src of every track');
    }
    if (kind !== '' && !(TRACK_KINDS as readonly string[]).includes(kind)) {
      throw lineError(
        FIELD_LABELS.tracks,
        line,
        `"${kind}" is not a track kind; WHATWG 4.8.10 allows ${TRACK_KINDS.join(', ')}`,
      );
    }
    const effectiveKind = kind === '' ? TRACK_KIND_DEFAULTS.missingValue : kind;
    if (srclang === '' && effectiveKind === 'subtitles') {
      throw lineError(
        FIELD_LABELS.tracks,
        line,
        'a subtitles track needs a language in the third cell, written as a language tag such as en or fr; WHATWG 4.8.10 requires srclang when the kind is subtitles (a blank kind means subtitles)',
      );
    }
    const language = srclang === '' ? '' : canonicalLanguage(srclang);
    if (language === null) {
      throw lineError(
        FIELD_LABELS.tracks,
        line,
        `"${srclang}" is not a well-formed language tag; WHATWG 4.8.10 wants a valid BCP 47 tag such as en, fr or en-GB`,
      );
    }
    if (flag !== '' && flag.toLowerCase() !== 'default') {
      throw lineError(
        FIELD_LABELS.tracks,
        line,
        `"${flag}" in the fifth cell is not understood; type default or leave it empty`,
      );
    }
    const isDefault = flag.toLowerCase() === 'default';
    const group = defaultGroup(effectiveKind);
    if (isDefault && group !== null) {
      const first = defaults.get(group);
      if (first !== undefined) {
        throw lineError(
          FIELD_LABELS.tracks,
          line,
          `a second default among ${group} tracks (line ${first} has one); WHATWG 4.8.10 allows at most one default for each of subtitles and captions, descriptions, and chapters`,
        );
      }
      defaults.set(group, line);
    }
    const key = JSON.stringify([effectiveKind, language, label]);
    const twin = seen.get(key);
    if (twin !== undefined) {
      throw lineError(
        FIELD_LABELS.tracks,
        line,
        `the same kind, language and label as line ${twin}; WHATWG 4.8.10 does not allow two tracks of the same kind, the same language and the same label, so change one of them`,
      );
    }
    seen.set(key, line);
    out.push({ url, kind, srclang, label, isDefault, line });
  }
  if (out.length > MAX_LINES) {
    throw new MarkupError(
      FIELD_LABELS.tracks,
      `${out.length} tracks, but at most ${MAX_LINES} are written; remove some`,
    );
  }
  return out;
}

function trackElement(track: TrackLine): El {
  return el(
    'track',
    [
      ['kind', track.kind === '' ? undefined : track.kind],
      ['src', track.url],
      ['srclang', track.srclang === '' ? undefined : track.srclang],
      ['label', track.label === '' ? undefined : track.label],
      ['default', track.isDefault ? true : undefined],
    ],
    [],
  );
}

// ---- Keywords and numbers -----------------------------------------------------------------------------------------

/** A value that must be one of the keywords of the standard, or blank for not written. */
function keyword(
  value: string | undefined,
  field: string,
  allowed: readonly string[],
  rule: string,
): string | undefined {
  const typed = text(value);
  if (typed === '') return undefined;
  if (!allowed.includes(typed)) {
    throw new MarkupError(field, `"${typed}" is not a keyword; ${rule} allows ${allowed.join(', ')}`);
  }
  return typed;
}

/** Width and height are valid non-negative integers (WHATWG 2.3.4.2), or blank. */
function dimension(value: string | undefined, field: string): string | undefined {
  const typed = text(value);
  assertSafeText(typed, field);
  if (blank(typed)) return undefined;
  if (!isValidNonNegativeInteger(typed)) {
    throw new MarkupError(
      field,
      `"${typed}" is not a valid non-negative integer; WHATWG 4.8.8 writes a size as whole pixels such as 640, with no sign, no decimal point and no unit`,
    );
  }
  return typed;
}

// ---- Video and audio ----------------------------------------------------------------------------------------------

/** The same tree with controls added to the media element when it has none; the markup itself is never changed. */
function withControls(tree: El[]): El[] {
  return tree.map((node) =>
    node.tag === 'video' || node.tag === 'audio'
      ? node.attrs.some(([name]) => name === 'controls')
        ? node
        : { ...node, attrs: [...node.attrs, ['controls', true] as [string, true]] }
      : node,
  );
}

/** An address with a scheme may be on another site; data and blob addresses never are. */
function mayBeCrossOrigin(address: string): boolean {
  const scheme = urlScheme(address);
  return scheme !== null && scheme !== 'data' && scheme !== 'blob';
}

function buildTimed(spec: MediaSpec, tag: 'video' | 'audio'): Draft | null {
  const section = tag === 'video' ? '4.8.8' : '4.8.9';
  const src = text(spec.src);
  const mediaSources = text(spec.mediaSources);
  const tracksText = text(spec.tracks);
  const poster = text(spec.poster);
  const fallback = text(spec.fallback);
  assertSafeText(src, FIELD_LABELS.src);
  assertSafeText(poster, FIELD_LABELS.poster);
  assertSafeText(fallback, FIELD_LABELS.fallback);

  // WHATWG 4.8.9: audio has no poster, width, height or playsinline, so a value given for one is refused.
  const width = dimension(spec.width, FIELD_LABELS.width);
  const height = dimension(spec.height, FIELD_LABELS.height);
  if (tag === 'audio') {
    const given: [string, boolean][] = [
      [FIELD_LABELS.poster, !blank(poster)],
      [FIELD_LABELS.width, width !== undefined],
      [FIELD_LABELS.height, height !== undefined],
      [FIELD_LABELS.playsinline, spec.playsinline === true],
    ];
    for (const [field, present] of given) {
      if (present) {
        throw new MarkupError(
          field,
          `an audio element does not take this; WHATWG ${section} lists no such attribute for audio`,
        );
      }
    }
  }

  if ([src, mediaSources, tracksText, poster, fallback].every(blank) && width === undefined && height === undefined) {
    return null;
  }

  const sources = parseSourceLines(mediaSources);
  const tracks = parseTrackLines(tracksText);
  if (!blank(src) && sources.length > 0) {
    throw new MarkupError(
      FIELD_LABELS.mediaSources,
      `a media element with a src attribute must not also have source elements (WHATWG ${section}); clear one of them`,
    );
  }
  if (blank(src) && sources.length === 0) {
    throw new MarkupError(
      FIELD_LABELS.src,
      `missing, type the address of the file or at least one source line (WHATWG ${section} needs a src attribute or a source element)`,
    );
  }
  const preload = keyword(spec.preload, FIELD_LABELS.preload, PRELOAD_KEYWORDS, 'WHATWG 4.8.11.5');
  const loading = keyword(spec.loading, FIELD_LABELS.loading, LOADING_KEYWORDS, 'WHATWG 2.5.7');
  const crossorigin = keyword(spec.crossorigin, FIELD_LABELS.crossorigin, CORS_KEYWORDS, 'WHATWG 2.5.4');

  const warnings: string[] = [];
  const addressWarnings: [string, string][] = [
    [FIELD_LABELS.src, src],
    [FIELD_LABELS.poster, poster],
    ...sources.map((s): [string, string] => [FIELD_LABELS.mediaSources, s.url]),
    ...tracks.map((t): [string, string] => [FIELD_LABELS.tracks, t.url]),
  ];
  for (const [field, address] of addressWarnings) {
    const warning = blank(address) ? null : schemeWarning(field, address);
    if (warning !== null) warnings.push(warning);
  }
  if (crossorigin === undefined && tracks.some((t) => mayBeCrossOrigin(t.url))) {
    warnings.push(
      "A track address starts with a scheme, so it may be on another site. Tracks are fetched with the media element's crossorigin setting (WHATWG 4.8.11.11.3), so a track from another site needs the crossorigin attribute here and CORS headers on the file.",
    );
  }
  if (spec.autoplay === true && spec.muted !== true) {
    warnings.push('Browsers commonly block autoplay unless the media is muted; it is kept as you chose.');
  }
  if (spec.autoplay === true && loading === 'lazy') {
    warnings.push(
      'Autoplay is kept, but lazy loading defers autoplay until the element is near the viewport (WHATWG 4.8.11).',
    );
  }
  if (loading !== undefined) {
    warnings.push(
      'The loading attribute on video and audio is in the HTML Living Standard, but when this tool was built only Chromium-based browsers acted on it.',
    );
  }
  if (tag === 'video' && (width === undefined || height === undefined)) {
    warnings.push(
      'Width and height are not both set. Giving both lets the browser reserve space for the video before it loads and avoids layout shift.',
    );
  }
  if (spec.controls !== true) {
    warnings.push(
      tag === 'audio'
        ? 'An audio element without controls is not displayed by the browser (WHATWG 4.8.9), so nothing shows on the page. The preview always shows controls so you can see it; your markup has none.'
        : 'Your markup has no controls, so a visitor cannot start or pause the video without script. The preview always shows controls so the element is visible.',
    );
  }

  const attrs: [string, string | true | undefined][] = [
    ['src', blank(src) ? undefined : src],
    ['poster', tag === 'video' && !blank(poster) ? poster : undefined],
    ['width', width],
    ['height', height],
    ['preload', preload],
    ['loading', loading],
    ['crossorigin', crossorigin],
    ['controls', spec.controls === true ? true : undefined],
    ['autoplay', spec.autoplay === true ? true : undefined],
    ['muted', spec.muted === true ? true : undefined],
    ['loop', spec.loop === true ? true : undefined],
    ['playsinline', tag === 'video' && spec.playsinline === true ? true : undefined],
  ];
  const tree = [
    el(tag, attrs, [
      ...sources.map(sourceElement),
      ...tracks.map(trackElement),
      blank(fallback) ? undefined : fallback,
    ]),
  ];
  return { tree, previewTree: withControls(tree), warnings };
}

/**
 * Builds the media element. Returns null when every field it reads is blank, throws MarkupError naming the field and
 * the broken rule when a value is refused. One tree is built; the markup and the preview are both written from it.
 */
export function buildMedia(spec: MediaSpec): BuiltMedia | null {
  let draft: Draft | null;
  switch (spec.kind) {
    case 'video':
    case 'audio':
      draft = buildTimed(spec, spec.kind);
      break;
    default:
      throw new MarkupError(FIELD_LABELS.kind, 'not a media element this builder writes');
  }
  if (draft === null) return null;
  return {
    tree: draft.tree,
    html: serialize(draft.tree),
    preview: serialize(inert(draft.previewTree ?? draft.tree)),
    warnings: draft.warnings,
  };
}
