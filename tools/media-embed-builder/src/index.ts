import meta from './meta.json';
import { MarkupError, assertSafeText, el, inert, schemeWarning, serialize, type El } from './markup';
import { TRACK_KINDS } from './spec-data';

export { meta };
export { MarkupError } from './markup';

/** The media the builder writes, in the order the page lists them. */
export const MEDIA_KINDS = ['video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** The label each field has on the page; a refusal names the field by this text. */
export const FIELD_LABELS = {
  kind: 'Media',
  src: 'Media address',
  tracks: 'Tracks',
  controls: 'Show controls',
} as const;

export interface MediaSpec {
  kind: MediaKind;
  /** The address of the media file, kept exactly as typed. */
  src?: string;
  /** One track per line: address | kind | language | label | default. */
  tracks?: string;
  controls?: boolean;
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

function trackError(line: number, message: string): MarkupError {
  return new MarkupError(FIELD_LABELS.tracks, `line ${line}: ${message}`);
}

/**
 * One track per line, cells split on a vertical bar and trimmed: address, kind, language, label, default. Blank lines
 * are skipped. At most 20 tracks. WHATWG 4.8.10: the address is required and the kind is one of five keywords.
 */
export function parseTrackLines(input: string): TrackLine[] {
  assertSafeText(input, FIELD_LABELS.tracks, { multiline: true });
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  const out: TrackLine[] = [];
  lines.forEach((raw, index) => {
    if (raw.trim() === '') return;
    const line = index + 1;
    const cells = raw.split('|').map((c) => c.trim());
    const [url = '', kind = '', srclang = '', label = '', flag = ''] = cells;
    if (url === '') throw trackError(line, 'the address is empty; WHATWG 4.8.10 needs the src of every track');
    if (kind !== '' && !(TRACK_KINDS as readonly string[]).includes(kind)) {
      throw trackError(line, `"${kind}" is not a track kind; WHATWG 4.8.10 allows ${TRACK_KINDS.join(', ')}`);
    }
    out.push({ url, kind, srclang, label, isDefault: flag.toLowerCase() === 'default', line });
  });
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

// ---- Video --------------------------------------------------------------------------------------------------------

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

function buildVideo(spec: MediaSpec): Draft | null {
  const src = text(spec.src);
  const tracksText = text(spec.tracks);
  assertSafeText(src, FIELD_LABELS.src);
  if ([src, tracksText].every(blank)) return null;
  const tracks = parseTrackLines(tracksText);
  if (blank(src)) {
    throw new MarkupError(FIELD_LABELS.src, 'missing, a video needs the address of the file (WHATWG 4.8.8)');
  }
  const warnings: string[] = [];
  const warning = schemeWarning(FIELD_LABELS.src, src);
  if (warning !== null) warnings.push(warning);
  for (const track of tracks) {
    const trackWarning = schemeWarning(FIELD_LABELS.tracks, track.url);
    if (trackWarning !== null) warnings.push(trackWarning);
  }
  const tree = [
    el(
      'video',
      [
        ['src', src],
        ['controls', spec.controls === true ? true : undefined],
      ],
      tracks.map(trackElement),
    ),
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
      draft = buildVideo(spec);
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
