/**
 * Version and range syntax, checked against two sources fetched this
 * session: the Semantic Versioning 2.0.0 specification
 * (https://semver.org/spec/v2.0.0.html, section 11's precedence examples and
 * its own recommended regular expression) for `isValidVersion`, and the
 * `semver` package's own README range grammar
 * (https://github.com/npm/node-semver#ranges) for `isValidRange`, whose hand
 * -written parser is proven against the real, devDependency-only `semver`
 * package (never bundled -- D-82) on the README's own examples plus a
 * generated battery in `test/index.test.ts`.
 */

// The Semantic Versioning 2.0.0 spec's own "regular expression (RegEx) to
// check a SemVer string", numbered-capture-groups form (cg1 major, cg2
// minor, cg3 patch, cg4 prerelease, cg5 build metadata), quoted verbatim.
const SEMVER_2_0_0_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isValidVersion(text: string): boolean {
  return SEMVER_2_0_0_REGEX.test(text);
}

const NUMERIC_IDENT = '(?:0|[1-9]\\d*)';
const ALPHANUM_IDENT = '(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)';
const PRERELEASE_IDENT = `(?:${NUMERIC_IDENT}|${ALPHANUM_IDENT})`;
const BUILD_IDENT = '[0-9A-Za-z-]+';
const PRERELEASE = `(?:-${PRERELEASE_IDENT}(?:\\.${PRERELEASE_IDENT})*)`;
const BUILD = `(?:\\+${BUILD_IDENT}(?:\\.${BUILD_IDENT})*)`;

const WILD = '(?:[xX*])';
// A full major.minor.patch triple, the only form the README shows carrying
// a prerelease or build tag.
const FULL = `${NUMERIC_IDENT}\\.${NUMERIC_IDENT}\\.${NUMERIC_IDENT}${PRERELEASE}?${BUILD}?`;
// A partial or X-range form: a bare wildcard, a major, a major.minor, an
// X-range with the wildcard as the last present component, or a full
// major.minor.patch triple with no prerelease or build.
const PARTIAL =
  `(?:${WILD}` + `|${NUMERIC_IDENT}(?:\\.(?:${WILD}|${NUMERIC_IDENT}(?:\\.(?:${WILD}|${NUMERIC_IDENT}))?))?)`;
// Any single range token: an optional lowercase v, then a full version or a partial/X-range form.
const TOKEN = `(?:v)?(?:${FULL}|${PARTIAL})`;

const COMPARATOR_RE = new RegExp(`^(?:<=|>=|<|>|=)?${TOKEN}$`);
const TILDE_RE = new RegExp(`^~${TOKEN}$`);
const CARET_RE = new RegExp(`^\\^${TOKEN}$`);
const HYPHEN_RE = new RegExp(`^(${TOKEN})\\s+-\\s+(${TOKEN})$`);

function isValidComparatorSet(set: string): boolean {
  const trimmed = set.trim();
  if (trimmed === '') return true; // an empty side of `||`, or the whole range, means "any version"
  if (HYPHEN_RE.test(trimmed)) return true;
  const tokens = trimmed.split(/\s+/);
  return tokens.every((t) => COMPARATOR_RE.test(t) || TILDE_RE.test(t) || CARET_RE.test(t));
}

/**
 * A hand-written parser for the `semver` package's own range grammar
 * (comparators, comparator sets joined by whitespace, `||`-joined sets,
 * hyphen ranges, X-ranges, tilde ranges and caret ranges) -- never the
 * `semver` package itself, which is this package's test-only oracle.
 */
export function isValidRange(text: string): boolean {
  return text.split('||').every(isValidComparatorSet);
}

export type SpecifierKind =
  | 'range'
  | 'tag'
  | 'npm-alias'
  | 'file'
  | 'git'
  | 'github-shorthand'
  | 'tarball-url'
  | 'workspace'
  | 'link'
  | 'problem';

export interface ClassifiedSpecifier {
  kind: SpecifierKind;
  /** True when this specifier is syntactically fine but npm itself will not read it the way another package manager might. */
  warning?: string;
}

const TARBALL_URL_RE = /^https?:\/\/.+\.(tgz|tar\.gz)(\?.*)?$/i;
const GIT_URL_RE = /^(git\+ssh:\/\/|git\+https?:\/\/|git:\/\/|ssh:\/\/|git\+file:\/\/)/i;
const GITHUB_SHORTHAND_RE = /^(github:)?[\w-]+\/[\w.-]+(#.+)?$/;
const TAG_RE = /^[A-Za-z][\w.-]*$/;

/**
 * Classifies an npm dependency specifier the way `package.json`'s
 * dependency maps read them: a semver range, a dist-tag, an `npm:` alias, a
 * local `file:` path, a git URL, a `user/repo` GitHub shorthand, a tarball
 * URL, or a `workspace:`/`link:` protocol -- which this project's own
 * fetched dependency-specifier documentation says npm itself does not read
 * (only other package managers or tools do), so it is a warning rather than
 * a plain acceptance.
 */
export function classifySpecifier(spec: string): ClassifiedSpecifier {
  const text = spec.trim();
  if (text === '') return { kind: 'problem' };

  if (text.startsWith('npm:')) return { kind: 'npm-alias' };
  if (text.startsWith('file:')) return { kind: 'file' };
  if (text.startsWith('workspace:')) {
    return { kind: 'workspace', warning: 'npm does not read the workspace: protocol; only pnpm and Yarn do.' };
  }
  if (text.startsWith('link:')) {
    return { kind: 'link', warning: 'npm does not read the link: protocol; only Yarn does.' };
  }
  if (GIT_URL_RE.test(text) || text.startsWith('git+') || /^git@/.test(text)) return { kind: 'git' };
  if (TARBALL_URL_RE.test(text)) return { kind: 'tarball-url' };
  if (isValidRange(text)) return { kind: 'range' };
  if (GITHUB_SHORTHAND_RE.test(text)) return { kind: 'github-shorthand' };
  if (TAG_RE.test(text)) return { kind: 'tag' };
  return { kind: 'problem' };
}
