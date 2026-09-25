/**
 * Turns a JSON key into a valid identifier for each target language, from
 * each language's own reference and keyword list (fetched live before this
 * file was written, quoted in this package's tests), and keeps the original
 * key recoverable: a struct tag, a `rename` attribute, a docblock line or,
 * for TypeScript and Python's class form, the key text itself when it is
 * already a valid identifier there.
 */

function wordsFromKey(key: string): string[] {
  return key.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

function capitalizeWord(word: string): string {
  const digits = word.match(/^[0-9]*/)![0]!;
  const rest = word.slice(digits.length);
  if (rest.length === 0) return word;
  return digits + rest[0]!.toUpperCase() + rest.slice(1);
}

function lowerFirstWord(word: string): string {
  const digits = word.match(/^[0-9]*/)![0]!;
  const rest = word.slice(digits.length);
  if (rest.length === 0) return word;
  return digits + rest[0]!.toLowerCase() + rest.slice(1);
}

/** PascalCase, such as a Go, C# or Kotlin type name. Falls back to `fallback` for an empty or all-punctuation key. */
export function pascalCase(key: string, fallback: string): string {
  const words = wordsFromKey(key);
  if (words.length === 0) return fallback;
  let name = words.map(capitalizeWord).join('');
  if (name === '') return fallback;
  if (/^[0-9]/.test(name)) name = `N${name}`;
  return name;
}

/** camelCase, such as a Java record component or a Kotlin property. */
export function camelCase(key: string, fallback: string): string {
  const words = wordsFromKey(key);
  if (words.length === 0) return fallback;
  let name = [lowerFirstWord(words[0]!), ...words.slice(1).map(capitalizeWord)].join('');
  if (name === '') return fallback;
  if (/^[0-9]/.test(name)) name = `n${name[0]!.toUpperCase()}${name.slice(1)}`;
  return name;
}

/** snake_case, such as a Rust field. */
export function snakeCase(key: string, fallback: string): string {
  const words = wordsFromKey(key);
  if (words.length === 0) return fallback;
  let name = words.map((w) => w.toLowerCase()).join('_');
  if (name === '') return fallback;
  if (/^[0-9]/.test(name)) name = `n_${name}`;
  return name;
}

/**
 * Applies `derive` to every key in order, and appends a number to any
 * candidate that collides with one already produced for an earlier key in
 * this same call -- two JSON keys can validly turn into the same identifier
 * candidate (for example `a-b` and `a_b`).
 */
export function assignNames(keys: string[], derive: (key: string) => string): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const key of keys) {
    let name = derive(key);
    let i = 2;
    while (used.has(name)) {
      name = `${derive(key)}${i}`;
      i++;
    }
    used.add(name);
    result.set(key, name);
  }
  return result;
}

/** Appends `Type` when a generated type name would otherwise shadow a language-provided type name. */
export function withShadowSuffix(name: string, shadow: ReadonlySet<string>): string {
  return shadow.has(name) ? `${name}Type` : name;
}

function escapeRustStringLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

// --- TypeScript ---------------------------------------------------------
// https://www.typescriptlang.org/docs/handbook/2/objects.html, fetched this
// session: an object type's property name is written as an IdentifierName
// (which, unlike a binding identifier, may be a reserved word) when valid,
// or a quoted string literal otherwise -- so only shape, never keyword
// status, decides whether a TypeScript property name needs quoting.
const TS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function typescriptPropertyName(key: string): string {
  return TS_IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

export const TS_SHADOW_TYPES = new Set([
  'Object',
  'String',
  'Number',
  'Boolean',
  'Array',
  'Function',
  'Symbol',
  'Date',
  'Error',
  'RegExp',
  'Map',
  'Set',
  'Promise',
]);

// --- Go ------------------------------------------------------------------
// https://go.dev/ref/spec#Keywords, fetched this session: "break default
// func interface select case defer go map struct chan else goto package
// switch const fallthrough if range type continue for import return var".
// Every generated Go field name here is PascalCase (exported), and every Go
// keyword is lowercase, so a field name can never collide with one -- no
// escaping is needed for field names, only for a generated type name that
// would shadow a Go predeclared identifier.
export const GO_KEYWORDS = new Set([
  'break',
  'default',
  'func',
  'interface',
  'select',
  'case',
  'defer',
  'go',
  'map',
  'struct',
  'chan',
  'else',
  'goto',
  'package',
  'switch',
  'const',
  'fallthrough',
  'if',
  'range',
  'type',
  'continue',
  'for',
  'import',
  'return',
  'var',
]);

export const GO_SHADOW_TYPES = new Set(['Error', 'Any', 'Comparable']);

export function goFieldName(key: string): string {
  return pascalCase(key, 'Field');
}

/**
 * `encoding/json`'s own docs (pkg.go.dev/encoding/json, fetched this
 * session): "The key name will be used if it's a non-empty string
 * consisting of only Unicode letters, digits, and ASCII punctuation except
 * quotation marks, backslash, and comma." A key with one of those three
 * characters is still written into the tag (kept for a human reading the
 * source), but noted in this package's `limits` as not round-tripping
 * through Go's own decoder exactly.
 */
export function goStructTag(key: string, optional: boolean): string {
  const value = optional ? `${key},omitempty` : key;
  const tagContent = `json:"${value}"`;
  if (!tagContent.includes('`')) return '`' + tagContent + '`';
  return '"' + tagContent.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

export function goKeyIsTagSafe(key: string): boolean {
  return key !== '' && !/["\\,]/.test(key);
}

// --- Rust ------------------------------------------------------------------
// https://doc.rust-lang.org/reference/keywords.html, fetched this session:
// strict keywords "_ as async await break const continue crate dyn else enum
// extern false fn for if impl in let loop match mod move mut pub ref return
// self Self static struct super trait true type unsafe use where while", plus
// reserved keywords "abstract become box do final gen macro override priv
// try typeof unsized virtual yield".
// https://doc.rust-lang.org/reference/identifiers.html, fetched this
// session: RESERVED_RAW_IDENTIFIER is `r#` followed by one of "_ crate self
// Self super" not followed by an identifier continuation character -- those
// five cannot be written as a raw identifier, so a trailing underscore is
// used for them instead.
export const RUST_KEYWORDS = new Set([
  '_',
  'as',
  'async',
  'await',
  'break',
  'const',
  'continue',
  'crate',
  'dyn',
  'else',
  'enum',
  'extern',
  'false',
  'fn',
  'for',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'match',
  'mod',
  'move',
  'mut',
  'pub',
  'ref',
  'return',
  'self',
  'Self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'type',
  'unsafe',
  'use',
  'where',
  'while',
  'abstract',
  'become',
  'box',
  'do',
  'final',
  'gen',
  'macro',
  'override',
  'priv',
  'try',
  'typeof',
  'unsized',
  'virtual',
  'yield',
]);

const RUST_NO_RAW_IDENTIFIER = new Set(['_', 'crate', 'self', 'Self', 'super']);

export const RUST_SHADOW_TYPES = new Set(['String', 'Vec', 'Option', 'Box', 'Result', 'Self']);

export interface RustField {
  /** What to write at the field's declaration site: a raw identifier, a trailing-underscore escape, or the plain name. */
  identifier: string;
  /** The field's own semantic name -- what serde matches by default, and what a `rename` attribute is compared against. */
  semanticName: string;
  needsRename: boolean;
  /** A Rust string literal (already quoted and escaped) for `#[serde(rename = ...)]`, present only when `needsRename`. */
  renameLiteral?: string;
}

export function rustField(key: string): RustField {
  const base = snakeCase(key, 'field');
  const isKeyword = RUST_KEYWORDS.has(base);
  const useTrailingUnderscore = isKeyword && RUST_NO_RAW_IDENTIFIER.has(base);
  const semanticName = useTrailingUnderscore ? `${base}_` : base;
  const identifier = isKeyword && !useTrailingUnderscore ? `r#${base}` : semanticName;
  const needsRename = semanticName !== key;
  return {
    identifier,
    semanticName,
    needsRename,
    renameLiteral: needsRename ? `"${escapeRustStringLiteral(key)}"` : undefined,
  };
}

// --- Python ----------------------------------------------------------------
// https://docs.python.org/3/reference/lexical_analysis.html, fetched this
// session: "False await else import pass None break except in raise True
// class finally is return and continue for lambda try as def from nonlocal
// while assert del global not with async elif if or yield" are the 35
// reserved keywords; a soft keyword (match, case, _, type) is not reserved
// and stays a valid ordinary identifier everywhere outside its own
// statement, so it is not treated as a keyword here.
export const PYTHON_KEYWORDS = new Set([
  'False',
  'await',
  'else',
  'import',
  'pass',
  'None',
  'break',
  'except',
  'in',
  'raise',
  'True',
  'class',
  'finally',
  'is',
  'return',
  'and',
  'continue',
  'for',
  'lambda',
  'try',
  'as',
  'def',
  'from',
  'nonlocal',
  'while',
  'assert',
  'del',
  'global',
  'not',
  'with',
  'async',
  'elif',
  'if',
  'or',
  'yield',
]);

const PYTHON_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidPythonIdentifier(key: string): boolean {
  return PYTHON_IDENTIFIER.test(key) && !PYTHON_KEYWORDS.has(key);
}

export function escapePythonStringLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}
