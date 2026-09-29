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

// --- Java --------------------------------------------------------------
// Java Language Specification, section 3.9 (Keywords), fetched this
// session (docs.oracle.com/javase/specs/jls/se21/html/jls-3.html): the
// ReservedKeyword list, plus true/false/null, which are boolean and null
// literals rather than keywords but are equally unusable as identifiers.
export const JAVA_KEYWORDS = new Set([
  'abstract',
  'continue',
  'for',
  'new',
  'switch',
  'assert',
  'default',
  'if',
  'package',
  'synchronized',
  'boolean',
  'do',
  'goto',
  'private',
  'this',
  'break',
  'double',
  'implements',
  'protected',
  'throw',
  'byte',
  'else',
  'import',
  'public',
  'throws',
  'case',
  'enum',
  'instanceof',
  'return',
  'transient',
  'catch',
  'extends',
  'int',
  'short',
  'try',
  'char',
  'final',
  'interface',
  'static',
  'void',
  'class',
  'finally',
  'long',
  'strictfp',
  'volatile',
  'const',
  'float',
  'native',
  'super',
  'while',
  '_',
  'true',
  'false',
  'null',
]);

export const JAVA_SHADOW_TYPES = new Set([
  'Object',
  'String',
  'Integer',
  'Long',
  'Double',
  'Boolean',
  'Float',
  'List',
  'Map',
]);

export interface EscapedName {
  identifier: string;
  needsAnnotation: boolean;
}

export function javaComponentName(key: string): EscapedName {
  const base = camelCase(key, 'value');
  const identifier = JAVA_KEYWORDS.has(base) ? `${base}_` : base;
  return { identifier, needsAnnotation: identifier !== key };
}

// --- C# --------------------------------------------------------------------
// learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/,
// fetched this session: the reserved-keyword table (as through while).
export const CSHARP_KEYWORDS = new Set([
  'abstract',
  'as',
  'base',
  'bool',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'checked',
  'class',
  'const',
  'continue',
  'decimal',
  'default',
  'delegate',
  'do',
  'double',
  'else',
  'enum',
  'event',
  'explicit',
  'extern',
  'false',
  'finally',
  'fixed',
  'float',
  'for',
  'foreach',
  'goto',
  'if',
  'implicit',
  'in',
  'int',
  'interface',
  'internal',
  'is',
  'lock',
  'long',
  'namespace',
  'new',
  'null',
  'object',
  'operator',
  'out',
  'override',
  'params',
  'private',
  'protected',
  'public',
  'readonly',
  'ref',
  'return',
  'sbyte',
  'sealed',
  'short',
  'sizeof',
  'stackalloc',
  'static',
  'string',
  'struct',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'uint',
  'ulong',
  'unchecked',
  'unsafe',
  'ushort',
  'using',
  'virtual',
  'void',
  'volatile',
  'while',
]);

export const CSHARP_SHADOW_TYPES = new Set([
  'Object',
  'String',
  'Int32',
  'Int64',
  'Double',
  'Boolean',
  'List',
  'Dictionary',
]);

/** C# escapes a keyword-named identifier with a literal `@` prefix, which is not part of the identifier's own text. */
export function csharpPropertyName(key: string): string {
  const base = pascalCase(key, 'Value');
  return CSHARP_KEYWORDS.has(base) ? `@${base}` : base;
}

// --- Kotlin ------------------------------------------------------------
// kotlinlang.org/docs/keyword-reference.html, fetched this session: the
// hard-keyword list (always interpreted as keywords, cannot be identifiers).
export const KOTLIN_KEYWORDS = new Set([
  'as',
  'break',
  'class',
  'continue',
  'do',
  'else',
  'false',
  'for',
  'fun',
  'if',
  'in',
  'interface',
  'is',
  'null',
  'object',
  'package',
  'return',
  'super',
  'this',
  'throw',
  'true',
  'try',
  'typealias',
  'typeof',
  'val',
  'var',
  'when',
  'while',
]);

export const KOTLIN_SHADOW_TYPES = new Set(['Any', 'String', 'Int', 'Long', 'Double', 'Boolean', 'List', 'Map']);

export interface KotlinField {
  /** What to write at the property's declaration site -- backtick-quoted when it collides with a hard keyword. */
  identifier: string;
  needsSerialName: boolean;
}

export function kotlinField(key: string): KotlinField {
  const base = camelCase(key, 'value');
  const isKeyword = KOTLIN_KEYWORDS.has(base);
  return {
    identifier: isKeyword ? `\`${base}\`` : base,
    needsSerialName: isKeyword || base !== key,
  };
}

// --- PHP -------------------------------------------------------------------
// php.net/manual/en/reserved.keywords.php, fetched this session: keywords
// are allowed as property and variable names (only disallowed as constant,
// class, or function names), so a PHP promoted-property variable name never
// needs keyword escaping -- only the identifier SHAPE (a valid PHP variable
// name) matters, handled by `camelCase`'s own fallback and digit-prefix
// rules. php.net/manual/en/reserved.other-reserved-words.php, fetched this
// session: the words that cannot name a class (parent, self, int, float,
// bool, string, true, false, null, void, iterable, object, mixed, never,
// array, callable), on top of the general keyword list. PHP matches both
// lists case-insensitively (php.net's own notes on the keyword page).
export const PHP_KEYWORDS = new Set([
  '__halt_compiler',
  'abstract',
  'and',
  'array',
  'as',
  'break',
  'callable',
  'case',
  'catch',
  'class',
  'clone',
  'const',
  'continue',
  'declare',
  'default',
  'die',
  'do',
  'echo',
  'else',
  'elseif',
  'empty',
  'enddeclare',
  'endfor',
  'endforeach',
  'endif',
  'endswitch',
  'endwhile',
  'eval',
  'exit',
  'extends',
  'final',
  'finally',
  'fn',
  'for',
  'foreach',
  'function',
  'global',
  'goto',
  'if',
  'implements',
  'include',
  'include_once',
  'instanceof',
  'insteadof',
  'interface',
  'isset',
  'list',
  'match',
  'namespace',
  'new',
  'or',
  'print',
  'private',
  'protected',
  'public',
  'readonly',
  'require',
  'require_once',
  'return',
  'static',
  'switch',
  'throw',
  'trait',
  'try',
  'unset',
  'use',
  'var',
  'while',
  'xor',
  'yield',
]);

export const PHP_OTHER_RESERVED = new Set([
  'parent',
  'self',
  'int',
  'float',
  'bool',
  'string',
  'true',
  'false',
  'null',
  'void',
  'iterable',
  'object',
  'mixed',
  'never',
  'array',
  'callable',
]);

/** A valid PHP variable name (without its leading `$`) for a JSON key, in camelCase. */
export function phpVariableName(key: string): string {
  return camelCase(key, 'value');
}

/** PHP matches keywords and other reserved class-name words case-insensitively. */
export function isPhpReservedClassName(name: string): boolean {
  const lower = name.toLowerCase();
  return [...PHP_KEYWORDS].some((k) => k.toLowerCase() === lower) || [...PHP_OTHER_RESERVED].some((k) => k === lower);
}

export function phpClassName(name: string): string {
  return isPhpReservedClassName(name) ? `${name}Type` : name;
}

// --- shared camelCase-boundary splitting, used by lowerSnakeCase below -----
// Splits a run of letters and digits at a camelCase boundary: between a
// lowercase letter or digit and a following uppercase letter, and between an
// uppercase run and a following uppercase-then-lowercase pair (so
// "HTTPServer" splits as "HTTP" + "Server", not one word or four).
function splitCamelWords(chunk: string): string[] {
  const spaced = chunk.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.split(/\s+/).filter(Boolean);
}

/**
 * lower_snake_case that also splits at camelCase boundaries, unlike
 * `snakeCase` above (which Rust's own field-name rule depends on and must
 * not change). Used by Protocol Buffers field names and the Dart part-file
 * name (P-04).
 */
export function lowerSnakeCase(key: string, fallback: string): string {
  const words = wordsFromKey(key).flatMap(splitCamelWords);
  if (words.length === 0) return fallback;
  let name = words.map((w) => w.toLowerCase()).join('_');
  if (name === '') return fallback;
  if (/^[0-9]/.test(name)) name = `n_${name}`;
  return name;
}

// --- Protocol Buffers (proto3) ----------------------------------------------
// https://protobuf.dev/reference/protobuf/proto3-spec/, fetched this
// session: the grammar's keyword tokens (syntax, edition, import, weak,
// public, package, option, repeated, optional, required, oneof, map,
// reserved, to, max, enum, message, service, rpc, stream, returns, extend,
// extensions, group, inf, nan, true, false) plus the scalar type names,
// which the ident rule also excludes from being written as a plain field
// name without escaping.
// https://protobuf.dev/programming-guides/json/, fetched this session:
// ProtoJSON maps a field name to lowerCamelCase by default, and a
// `json_name` option overrides that default when present.
// https://protobuf.dev/programming-guides/proto3/, fetched this session:
// field numbers 19000 through 19999 are reserved for the protocol buffers
// implementation and may not be used in a message.
export const PROTOBUF_KEYWORDS = new Set([
  'syntax',
  'edition',
  'import',
  'weak',
  'public',
  'package',
  'option',
  'repeated',
  'optional',
  'required',
  'oneof',
  'map',
  'reserved',
  'to',
  'max',
  'enum',
  'message',
  'service',
  'rpc',
  'stream',
  'returns',
  'extend',
  'extensions',
  'group',
  'inf',
  'nan',
  'true',
  'false',
  'double',
  'float',
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
  'bool',
  'string',
  'bytes',
]);

/** protoc's own rule, implemented literally: an underscore is dropped and uppercases the next character; every other character is copied, so a trailing underscore simply disappears. */
export function protobufDefaultJsonName(fieldName: string): string {
  let out = '';
  let upperNext = false;
  for (const ch of fieldName) {
    if (ch === '_') {
      upperNext = true;
      continue;
    }
    out += upperNext ? ch.toUpperCase() : ch;
    upperNext = false;
  }
  return out;
}

/**
 * Assigns a proto3 field name per JSON key: `lowerSnakeCase`, with a
 * trailing underscore added when that candidate is a proto3 keyword. On a
 * collision -- either the candidate name or its own protoc default JSON name
 * was already produced for an earlier key in this same message -- 2, 3, ...
 * is appended, so both the field name and its default JSON name stay unique
 * inside the message and protoc's own JSON-name uniqueness check can never
 * fail.
 */
export function assignProtobufFieldNames(keys: string[]): Map<string, string> {
  const usedNames = new Set<string>();
  const usedJsonNames = new Set<string>();
  const result = new Map<string, string>();
  for (const key of keys) {
    const base = lowerSnakeCase(key, 'field');
    const candidateBase = PROTOBUF_KEYWORDS.has(base) ? `${base}_` : base;
    let name = candidateBase;
    let i = 2;
    while (usedNames.has(name) || usedJsonNames.has(protobufDefaultJsonName(name))) {
      name = `${candidateBase}${i}`;
      i++;
    }
    usedNames.add(name);
    usedJsonNames.add(protobufDefaultJsonName(name));
    result.set(key, name);
  }
  return result;
}

export function escapeProtobufStringLiteral(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += '\\x' + code.toString(16).padStart(2, '0');
    else out += ch;
  }
  return out;
}

// --- Swift -------------------------------------------------------------
// https://docs.swift.org/swift-book/documentation/the-swift-programming-language/lexicalstructure/,
// fetched this session, "Keywords and Punctuation": the keywords reserved
// in all contexts (as opposed to Swift's separate, smaller list of
// keywords reserved only in particular contexts, which stay valid ordinary
// identifiers everywhere else and so are not escaped here); the same page
// documents that a keyword can be used as an identifier by surrounding it
// with backticks.
export const SWIFT_KEYWORDS = new Set([
  'associatedtype',
  'borrowing',
  'class',
  'consuming',
  'deinit',
  'enum',
  'extension',
  'fileprivate',
  'func',
  'import',
  'init',
  'inout',
  'internal',
  'let',
  'nonisolated',
  'open',
  'operator',
  'precedencegroup',
  'private',
  'protocol',
  'public',
  'rethrows',
  'static',
  'struct',
  'subscript',
  'typealias',
  'var',
  'break',
  'case',
  'catch',
  'continue',
  'default',
  'defer',
  'do',
  'else',
  'fallthrough',
  'for',
  'guard',
  'if',
  'in',
  'repeat',
  'return',
  'throw',
  'switch',
  'where',
  'while',
  'Any',
  'as',
  'await',
  'false',
  'is',
  'nil',
  'self',
  'Self',
  'super',
  'throws',
  'true',
  'try',
  '_',
]);

export const SWIFT_SHADOW_TYPES = new Set([
  'String',
  'Int',
  'Double',
  'Bool',
  'Array',
  'Dictionary',
  'Optional',
  'Codable',
  'Decodable',
  'Encodable',
  'Data',
  'Date',
  'URL',
  'Error',
  'Any',
  'Self',
  'Type',
  'Protocol',
  'JSONValue',
  'CodingKeys',
]);

export function escapeSwiftStringLiteral(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += '\\u{' + code.toString(16) + '}';
    else out += ch;
  }
  return out;
}

// --- Dart ----------------------------------------------------------------
// https://dart.dev/language/keywords, fetched this session: the reserved
// words (which cannot be used as identifiers at all), plus `await` and
// `yield`, which that same page marks as restricted only inside an async or
// generator function body -- treated as reserved here too, since a
// generated property could otherwise land inside one. Object's own members
// (hashCode, runtimeType, toString, noSuchMethod) and json_serializable's
// two generated members (fromJson, toJson) are added on top, since a field
// of either name would collide with a real member or a generated one.
export const DART_RESERVED = new Set([
  'assert',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'do',
  'else',
  'enum',
  'extends',
  'false',
  'final',
  'finally',
  'for',
  'if',
  'in',
  'is',
  'new',
  'null',
  'rethrow',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'var',
  'void',
  'while',
  'with',
  'await',
  'yield',
  'hashCode',
  'runtimeType',
  'toString',
  'noSuchMethod',
  'fromJson',
  'toJson',
]);

export function dartFieldName(key: string): string {
  const base = camelCase(key, 'value');
  return DART_RESERVED.has(base) ? `${base}_` : base;
}

export const DART_SHADOW_TYPES = new Set([
  'String',
  'List',
  'Map',
  'Object',
  'Function',
  'Null',
  'Type',
  'Iterable',
  'Set',
  'Record',
  'Never',
  'Enum',
  'Symbol',
  'Error',
  'Exception',
  'DateTime',
  'Duration',
  'Uri',
  'Future',
  'Stream',
  'JsonKey',
  'JsonSerializable',
]);

export function escapeDartStringLiteral(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '$') out += '\\$';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += '\\u{' + code.toString(16) + '}';
    else out += ch;
  }
  return out;
}
