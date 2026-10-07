import { MAX_FILENAME_CHARACTERS } from './limits';

/**
 * Code point ranges that are replaced in a file name: the control characters, characters that change the direction of
 * the text around them, characters with no visible shape (zero width, soft hyphen, byte order mark, variation
 * selectors, the invisible filler characters, the tag characters), blank characters that look like a space, and
 * unpaired surrogates. The same table the shared display helper uses, written here because a package never imports from
 * another file's private tables.
 */
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00a0, 0x00a0],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x1680, 0x1680],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x2800, 0x2800],
  [0x3000, 0x3000],
  [0x3164, 0x3164],
  [0xd800, 0xdfff],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0xfffe, 0xffff],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

function isHidden(point: number): boolean {
  for (const range of HIDDEN_RANGES) if (point >= range[0] && point <= range[1]) return true;
  return false;
}

/** The characters a Windows file name may not hold (the two slashes are handled before this). */
const RESERVED = ':*?"<>|';

const DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/** The longest extension kept when a long name is cut, in UTF-16 units. */
const MAX_KEPT_EXTENSION = 32;

/** A text cut to at most `limit` UTF-16 units, by whole code points (a surrogate pair is never split). */
function cutUnits(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let units = 0;
  let out = '';
  for (const ch of text) {
    if (units + ch.length > limit) break;
    out += ch;
    units += ch.length;
  }
  return out;
}

function joinName(base: string, extension: string, suffix: string): string {
  const room = MAX_FILENAME_CHARACTERS - extension.length - suffix.length;
  return cutUnits(base, Math.max(1, room)) + suffix + extension;
}

/** The result of cleaning one attachment name. */
export interface CleanName {
  /** The name to save the file under: never empty, unique among the names already taken. */
  name: string;
  /** True when the name differs from what the message wrote. */
  changed: boolean;
}

/**
 * Makes a name from a message safe to use as a file name. The part after the last slash or backslash is kept;
 * control, direction and zero-width characters and the characters : * ? " < > | become underscores; trailing dots and
 * spaces go and a leading run of dots becomes one underscore; a Windows device name gets a leading underscore; a name
 * over 120 UTF-16 units is cut by code point with its extension kept; an empty name becomes attachment-<n> (n is the
 * 1-based number of the attachment). A name already in `taken` (compared without regard to letter case) gets a number
 * before its extension: report.txt, report (2).txt. The cleaned name is added to `taken`.
 */
export function safeAttachmentName(raw: string, index: number, taken: Set<string>): CleanName {
  let name = raw;
  const cut = Math.max(name.lastIndexOf('/'), name.lastIndexOf(String.fromCharCode(92)));
  if (cut !== -1) name = name.slice(cut + 1);

  let cleaned = '';
  for (const ch of name) {
    const point = ch.codePointAt(0) ?? 0;
    cleaned += isHidden(point) || RESERVED.includes(ch) ? '_' : ch;
  }

  let end = cleaned.length;
  while (end > 0 && (cleaned.charCodeAt(end - 1) === 0x2e || cleaned.charCodeAt(end - 1) === 0x20)) end--;
  cleaned = cleaned.slice(0, end);

  if (cleaned.startsWith('.')) {
    let dots = 0;
    while (dots < cleaned.length && cleaned.charCodeAt(dots) === 0x2e) dots++;
    cleaned = '_' + cleaned.slice(dots);
  }

  if (cleaned === '') cleaned = `attachment-${index}`;

  const firstDot = cleaned.indexOf('.');
  const stem = (firstDot === -1 ? cleaned : cleaned.slice(0, firstDot)).toLowerCase();
  if (DEVICE_NAMES.has(stem.trimEnd())) cleaned = '_' + cleaned;

  const lastDot = cleaned.lastIndexOf('.');
  const hasExtension = lastDot > 0 && cleaned.length - lastDot <= MAX_KEPT_EXTENSION;
  const base = hasExtension ? cleaned.slice(0, lastDot) : cleaned;
  const extension = hasExtension ? cleaned.slice(lastDot) : '';

  let candidate = joinName(base, extension, '');
  let number = 1;
  while (taken.has(candidate.toLowerCase())) {
    number++;
    candidate = joinName(base, extension, ` (${number})`);
  }
  taken.add(candidate.toLowerCase());
  return { name: candidate, changed: candidate !== raw };
}

const BACKSLASH_U = String.fromCharCode(92) + 'u{';

/**
 * A body of text made safe to show: line ends become one line feed, tabs stay, and every other control, direction,
 * zero-width or invisible character is written as an escape (backslash, u, braces and the code point in hex), so no
 * character in a message can reorder or hide the text around it.
 */
export function showBody(text: string): string {
  const parts: string[] = [];
  let run = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0d) {
      run += '\n';
      if (text.charCodeAt(i + 1) === 0x0a) i++;
    } else if (code === 0x0a || code === 0x09) run += text[i];
    else if (code < 0x80 && code >= 0x20 && code !== 0x7f) run += text[i];
    else {
      const point = text.codePointAt(i) ?? code;
      if (point > 0xffff) i++;
      run += isHidden(point) ? BACKSLASH_U + point.toString(16).toUpperCase() + '}' : String.fromCodePoint(point);
    }
    if (run.length > 4096) {
      parts.push(run);
      run = '';
    }
  }
  parts.push(run);
  return parts.join('');
}
