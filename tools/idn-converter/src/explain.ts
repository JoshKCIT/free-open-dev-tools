import { toASCII, toUnicode } from 'tr46';
import type { Tr46Options } from 'tr46';
import type { Profile } from './profiles';

/**
 * The rule families the Unicode conformance data (IdnaTestV2.txt) groups its status codes into, as this page names them:
 * hyphens (V2, V3), bidirectional text (B1 to B6), joiners (C1, C2), characters not allowed in a host name (U1, STD3),
 * label and name length (A4_1, A4_2), characters and labels that cannot be processed (P4, V1, V4, V6, V7, A3) and an empty
 * label (X4_2; the data also gives A4_1 and A4_2 for one).
 */
export const PROBLEM_FAMILIES = ['hyphen', 'bidi', 'joiner', 'std3', 'length', 'processing', 'empty-label'] as const;
export type ProblemFamily = (typeof PROBLEM_FAMILIES)[number];

/** The family names in words, for the page. */
export const FAMILY_WORDS: ReadonlyMap<string, string> = new Map<string, string>([
  ['hyphen', 'Hyphens'],
  ['bidi', 'Bidirectional text'],
  ['joiner', 'Joiner characters'],
  ['std3', 'Characters not allowed in a host name'],
  ['length', 'Length'],
  ['processing', 'Characters or labels that cannot be processed'],
  ['empty-label', 'Empty label'],
]);

export interface LabelProblem {
  /** The label the problem is in, counting from 1 in the mapped name, or 0 for a problem of the whole name. */
  label: number;
  family: ProblemFamily;
  /** Plain printable ASCII, at most a few hundred characters; it never repeats pasted text. */
  message: string;
  /** Offending code points as `U+XXXX` values, at most 8; the message says how many more there are. */
  codePoints: string[];
}

export type ExplainDirection = 'to-ascii' | 'to-unicode';

/** The most code points one problem lists. */
const MAX_LISTED_CODE_POINTS = 8;
/** The most characters whose mapping is remembered between calls. */
const MAX_CACHED_CHARACTERS = 20_000;
/** A right-to-left letter: a label that is valid on its own, used to make a name a bidirectional name. */
const RIGHT_TO_LEFT_LABEL = String.fromCodePoint(0x5d0);

/** Every optional check off: what is left are the basic rules every name must meet. */
const ALL_OFF: Tr46Options = {
  checkHyphens: false,
  checkBidi: false,
  checkJoiners: false,
  useSTD3ASCIIRules: false,
  verifyDNSLength: false,
  transitionalProcessing: false,
  ignoreInvalidPunycode: false,
};

interface CharacterInfo {
  /** What UTS #46 maps this code point to (itself, another string, or nothing). */
  mapped: string;
  /** True when its status in the mapping table is disallowed. */
  disallowed: boolean;
}

const CHARACTERS = new Map<string, CharacterInfo>();

/**
 * What UTS #46 does with one code point, found by asking tr46 about it after a neutral digit (a digit never joins to
 * the character after it when the string is normalised, and a label that starts with a digit has no leading combining
 * mark, so the only error left is the code point itself being disallowed).
 */
function characterInfo(ch: string): CharacterInfo {
  const known = CHARACTERS.get(ch);
  if (known !== undefined) return known;
  const result = toUnicode('0' + ch, ALL_OFF);
  const info: CharacterInfo = { mapped: result.domain.slice(1), disallowed: result.error };
  if (CHARACTERS.size >= MAX_CACHED_CHARACTERS) CHARACTERS.clear();
  CHARACTERS.set(ch, info);
  return info;
}

/** The name after the Map and Normalize steps of UTS #46 section 4 (the dots the mapping makes are dots). */
function mappedName(name: string): string {
  let mapped = '';
  for (const ch of name) mapped += characterInfo(ch).mapped;
  return mapped.normalize('NFC');
}

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return true;
  return false;
}

/** `U+XXXX` with at least four hex digits. */
function formatCodePoint(point: number): string {
  return 'U+' + point.toString(16).toUpperCase().padStart(4, '0');
}

type XnState = 'none' | 'non-ascii' | 'undecodable' | 'ascii-only' | 'decoded';

interface LabelView {
  /** The label as UTS #46 validates it: Punycode labels decoded when they can be. */
  shown: string;
  xn: XnState;
  /** The label fails the basic checks (every optional check off). */
  basicFailure: boolean;
}

/** Looks at one label of the mapped name (no dots in it). */
function viewLabel(label: string): LabelView {
  let shown = label;
  let xn: XnState = 'none';
  if (label.startsWith('xn--')) {
    if (hasNonAscii(label)) {
      xn = 'non-ascii';
    } else {
      const result = toUnicode(label, ALL_OFF);
      if (result.error && result.domain === label) {
        xn = 'undecodable';
      } else {
        shown = result.domain;
        xn = shown === '' || !hasNonAscii(shown) ? 'ascii-only' : 'decoded';
      }
    }
  }
  return { shown, xn, basicFailure: label !== '' && toASCII(label, ALL_OFF) === null };
}

/** Kinds of problem, each with one message; the same kind found in several labels is reported once with a count. */
type Kind =
  | 'disallowed'
  | 'xn-non-ascii'
  | 'xn-undecodable'
  | 'xn-ascii-only'
  | 'leading-mark'
  | 'not-nfc'
  | 'other'
  | 'empty'
  | 'empty-decoded'
  | 'root-dot'
  | 'label-long'
  | 'name-long'
  | 'hyphen-third-fourth'
  | 'hyphen-edge'
  | 'std3'
  | 'joiner'
  | 'bidi'
  | 'bidi-name';

interface Found {
  kind: Kind;
  family: ProblemFamily;
  /** The first label with this problem (0: the whole name). */
  label: number;
  codePoints: number[];
  /** Further labels with the same problem. */
  more: number;
  /** A length in octets, for the length kinds. */
  octets: number;
}

function listText(points: readonly number[]): string {
  const shown = points.slice(0, MAX_LISTED_CODE_POINTS).map(formatCodePoint);
  const rest = points.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
}

function moreText(more: number): string {
  if (more === 0) return '';
  return more === 1 ? ' 1 more label has the same problem.' : ` ${more} more labels have the same problem.`;
}

function messageOf(found: Found): string {
  const n = found.label;
  const tail = moreText(found.more);
  switch (found.kind) {
    case 'disallowed':
      return `Label ${n} has a character that is not allowed in a domain name (${listText(found.codePoints)}). UTS #46 has no use for it, so the name cannot be converted.${tail}`;
    case 'xn-non-ascii':
      return `Label ${n} starts with xn-- but holds a character that is not ASCII. A label that starts with xn-- must be ASCII Punycode.${tail}`;
    case 'xn-undecodable':
      return `Label ${n} starts with xn-- but cannot be decoded as Punycode: its digits are not valid, or the number they give is too large.${tail}`;
    case 'xn-ascii-only':
      return `Label ${n} starts with xn-- but decodes to nothing or to ASCII only. Punycode is for labels that hold at least one character that is not ASCII.${tail}`;
    case 'leading-mark':
      return `Label ${n} starts with a combining mark (${listText(found.codePoints)}). A label may not begin with one.${tail}`;
    case 'not-nfc':
      return `Label ${n} is not in Unicode normalization form C once its Punycode is decoded.${tail}`;
    case 'other':
      return `Label ${n} cannot be processed under the UTS #46 rules.${tail}`;
    case 'empty':
      return `Label ${n} is empty: the name starts with a full stop or has two full stops in a row, and a DNS name has no empty labels.${tail}`;
    case 'empty-decoded':
      return `Label ${n} is xn-- with nothing after it, so it decodes to an empty label, and a DNS name has no empty labels.${tail}`;
    case 'root-dot':
      return `The name ends with a full stop, so its last label (label ${n}) is empty. UTS #46 asks every label to be 1 to 63 octets when it checks DNS lengths, and the strict profile does not accept the empty root label. Remove the final full stop, or use the browser profile.`;
    case 'label-long':
      return `Label ${n} is ${found.octets} octets long in ASCII form. A label may be at most 63 octets.${tail}`;
    case 'name-long':
      return `The name is ${found.octets} octets long in ASCII form (a final full stop does not count). A name may be at most 253 octets.`;
    case 'hyphen-third-fourth':
      return `Label ${n} has hyphens in its third and fourth positions. UTS #46 keeps those positions for labels such as xn--.${tail}`;
    case 'hyphen-edge':
      return `Label ${n} begins or ends with a hyphen, which the strict profile does not allow.${tail}`;
    case 'std3':
      return `Label ${n} has an ASCII character that is not a letter, a digit or a hyphen (${listText(found.codePoints)}). The strict profile allows only those ASCII characters in a host name.${tail}`;
    case 'joiner':
      return `Label ${n} has a joiner character (${listText(found.codePoints)}) where the joiner rules (RFC 5892 appendix A) do not allow one. A zero width joiner is only allowed straight after a virama (a mark of the Indic scripts); a zero width non-joiner is also allowed between certain letters of joining scripts such as Arabic.${tail}`;
    case 'bidi':
      return `Label ${n} breaks the bidirectional text rules (RFC 5893 section 2). Because a label of the name is written right to left, every label must start with a letter, hold only characters allowed for its direction and end with a letter or a digit.${tail}`;
    case 'bidi-name':
      return 'The name breaks the bidirectional text rules (RFC 5893 section 2), but no single label could be named.';
  }
}

/** The order problems of one label are listed in: the basic rules first, which the others may depend on. */
const LISTING_ORDER: readonly ProblemFamily[] = [
  'processing',
  'empty-label',
  'hyphen',
  'std3',
  'joiner',
  'bidi',
  'length',
];
const FAMILY_RANK = new Map<ProblemFamily, number>(
  LISTING_ORDER.map((family, index): [ProblemFamily, number] => [family, index]),
);

/** Collects problems by kind: the first label with a kind is reported and the others are counted. */
class Collector {
  private readonly byKind = new Map<Kind, Found>();

  add(kind: Kind, family: ProblemFamily, label: number, codePoints: readonly number[] = [], octets = 0): void {
    const found = this.byKind.get(kind);
    if (found === undefined) {
      this.byKind.set(kind, { kind, family, label, codePoints: [...new Set(codePoints)], more: 0, octets });
    } else {
      found.more += 1;
    }
  }

  results(): LabelProblem[] {
    const all = [...this.byKind.values()];
    // Label order, then the order of the families; a problem of the whole name (label 0) goes last.
    all.sort((a, b) => {
      const byLabel =
        (a.label === 0 ? Number.MAX_SAFE_INTEGER : a.label) - (b.label === 0 ? Number.MAX_SAFE_INTEGER : b.label);
      if (byLabel !== 0) return byLabel;
      return (FAMILY_RANK.get(a.family) ?? 0) - (FAMILY_RANK.get(b.family) ?? 0);
    });
    return all.map((found) => ({
      label: found.label,
      family: found.family,
      message: messageOf(found),
      codePoints: found.codePoints.slice(0, MAX_LISTED_CODE_POINTS).map(formatCodePoint),
    }));
  }
}

function codePointsOf(text: string): number[] {
  const points: number[] = [];
  for (const ch of text) points.push(ch.codePointAt(0) ?? 0);
  return points;
}

/**
 * Explains why a name is not valid under a profile, in the rule families the Unicode conformance data uses. tr46 says
 * only that a name passes or fails, so the explanation is made by asking it more questions: every optional check off
 * (the basic rules) for each label of the name as UTS #46 maps it, then one check at a time, with the tool's own scans to
 * say which label and which code points. A name that fails the basic rules is explained by those; the optional families
 * that cannot be told apart from it are named only where a scan of the label itself finds them (hyphens, STD3
 * characters, lengths, joiners).
 *
 * Bidirectional rules are a property of the whole name: a name is a bidirectional name if any of its labels has a
 * right-to-left character, and then every label must meet them. Each label is therefore tried in the company of a
 * right-to-left label.
 *
 * The result is empty exactly when the name is valid under the profile (lengths are only checked going to ASCII).
 */
export function explainName(name: string, profile: Profile, direction: ExplainDirection = 'to-ascii'): LabelProblem[] {
  const collector = new Collector();
  const labels = mappedName(name).split('.');
  const views = labels.map(viewLabel);
  const basicFailed = views.some((view) => view.basicFailure);

  // The basic rules, label by label (UTS #46 section 4, steps Convert/Validate, and validity criteria 1, 4 to 7).
  views.forEach((view, index) => {
    if (!view.basicFailure) return;
    const n = index + 1;
    if (view.xn === 'non-ascii') collector.add('xn-non-ascii', 'processing', n);
    else if (view.xn === 'undecodable') collector.add('xn-undecodable', 'processing', n);
    else if (view.xn === 'ascii-only') collector.add('xn-ascii-only', 'processing', n);
    else {
      const bad = codePointsOf(view.shown).filter((point) => characterInfo(String.fromCodePoint(point)).disallowed);
      if (bad.length > 0) collector.add('disallowed', 'processing', n, bad);
      else if (view.shown.normalize('NFC') !== view.shown) collector.add('not-nfc', 'processing', n);
      else if (toASCII('0' + view.shown, ALL_OFF) !== null)
        collector.add('leading-mark', 'processing', n, [view.shown.codePointAt(0) ?? 0]);
      else collector.add('other', 'processing', n);
    }
  });

  // An empty label (also one that Punycode decodes to nothing) anywhere but the one empty root label after a final full
  // stop (the data's X4_2).
  const hasRoot = labels.length > 1 && labels[labels.length - 1] === '';
  let emptyFound = false;
  views.forEach((view, index) => {
    if (hasRoot && index === labels.length - 1) return;
    if (labels[index] === '') {
      emptyFound = true;
      collector.add('empty', 'empty-label', index + 1);
    } else if (view.xn === 'ascii-only' && view.shown === '') {
      emptyFound = true;
      collector.add('empty-decoded', 'empty-label', index + 1);
    }
  });
  if (direction === 'to-ascii' && profile.verifyDNSLength && hasRoot && !emptyFound)
    collector.add('root-dot', 'length', labels.length);

  // Optional rules found by scanning the label as UTS #46 validates it (the decoded form of a Punycode label).
  views.forEach((view, index) => {
    if (view.xn === 'non-ascii' || view.xn === 'undecodable' || view.shown === '') return;
    const n = index + 1;
    const points = codePointsOf(view.shown);
    if (profile.checkHyphens) {
      if (points[2] === 0x2d && points[3] === 0x2d) collector.add('hyphen-third-fourth', 'hyphen', n);
      if (points[0] === 0x2d || points[points.length - 1] === 0x2d) collector.add('hyphen-edge', 'hyphen', n);
    }
    if (profile.useSTD3ASCIIRules) {
      const bad = points.filter(
        (point) =>
          point <= 0x7f && !((point >= 0x61 && point <= 0x7a) || (point >= 0x30 && point <= 0x39) || point === 0x2d),
      );
      if (bad.length > 0) collector.add('std3', 'std3', n, bad);
    }
    if (
      profile.checkJoiners &&
      !view.basicFailure &&
      toASCII(labels[index] ?? '', { ...ALL_OFF, checkJoiners: true }) === null
    ) {
      collector.add(
        'joiner',
        'joiner',
        n,
        points.filter((point) => point === 0x200c || point === 0x200d),
      );
    }
  });

  // Bidirectional rules, on the whole name, when the basic rules do not already hide them.
  if (profile.checkBidi && !basicFailed && toASCII(name, { ...ALL_OFF, checkBidi: true }) === null) {
    let named = false;
    labels.forEach((label, index) => {
      if (label === '') return;
      if (toASCII(RIGHT_TO_LEFT_LABEL + '.' + label, { ...ALL_OFF, checkBidi: true }) !== null) return;
      named = true;
      collector.add('bidi', 'bidi', index + 1);
    });
    if (!named) collector.add('bidi-name', 'bidi', 0);
  }

  // Lengths in octets of the ASCII form (UTS #46 section 4.2): each label 1 to 63, the name 1 to 253 without a root dot.
  if (direction === 'to-ascii' && profile.verifyDNSLength && !basicFailed) {
    const forms = labels.map((label) => (label === '' ? '' : (toASCII(label, ALL_OFF) ?? '')));
    forms.forEach((form, index) => {
      if (form.length > 63) collector.add('label-long', 'length', index + 1, [], form.length);
    });
    const total = (hasRoot ? forms.slice(0, -1) : forms).join('.').length;
    if (total > 253) collector.add('name-long', 'length', 0, [], total);
  }

  return collector.results();
}
