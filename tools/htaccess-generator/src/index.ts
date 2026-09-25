import meta from './meta.json';
import { assertSingleLine } from './safe-value';
import { HtaccessError } from './htpasswd';

export { meta };
export { UnsafeValueError, findUnsafeCharacter, assertSingleLine } from './safe-value';
export { HtaccessError, htpasswdLine, HTPASSWD_COST } from './htpasswd';
export type { HtpasswdCostRange, HtpasswdLineResult } from './htpasswd';

export type HostMode = 'keep' | 'www' | 'bare';

export interface BuildHtaccessOptions {
  forceHttps?: boolean;
  host?: HostMode;
  /** Required (and validated as an RFC 1123 host name) unless `host` is `'keep'`. */
  domain?: string;
  /** One `old new [status]` per line. `status` is one of 301, 302, 303, 307 or 308; default 301. */
  redirects?: string;
  noIndexes?: boolean;
  /** One `type/subtype interval` per line, e.g. `image/png 1 year`. Non-empty text turns caching on. */
  cacheRules?: string;
  protect?: boolean;
  realm?: string;
  userFile?: string;
}

export interface BuildHtaccessResult {
  text: string;
  /** The section titles actually written, in file order (an empty array means an empty file). */
  sections: string[];
  warnings: string[];
}

// RFC 1123 3.2.2 / STD 3: a sequence of dot-separated labels, each 1-63
// characters of letters, digits or hyphens, never starting or ending with a
// hyphen; the whole name at most 253 characters.
const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;

function assertHostname(domain: string): void {
  assertSingleLine(domain, 'Domain');
  if (!HOSTNAME_RE.test(domain)) {
    throw new HtaccessError(`"${domain}" is not an RFC 1123 host name.`, { field: 'domain' });
  }
}

const ALLOWED_STATUSES = new Set([301, 302, 303, 307, 308]);

interface ParsedRedirect {
  old: string;
  target: string;
  status: number;
}

/**
 * Parses one `old new [status]` redirect line. The last token is an
 * optional status code (one of `ALLOWED_STATUSES`); the token before that
 * is the new target; everything before that, rejoined with single spaces,
 * is the old path -- so an old path that itself carries a literal space
 * (an unusual but real URL-encoded path) still parses correctly.
 */
function parseRedirectLine(raw: string, lineNumber: number): ParsedRedirect {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    throw new HtaccessError(`Redirect line ${lineNumber} needs an old path and a new target.`, {
      field: 'redirects',
      line: lineNumber,
    });
  }
  let status = 301;
  const last = tokens[tokens.length - 1]!;
  if (/^\d+$/.test(last) && ALLOWED_STATUSES.has(Number(last))) {
    status = Number(last);
    tokens.pop();
  }
  if (tokens.length < 2) {
    throw new HtaccessError(`Redirect line ${lineNumber} needs an old path and a new target.`, {
      field: 'redirects',
      line: lineNumber,
    });
  }
  const target = tokens.pop()!;
  const old = tokens.join(' ');
  if (!old.startsWith('/')) {
    throw new HtaccessError(`Redirect line ${lineNumber}'s old path must start with "/".`, {
      field: 'redirects',
      line: lineNumber,
    });
  }
  assertSingleLine(old, `redirects line ${lineNumber} old path`);
  assertSingleLine(target, `redirects line ${lineNumber} target`);
  return { old, target, status };
}

/**
 * Backslash-escapes every regular-expression metacharacter and every
 * space in `path` (after its leading slash is removed -- Apache's own
 * mod_rewrite.html, fetched 2026-09-25: "The removed prefix always ends
 * with a slash, meaning the matching occurs against a string which never
 * has a leading slash. Therefore, a Pattern with ^/ never matches in
 * per-directory context."), then anchors the result with a trailing `$`.
 */
function escapeRedirectPattern(path: string): string {
  const withoutLeadingSlash = path.startsWith('/') ? path.slice(1) : path;
  return withoutLeadingSlash.replace(/[.*+?^${}()|[\]\\ ]/g, '\\$&');
}

function redirectRuleLine(redirect: ParsedRedirect): string {
  const pattern = escapeRedirectPattern(redirect.old);
  const target = redirect.target.includes(' ') ? `"${redirect.target}"` : redirect.target;
  return `RewriteRule ^${pattern}$ ${target} [R=${redirect.status},L]`;
}

/**
 * Fetched from httpd.apache.org/docs/2.4/mod/mod_rewrite.html, "Server
 * Variables": "HTTPS ... Will contain the text 'on' if the connection is
 * using SSL/TLS, or 'off' otherwise." The `R` and `L` flags are quoted in
 * `test/index.test.ts` from `rewrite/flags.html`.
 */
function forceHttpsLines(): string[] {
  return ['RewriteCond %{HTTPS} off', 'RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]'];
}

/**
 * Fetched from httpd.apache.org/docs/2.4/rewrite/remapping.html,
 * "Canonical Hostnames": the recipe redirects every request whose
 * `%{HTTP_HOST}` does not already match the canonical name. This tool
 * writes the same shape for either canonicalisation direction (`www` or
 * `bare`), using the `NC` flag (rewrite/flags.html, fetched 2026-09-25:
 * "Use of the [NC] flag causes the RewriteRule to be matched in a
 * case-insensitive manner.") so a visitor's differently-cased Host header
 * still matches.
 */
function hostRuleLines(mode: 'www' | 'bare', domain: string): string[] {
  const escapedDomain = domain.replace(/\./g, '\\.');
  const canonicalHost = mode === 'www' ? `www.${domain}` : domain;
  const pattern = mode === 'www' ? `www\\.${escapedDomain}` : escapedDomain;
  return [
    `RewriteCond %{HTTP_HOST} !^${pattern}$ [NC]`,
    `RewriteRule ^ https://${canonicalHost}%{REQUEST_URI} [R=301,L]`,
  ];
}

interface ParsedCacheRule {
  type: string;
  interval: string;
}

const MIME_TYPE_RE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

function parseCacheLine(raw: string, lineNumber: number): ParsedCacheRule {
  const trimmed = raw.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    throw new HtaccessError(
      `Cache rule line ${lineNumber} needs a MIME type and an interval, for example "image/png 1 year".`,
      { field: 'cacheRules', line: lineNumber },
    );
  }
  const type = trimmed.slice(0, spaceIdx);
  const interval = trimmed.slice(spaceIdx + 1).trim();
  if (!MIME_TYPE_RE.test(type)) {
    throw new HtaccessError(`Cache rule line ${lineNumber}: "${type}" is not a MIME type in the form type/subtype.`, {
      field: 'cacheRules',
      line: lineNumber,
    });
  }
  if (!interval) {
    throw new HtaccessError(`Cache rule line ${lineNumber} has no interval after "${type}".`, {
      field: 'cacheRules',
      line: lineNumber,
    });
  }
  assertSingleLine(interval, `cacheRules line ${lineNumber} interval`);
  return { type, interval };
}

/**
 * Fetched from httpd.apache.org/docs/2.4/mod/mod_expires.html: "Example:
 * # enable expirations \n ExpiresActive On" and the "Alternate Interval
 * Syntax" section's own `ExpiresByType type/encoding "base [plus num
 * type]..."` form, whose worked example reads
 * `ExpiresByType text/html "access plus 1 month 15 days 2 hours"`. A
 * visitor's interval text (`1 year`) is written after the literal
 * `access plus ` this tool always prepends.
 */
function cachingLines(rules: ParsedCacheRule[]): string[] {
  return ['ExpiresActive On', ...rules.map((r) => `ExpiresByType ${r.type} "access plus ${r.interval}"`)];
}

/**
 * Backslash-escapes a double quote or backslash the way Apache's own
 * configuring.html ("Quoting and Escaping", fetched 2026-09-25, already
 * quoted in `tools/security-headers/src/target-apache.ts`) documents for
 * every Apache config value, so a realm carrying either character cannot
 * end the quoted `AuthName` string early.
 */
function escapeApacheQuotedValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Fetched from httpd.apache.org/docs/2.4/mod/mod_auth_basic.html
 * ("AuthType basic", "AuthName"), mod_authn_file.html ("AuthUserFile
 * Directive ... If it is not absolute, it is treated as relative to the
 * ServerRoot.") and mod_authz_core.html ("Require valid-user ... All
 * valid users can access the resource.").
 */
function protectLines(realm: string, userFile: string, warnings: string[]): string[] {
  assertSingleLine(realm, 'Realm');
  assertSingleLine(userFile, 'User file path');
  if (!realm) throw new HtaccessError('Realm cannot be empty.', { field: 'realm' });
  if (!userFile) throw new HtaccessError('User file path cannot be empty.', { field: 'userFile' });
  if (!userFile.startsWith('/')) {
    warnings.push(
      `"${userFile}" is not an absolute path, so Apache resolves AuthUserFile relative to ServerRoot, not this directory.`,
    );
  }
  return [
    'AuthType Basic',
    `AuthName "${escapeApacheQuotedValue(realm)}"`,
    `AuthUserFile ${userFile}`,
    'Require valid-user',
  ];
}

/**
 * Builds Apache 2.4 `.htaccess` rule text (D-94, D-98): forcing HTTPS,
 * choosing the `www` or bare host, path redirects, caching and turning off
 * directory listings, one `#`-commented section per feature, in a fixed
 * order. Every value passes `assertSingleLine` (AA) before it is written.
 */
export function buildHtaccess(options: BuildHtaccessOptions = {}): BuildHtaccessResult {
  const warnings: string[] = [];
  const sections: { title: string; body: string[]; wrap?: string }[] = [];

  if (options.noIndexes) {
    sections.push({ title: 'Turn off directory listings', body: ['Options -Indexes'] });
  }

  const rewriteLines: string[] = [];
  if (options.forceHttps) rewriteLines.push(...forceHttpsLines());

  const hostMode = options.host ?? 'keep';
  if (hostMode !== 'keep') {
    const domain = options.domain ?? '';
    if (!domain) throw new HtaccessError('A domain is required to choose the www or bare host.', { field: 'domain' });
    assertHostname(domain);
    rewriteLines.push(...hostRuleLines(hostMode, domain));
  }

  const redirectText = options.redirects ?? '';
  const redirectLinesRaw = redirectText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  redirectLinesRaw.forEach((raw, i) => {
    const parsed = parseRedirectLine(raw, i + 1);
    rewriteLines.push(redirectRuleLine(parsed));
  });

  if (rewriteLines.length > 0) {
    sections.push({
      title: 'Force HTTPS, canonical host and redirects',
      body: ['RewriteEngine On', ...rewriteLines],
      wrap: 'mod_rewrite.c',
    });
  }

  const cacheText = options.cacheRules ?? '';
  const cacheLinesRaw = cacheText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (cacheLinesRaw.length > 0) {
    const parsedRules = cacheLinesRaw.map((raw, i) => parseCacheLine(raw, i + 1));
    sections.push({
      title: 'Cache static assets',
      body: cachingLines(parsedRules),
      wrap: 'mod_expires.c',
    });
  }

  if (options.protect) {
    sections.push({
      title: 'Password-protect this directory',
      body: protectLines(options.realm ?? '', options.userFile ?? '', warnings),
    });
  }

  const text = sections
    .map((s) => {
      const inner = s.wrap ? [`<IfModule ${s.wrap}>`, ...s.body, '</IfModule>'] : s.body;
      return [`# ${s.title}`, ...inner].join('\n');
    })
    .join('\n\n');

  return { text, sections: sections.map((s) => s.title), warnings };
}
