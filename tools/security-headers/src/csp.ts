/**
 * Content-Security-Policy directive parsing and serialisation, against the
 * directive list and source-list ABNF fetched live from CSP Level 3
 * (https://www.w3.org/TR/CSP3/, "Source Lists" section and each directive's
 * own ABNF), plus `upgrade-insecure-requests`, which belongs to the Mixed
 * Content specification rather than CSP itself (quoted where it is emitted
 * in index.ts).
 */

export type CspValueType = 'source-list' | 'sandbox' | 'ancestor-source-list' | 'report-uri' | 'report-to' | 'boolean';

interface DirectiveSpec {
  name: string;
  valueType: CspValueType;
}

export interface CspDirective {
  name: string;
  value: string;
  line: number;
}

export interface CspProblem {
  line: number;
  message: string;
}

export interface ParsedCsp {
  directives: CspDirective[];
  problems: CspProblem[];
}

// CSP Level 3's own directive list ("2.1 Directives" and each directive's
// own ABNF, fetched live from w3.org/TR/CSP3): fetch directives, the one
// other directive (worker-src), the document directives (base-uri,
// sandbox), the navigation directives (form-action, frame-ancestors) and
// the reporting directives (report-uri, report-to).
const FETCH_DIRECTIVE_NAMES = [
  'child-src',
  'connect-src',
  'default-src',
  'font-src',
  'frame-src',
  'img-src',
  'manifest-src',
  'media-src',
  'object-src',
  'script-src',
  'script-src-elem',
  'script-src-attr',
  'style-src',
  'style-src-elem',
  'style-src-attr',
  'worker-src',
];

export const CSP_DIRECTIVES: DirectiveSpec[] = [
  ...FETCH_DIRECTIVE_NAMES.map((name) => ({ name, valueType: 'source-list' as const })),
  { name: 'base-uri', valueType: 'source-list' },
  { name: 'sandbox', valueType: 'sandbox' },
  { name: 'form-action', valueType: 'source-list' },
  { name: 'frame-ancestors', valueType: 'ancestor-source-list' },
  { name: 'report-uri', valueType: 'report-uri' },
  { name: 'report-to', valueType: 'report-to' },
  // Mixed Content (not CSP Level 3 itself, see index.ts's own citation).
  { name: 'upgrade-insecure-requests', valueType: 'boolean' },
];

const DIRECTIVE_BY_NAME = new Map(CSP_DIRECTIVES.map((d) => [d.name, d]));

// CSP Level 3, "Source Lists": keyword-source.
const KEYWORD_SOURCES = new Set([
  "'self'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'strict-dynamic'",
  "'unsafe-hashes'",
  "'report-sample'",
  "'unsafe-allow-redirects'",
  "'wasm-unsafe-eval'",
  "'trusted-types-eval'",
  "'report-sha256'",
  "'report-sha384'",
  "'report-sha512'",
  "'unsafe-webtransport-hashes'",
]);

// A keyword written without its required quotes: CSP Level 3's own grammar
// makes this a host-source instead, matching nothing real -- a silent
// no-op that looks like it did something.
const BARE_KEYWORDS = new Set(['self', 'none', 'unsafe-inline', 'unsafe-eval']);

// nonce-source / hash-source: 'nonce-<base64-value>' / 'sha256|384|512-<base64-value>'.
const NONCE_SOURCE_RE = /^'nonce-[A-Za-z0-9+/_-]+={0,2}'$/;
const HASH_SOURCE_RE = /^'sha(256|384|512)-[A-Za-z0-9+/_-]+={0,2}'$/;

// scheme-source: scheme ":" (RFC 3986 section 3.1's scheme grammar).
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:$/;

// host-source: [ scheme "://" ] host [ ":" port ] [ path ]. host-char is
// ALPHA / DIGIT / "-" per CSP Level 3's own grammar (no underscore).
const HOST_LABEL = '[A-Za-z0-9-]+';
const HOST_RE = new RegExp(
  `^(?:[A-Za-z][A-Za-z0-9+.-]*://)?(?:\\*|(?:\\*\\.)?${HOST_LABEL}(?:\\.${HOST_LABEL})*\\.?)(?::(?:\\d+|\\*))?(?:/[^;,]*)?$`,
);

function isSchemeSource(token: string): boolean {
  return SCHEME_RE.test(token);
}

function isHostSource(token: string): boolean {
  return HOST_RE.test(token);
}

// The HTML Living Standard's own iframe sandbox attribute keyword list
// (fetched live from html.spec.whatwg.org/multipage/iframe-embed-object.html),
// which CSP Level 3's sandbox directive requires each token to be one of.
export const SANDBOX_TOKENS = new Set([
  'allow-downloads',
  'allow-forms',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-same-origin',
  'allow-scripts',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
]);

function checkSourceToken(
  token: string,
  directiveName: string,
  kind: 'source-list' | 'ancestor-source-list',
  line: number,
  problems: CspProblem[],
): void {
  if (BARE_KEYWORDS.has(token.toLowerCase())) {
    problems.push({
      line,
      message: `"${token}" in "${directiveName}" has no surrounding quotes, so the browser reads it as a host name, not a keyword.`,
    });
    return;
  }
  if (kind === 'ancestor-source-list') {
    // CSP Level 3, frame-ancestors: ancestor-source = scheme-source / host-source / "'self'".
    if (token === "'self'" || isSchemeSource(token) || isHostSource(token)) return;
    problems.push({
      line,
      message: `"${token}" in "${directiveName}" is not 'self', a scheme source or a host source, which is all frame-ancestors accepts.`,
    });
    return;
  }
  if (
    KEYWORD_SOURCES.has(token) ||
    NONCE_SOURCE_RE.test(token) ||
    HASH_SOURCE_RE.test(token) ||
    isSchemeSource(token) ||
    isHostSource(token)
  ) {
    return;
  }
  problems.push({
    line,
    message: `"${token}" in "${directiveName}" does not match a keyword, scheme, host, nonce or hash source expression.`,
  });
}

/**
 * Parses either one directive per line or a pasted policy split on `;`,
 * lower-casing directive names, and returns every directive plus a
 * line-numbered problem for anything CSP Level 3's own grammar rejects.
 */
export function parseCspDirectives(text: string): ParsedCsp {
  const directives: CspDirective[] = [];
  const problems: CspProblem[] = [];
  const seen = new Set<string>();

  // A pasted single-line policy (";"-separated, no real line breaks) is
  // split on ";" instead; otherwise each source line may itself hold a
  // ";"-separated run (a paste that mixes both shapes).
  const singleLine = !text.includes('\n') && text.includes(';');
  const rawSegments = singleLine ? text.split(';') : text.split('\n').flatMap((line) => line.split(';'));

  let lineNumber = 0;
  for (const raw of rawSegments) {
    lineNumber++;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    const rawName = parts[0] ?? '';
    const name = rawName.toLowerCase();
    const valueTokens = parts.slice(1);
    const value = valueTokens.join(' ');

    const spec = DIRECTIVE_BY_NAME.get(name);
    if (!spec) {
      problems.push({
        line: lineNumber,
        message: `"${rawName}" is not a directive CSP Level 3 defines. It may be a fetch directive an earlier version removed, or a typo.`,
      });
      continue;
    }

    if (seen.has(name)) {
      problems.push({
        line: lineNumber,
        message: `"${name}" is repeated. CSP Level 3's own parsing rules say only the first occurrence of a directive applies; the rest are ignored.`,
      });
      continue;
    }
    seen.add(name);

    if (spec.valueType === 'boolean') {
      if (valueTokens.length > 0) {
        problems.push({ line: lineNumber, message: `"${name}" takes no value; it is a boolean directive.` });
      }
      directives.push({ name, value: '', line: lineNumber });
      continue;
    }

    if (valueTokens.length === 0) {
      problems.push({ line: lineNumber, message: `"${name}" has no value.` });
      continue;
    }

    if (spec.valueType === 'source-list' || spec.valueType === 'ancestor-source-list') {
      if (valueTokens.length > 1 && valueTokens.includes("'none'")) {
        problems.push({
          line: lineNumber,
          message: `"${name}" combines 'none' with another source; CSP Level 3's grammar requires 'none' to be the only source when it is used.`,
        });
      } else {
        for (const token of valueTokens) {
          if (token === "'none'") continue;
          checkSourceToken(token, name, spec.valueType, lineNumber, problems);
        }
      }
    } else if (spec.valueType === 'sandbox') {
      for (const token of valueTokens) {
        if (!SANDBOX_TOKENS.has(token)) {
          problems.push({
            line: lineNumber,
            message: `"${token}" in "sandbox" is not one of the HTML Living Standard's iframe sandbox attribute keyword tokens.`,
          });
        }
      }
    }

    directives.push({ name, value, line: lineNumber });
  }

  return { directives, problems };
}

/** Joins `name value` pairs with `; `, CSP Level 3's own serialisation form. */
export function serialiseCsp(directives: CspDirective[]): string {
  return directives.map((d) => (d.value ? `${d.name} ${d.value}` : d.name)).join('; ');
}
