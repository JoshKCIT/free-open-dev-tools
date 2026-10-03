/**
 * Grades a pasted Content-Security-Policy against a stated rule set. Every rule names the section of W3C Content
 * Security Policy Level 3 (https://www.w3.org/TR/CSP3/, Working Draft of 16 September 2026) it rests on, or says that it
 * is this page's own rule. The grade is this page's own summary of those rules; it is never a statement that a policy is
 * secure.
 *
 * The policy is read by the existing `parseCspDirectives` (not edited here). Effective source lists follow CSP Level 3
 * section 6.8.3 ("Get fetch directive fallback list"). Directive and rule lookups use `Map`s, so a directive named
 * `__proto__`, `constructor` or `toString` is only an unknown directive.
 *
 * Linear time: a paste over CSP_GRADE_MAX_CHARS is refused before anything is parsed; a pasted header name is found by
 * comparing characters; a pasted meta element is read by a scanner that moves forward only (no regular expression runs
 * over the paste); the existing parser is linear; and the findings of a paste full of syntax problems are capped.
 */
import { parseCspDirectives, type CspDirective, type CspProblem } from './csp';

export type CspSeverity = 'high' | 'medium' | 'low' | 'info';
export type CspGradeLetter = 'A' | 'B' | 'C' | 'D' | 'F';
export type CspSource = 'policy' | 'header' | 'report-only header' | 'meta';

/** One rule of the table: what it says when it fires. */
export interface CspRule {
  id: string;
  severity: CspSeverity;
  /** What is wrong, in one sentence. */
  finding: string;
  /** Why it matters. */
  why: string;
  /** The fix. */
  fix: string;
  /** The CSP Level 3 section the rule rests on, or the statement that it is this page's own rule. */
  basis: string;
}

export interface CspFinding {
  rule: string;
  severity: CspSeverity;
  directive: string;
  finding: string;
  why: string;
  fix: string;
  basis: string;
}

export interface CspGrade {
  /** Directives that are in the policy and that no rule reads, so the grade says nothing about them. */
  notGraded: string[];
  grade: CspGradeLetter;
  score: number;
  findings: CspFinding[];
  source: CspSource;
  /** The policy text that was graded: the paste with a header name or meta wrapper taken off. */
  policy: string;
  /** True when there was nothing to grade; the grade and score then carry no meaning. */
  empty: boolean;
  /** What was taken off the paste before grading, in plain words. */
  notes: string[];
}

export interface NormalisedPolicy {
  policy: string;
  source: CspSource;
  notes: string[];
  /** Set when the paste was a meta element that names the Report-Only header, which a meta element does not support. */
  reportOnly?: boolean;
}

/** The longest paste that is graded: 64 KiB. A longer one is refused before it is parsed. */
export const CSP_GRADE_MAX_CHARS = 65536;

/** The most syntax findings listed; a paste with more says how many were left out. */
const SYNTAX_FINDING_CAP = 20;

/** What the page around the grader says about the policy: its own Report only and Add upgrade-insecure-requests boxes. */
export interface CspGradeOptions {
  /** The page sends the policy as a Content-Security-Policy-Report-Only header. */
  reportOnly?: boolean;
  /** The page adds upgrade-insecure-requests to the policy it builds. */
  upgradeInsecure?: boolean;
}

export class CspGradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CspGradeError';
  }
}

/** Points taken off 100 by each rule that fires (once per rule). This is the page's own summary policy. */
export const CSP_SEVERITY_WEIGHTS: ReadonlyMap<CspSeverity, number> = new Map<CspSeverity, number>([
  ['high', 30],
  ['medium', 15],
  ['low', 5],
  ['info', 0],
]);

const OWN_RULE = "This page's own rule";

// The rules, in table order. Findings are listed by severity and then by this order.
export const CSP_RULES: readonly CspRule[] = [
  {
    id: 'script-unrestricted',
    severity: 'high',
    finding: 'Scripts are not restricted: the policy has no script-src, script-src-elem or default-src.',
    why: 'Any script from anywhere may run, so the policy does nothing against an injected script.',
    fix: "Add default-src 'self', or a script-src that names where scripts may come from.",
    basis:
      'CSP Level 3 section 6: developers SHOULD include directives that regulate sources of script and plugins, either both script-src and object-src or a default-src',
  },
  {
    id: 'script-unsafe-inline',
    severity: 'high',
    finding: "'unsafe-inline' allows inline scripts and javascript: URLs, and nothing overrides it.",
    why: 'Inline script and javascript: URLs run, which is what an injected script needs.',
    fix: "Remove 'unsafe-inline' and allow scripts by nonce or hash.",
    basis:
      "CSP Level 3 section 6: developers SHOULD NOT include 'unsafe-inline' or data: as valid sources; section 6.7.3.2 (does a source list allow all inline behavior)",
  },
  {
    id: 'script-attr-unsafe-inline',
    severity: 'high',
    finding: "'unsafe-inline' allows inline event handlers (onclick and the like), and nothing overrides it.",
    why: 'Inline event handler attributes run, so injected markup such as an element with an onerror handler runs script.',
    fix: "Move the handlers into scripts that use addEventListener, and remove 'unsafe-inline' from the list that governs script-src-attr.",
    basis:
      "CSP Level 3 section 6: developers SHOULD NOT include 'unsafe-inline' as a valid source; section 6.7.3.2 (does a source list allow all inline behavior), which covers script attributes; section 6.8.3 (script-src-attr falls back to script-src, then default-src)",
  },
  {
    id: 'unsafe-inline-ignored',
    severity: 'info',
    finding:
      "'unsafe-inline' is listed next to a nonce, a hash or 'strict-dynamic', so browsers that know those ignore it.",
    why: "Browsers that support nonces and hashes ignore 'unsafe-inline' in that list; it only matters to old browsers that do not.",
    fix: 'Keep it only as a fallback for old browsers, or remove it.',
    basis:
      "CSP Level 3 section 6.7.3.2: a source list with a nonce, a hash or (for scripts) 'strict-dynamic' does not allow all inline behavior",
  },
  {
    id: 'script-wildcard',
    severity: 'high',
    finding: 'A bare * allows scripts from any host.',
    why: 'Any host can serve a script, so an attacker can load one from their own server.',
    fix: "Name the exact hosts, or use nonces with 'strict-dynamic'.",
    basis:
      "CSP Level 3 section 6.7.2.8: the source expression * matches any URL with an HTTP(S) scheme or the page's own scheme; section 8.2",
  },
  {
    id: 'script-data',
    severity: 'high',
    finding: 'data: allows scripts written into a URL.',
    why: 'A data: URL can carry a whole script, so any place that accepts a URL can run code.',
    fix: 'Remove data: from the script sources.',
    basis:
      "CSP Level 3 section 6: developers SHOULD NOT include 'unsafe-inline' or data: as valid sources, because both enable XSS attacks",
  },
  {
    id: 'script-scheme-only',
    severity: 'high',
    finding: 'A whole scheme (https: or http:) is allowed for scripts.',
    why: 'Every host that uses that scheme is allowed, so any site can serve a script.',
    fix: "Allow specific hosts, or use a nonce with 'strict-dynamic'.",
    basis: 'CSP Level 3 section 2.3.1: a scheme such as https: matches any resource having that scheme; section 8.2',
  },
  {
    id: 'host-sources-ignored',
    severity: 'info',
    finding:
      "Host, scheme, wildcard or 'self' sources sit next to 'strict-dynamic', so browsers ignore them for scripts.",
    why: "With 'strict-dynamic' in the list, browsers that support it ignore host sources, scheme sources, wildcards and 'self' for scripts; they only help old browsers.",
    fix: 'Nothing to fix. Keep them as a fallback for old browsers, or remove them.',
    basis:
      "CSP Level 3 section 8.2: host-source and scheme-source expressions, as well as 'unsafe-inline' and 'self', are ignored when loading script",
  },
  {
    id: 'script-unsafe-eval',
    severity: 'medium',
    finding: "'unsafe-eval' allows eval and the calls that work like it.",
    why: 'eval, new Function and string timers turn an injected string into running code.',
    fix: "Remove 'unsafe-eval'. If only WebAssembly needs it, use 'wasm-unsafe-eval' instead.",
    basis:
      "CSP Level 3 section 6.1.10: script-src gates the JavaScript execution sinks on the 'unsafe-eval' source expression",
  },
  {
    id: 'script-http-host',
    severity: 'medium',
    finding: 'A script source uses plain http://.',
    why: 'A script fetched over http can be changed on its way to the browser.',
    fix: 'Use https:// sources.',
    basis: `${OWN_RULE}: a script fetched over plain http can be altered in transit. CSP Level 3 does not require this.`,
  },
  {
    id: 'strict-dynamic-no-nonce',
    severity: 'medium',
    finding: "'strict-dynamic' is used without a nonce or a hash.",
    why: "With 'strict-dynamic' the host sources and 'self' are ignored, so without a nonce or hash no script can start.",
    fix: "Add a 'nonce-...' or a hash source for each script that must run.",
    basis:
      "CSP Level 3 section 8.2: with 'strict-dynamic', hash and nonce expressions are honored and host sources and 'self' are ignored",
  },
  {
    id: 'script-host-allowlist',
    severity: 'low',
    finding: 'Scripts are allowed by a list of hosts only.',
    why: 'Host and path lists are hard to get right: a host that serves one script you need may serve others an attacker can use.',
    fix: "Prefer a nonce or a hash with 'strict-dynamic'.",
    basis:
      'CSP Level 3 section 8.2: host- and path-based policies are tough to get right, and such lists end up brittle, awkward and difficult to maintain',
  },
  {
    id: 'nonce-short',
    severity: 'medium',
    finding: 'A nonce is shorter than 22 Base64 characters (128 bits).',
    why: 'A short nonce can be guessed, and a guessed nonce lets an attacker run their own script.',
    fix: 'Generate 16 random bytes for every response and encode them in Base64 (22 characters or more).',
    basis: 'CSP Level 3 section 7.1: the generated value SHOULD be at least 128 bits long (before encoding)',
  },
  {
    id: 'object-src',
    severity: 'medium',
    finding: "Plugin content is not blocked: object-src is missing or is not 'none'.",
    why: 'Plugin content (object and embed) is not restricted, and it can run code.',
    fix: "Add object-src 'none'.",
    basis:
      'CSP Level 3 section 6: developers SHOULD include directives that regulate sources of script and plugins (section 6.1.9 object-src)',
  },
  {
    id: 'base-uri',
    severity: 'medium',
    finding: 'base-uri is missing, or it allows any host or a whole scheme.',
    why: 'base-uri does not fall back to default-src. An injected base element can send relative script URLs to another site (nonce retargeting).',
    fix: "Add base-uri 'none' or base-uri 'self'.",
    basis:
      "CSP Level 3 section 6.3.1 (base-uri); section 7.3 (nonce retargeting); section 8.5 (Strict CSP: base-uri 'self' or 'none')",
  },
  {
    id: 'frame-ancestors-open',
    severity: 'medium',
    finding: 'frame-ancestors allows any host or a whole scheme, so other sites may embed the page.',
    why: 'An open frame-ancestors list lets any site put the page in a frame (clickjacking), the same as having no frame-ancestors at all, but it reads as if the page were protected. A meta element cannot set it.',
    fix: "Use frame-ancestors 'none' or 'self' in the HTTP header, or name only the sites that may embed the page.",
    basis:
      'CSP Level 3 section 6.4.2 (frame-ancestors lists the parents that may embed the page); section 3.3 (ignored in a meta element)',
  },
  {
    id: 'frame-ancestors',
    severity: 'low',
    finding: 'frame-ancestors is missing, so other sites may embed the page.',
    why: 'frame-ancestors does not fall back to default-src, so any site may put the page in a frame (clickjacking). A meta element cannot set it.',
    fix: "Add frame-ancestors 'none' or 'self' in the HTTP header.",
    basis:
      'CSP Level 3 section 6.4.2 (frame-ancestors does not fall back to default-src); section 3.3 (ignored in a meta element)',
  },
  {
    id: 'form-action',
    severity: 'low',
    finding: 'form-action is missing or open, so a form may post to any address.',
    why: 'form-action does not fall back to default-src, so an injected form can send what a visitor types to another site.',
    fix: "Add form-action 'self'.",
    basis: 'CSP Level 3 section 6.4.1 (form-action restricts the URLs that can be the target of a form submission)',
  },
  {
    id: 'default-open',
    severity: 'medium',
    finding: 'default-src allows any host or a whole scheme.',
    why: 'default-src is the fallback for every fetch directive that is not set, so each of them is open too.',
    fix: "Start from default-src 'self' or 'none' and open only what is needed.",
    basis:
      'CSP Level 3 section 6.1.3 (default-src is the fallback for the other fetch directives); section 8.6 (exfiltration)',
  },
  {
    id: 'exfiltration-wildcard',
    severity: 'low',
    finding: 'A fetch directive allows any host while default-src is restrictive.',
    why: 'A policy only resists data leaving the page as far as its least restrictive directive allows.',
    fix: 'Name the hosts the page really uses.',
    basis:
      "CSP Level 3 section 8.6: a policy's exfiltration mitigation ability depends upon the least-restrictive directive allowlist (default-src 'none'; img-src *)",
  },
  {
    id: 'style-unsafe-inline',
    severity: 'low',
    finding: "'unsafe-inline' allows inline styles and nothing overrides it.",
    why: 'Injected styles can restyle the page and can leak data through attribute selectors.',
    fix: 'Use a nonce or a hash for styles.',
    basis: 'CSP Level 3 section 6.1.13 (style-src); section 6.7.3.2 (does a source list allow all inline behavior)',
  },
  {
    id: 'unsafe-hashes',
    severity: 'low',
    finding: "'unsafe-hashes' allows inline event handlers by their hash.",
    why: 'A hash lets one script run but does not make sure it runs the way the author meant; a handler that does something powerful can be injected as a script.',
    fix: "Move the handlers into scripts that use addEventListener, then remove 'unsafe-hashes'.",
    basis:
      "CSP Level 3 section 8.3 (usage of 'unsafe-hashes': useful for legacy sites, but should be avoided for modern sites)",
  },
  {
    id: 'report-only',
    severity: 'info',
    finding: 'The policy was pasted as a Report-Only header, so it is reported but not enforced.',
    why: 'A browser only sends reports for this policy and blocks nothing.',
    fix: 'Switch to the Content-Security-Policy header when the reports are clean.',
    basis:
      'CSP Level 3 section 3.2 (the Content-Security-Policy-Report-Only header field monitors a policy but does not enforce it)',
  },
  {
    id: 'meta-ignored-directive',
    severity: 'medium',
    finding: 'A directive that a meta element cannot set is in the policy, so the browser ignores it.',
    why: 'frame-ancestors, report-uri and sandbox do nothing in a meta element, so the page is not protected the way the policy reads. The grade treats them as absent.',
    fix: 'Send the policy as an HTTP header, which supports every directive.',
    basis:
      'CSP Level 3 section 3.3 (a meta element does not support the Report-Only header or the report-uri, frame-ancestors and sandbox directives)',
  },
  {
    id: 'meta-limits',
    severity: 'info',
    finding: 'The policy came from a meta element, which cannot carry every directive.',
    why: 'A meta element does not support frame-ancestors, report-uri or sandbox, nor the Report-Only header, and it only applies to content after it.',
    fix: 'Send the policy as an HTTP header when you can.',
    basis:
      'CSP Level 3 section 3.3 (a meta element does not support the Report-Only header or the report-uri, frame-ancestors and sandbox directives)',
  },
  {
    id: 'upgrade-insecure-requests',
    severity: 'info',
    finding: 'upgrade-insecure-requests is not in the policy.',
    why: 'Plain http subresources are fetched as written.',
    fix: 'Add upgrade-insecure-requests if every host you use supports https.',
    basis: `${OWN_RULE}: upgrade-insecure-requests comes from the Upgrade Insecure Requests specification, not from CSP Level 3.`,
  },
  {
    id: 'syntax',
    severity: 'low',
    finding: 'A part of the policy is invalid or ignored.',
    why: 'A browser skips what it cannot read, so the policy does less than it looks like.',
    fix: 'Fix the part named in the finding.',
    basis:
      'CSP Level 3 section 2.2.1 (parse a serialized CSP: a repeated directive is ignored) and the grammar the builder above checks',
  },
];

const RULE_BY_ID: ReadonlyMap<string, CspRule> = new Map(CSP_RULES.map((r) => [r.id, r]));
const RULE_ORDER: ReadonlyMap<string, number> = new Map(CSP_RULES.map((r, i) => [r.id, i]));
const SEVERITY_ORDER: ReadonlyMap<CspSeverity, number> = new Map<CspSeverity, number>([
  ['high', 0],
  ['medium', 1],
  ['low', 2],
  ['info', 3],
]);

// CSP Level 3 section 6.8.3, "Get fetch directive fallback list", in the order the section gives. A name that is not
// listed (base-uri, form-action, frame-ancestors, sandbox, report-uri, report-to) has no fallback.
const FALLBACK: ReadonlyMap<string, readonly string[]> = new Map([
  ['script-src', ['script-src', 'default-src']],
  ['style-src', ['style-src', 'default-src']],
  ['child-src', ['child-src', 'default-src']],
  ['script-src-elem', ['script-src-elem', 'script-src', 'default-src']],
  ['script-src-attr', ['script-src-attr', 'script-src', 'default-src']],
  ['style-src-elem', ['style-src-elem', 'style-src', 'default-src']],
  ['style-src-attr', ['style-src-attr', 'style-src', 'default-src']],
  ['worker-src', ['worker-src', 'child-src', 'script-src', 'default-src']],
  ['connect-src', ['connect-src', 'default-src']],
  ['manifest-src', ['manifest-src', 'default-src']],
  ['object-src', ['object-src', 'default-src']],
  ['frame-src', ['frame-src', 'child-src', 'default-src']],
  ['media-src', ['media-src', 'default-src']],
  ['font-src', ['font-src', 'default-src']],
  ['img-src', ['img-src', 'default-src']],
]);

// The directives CSP Level 3 section 3.3 says a meta element does not support.
const META_IGNORED_DIRECTIVES: readonly string[] = ['frame-ancestors', 'report-uri', 'sandbox'];

// The fetch directives other than script and style that the exfiltration rule reads (section 8.6).
const EXFILTRATION_DIRECTIVES = [
  'child-src',
  'connect-src',
  'font-src',
  'frame-src',
  'img-src',
  'manifest-src',
  'media-src',
];

type SourceIndex = ReadonlyMap<string, readonly string[]>;

/** Name to source tokens; the first occurrence of a directive wins (CSP Level 3 section 2.2.1). */
function indexDirectives(directives: readonly CspDirective[]): SourceIndex {
  const index = new Map<string, readonly string[]>();
  for (const d of directives) {
    if (!index.has(d.name)) index.set(d.name, d.value === '' ? [] : d.value.split(' '));
  }
  return index;
}

function effectiveIn(index: SourceIndex, name: string): { directive: string; sources: string[] } | null {
  for (const candidate of FALLBACK.get(name) ?? [name]) {
    const list = index.get(candidate);
    if (list) return { directive: candidate, sources: [...list] };
  }
  return null;
}

/**
 * The source list that governs `name`: the most specific directive that is present in the order of CSP Level 3 section
 * 6.8.3, or null when none is. base-uri, form-action and frame-ancestors never fall back to default-src.
 */
export function effectiveSources(
  directives: readonly CspDirective[],
  name: string,
): { directive: string; sources: string[] } | null {
  return effectiveIn(indexDirectives(directives), name);
}

// ---- Reading what was pasted: a header line or a meta element around the policy ----

const CHAR_TAB = 9;
const CHAR_LF = 10;
const CHAR_FF = 12;
const CHAR_CR = 13;
const CHAR_SPACE = 32;
const CHAR_QUOTE = 34;
const CHAR_APOSTROPHE = 39;
const CHAR_SLASH = 47;
const CHAR_COLON = 58;
const CHAR_SEMICOLON = 59;
const CHAR_EQUALS = 61;
const CHAR_GT = 62;

function isSpace(code: number): boolean {
  return code === CHAR_SPACE || code === CHAR_TAB || code === CHAR_LF || code === CHAR_CR || code === CHAR_FF;
}

function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isSpace(text.charCodeAt(i))) i++;
  return i;
}

function lowerAscii(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

/** True when text[start, end) equals the lower-case ASCII `word`, ignoring ASCII case. */
function equalsAscii(text: string, start: number, end: number, word: string): boolean {
  if (end - start !== word.length) return false;
  for (let i = 0; i < word.length; i++) {
    if (lowerAscii(text.charCodeAt(start + i)) !== word.charCodeAt(i)) return false;
  }
  return true;
}

function startsWithAscii(text: string, at: number, word: string): boolean {
  return at + word.length <= text.length && equalsAscii(text, at, at + word.length, word);
}

interface MetaTag {
  /** Index of the closing angle bracket. */
  end: number;
  httpEquiv: string | null;
  content: string | null;
}

/**
 * Reads the attributes of one tag from just after its name. Moves forward only. Returns null when the tag never
 * ends (an unfinished quote, or no closing angle bracket), which also means no later tag in the paste can end.
 */
function readTag(text: string, from: number): MetaTag | null {
  const n = text.length;
  let i = from;
  let httpEquiv: string | null = null;
  let content: string | null = null;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (isSpace(c) || c === CHAR_SLASH) {
      i++;
      continue;
    }
    if (c === CHAR_GT) return { end: i, httpEquiv, content };
    let nameEnd = i;
    while (nameEnd < n) {
      const d = text.charCodeAt(nameEnd);
      if (isSpace(d) || d === CHAR_EQUALS || d === CHAR_GT || d === CHAR_SLASH) break;
      nameEnd++;
    }
    if (nameEnd === i) {
      // A stray equals sign with no name: step over it.
      i++;
      continue;
    }
    let j = skipSpace(text, nameEnd);
    let value = '';
    if (j < n && text.charCodeAt(j) === CHAR_EQUALS) {
      j = skipSpace(text, j + 1);
      if (j >= n) return null;
      const q = text.charCodeAt(j);
      if (q === CHAR_QUOTE || q === CHAR_APOSTROPHE) {
        const close = text.indexOf(q === CHAR_QUOTE ? '"' : "'", j + 1);
        if (close < 0) return null;
        value = text.slice(j + 1, close);
        j = close + 1;
      } else {
        const valueStart = j;
        while (j < n && !isSpace(text.charCodeAt(j)) && text.charCodeAt(j) !== CHAR_GT) j++;
        value = text.slice(valueStart, j);
      }
    }
    // The first attribute of a name counts, as in HTML.
    if (httpEquiv === null && equalsAscii(text, i, nameEnd, 'http-equiv')) httpEquiv = value;
    else if (content === null && equalsAscii(text, i, nameEnd, 'content')) content = value;
    i = j;
  }
  return null;
}

interface MetaPolicy {
  content: string;
  /** The element says Content-Security-Policy-Report-Only, which a meta element does not support. */
  reportOnly: boolean;
}

const NAMED_REFERENCES: ReadonlyMap<string, string> = new Map([
  ['quot', '"'],
  ['apos', "'"],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
]);

/** The longest character reference that is looked for: &#x10FFFF; is 10 characters, so a ; further on than 12 is not one. */
const REFERENCE_SPAN = 12;

function isDecimalDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isHexDigit(code: number): boolean {
  return isDecimalDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/** The text a numeric reference body (the part between &# and ;) stands for, or null when it is not a valid reference. */
function numericReference(body: string): string | null {
  const hex = body.startsWith('x') || body.startsWith('X');
  const digits = hex ? body.slice(1) : body;
  if (digits.length === 0 || digits.length > 7) return null;
  for (let i = 0; i < digits.length; i++) {
    const code = digits.charCodeAt(i);
    if (!(hex ? isHexDigit(code) : isDecimalDigit(code))) return null;
  }
  const point = parseInt(digits, hex ? 16 : 10);
  if (point < 1 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return null;
  return String.fromCodePoint(point);
}

/**
 * Decodes the character references a browser would decode in an attribute value: the five named ones (&quot; &apos; &amp;
 * &lt; &gt;) and numeric ones (&#39; &#x27;). Anything else, a reference with no semicolon or a number that is not a
 * character, stays as written. Moves forward only, and looks at most REFERENCE_SPAN characters past each ampersand.
 */
function decodeReferences(value: string): string {
  let amp = value.indexOf('&');
  if (amp < 0) return value;
  let out = '';
  let last = 0;
  while (amp >= 0) {
    let semi = -1;
    const limit = Math.min(value.length, amp + REFERENCE_SPAN);
    for (let i = amp + 1; i < limit; i++) {
      if (value.charCodeAt(i) === CHAR_SEMICOLON) {
        semi = i;
        break;
      }
    }
    let decoded: string | null = null;
    if (semi > amp + 1) {
      const body = value.slice(amp + 1, semi);
      decoded = body.startsWith('#') ? numericReference(body.slice(1)) : (NAMED_REFERENCES.get(body) ?? null);
    }
    if (decoded === null) {
      amp = value.indexOf('&', amp + 1);
      continue;
    }
    out += value.slice(last, amp) + decoded;
    last = semi + 1;
    amp = value.indexOf('&', last);
  }
  return out + value.slice(last);
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * The policy of the first meta element whose http-equiv is Content-Security-Policy (or the Report-Only name, which a meta
 * element does not support), or null. Every tag is read through its attributes, so text inside a quoted attribute value is
 * never taken for a tag, and an HTML comment is skipped (an unfinished one runs to the end of the paste, as in a browser).
 */
function readMetaContent(text: string): MetaPolicy | null {
  const n = text.length;
  let at = text.indexOf('<');
  while (at >= 0) {
    if (startsWithAscii(text, at, '<!--')) {
      // The comment ends at the first --> after the two characters of its opening, so <!--> and <!---> are empty comments.
      const close = text.indexOf('-->', at + 2);
      if (close < 0) return null;
      at = text.indexOf('<', close + 3);
      continue;
    }
    const nameStart = at + 1;
    if (nameStart >= n || !isAsciiLetter(text.charCodeAt(nameStart))) {
      at = text.indexOf('<', nameStart);
      continue;
    }
    let nameEnd = nameStart;
    while (nameEnd < n) {
      const c = text.charCodeAt(nameEnd);
      if (isSpace(c) || c === CHAR_SLASH || c === CHAR_GT) break;
      nameEnd++;
    }
    const tag = readTag(text, nameEnd);
    if (tag === null) return null;
    if (tag.httpEquiv !== null && tag.content !== null && equalsAscii(text, nameStart, nameEnd, 'meta')) {
      if (equalsAscii(tag.httpEquiv, 0, tag.httpEquiv.length, 'content-security-policy')) {
        return { content: decodeReferences(tag.content), reportOnly: false };
      }
      if (equalsAscii(tag.httpEquiv, 0, tag.httpEquiv.length, 'content-security-policy-report-only')) {
        return { content: decodeReferences(tag.content), reportOnly: true };
      }
    }
    at = text.indexOf('<', tag.end + 1);
  }
  return null;
}

// Longest name first, so the Report-Only name is not read as the plain one.
const HEADER_NAMES: readonly { name: string; source: CspSource; note: string }[] = [
  {
    name: 'content-security-policy-report-only',
    source: 'report-only header',
    note: 'Took off the header name Content-Security-Policy-Report-Only: and graded the rest as the policy. A Report-Only policy is reported, not enforced.',
  },
  {
    name: 'content-security-policy',
    source: 'header',
    note: 'Took off the header name Content-Security-Policy: and graded the rest as the policy.',
  },
];

const META_NOTE = 'Read the content attribute of the meta element and graded it as the policy.';
const META_REPORT_ONLY_NOTE =
  'The meta element names Content-Security-Policy-Report-Only, which a meta element does not support, so a browser ignores it.';

const CHAR_BACKSLASH = 92;
const CHAR_PERCENT = 37;

/**
 * The text of a quoted value that starts at `from` (a double or single quote), with the escapes both servers recognise
 * (a backslash before the quote or before a backslash) taken off, or an unquoted value up to white space or a semicolon.
 * Null when the quote is never closed or there is no value. Moves forward only.
 */
function readServerValue(line: string, from: number): string | null {
  const q = line.charCodeAt(from);
  if (q === CHAR_QUOTE || q === CHAR_APOSTROPHE) {
    let out = '';
    let start = from + 1;
    for (let i = from + 1; i < line.length; i++) {
      const c = line.charCodeAt(i);
      if (c === CHAR_BACKSLASH && i + 1 < line.length) {
        const next = line.charCodeAt(i + 1);
        if (next === q || next === CHAR_BACKSLASH) {
          out += line.slice(start, i) + line[i + 1];
          i++;
          start = i + 1;
        }
      } else if (c === q) {
        return out + line.slice(start, i);
      }
    }
    return null;
  }
  let end = from;
  while (end < line.length && !isSpace(line.charCodeAt(end)) && line.charCodeAt(end) !== CHAR_SEMICOLON) end++;
  return end > from ? line.slice(from, end) : null;
}

/** The end of the word that starts at `from` (a run of anything but white space). */
function wordEnd(line: string, from: number): number {
  let i = from;
  while (i < line.length && !isSpace(line.charCodeAt(i))) i++;
  return i;
}

const APACHE_WHEN = ['always', 'onsuccess'];
const APACHE_ACTIONS = ['set', 'setifempty', 'add', 'append', 'merge'];

function wordIs(line: string, start: number, end: number, words: readonly string[]): boolean {
  return words.some((w) => equalsAscii(line, start, end, w));
}

interface ServerLine {
  value: string;
  header: (typeof HEADER_NAMES)[number];
  server: 'nginx' | 'Apache';
}

/** Which of the two Content-Security-Policy header names the word line[start, end) is, or null. */
function headerNamed(line: string, start: number, end: number): (typeof HEADER_NAMES)[number] | null {
  return HEADER_NAMES.find((h) => equalsAscii(line, start, end, h.name)) ?? null;
}

/** One line of nginx (add_header name value [always];) or Apache (Header [always] set name value) that sets the policy. */
function readServerLine(line: string): ServerLine | null {
  const first = skipSpace(line, 0);
  const firstEnd = wordEnd(line, first);
  if (equalsAscii(line, first, firstEnd, 'add_header')) {
    const nameStart = skipSpace(line, firstEnd);
    const nameEnd = wordEnd(line, nameStart);
    const header = headerNamed(line, nameStart, nameEnd);
    if (!header) return null;
    const value = readServerValue(line, skipSpace(line, nameEnd));
    return value === null ? null : { value, header, server: 'nginx' };
  }
  if (equalsAscii(line, first, firstEnd, 'header')) {
    let wordStart = skipSpace(line, firstEnd);
    let end = wordEnd(line, wordStart);
    if (wordIs(line, wordStart, end, APACHE_WHEN)) {
      wordStart = skipSpace(line, end);
      end = wordEnd(line, wordStart);
    }
    if (!wordIs(line, wordStart, end, APACHE_ACTIONS)) return null;
    const nameStart = skipSpace(line, end);
    const nameEnd = wordEnd(line, nameStart);
    const header = headerNamed(line, nameStart, nameEnd);
    if (!header) return null;
    const value = readServerValue(line, skipSpace(line, nameEnd));
    if (value === null) return null;
    // Apache writes a percent sign twice (mod_headers format specifiers); the builder does the same.
    let single = '';
    let from = 0;
    for (let i = 0; i < value.length - 1; i++) {
      if (value.charCodeAt(i) === CHAR_PERCENT && value.charCodeAt(i + 1) === CHAR_PERCENT) {
        single += value.slice(from, i + 1);
        from = i + 2;
        i++;
      }
    }
    return { value: single + value.slice(from), header, server: 'Apache' };
  }
  return null;
}

/**
 * Takes a pasted header line (Content-Security-Policy: or Content-Security-Policy-Report-Only:), a pasted meta element
 * (http-equiv Content-Security-Policy), or an nginx or Apache line that sets the header, off the policy text, for grading
 * only. Anything else is returned as it was.
 */
export function normaliseForGrading(text: string): NormalisedPolicy {
  const meta = readMetaContent(text);
  if (meta !== null) {
    return meta.reportOnly
      ? { policy: meta.content, source: 'meta', notes: [META_NOTE, META_REPORT_ONLY_NOTE], reportOnly: true }
      : { policy: meta.content, source: 'meta', notes: [META_NOTE] };
  }
  const start = skipSpace(text, 0);
  for (const header of HEADER_NAMES) {
    if (!startsWithAscii(text, start, header.name)) continue;
    const colon = skipSpace(text, start + header.name.length);
    if (text.charCodeAt(colon) === CHAR_COLON) {
      return { policy: text.slice(skipSpace(text, colon + 1)), source: header.source, notes: [header.note] };
    }
  }
  for (const line of text.split('\n')) {
    const found = readServerLine(line);
    if (found) {
      const reportOnly = found.header.source === 'report-only header';
      return {
        policy: found.value,
        source: found.header.source,
        notes: [
          `Read the value of the ${found.server} line that sets ${reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy'} and graded it as the policy.${reportOnly ? ' A Report-Only policy is reported, not enforced.' : ''}`,
        ],
      };
    }
  }
  return { policy: text, source: 'policy', notes: [] };
}

// ---- Rules ----

function hasKeyword(list: readonly string[], keyword: string): boolean {
  return list.some((t) => t.toLowerCase() === keyword);
}

function isNonceOrHash(token: string): boolean {
  const t = token.toLowerCase();
  return t.startsWith("'nonce-") || t.startsWith("'sha256-") || t.startsWith("'sha384-") || t.startsWith("'sha512-");
}

/** A host source (not a keyword, a nonce, a hash, a bare scheme or the wildcard). */
function isHostSource(token: string): boolean {
  return token !== '*' && !token.startsWith("'") && !token.endsWith(':');
}

function isOpenSource(token: string): boolean {
  const t = token.toLowerCase();
  return t === '*' || t === 'https:' || t === 'http:';
}

const SCHEME_ONLY = /^[a-z][a-z0-9+.-]*:$/;

/**
 * True when one source of frame-ancestors or form-action lets any site in: a bare *, a whole scheme (https:, http:, data:
 * and so on), a wildcard host with no name (https://*, *:443) or a wildcard in front of a single label (*.com), which is
 * every host under a top level domain. A wildcard in front of a name with a dot in it (*.example.invalid) is not open. A
 * public suffix with a dot in it (such as *.co.uk) is not recognised: the page carries no public suffix list.
 */
function isOpenNavigationSource(token: string): boolean {
  const t = token.toLowerCase();
  if (t === '*' || SCHEME_ONLY.test(t)) return true;
  if (t.startsWith("'")) return false;
  let rest = t;
  const scheme = rest.indexOf('://');
  if (scheme > 0) rest = rest.slice(scheme + 3);
  const slash = rest.indexOf('/');
  if (slash >= 0) rest = rest.slice(0, slash);
  const colon = rest.lastIndexOf(':');
  if (colon >= 0) rest = rest.slice(0, colon);
  if (rest === '*') return true;
  return rest.startsWith('*.') && rest.length > 2 && rest.indexOf('.', 2) < 0;
}

function finding(id: string, directive: string, text?: { whole?: string; suffix?: string }): CspFinding {
  const rule = RULE_BY_ID.get(id);
  if (!rule) throw new Error(`Unknown rule ${id}`);
  return {
    rule: rule.id,
    severity: rule.severity,
    directive,
    finding: text?.whole ?? (text?.suffix ? `${rule.finding} ${text.suffix}` : rule.finding),
    why: rule.why,
    fix: rule.fix,
    basis: rule.basis,
  };
}

function withCommas(n: number): string {
  const digits = String(n);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

// The builder's parser (csp.ts, not edited here) does not know the Trusted Types directives and reads keywords in lower case
// only. CSP Level 3 matches keywords without regard to case, and the Trusted Types directives are valid, so the grader drops
// those two kinds of false report before it lists the syntax findings.
const TRUSTED_TYPES_DIRECTIVES: ReadonlySet<string> = new Set(['require-trusted-types-for', 'trusted-types']);
const UNKNOWN_DIRECTIVE_TAIL = '" is not a directive CSP Level 3 defines.';
const SOURCE_PROBLEM_TAILS = [' does not match a keyword,', " is not 'self', a scheme source"];
const CASE_SENSITIVE_PREFIXES = ["'nonce-", "'sha256-", "'sha384-", "'sha512-"];

/** The token with its keyword or nonce and hash prefix in lower case (the Base64 value after a prefix keeps its case). */
function lowerKeywordCase(token: string): string {
  const lower = token.toLowerCase();
  for (const prefix of CASE_SENSITIVE_PREFIXES) {
    if (lower.startsWith(prefix)) return prefix + token.slice(prefix.length);
  }
  return lower;
}

/** The Trusted Types directive a problem message is about (in lower case), or null for any other problem. */
function trustedTypesName(message: string): string | null {
  if (!message.startsWith('"')) return null;
  const unknown = message.indexOf(UNKNOWN_DIRECTIVE_TAIL);
  if (unknown <= 0) return null;
  const name = message.slice(1, unknown).toLowerCase();
  return TRUSTED_TYPES_DIRECTIVES.has(name) ? name : null;
}

function isFalseProblem(message: string): boolean {
  if (!message.startsWith('"')) return false;
  if (message.indexOf(UNKNOWN_DIRECTIVE_TAIL) > 0) return trustedTypesName(message) !== null;
  const inAt = message.indexOf('" in "');
  if (inAt < 0) return false;
  const token = message.slice(1, inAt);
  const afterIn = message.slice(inAt + 6);
  const nameEnd = afterIn.indexOf('"');
  if (nameEnd < 0) return false;
  const tail = afterIn.slice(nameEnd + 1);
  if (!SOURCE_PROBLEM_TAILS.some((t) => tail.startsWith(t))) return false;
  const fixed = lowerKeywordCase(token);
  if (fixed === token) return false;
  return parseCspDirectives(`${afterIn.slice(0, nameEnd)} ${fixed}`).problems.length === 0;
}

/**
 * The parser numbers the parts a policy is split into (on a semicolon, and on a line break when there is one), empty parts
 * included. This gives the place of each non-empty part, so a finding can say "Directive 2" for the second directive. The
 * splitting is the parser's own, written out again because the parser does not return where a part began.
 */
function directivePlaces(policy: string): number[] {
  const singleLine = !policy.includes('\n') && policy.includes(';');
  const parts = singleLine ? policy.split(';') : policy.split('\n').flatMap((line) => line.split(';'));
  const places = [0];
  let place = 0;
  for (const part of parts) {
    if (part.trim() !== '') place++;
    places.push(place);
  }
  return places;
}

function evaluate(
  index: SourceIndex,
  problems: readonly CspProblem[],
  source: CspSource,
  policy: string,
  options: CspGradeOptions,
  reportOnlyWhy: string | null,
): CspFinding[] {
  const found: CspFinding[] = [];

  // Scripts: the list that governs script elements (CSP Level 3 section 6.8.3).
  const script = effectiveIn(index, 'script-src-elem');
  if (!script) {
    found.push(finding('script-unrestricted', 'script-src'));
  } else {
    const list = script.sources;
    const lower = list.map((t) => t.toLowerCase());
    const modern = list.some(isNonceOrHash);
    const strict = lower.includes("'strict-dynamic'");
    const inline = lower.includes("'unsafe-inline'");
    if (inline && !modern && !strict) found.push(finding('script-unsafe-inline', script.directive));
    if (inline && (modern || strict)) found.push(finding('unsafe-inline-ignored', script.directive));
    if (strict) {
      // Section 8.2: with 'strict-dynamic', host and scheme sources, the wildcard and 'self' are ignored for scripts, so
      // the rules about them stay quiet and the ignored sources are only reported.
      const ignored = list.filter((t) => t.toLowerCase() === "'self'" || !t.startsWith("'"));
      if (ignored.length > 0) {
        const shown = ignored.slice(0, 8).join(' ');
        const more = ignored.length > 8 ? ` and ${ignored.length - 8} more` : '';
        found.push(finding('host-sources-ignored', script.directive, { suffix: `Ignored here: ${shown}${more}.` }));
      }
    } else {
      if (lower.includes('*')) found.push(finding('script-wildcard', script.directive));
      if (lower.includes('data:')) found.push(finding('script-data', script.directive));
      if (lower.includes('https:') || lower.includes('http:'))
        found.push(finding('script-scheme-only', script.directive));
      if (lower.some((t) => t.startsWith('http://'))) found.push(finding('script-http-host', script.directive));
    }
    if (lower.includes("'unsafe-eval'")) found.push(finding('script-unsafe-eval', script.directive));
    if (strict && !modern) found.push(finding('strict-dynamic-no-nonce', script.directive));
    if (!strict && !modern && list.some(isHostSource)) found.push(finding('script-host-allowlist', script.directive));
  }

  // Inline event handlers: the list that governs script-src-attr (script-src-attr, then script-src, then default-src). When
  // that is the very list the script rules above already reported for 'unsafe-inline', it is not counted a second time.
  const attr = effectiveIn(index, 'script-src-attr');
  if (attr) {
    const attrLower = attr.sources.map((t) => t.toLowerCase());
    const attrInline =
      attrLower.includes("'unsafe-inline'") &&
      !attr.sources.some(isNonceOrHash) &&
      !attrLower.includes("'strict-dynamic'");
    const reportedAlready =
      attr.directive === script?.directive && found.some((f) => f.rule === 'script-unsafe-inline');
    if (attrInline && !reportedAlready) found.push(finding('script-attr-unsafe-inline', attr.directive));
  }

  // Workers run script: a worker list of its own that allows any host is a script wildcard. A worker list that falls back to
  // script-src or default-src is graded where it is written.
  const worker = effectiveIn(index, 'worker-src');
  if (
    worker &&
    (worker.directive === 'worker-src' || worker.directive === 'child-src') &&
    worker.sources.includes('*')
  ) {
    found.push(
      finding('script-wildcard', worker.directive, { suffix: 'This directive governs workers, which run script.' }),
    );
  }

  // Nonces in any directive (section 7.1): 22 Base64 characters are 132 bits, 21 are 126.
  for (const [name, list] of index) {
    const short = list.some((t) => {
      const lowerToken = t.toLowerCase();
      if (!lowerToken.startsWith("'nonce-") || !lowerToken.endsWith("'") || t.length < 9) return false;
      let end = t.length - 1;
      while (end > 7 && t.charCodeAt(end - 1) === 61) end--;
      return end - 7 < 22;
    });
    if (short) found.push(finding('nonce-short', name));
  }

  const object = effectiveIn(index, 'object-src');
  if (!object) found.push(finding('object-src', 'object-src'));
  else if (!hasKeyword(object.sources, "'none'")) found.push(finding('object-src', object.directive));

  // base-uri, frame-ancestors and form-action are read on their own: none of them falls back to default-src.
  const base = index.get('base-uri');
  if (!base || base.some(isOpenSource)) found.push(finding('base-uri', 'base-uri'));
  // A meta element cannot set frame-ancestors (section 3.3), so there it counts as absent; each directive of that kind that
  // the policy does list is reported once, by name.
  const metaIgnored = source === 'meta' ? META_IGNORED_DIRECTIVES.filter((name) => index.has(name)) : [];
  for (const name of metaIgnored) {
    found.push(
      finding('meta-ignored-directive', name, {
        whole: `${name} is in the policy, but a meta element cannot set it, so the browser ignores it and the grade treats it as absent.`,
      }),
    );
  }
  const ancestors = source === 'meta' ? undefined : index.get('frame-ancestors');
  if (!ancestors) found.push(finding('frame-ancestors', 'frame-ancestors'));
  else if (ancestors.some(isOpenNavigationSource)) {
    // An open list is its own medium rule: it reads as protection while any site may frame the page, which is worse than a
    // missing directive, so it costs more than the low rule for a missing one.
    found.push(finding('frame-ancestors-open', 'frame-ancestors'));
  }
  const formAction = index.get('form-action');
  if (!formAction) found.push(finding('form-action', 'form-action'));
  else if (formAction.some(isOpenNavigationSource)) {
    found.push(
      finding('form-action', 'form-action', {
        whole: 'form-action allows any host or a whole scheme, so a form may post to any address.',
      }),
    );
  }

  const defaults = index.get('default-src');
  const defaultOpen = defaults?.some(isOpenSource) ?? false;
  if (defaultOpen) found.push(finding('default-open', 'default-src'));
  if (defaults && !defaultOpen) {
    for (const name of EXFILTRATION_DIRECTIVES) {
      if (index.get(name)?.includes('*')) found.push(finding('exfiltration-wildcard', name));
    }
  }

  const style = effectiveIn(index, 'style-src-elem');
  if (style && hasKeyword(style.sources, "'unsafe-inline'") && !style.sources.some(isNonceOrHash)) {
    found.push(finding('style-unsafe-inline', style.directive));
  }

  for (const [name, list] of index) {
    if (hasKeyword(list, "'unsafe-hashes'")) found.push(finding('unsafe-hashes', name));
  }

  if (source === 'report-only header') found.push(finding('report-only', 'Content-Security-Policy-Report-Only'));
  else if (reportOnlyWhy !== null) {
    found.push(finding('report-only', 'Content-Security-Policy-Report-Only', { whole: reportOnlyWhy }));
  }
  if (source === 'meta') found.push(finding('meta-limits', 'meta'));
  if (!index.has('upgrade-insecure-requests') && !options.upgradeInsecure)
    found.push(finding('upgrade-insecure-requests', 'upgrade-insecure-requests'));

  const real = problems.filter((p) => !isFalseProblem(p.message));
  const places = directivePlaces(policy);
  for (const problem of real.slice(0, SYNTAX_FINDING_CAP)) {
    found.push(
      finding('syntax', '(policy)', { whole: `Directive ${places[problem.line] ?? problem.line}: ${problem.message}` }),
    );
  }
  if (real.length > SYNTAX_FINDING_CAP) {
    const left = real.length - SYNTAX_FINDING_CAP;
    found.push(
      finding('syntax', '(policy, more)', {
        whole: `${withCommas(left)} more problems are not listed here. Fix the ones above and grade again.`,
      }),
    );
  }
  return found;
}

function compareFindings(a: CspFinding, b: CspFinding): number {
  const bySeverity = (SEVERITY_ORDER.get(a.severity) ?? 9) - (SEVERITY_ORDER.get(b.severity) ?? 9);
  if (bySeverity !== 0) return bySeverity;
  const byRule = (RULE_ORDER.get(a.rule) ?? 999) - (RULE_ORDER.get(b.rule) ?? 999);
  if (byRule !== 0) return byRule;
  // The same rule on several directives: by directive name, so the list does not depend on the order of the policy.
  // Findings of one rule on one directive (syntax) keep the order the policy gave them.
  if (a.directive !== b.directive) return a.directive < b.directive ? -1 : 1;
  return 0;
}

function letterFor(score: number, anyHigh: boolean): CspGradeLetter {
  const letter: CspGradeLetter = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  // Any high finding caps the grade at D.
  return anyHigh && (letter === 'A' || letter === 'B' || letter === 'C') ? 'D' : letter;
}

// Directives that no rule reads. The grade says nothing about them, and the page says so beside the grade.
const NOT_GRADED_DIRECTIVES: readonly string[] = [
  'report-to',
  'report-uri',
  'require-trusted-types-for',
  'sandbox',
  'style-src-attr',
  'trusted-types',
];

function notGradedIn(index: SourceIndex, trustedTypes: readonly (string | null)[]): string[] {
  // The parser does not keep the Trusted Types directives (it does not know them), so they are found from its problems.
  const names = NOT_GRADED_DIRECTIVES.filter((name) => index.has(name) || trustedTypes.includes(name));
  // worker-src is read for a bare * only (see the script-wildcard rule); its other sources are not graded.
  const worker = index.get('worker-src');
  if (worker && !worker.includes('*')) names.push('worker-src (only a bare * is graded)');
  return names;
}

/** True when the text holds nothing but white space and semicolons: an empty policy. */
function isBlank(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (!isSpace(code) && code !== CHAR_SEMICOLON) return false;
  }
  return true;
}

/**
 * Grades a pasted policy. A paste over CSP_GRADE_MAX_CHARS characters is refused (CspGradeError) before anything is parsed.
 * The paste may be a bare policy, a header line, a Report-Only header line or a meta element.
 */
export function gradeCsp(text: string, options: CspGradeOptions = {}): CspGrade {
  if (text.length > CSP_GRADE_MAX_CHARS) {
    throw new CspGradeError(
      `This policy is ${withCommas(text.length)} characters. The limit for grading is ${withCommas(CSP_GRADE_MAX_CHARS)}.`,
    );
  }
  const { policy, source, notes, reportOnly: metaReportOnly } = normaliseForGrading(text);
  // Why the policy counts as reported and not enforced, when it does and a pasted header name does not already say so.
  let reportOnlyWhy: string | null = null;
  if (source !== 'report-only header') {
    if (options.reportOnly) {
      reportOnlyWhy =
        'The Report only box is ticked, so the policy is sent as a Report-Only header: it is reported but not enforced.';
    } else if (metaReportOnly) {
      reportOnlyWhy =
        'The meta element names Content-Security-Policy-Report-Only, which a meta element does not support, so a browser ignores it; it is graded as a policy that is reported and not enforced.';
    }
  }
  const empty = isBlank(policy);
  let findings: CspFinding[] = [];
  let notGraded: string[] = [];
  if (!empty) {
    const parsed = parseCspDirectives(policy);
    const index = indexDirectives(parsed.directives);
    findings = evaluate(index, parsed.problems, source, policy, options, reportOnlyWhy);
    if (options.upgradeInsecure && !index.has('upgrade-insecure-requests')) {
      notes.push(
        'The Add upgrade-insecure-requests box is ticked, so the headers built above carry upgrade-insecure-requests and the grade counts it as present.',
      );
    }
    findings.sort(compareFindings);
    notGraded = notGradedIn(
      index,
      parsed.problems.map((p) => trustedTypesName(p.message)),
    );
  }

  // Each rule that fires counts once, however many findings it lists.
  const fired = new Map<string, CspSeverity>();
  for (const f of findings) fired.set(f.rule, f.severity);
  let score = 100;
  for (const severity of fired.values()) score -= CSP_SEVERITY_WEIGHTS.get(severity) ?? 0;
  score = Math.max(0, score);

  return {
    grade: empty
      ? 'F'
      : letterFor(
          score,
          findings.some((f) => f.severity === 'high'),
        ),
    score: empty ? 0 : score,
    findings,
    source,
    policy,
    empty,
    notes,
    notGraded,
  };
}
