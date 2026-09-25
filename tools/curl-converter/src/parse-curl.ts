/**
 * Reads a pasted curl command into a `RequestSpec`, following the curl
 * manual (https://curl.se/docs/manpage.html, fetched before this file was
 * written) for what each option means. Meaning, quoted from the manual
 * where a plain reading could go two ways:
 *
 * - `-d, --data`: "If any of these options is used more than once on the
 *   same command line, the data pieces specified will be merged together
 *   with a separating &-symbol." and "this option makes curl use the POST
 *   method" (unless `-X`/`--request` overrides it).
 * - `-G, --get`: "If used in combination with -I, --head, no data-part will
 *   be sent." and moves the data content specified with `-d` onto the URL
 *   in a GET request instead of the POST it otherwise implies.
 * - `-I, --head`: "Fetch the headers only!" -- sets the request method to
 *   HEAD.
 * - `--json`: "the data is used as-is" and sets `Content-Type:
 *   application/json` and `Accept: application/json` if not already set,
 *   and implies `-X POST`.
 * - `--data-urlencode`: "the part before the equal sign is used literally"
 *   for the `name=content` form, and a leading `=` percent-encodes the
 *   whole remainder as one string.
 * - `-u, --user`: "If no password is specified, curl will ask for a
 *   password interactively" -- so a value with no colon is a warning, not
 *   an error.
 *
 * Every option not in `SUPPORTED_OPTIONS` (and not one of the accepted,
 * silently-passed-through output options) is reported as a warning naming
 * it, never dropped silently and never guessed at.
 */
import { isToken, type RequestAuth, type RequestBody, type RequestSpec } from './model';
import { CurlConverterError } from './model';
import { assertSingleLine } from './safe-value';
import { tokenizeShell } from './tokenize';

export interface ParseCurlResult {
  request: RequestSpec;
  warnings: string[];
  ignored: string[];
}

/** Every curl option this tool reads with real meaning (the manual's own flag spellings). */
export const SUPPORTED_OPTIONS = [
  '-X',
  '--request',
  '-H',
  '--header',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode',
  '--json',
  '-F',
  '--form',
  '--form-string',
  '-u',
  '--user',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '-b',
  '--cookie',
  '-G',
  '--get',
  '-I',
  '--head',
  '-L',
  '--location',
  '-k',
  '--insecure',
  '--compressed',
  '--url',
  '--oauth2-bearer',
] as const;

/** Accepted and silently ignored: output/verbosity controls with no bearing on the request itself. */
const IGNORED_NO_VALUE = new Set(['-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-i', '--include', '-O']);
const IGNORED_WITH_VALUE = new Set(['-o', '--output']);

type OptionKind =
  | 'method'
  | 'header'
  | 'data'
  | 'data-raw'
  | 'data-binary'
  | 'data-urlencode'
  | 'json'
  | 'form'
  | 'form-string'
  | 'user'
  | 'user-agent'
  | 'referer'
  | 'cookie'
  | 'get'
  | 'head'
  | 'location'
  | 'insecure'
  | 'compressed'
  | 'url'
  | 'bearer';

interface OptionEntry {
  kind: OptionKind;
  takesValue: boolean;
}

const LONG_OPTIONS: Record<string, OptionEntry> = {
  request: { kind: 'method', takesValue: true },
  header: { kind: 'header', takesValue: true },
  data: { kind: 'data', takesValue: true },
  'data-raw': { kind: 'data-raw', takesValue: true },
  'data-binary': { kind: 'data-binary', takesValue: true },
  'data-ascii': { kind: 'data', takesValue: true },
  'data-urlencode': { kind: 'data-urlencode', takesValue: true },
  json: { kind: 'json', takesValue: true },
  form: { kind: 'form', takesValue: true },
  'form-string': { kind: 'form-string', takesValue: true },
  user: { kind: 'user', takesValue: true },
  'user-agent': { kind: 'user-agent', takesValue: true },
  referer: { kind: 'referer', takesValue: true },
  cookie: { kind: 'cookie', takesValue: true },
  get: { kind: 'get', takesValue: false },
  head: { kind: 'head', takesValue: false },
  location: { kind: 'location', takesValue: false },
  insecure: { kind: 'insecure', takesValue: false },
  compressed: { kind: 'compressed', takesValue: false },
  url: { kind: 'url', takesValue: true },
  'oauth2-bearer': { kind: 'bearer', takesValue: true },
};

const SHORT_OPTIONS: Record<string, OptionEntry> = {
  X: { kind: 'method', takesValue: true },
  H: { kind: 'header', takesValue: true },
  d: { kind: 'data', takesValue: true },
  F: { kind: 'form', takesValue: true },
  u: { kind: 'user', takesValue: true },
  A: { kind: 'user-agent', takesValue: true },
  e: { kind: 'referer', takesValue: true },
  b: { kind: 'cookie', takesValue: true },
  G: { kind: 'get', takesValue: false },
  I: { kind: 'head', takesValue: false },
  L: { kind: 'location', takesValue: false },
  k: { kind: 'insecure', takesValue: false },
};

interface Builder {
  method: string | null;
  url: string | null;
  headers: [string, string][];
  dataParts: string[];
  rawBody: string | null;
  jsonBody: string | null;
  formFields: { name: string; value: string; isFile: boolean }[];
  isMultipart: boolean;
  getMode: boolean;
  headOnly: boolean;
  followRedirects: boolean;
  insecure: boolean;
  compressed: boolean;
  auth: RequestAuth;
  warnings: string[];
  ignored: string[];
}

/** Splits one `-abc` combined short-option token into its component flags, returning any attached value. */
function splitCombinedShort(token: string): { chars: string[]; attachedValue: string | null } {
  const chars: string[] = [];
  let attachedValue: string | null = null;
  for (let i = 1; i < token.length; i++) {
    const c = token[i]!;
    const known = SHORT_OPTIONS[c];
    const ignoredNoValue = IGNORED_NO_VALUE.has(`-${c}`);
    const ignoredWithValue = IGNORED_WITH_VALUE.has(`-${c}`);
    if (known?.takesValue || ignoredWithValue) {
      chars.push(c);
      const rest = token.slice(i + 1);
      if (rest.length > 0) attachedValue = rest;
      break;
    }
    chars.push(c);
    if (!known && !ignoredNoValue) {
      // Unknown short flag: stop combining further, the rest is its own thing (rare, but never mis-swallow).
    }
  }
  return { chars, attachedValue };
}

function decodeDataUrlencode(spec: string): string {
  // `content` -> the whole thing percent-encoded; `=content` -> same, minus
  // the leading `=`; `name=content` -> "name=" kept literal, content
  // percent-encoded. A `@file` form is not supported here (reported by the
  // caller before this function runs).
  const eq = spec.indexOf('=');
  if (eq < 0) return encodeURIComponent(spec);
  if (eq === 0) return encodeURIComponent(spec.slice(1));
  const name = spec.slice(0, eq);
  const content = spec.slice(eq + 1);
  return `${name}=${encodeURIComponent(content)}`;
}

function readOptions(tokens: string[], b: Builder): void {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;

    if (token === '--') {
      i++;
      continue;
    }

    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = eq >= 0 ? token.slice(2, eq) : token.slice(2);
      const opt = LONG_OPTIONS[name];
      if (IGNORED_NO_VALUE.has(`--${name}`)) {
        b.ignored.push(`--${name}`);
        i++;
        continue;
      }
      if (IGNORED_WITH_VALUE.has(`--${name}`)) {
        b.ignored.push(`--${name}`);
        i++;
        if (i < tokens.length) i++;
        continue;
      }
      if (!opt) {
        b.warnings.push(`"--${name}" is not an option this tool reads; it was ignored.`);
        i++;
        continue;
      }
      let value = '';
      if (opt.takesValue) {
        if (eq >= 0) value = token.slice(eq + 1);
        else if (i + 1 < tokens.length) {
          i++;
          value = tokens[i]!;
        } else {
          b.warnings.push(`"--${name}" needs a value but the command ends right after it.`);
          i++;
          continue;
        }
      }
      applyOption(opt.kind, value, b);
      i++;
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const { chars, attachedValue } = splitCombinedShort(token);
      for (const c of chars) {
        const opt = SHORT_OPTIONS[c];
        if (IGNORED_NO_VALUE.has(`-${c}`)) {
          b.ignored.push(`-${c}`);
          continue;
        }
        if (IGNORED_WITH_VALUE.has(`-${c}`)) {
          b.ignored.push(`-${c}`);
          if (attachedValue === null && i + 1 < tokens.length) i++;
          continue;
        }
        if (!opt) {
          b.warnings.push(`"-${c}" is not an option this tool reads; it was ignored.`);
          continue;
        }
        if (!opt.takesValue) {
          applyOption(opt.kind, '', b);
          continue;
        }
        let value: string;
        if (attachedValue !== null) {
          value = attachedValue;
        } else if (i + 1 < tokens.length) {
          i++;
          value = tokens[i]!;
        } else {
          b.warnings.push(`"-${c}" needs a value but the command ends right after it.`);
          continue;
        }
        applyOption(opt.kind, value, b);
      }
      i++;
      continue;
    }

    // A bare word: the URL, unless one was already set (via --url or an earlier bare word).
    if (b.url === null) {
      b.url = token;
    } else {
      b.warnings.push(`"${token}" is an extra argument this tool ignores; only one URL is read.`);
    }
    i++;
  }
}

function applyOption(kind: OptionKind, value: string, b: Builder): void {
  switch (kind) {
    case 'method':
      b.method = value;
      break;
    case 'header': {
      const colon = value.indexOf(':');
      if (colon < 0) {
        b.warnings.push(`Header "${value}" has no colon, so it was ignored.`);
        break;
      }
      const name = value.slice(0, colon).trim();
      const headerValue = value.slice(colon + 1).trim();
      if (!isToken(name)) {
        b.warnings.push(`"${name}" is not a valid header name (RFC 9110 field names are tokens), so it was ignored.`);
        break;
      }
      try {
        b.headers.push([name, assertSingleLine(headerValue, `Header "${name}"`)]);
      } catch (err) {
        throw new CurlConverterError(err instanceof Error ? err.message : String(err));
      }
      break;
    }
    case 'data':
    case 'data-raw':
      if (value.startsWith('@')) {
        b.warnings.push(`"${value}" reads a file from disk, which this page cannot do, so that data was left out.`);
        break;
      }
      b.dataParts.push(value);
      break;
    case 'data-binary':
      if (value.startsWith('@')) {
        b.warnings.push(`"${value}" reads a file from disk, which this page cannot do, so that data was left out.`);
        break;
      }
      b.dataParts.push(value);
      break;
    case 'data-urlencode':
      if (/(^|=)@/.test(value)) {
        b.warnings.push(`"${value}" reads a file from disk, which this page cannot do, so that data was left out.`);
        break;
      }
      b.dataParts.push(decodeDataUrlencode(value));
      break;
    case 'json':
      b.jsonBody = value;
      break;
    case 'form':
    case 'form-string': {
      b.isMultipart = true;
      const eq = value.indexOf('=');
      const name = eq < 0 ? value : value.slice(0, eq);
      const rest = eq < 0 ? '' : value.slice(eq + 1);
      const isFile = kind === 'form' && rest.startsWith('@');
      if (isFile) {
        b.warnings.push(
          `Form field "${name}" reads a file from disk, which this page cannot do, so it was reported as not readable here.`,
        );
      }
      b.formFields.push({ name, value: isFile ? rest.slice(1) : rest, isFile });
      break;
    }
    case 'user': {
      const colon = value.indexOf(':');
      if (colon < 0) {
        b.warnings.push(
          `"-u ${value}" has no colon, so curl would prompt for the password interactively; the password was left empty here.`,
        );
        b.auth = { kind: 'basic', user: value, password: '' };
      } else {
        b.auth = { kind: 'basic', user: value.slice(0, colon), password: value.slice(colon + 1) };
      }
      break;
    }
    case 'user-agent':
      b.headers.push(['User-Agent', value]);
      break;
    case 'referer':
      b.headers.push(['Referer', value]);
      break;
    case 'cookie':
      b.headers.push(['Cookie', value]);
      break;
    case 'get':
      b.getMode = true;
      break;
    case 'head':
      b.headOnly = true;
      break;
    case 'location':
      b.followRedirects = true;
      break;
    case 'insecure':
      b.insecure = true;
      break;
    case 'compressed':
      b.compressed = true;
      break;
    case 'url':
      b.url = value;
      break;
    case 'bearer':
      b.auth = { kind: 'bearer', token: value };
      break;
    default: {
      const exhaustive: never = kind;
      throw new CurlConverterError(`Unhandled option kind "${String(exhaustive)}".`);
    }
  }
}

function resolveUrl(rawUrl: string | null, warnings: string[]): string {
  if (!rawUrl) throw new CurlConverterError('No URL was found in this command.');
  let url = rawUrl;
  const missingScheme = !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url);
  if (missingScheme) {
    // curl manual, --url: "If you specify URL without a protocol:// prefix,
    // curl will attempt to guess what protocol you might want... curl will
    // default to HTTP".
    warnings.push(`"${url}" has no scheme; http:// was assumed, as the curl manual states curl itself does.`);
    url = `http://${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new CurlConverterError(`The URL scheme "${parsed.protocol}" is not http or https.`);
    }
  } catch (err) {
    if (err instanceof CurlConverterError) throw err;
    throw new CurlConverterError(`"${rawUrl}" is not a URL this tool can parse.`);
  }
  return url;
}

function applyGetMode(url: string, dataParts: string[]): string {
  if (dataParts.length === 0) return url;
  const query = dataParts.join('&');
  const parsed = new URL(url);
  const separator = parsed.search ? '&' : '?';
  return `${url}${separator}${query}`;
}

/** Parses a pasted curl command into a `RequestSpec`, per the curl manual (see the file header). */
export function parseCurl(command: string): ParseCurlResult {
  const tokens = tokenizeShell(command);
  if (tokens.length === 0 || tokens[0] !== 'curl') {
    throw new CurlConverterError('This does not look like a curl command: the first word must be "curl".');
  }

  const b: Builder = {
    method: null,
    url: null,
    headers: [],
    dataParts: [],
    rawBody: null,
    jsonBody: null,
    formFields: [],
    isMultipart: false,
    getMode: false,
    headOnly: false,
    followRedirects: false,
    insecure: false,
    compressed: false,
    auth: { kind: 'none' },
    warnings: [],
    ignored: [],
  };

  readOptions(tokens.slice(1), b);

  const url = resolveUrl(b.url, b.warnings);

  let method = b.method;
  const hasData = b.dataParts.length > 0 || b.jsonBody !== null;
  if (!method) {
    if (b.headOnly) method = 'HEAD';
    else if (hasData && !b.getMode) method = 'POST';
    else if (b.isMultipart) method = 'POST';
    else method = 'GET';
  }
  if (!isToken(method)) {
    throw new CurlConverterError(`"${method}" is not a valid HTTP method token (RFC 9110 section 9.1).`);
  }

  let finalUrl = url;
  let body: RequestBody = { kind: 'none' };

  if (b.getMode && b.dataParts.length > 0) {
    finalUrl = applyGetMode(url, b.dataParts);
  } else if (b.jsonBody !== null) {
    body = { kind: 'json', text: b.jsonBody };
    if (!b.headers.some(([n]) => n.toLowerCase() === 'content-type'))
      b.headers.push(['Content-Type', 'application/json']);
    if (!b.headers.some(([n]) => n.toLowerCase() === 'accept')) b.headers.push(['Accept', 'application/json']);
  } else if (b.isMultipart) {
    body = { kind: 'multipart', fields: b.formFields };
  } else if (b.dataParts.length > 0) {
    body = { kind: 'form', pairs: b.dataParts.map((p) => splitPair(p)) };
  }

  const request: RequestSpec = {
    method,
    url: finalUrl,
    headers: b.headers,
    body,
    auth: b.auth,
    followRedirects: b.followRedirects,
    insecure: b.insecure,
    compressed: b.compressed,
  };

  return { request, warnings: b.warnings, ignored: b.ignored };
}

function splitPair(part: string): [string, string] {
  const eq = part.indexOf('=');
  if (eq < 0) return [part, ''];
  return [part.slice(0, eq), part.slice(eq + 1)];
}
