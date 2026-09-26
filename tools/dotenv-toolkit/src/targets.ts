/**
 * Writers and readers for the five conversion targets: a Compose
 * `environment` fragment, a Kubernetes ConfigMap, a Kubernetes Secret, POSIX
 * shell `export` lines, and JSON.
 *
 * Compose interpolation section (spec.md, fetched at the pinned commit):
 * "You can use a $$ (double-dollar sign) when your configuration needs a
 * literal dollar sign." -- every `$` in a value written to Compose becomes
 * `$$` so it survives Compose's own interpolation pass unchanged.
 *
 * Kubernetes ConfigMap and Secret concept pages: a `data`/`stringData` key
 * "must consist of alphanumeric characters, '-', '_' or '.'"; Secret `data`
 * values are the base64 encoding of the raw bytes (RFC 4648), never
 * encrypted.
 */
import { Document } from 'yaml';
import { readYaml } from './yaml-source';
import { posixSingleQuote } from './shell-literal';
import { setOwn, getOwn, hasOwn } from './own-property';
import type { EnvEntry, EnvProblem } from './parse-env';

export type EnvTarget = 'compose' | 'configmap' | 'secret' | 'shell' | 'json';

export interface WriteOptions {
  serviceName?: string;
  resourceName?: string;
}

export interface UnrepresentableValue {
  key: string;
  reason: string;
}

export interface WriteResult {
  output: string;
  warnings: string[];
  unrepresentable: UnrepresentableValue[];
}

export interface ReadResult {
  entries: EnvEntry[];
  problems: EnvProblem[];
}

/** A Kubernetes ConfigMap/Secret `data` key: alphanumeric, `-`, `_` or `.` (the concept page's own key rule). */
const KUBERNETES_KEY = /^[A-Za-z0-9._-]+$/;

/** A POSIX shell environment variable name (letters, digits, underscore; not starting with a digit). */
const SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** A minimal, dependency-free base64 encoder (RFC 4648 section 4) over raw bytes. */
function base64Encode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out +=
      BASE64_ALPHABET[(n >> 18) & 63]! +
      BASE64_ALPHABET[(n >> 12) & 63]! +
      BASE64_ALPHABET[(n >> 6) & 63]! +
      BASE64_ALPHABET[n & 63]!;
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i]! << 16;
    out += BASE64_ALPHABET[(n >> 18) & 63]! + BASE64_ALPHABET[(n >> 12) & 63]! + '==';
  } else if (remaining === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += BASE64_ALPHABET[(n >> 18) & 63]! + BASE64_ALPHABET[(n >> 12) & 63]! + BASE64_ALPHABET[(n >> 6) & 63]! + '=';
  }
  return out;
}

/** A minimal, dependency-free base64 decoder (RFC 4648 section 4) into raw bytes. */
function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  const withoutPad = clean.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of withoutPad) {
    const index = BASE64_ALPHABET.indexOf(ch);
    if (index === -1) continue;
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** Every `$` in a value written into Compose YAML becomes `$$`, per the Interpolation section's own literal-dollar escape. */
function escapeComposeDollar(value: string): string {
  return value.replace(/\$/g, '$$$$');
}

function unescapeComposeDollar(value: string): string {
  return value.replace(/\$\$/g, '$');
}

/** Writes a Compose fragment with one service's `environment` mapping. */
function writeCompose(entries: EnvEntry[], serviceName: string): WriteResult {
  const doc = new Document({
    services: {
      [serviceName]: {
        environment: Object.fromEntries(entries.map((e) => [e.key, escapeComposeDollar(e.value)])),
      },
    },
  });
  return { output: doc.toString(), warnings: [], unrepresentable: [] };
}

function readCompose(text: string): ReadResult {
  const source = readYaml(text);
  const value = source.documents[0]?.value as { services?: Record<string, { environment?: unknown }> } | undefined;
  const problems: EnvProblem[] = [];
  const entries: EnvEntry[] = [];
  const services = value?.services ?? {};
  const firstService = Object.values(services)[0];
  const env = firstService?.environment;
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    for (const [key, raw] of Object.entries(env as Record<string, unknown>)) {
      const value2 = typeof raw === 'string' ? unescapeComposeDollar(raw) : String(raw);
      entries.push({ key, value: value2, line: 1, quote: 'none' });
    }
  } else {
    problems.push({ line: 1, message: 'No services.<name>.environment mapping was found in this Compose fragment.' });
  }
  return { entries, problems };
}

/** Writes a Kubernetes ConfigMap (`data`) or Secret (`data` base64-encoded) manifest. Keys outside the Kubernetes key rule are left out and listed. */
function writeKubernetes(entries: EnvEntry[], kind: 'ConfigMap' | 'Secret', name: string): WriteResult {
  const data: Record<string, string> = {};
  const unrepresentable: UnrepresentableValue[] = [];
  const warnings: string[] = [];
  for (const entry of entries) {
    if (!KUBERNETES_KEY.test(entry.key)) {
      unrepresentable.push({
        key: entry.key,
        reason: 'Kubernetes data keys accept only letters, digits, "-", "_" and "."',
      });
      continue;
    }
    setOwn(data, entry.key, kind === 'Secret' ? base64Encode(utf8Bytes(entry.value)) : entry.value);
  }
  const doc = new Document({
    apiVersion: 'v1',
    kind,
    metadata: { name },
    data,
  });
  if (kind === 'Secret') warnings.push('Secret data is base64, which is encoding, not encryption.');
  return { output: doc.toString(), warnings, unrepresentable };
}

function readKubernetes(text: string, kind: 'ConfigMap' | 'Secret'): ReadResult {
  const source = readYaml(text);
  const value = source.documents[0]?.value as { kind?: string; data?: Record<string, unknown> } | undefined;
  const problems: EnvProblem[] = [];
  const entries: EnvEntry[] = [];
  const data = value?.data ?? {};
  for (const [key, raw] of Object.entries(data)) {
    if (typeof raw !== 'string') continue;
    const decoded = kind === 'Secret' ? utf8Decode(base64Decode(raw)) : raw;
    entries.push({ key, value: decoded, line: 1, quote: 'none' });
  }
  if (Object.keys(data).length === 0) {
    problems.push({ line: 1, message: `No data mapping was found in this ${kind} manifest.` });
  }
  return { entries, problems };
}

/** Writes POSIX `export KEY=<value>` lines. Keys that are not POSIX shell names are left out and listed. */
function writeShell(entries: EnvEntry[]): WriteResult {
  const lines: string[] = [];
  const unrepresentable: UnrepresentableValue[] = [];
  for (const entry of entries) {
    if (!SHELL_NAME.test(entry.key)) {
      unrepresentable.push({ key: entry.key, reason: 'This is not a POSIX shell environment variable name.' });
      continue;
    }
    lines.push(`export ${entry.key}=${posixSingleQuote(entry.value)}`);
  }
  return { output: lines.join('\n') + (lines.length > 0 ? '\n' : ''), warnings: [], unrepresentable };
}

/**
 * Decodes a POSIX shell word built only from single-quoted spans (`'...'`,
 * taken literally) and single-character backslash escapes (`\x`) --
 * precisely the two building blocks `posixSingleQuote` ever emits, closing,
 * escaping and reopening the quote for every embedded quote character.
 */
function decodePosixWord(word: string): string {
  let out = '';
  let i = 0;
  while (i < word.length) {
    if (word[i] === "'") {
      const end = word.indexOf("'", i + 1);
      if (end === -1) return out + word.slice(i);
      out += word.slice(i + 1, end);
      i = end + 1;
    } else if (word[i] === '\\' && i + 1 < word.length) {
      out += word[i + 1];
      i += 2;
    } else {
      out += word[i];
      i++;
    }
  }
  return out;
}

/** True for a word built only from `'...'` spans and single-character backslash escapes -- the exact grammar `posixSingleQuote` produces. */
const POSIX_WORD = /^(?:'[^']*'|\\[\s\S])*$/;

/**
 * Reads `export KEY=<posixSingleQuote(value)>` entries back, exactly in the
 * form `writeShell` writes. Scans the whole text rather than splitting on
 * every newline first, since a single-quoted POSIX word can legitimately
 * contain a literal embedded newline (`posixSingleQuote` never escapes one).
 * Anything else found is a problem naming the physical line it starts on.
 */
function readShell(text: string): ReadResult {
  // Unlike parseEnv, this never folds \r\n to \n: a quoted value can hold a
  // literal CR byte exactly as posixSingleQuote wrote it, so only a bare \n
  // is treated as a line separator here.
  const normalized = text;
  const len = normalized.length;
  const entries: EnvEntry[] = [];
  const problems: EnvProblem[] = [];
  let i = 0;
  let line = 1;

  while (i < len) {
    if (normalized[i] === '\n') {
      i++;
      line++;
      continue;
    }

    const startLine = line;
    const prefixMatch = /^export ([A-Za-z_][A-Za-z0-9_]*)=/.exec(normalized.slice(i));
    if (!prefixMatch) {
      let end = i;
      while (end < len && normalized[end] !== '\n') end++;
      if (normalized.slice(i, end).trim() !== '') {
        problems.push({
          line: startLine,
          message: "This line is not an export KEY='value' line in the form this tool writes.",
        });
      }
      i = end;
      continue;
    }

    i += prefixMatch[0].length;
    let word = '';
    let ok = true;
    while (i < len) {
      if (normalized[i] === "'") {
        const close = normalized.indexOf("'", i + 1);
        if (close === -1) {
          ok = false;
          break;
        }
        for (let k = i; k <= close; k++) if (normalized[k] === '\n') line++;
        word += normalized.slice(i, close + 1);
        i = close + 1;
      } else if (normalized[i] === '\\' && i + 1 < len) {
        word += normalized.slice(i, i + 2);
        i += 2;
      } else {
        break;
      }
    }

    let lineEnd = i;
    while (lineEnd < len && normalized[lineEnd] !== '\n') lineEnd++;
    const trailing = normalized.slice(i, lineEnd);
    if (!ok || trailing.trim() !== '' || !POSIX_WORD.test(word)) {
      problems.push({
        line: startLine,
        message: "This line is not an export KEY='value' line in the form this tool writes.",
      });
      i = lineEnd;
      continue;
    }

    entries.push({ key: prefixMatch[1]!, value: decodePosixWord(word), line: startLine, quote: 'single' });
    i = lineEnd;
  }

  return { entries, problems };
}

/** Writes a JSON object, two-space indent, built with `setOwn` so a key such as `__proto__` stays an own key. */
function writeJson(entries: EnvEntry[]): WriteResult {
  const obj: Record<string, string> = {};
  for (const entry of entries) setOwn(obj, entry.key, entry.value);
  return { output: JSON.stringify(obj, null, 2) + '\n', warnings: [], unrepresentable: [] };
}

function readJson(text: string): ReadResult {
  const problems: EnvProblem[] = [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    problems.push({ line: 1, message: err instanceof Error ? err.message : 'This is not valid JSON.' });
    return { entries: [], problems };
  }
  const entries: EnvEntry[] = [];
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (!hasOwn(value as object, key)) continue;
      const raw = getOwn(value as Record<string, unknown>, key);
      entries.push({ key, value: typeof raw === 'string' ? raw : JSON.stringify(raw), line: 1, quote: 'none' });
    }
  } else {
    problems.push({ line: 1, message: 'The top-level JSON value must be an object.' });
  }
  return { entries, problems };
}

export function writeTarget(entries: EnvEntry[], target: EnvTarget, options: WriteOptions = {}): WriteResult {
  switch (target) {
    case 'compose':
      return writeCompose(entries, options.serviceName || 'app');
    case 'configmap':
      return writeKubernetes(entries, 'ConfigMap', options.resourceName || 'app-config');
    case 'secret':
      return writeKubernetes(entries, 'Secret', options.resourceName || 'app-secret');
    case 'shell':
      return writeShell(entries);
    case 'json':
      return writeJson(entries);
  }
}

export function readTarget(text: string, target: EnvTarget): ReadResult {
  switch (target) {
    case 'compose':
      return readCompose(text);
    case 'configmap':
      return readKubernetes(text, 'ConfigMap');
    case 'secret':
      return readKubernetes(text, 'Secret');
    case 'shell':
      return readShell(text);
    case 'json':
      return readJson(text);
  }
}

/** Writes `.env` text from entries, choosing the least intrusive quoting per value; a value nothing can hold unchanged is left out and listed. */
export function writeEnv(entries: EnvEntry[]): { output: string; unrepresentable: UnrepresentableValue[] } {
  const lines: string[] = [];
  const unrepresentable: UnrepresentableValue[] = [];
  for (const entry of entries) {
    const written = writeEnvValue(entry.value);
    if (written === undefined) {
      unrepresentable.push({
        key: entry.key,
        reason:
          'This value mixes characters no .env quoting form here can hold unchanged (for example a newline together with a double quote).',
      });
      continue;
    }
    lines.push(`${entry.key}=${written}`);
  }
  return { output: lines.join('\n') + (lines.length > 0 ? '\n' : ''), unrepresentable };
}

/**
 * Chooses the least intrusive .env quoting for one value, re-reading dotenv's
 * own rules in reverse: unquoted survives unchanged only when parsing it back
 * unquoted would reproduce it exactly (no `#`, no leading/trailing space, not
 * empty, no quote character, no backslash-n/backslash-r sequence that a
 * double-quoted read would misinterpret); otherwise single quotes (unless the
 * value itself contains a single quote), otherwise double quotes with `\n`
 * for a real newline (unless the value already contains a literal backslash
 * immediately before an `n` or `r`, which a double-quoted read would expand
 * on the way back in); otherwise backticks (unless the value contains a
 * backtick); otherwise this value cannot round-trip through this format and
 * is reported as unrepresentable rather than silently changed.
 */
function writeEnvValue(value: string): string | undefined {
  const isPlainUnquotable =
    value !== '' &&
    value === value.trim() &&
    !value.includes('#') &&
    !value.includes("'") &&
    !value.includes('"') &&
    !value.includes('`') &&
    !value.includes('\n') &&
    !value.includes('\r') &&
    !value.includes('\\');
  if (isPlainUnquotable) return value;

  if (!value.includes("'") && !value.includes('\n') && !value.includes('\r')) {
    return `'${value}'`;
  }

  if (!value.includes('"') && !/\\[nr]/.test(value)) {
    return `"${value.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  }

  if (!value.includes('`')) {
    return `\`${value}\``;
  }

  return undefined;
}
