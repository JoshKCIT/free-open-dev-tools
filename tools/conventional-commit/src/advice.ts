import { MAX_SHOWN_CHARACTERS } from './limits';
import { footerStart, isWhiteCode, type ParsedMessage } from './parse';
import { visible } from './visible';

/**
 * What kind of note this is. `convention` notes are common habits that the specification does not ask for (it allows any
 * type, any length and any case). `specification` notes say how the numbered rules were applied to a line that a reader
 * might expect to count and does not. Neither ever changes whether a message is valid.
 */
export type AdviceLabel = 'convention' | 'specification';

export interface AdviceItem {
  /** A short stable name for the kind of note. */
  code: string;
  label: AdviceLabel;
  /** A plain sentence. It shows at most 40 characters of the message, through `visible`. */
  message: string;
}

/** The types the specification's own bullet list names (from the Angular convention): common, not required. */
const COMMON_TYPES: readonly string[] = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
];

/** Header length many teams keep to, and the length beyond which most tools cut a header. */
const HEADER_SOFT_LIMIT = 72;
const HEADER_HARD_LIMIT = 100;

/**
 * Code point ranges of characters with no visible shape, or that change the direction of the text around them: the soft
 * hyphen, joiners, zero width spaces, direction marks and overrides, word joiners and the invisible operators, variation
 * selectors, filler characters, the tag characters and the control characters other than tab, line feed and carriage return.
 * No-break space, tab and ordinary spaces are not here: a no-break space is named where it matters, after the colon.
 */
const HIDDEN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

function isHidden(point: number): boolean {
  for (const range of HIDDEN_RANGES) {
    if (point >= range[0] && point <= range[1]) return true;
  }
  return false;
}

/** Colon look-alikes: the fullwidth colon and the small colon. */
function isColonLookAlike(point: number): boolean {
  return point === 0xff1a || point === 0xfe55;
}

/** Space-like characters other than the ordinary space: they look like the space after the colon and are not it. */
function isSpaceLike(point: number): boolean {
  return (
    point === 9 ||
    point === 11 ||
    point === 12 ||
    point === 0xa0 ||
    point === 0x1680 ||
    (point >= 0x2000 && point <= 0x200a) ||
    point === 0x202f ||
    point === 0x205f ||
    point === 0x3000 ||
    point === 0xfeff
  );
}

function spaceName(point: number): string {
  if (point === 9) return 'a tab';
  if (point === 0xa0) return 'a no-break space (U+00A0)';
  return `a space-like character (U+${point.toString(16).toUpperCase().padStart(4, '0')})`;
}

type Script = 'latin' | 'cyrillic' | 'greek' | 'other';

function scriptOf(point: number): Script {
  if ((point >= 65 && point <= 90) || (point >= 97 && point <= 122) || (point >= 0xc0 && point <= 0x24f))
    return 'latin';
  if (point >= 0x400 && point <= 0x52f) return 'cyrillic';
  if (point >= 0x370 && point <= 0x3ff) return 'greek';
  return 'other';
}

/** True when the type mixes Latin letters with Cyrillic or Greek ones, which can look alike. */
function mixesAlphabets(type: string): boolean {
  let latin = false;
  let cyrillic = false;
  let greek = false;
  for (const ch of type) {
    const script = scriptOf(ch.codePointAt(0) as number);
    if (script === 'latin') latin = true;
    else if (script === 'cyrillic') cyrillic = true;
    else if (script === 'greek') greek = true;
  }
  return (latin && (cyrillic || greek)) || (cyrillic && greek);
}

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) return true;
  }
  return false;
}

function hasWhite(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (isWhiteCode(text.charCodeAt(i))) return true;
  }
  return false;
}

/** The first code point of a string that is a letter with an upper case form that differs from its lower case form. */
function startsWithCapital(text: string): boolean {
  const first = String.fromCodePoint(text.codePointAt(0) ?? 0);
  return first !== first.toLowerCase() && first === first.toUpperCase();
}

function hasHiddenCharacter(text: string): boolean {
  let index = 0;
  for (const ch of text) {
    const point = ch.codePointAt(0) as number;
    // A byte order mark at the very start is dropped when the message is read, so it is not a finding.
    if (isHidden(point) && !(point === 0xfeff && index === 0)) return true;
    index += ch.length;
  }
  return false;
}

/**
 * Convention notes for a message: an unknown type, a long header, a capital first letter, a trailing period, a space in the
 * scope, a type outside ASCII, look-alike characters (a fullwidth colon, a space-like character after the colon, a type
 * that mixes alphabets, hidden characters), and three notes on how the specification was applied: a lower case or mixed
 * case "breaking change" line, a BREAKING CHANGE line that follows body text without a blank line, and a BREAKING CHANGE
 * line that is not a footer (a plural, a colon that ends the line, no space after the colon, no colon, or text inside
 * another footer value), none of which is a breaking change (rules 8, 10, 12 and 15). The body, every footer value and
 * the footer tokens are read for them. Each kind is given at most once per message.
 *
 * `raw` is the whole message as pasted (the header is used when none is given). A note is made for what could be read even
 * when the message is not valid. This function only reads: it never changes the message or whether it is valid.
 */
export function adviceFor(parsed: ParsedMessage, raw: string = parsed.header): AdviceItem[] {
  const out: AdviceItem[] = [];
  const add = (code: string, label: AdviceLabel, message: string): void => {
    out.push({ code, label, message });
  };
  const header = parsed.header;

  // Look-alikes in the header come first: they are why a header that looks right is not read.
  let colonLookAlike = -1;
  for (const ch of header) {
    const point = ch.codePointAt(0) as number;
    if (isColonLookAlike(point)) {
      colonLookAlike = point;
      break;
    }
  }
  if (colonLookAlike >= 0) {
    add(
      'fullwidth-colon',
      'convention',
      `The header holds a look-alike of the colon (U+${colonLookAlike.toString(16).toUpperCase().padStart(4, '0')}). It looks like a colon but is not one, so the prefix is not read.`,
    );
  }
  const colon = header.indexOf(':');
  if (colon >= 0 && colon + 1 < header.length) {
    const next = header.codePointAt(colon + 1) as number;
    if (next !== 32 && isSpaceLike(next)) {
      add(
        'nbsp-after-colon',
        'convention',
        `The character after the colon is ${spaceName(next)}. It looks like the space the specification asks for and is not one.`,
      );
    }
  }
  if (parsed.type !== null && mixesAlphabets(parsed.type)) {
    add(
      'mixed-script',
      'convention',
      `The type "${visible(parsed.type, MAX_SHOWN_CHARACTERS)}" mixes alphabets (for example Latin and Cyrillic letters), which can look alike and are different characters.`,
    );
  }
  if (parsed.type !== null && hasNonAscii(parsed.type)) {
    add(
      'type-non-ascii',
      'convention',
      `The type "${visible(parsed.type, MAX_SHOWN_CHARACTERS)}" uses characters outside the ASCII letters. The specification allows it, but tools that match types by name may not recognise it.`,
    );
  }
  if (hasHiddenCharacter(raw) || hasHiddenCharacter(header)) {
    add(
      'hidden-character',
      'convention',
      'The message holds a hidden or direction-changing character, such as a zero width space. It is shown as an escape where this page shows the text.',
    );
  }

  // Habits.
  if (parsed.type !== null && !COMMON_TYPES.includes(parsed.type.toLowerCase())) {
    add(
      'unknown-type',
      'convention',
      `The type "${visible(parsed.type, MAX_SHOWN_CHARACTERS)}" is not one of the types most teams use (${COMMON_TYPES.join(', ')}). The specification allows any type, but tools that group by type may not know this one.`,
    );
  }
  if (header.length > HEADER_HARD_LIMIT) {
    add(
      'header-very-long',
      'convention',
      `The header is ${header.length} characters long. Many tools cut a header at ${HEADER_HARD_LIMIT}; the specification sets no length.`,
    );
  } else if (header.length > HEADER_SOFT_LIMIT) {
    add(
      'header-long',
      'convention',
      `The header is ${header.length} characters long. Many teams keep it to ${HEADER_SOFT_LIMIT} or fewer; the specification sets no length.`,
    );
  }
  if (parsed.description !== '' && startsWithCapital(parsed.description)) {
    add(
      'capital-first',
      'convention',
      'The description starts with a capital letter. Many teams start it in lower case; the specification allows both.',
    );
  }
  if (parsed.description.endsWith('.')) {
    add(
      'trailing-period',
      'convention',
      'The description ends with a period. Many teams leave it off; the specification allows it.',
    );
  }
  if (parsed.scope !== null && hasWhite(parsed.scope)) {
    add(
      'scope-space',
      'convention',
      'The scope holds a space. A scope is usually one word naming a part of the codebase, such as api.',
    );
  }

  // How the numbered rules were applied: lines that look like a breaking change and do not mark one. The body is read
  // line by line, and so is every footer value, because a line that is not a valid token continues the value of the
  // footer before it (rule 10). Footer tokens are read too, for a plural or a different case written with a hyphen.
  const found: BreakingLook = { wrongCase: false, glued: false, reasons: [] };
  for (const footer of parsed.footers) {
    if (footer.token === BREAKING_CHANGE || footer.token === BREAKING_HYPHEN) continue;
    const token = footer.token;
    if (token.length === BREAKING_HYPHEN.length || (token.length === BREAKING_HYPHEN.length + 1 && isS(token, 15))) {
      lookAtLine(token + ':', 'footer', found);
    }
  }
  const body = parsed.body.split('\n');
  for (let i = 0; i < body.length; i++) lookAtLine(body[i] as string, i > 0 ? 'body-after-text' : 'body', found);
  for (const footer of parsed.footers) {
    for (const line of footer.value.split('\n')) lookAtLine(line, 'value', found);
  }
  const wrongCase = found.wrongCase;
  const glued = found.glued;
  if (wrongCase) {
    add(
      'breaking-case',
      'specification',
      'A line starts with "breaking change" in a different case from BREAKING CHANGE. Only the upper case text marks a breaking change (rules 12 and 15), so this line does not.',
    );
  }
  if (glued) {
    add(
      'breaking-glued',
      'specification',
      'A BREAKING CHANGE line follows body text without a blank line before it. Footers begin one blank line after the body (rule 8), so this line is part of the body and does not mark a breaking change. Put a blank line before it to make it a breaking change. Many release tools count this line as breaking anyway, so the version they choose may be higher than the one shown here.',
    );
  }
  if (found.reasons.length > 0) {
    add(
      'breaking-not-footer',
      'specification',
      `Text that starts with BREAKING CHANGE does not mark a breaking change here: ${found.reasons.join('; ')}. A breaking change footer is BREAKING CHANGE or BREAKING-CHANGE in upper case, a colon, a space and the description, one blank line after the body (rules 8, 12 and 16).`,
    );
  }
  return out;
}

const BREAKING_CHANGE = 'BREAKING CHANGE';
const BREAKING_HYPHEN = 'BREAKING-CHANGE';

/** Where a line was found: the first body line, a body line after another, a line of a footer value, or a footer token. */
type Place = 'body' | 'body-after-text' | 'value' | 'footer';

interface BreakingLook {
  wrongCase: boolean;
  glued: boolean;
  /** Distinct plain-words reasons, in the order they were first found. They never hold pasted text. */
  reasons: string[];
}

/** True when the character at `index` is an S in either case. */
function isS(text: string, index: number): boolean {
  const c = text.charCodeAt(index);
  return c === 83 || c === 115;
}

/** True when `line` starts with `word` (upper case ASCII letters, a space or a hyphen), the letters in any ASCII case. */
function startsWithAnyCase(line: string, word: string): boolean {
  if (line.length < word.length) return false;
  for (let k = 0; k < word.length; k++) {
    let c = line.charCodeAt(k);
    if (c >= 97 && c <= 122) c -= 32;
    if (c !== word.charCodeAt(k)) return false;
  }
  return true;
}

const PLACE_WORDS: Record<Place, string> = {
  body: 'so it is read as body text',
  'body-after-text': 'so it is read as body text',
  value: 'so it is read as part of the value of another footer',
  footer: 'so it is read as an ordinary footer',
};

/**
 * Looks at one line for a breaking change that does not count. A line counts as a try when it starts with BREAKING CHANGE
 * or BREAKING-CHANGE in any case, optionally followed by S, and then the end of the line, a colon or white space (so that
 * BREAKING-CHANGELOG is not one). In a different case it is a try only when a colon follows (so that prose such as
 * "Breaking changes are listed" is not one). Only the first 16 characters are looked at, so a long line costs nothing more.
 */
function lookAtLine(line: string, place: Place, found: BreakingLook): void {
  const token = startsWithAnyCase(line, BREAKING_CHANGE)
    ? BREAKING_CHANGE
    : startsWithAnyCase(line, BREAKING_HYPHEN)
      ? BREAKING_HYPHEN
      : null;
  if (token === null) return;
  const plural = isS(line, token.length);
  const end = token.length + (plural ? 1 : 0);
  const next = line.charCodeAt(end);
  if (!(end === line.length || next === 58 || isWhiteCode(next))) return;
  if (!line.startsWith(token) || (plural && line.charCodeAt(token.length) !== 83)) {
    if (next === 58) found.wrongCase = true;
    return;
  }
  let reason: string;
  if (plural) {
    reason = `it says ${token}S, and the token has no S`;
  } else if (footerStart(line) !== null) {
    // The shape of a footer. In the body it can only follow body text with no blank line between (rule 8); in a value it
    // is the text after another footer's token on the same line.
    if (place === 'body-after-text') {
      found.glued = true;
      return;
    }
    if (place !== 'value') return;
    reason = 'it follows the token of another footer on the same line';
  } else if (next === 58 && end + 1 === line.length) {
    reason = 'the colon ends the line with no space after it (with one space, the next line would be its description)';
  } else if (next === 58) {
    reason = 'the colon is not followed by a space';
  } else {
    reason = 'no colon and space follow it';
  }
  const sentence = `${reason}, ${PLACE_WORDS[place]}`;
  if (!found.reasons.includes(sentence)) found.reasons.push(sentence);
}
