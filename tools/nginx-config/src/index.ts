import meta from './meta.json';
import { assertSingleLine } from './safe-value';

export { meta };
export { UnsafeValueError, findUnsafeCharacter, assertSingleLine } from './safe-value';

export type NginxPattern = 'static' | 'spa' | 'proxy' | 'php';

export const PATTERNS: readonly NginxPattern[] = ['static', 'spa', 'proxy', 'php'];

export class NginxConfigError extends Error {
  readonly field?: string;

  constructor(message: string, detail: { field?: string } = {}) {
    super(message);
    this.name = 'NginxConfigError';
    this.field = detail.field;
  }
}

export interface NginxHttpsOptions {
  certificate: string;
  certificateKey: string;
}

export interface NginxBasicAuthOptions {
  realm: string;
  userFile: string;
}

export interface BuildNginxConfigOptions {
  pattern: NginxPattern;
  /** Space separated. Each an RFC 1123 host name or an nginx wildcard name (server_names.html). */
  serverNames: string;
  /** Required for `static` and `php`. An absolute POSIX path. */
  root?: string;
  /** Required for `proxy`. An http: or https: URL; only its scheme, host and port are kept. */
  upstream?: string;
  /** Required for `php`. `unix:/path` or `host:port`. */
  fastcgi?: string;
  https?: NginxHttpsOptions | null;
  canonicalHost?: 'keep' | 'www' | 'bare';
  gzip?: boolean;
  cacheAssets?: boolean;
  basicAuth?: NginxBasicAuthOptions | null;
  /** Whole megabytes. 0 (the default) omits the directive; negatives are clamped to 0 with a warning. */
  maxBodyMb?: number;
}

export interface BuildNginxConfigResult {
  text: string;
  warnings: string[];
}

// A value that becomes a bare token or a path (never free text like a
// realm) may carry none of nginx's own syntax characters and no
// whitespace: nginx's own config-file tokenizer (github.com/nginx/nginx
// src/core/ngx_conf_file.c, fetched 2026-09-25) reads ';', '{', '}', '#',
// '$', '"', '\'' and '\\' as syntax or the start of a variable, with no
// escape defined for any of them inside an unquoted token, and whitespace
// itself separates tokens.
const NGINX_SYNTAX_CHARS_RE = /[;{}#$"'\\]/;

function describeForbidden(match: string, field: string): string {
  return `${field} contains "${match}", which nginx's own config-file tokenizer reads as syntax or a variable and gives no literal escape for, so it was refused.`;
}

/** For a name or path: no whitespace, none of nginx's own syntax characters, no line break. */
function assertNginxToken(value: string, field: string): string {
  assertSingleLine(value, field);
  if (/\s/.test(value)) {
    throw new NginxConfigError(`${field} cannot contain whitespace.`, { field });
  }
  const m = NGINX_SYNTAX_CHARS_RE.exec(value);
  if (m) throw new NginxConfigError(describeForbidden(m[0], field), { field });
  return value;
}

/** For free text (a realm): whitespace is fine, but nginx's own syntax characters and line breaks still are not. */
function assertNginxText(value: string, field: string): string {
  assertSingleLine(value, field);
  const m = NGINX_SYNTAX_CHARS_RE.exec(value);
  if (m) throw new NginxConfigError(describeForbidden(m[0], field), { field });
  return value;
}

// RFC 1123 3.2.2 / STD 3, and nginx's own wildcard forms (server_names.html,
// fetched 2026-09-25): "server_name *.example.org;" and "server_name mail.*;".
const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;
const WILDCARD_LEADING_RE = /^\*\.(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;
const WILDCARD_TRAILING_RE = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*\.\*$/;

function assertServerName(name: string): string {
  assertNginxToken(name, 'serverNames');
  if (HOSTNAME_RE.test(name) || WILDCARD_LEADING_RE.test(name) || WILDCARD_TRAILING_RE.test(name)) return name;
  throw new NginxConfigError(
    `"${name}" is not an RFC 1123 host name or one of nginx's own wildcard name forms (*.example.org or mail.*).`,
    { field: 'serverNames' },
  );
}

function parseServerNames(raw: string): string[] {
  const names = raw.trim().split(/\s+/).filter(Boolean);
  if (names.length === 0) throw new NginxConfigError('At least one server name is required.', { field: 'serverNames' });
  return names.map(assertServerName);
}

function assertAbsolutePath(value: string, field: string): string {
  assertNginxToken(value, field);
  if (!value.startsWith('/')) throw new NginxConfigError(`${field} must be an absolute path.`, { field });
  return value;
}

/**
 * Reduces an `http:`/`https:` URL to just its scheme, host and port
 * (`URL.origin`), then re-checks the reduced string itself for nginx's own
 * syntax characters -- `new URL()` accepts a handful of characters in a
 * host, such as `$`, that the generic URL grammar allows but that nginx's
 * config tokenizer does not, so a value that survives URL parsing must
 * still be checked before it reaches the generated text.
 */
function assertUpstream(raw: string): string {
  assertNginxToken(raw, 'upstream');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NginxConfigError(`"${raw}" is not a valid URL.`, { field: 'upstream' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new NginxConfigError(`upstream must be an http: or https: URL (got "${url.protocol}").`, {
      field: 'upstream',
    });
  }
  return assertNginxToken(url.origin, 'upstream');
}

const HOST_PORT_RE = /^[A-Za-z0-9.-]+:[0-9]{1,5}$/;

function assertFastcgi(raw: string): string {
  assertNginxToken(raw, 'fastcgi');
  if (raw.startsWith('unix:/')) return raw;
  if (HOST_PORT_RE.test(raw)) return raw;
  throw new NginxConfigError(`"${raw}" is not "unix:/path" or "host:port".`, { field: 'fastcgi' });
}

function indent(lines: string[]): string[] {
  return lines.map((l) => `    ${l}`);
}

/**
 * Fetched from nginx.org/en/docs/http/ngx_http_core_module.html:
 * "Syntax: try_files file ... uri;" and (ngx_http_index_module.html)
 * "Syntax: index file ...;" / "Default: index index.html;".
 */
function patternLines(options: BuildNginxConfigOptions): { pre: string[]; locations: string[] } {
  switch (options.pattern) {
    case 'static': {
      const root = assertAbsolutePath(options.root ?? '', 'root');
      return {
        pre: [`root ${root};`, 'index index.html;'],
        locations: ['location / {', ...indent(['try_files $uri $uri/ =404;']), '}'],
      };
    }
    case 'spa': {
      const root = assertAbsolutePath(options.root ?? '', 'root');
      return {
        pre: [`root ${root};`, 'index index.html;'],
        locations: ['location / {', ...indent(['try_files $uri $uri/ /index.html;']), '}'],
      };
    }
    case 'proxy': {
      // Fetched from ngx_http_proxy_module.html: "Syntax: proxy_pass URL;"
      // and "Syntax: proxy_set_header field value;". The header names below
      // are the well-known set an upstream needs to see the original
      // request; only their values are variables this tool always writes,
      // never visitor input.
      const upstream = assertUpstream(options.upstream ?? '');
      return {
        pre: [],
        locations: [
          'location / {',
          ...indent([
            `proxy_pass ${upstream};`,
            'proxy_set_header Host $host;',
            'proxy_set_header X-Real-IP $remote_addr;',
            'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
            'proxy_set_header X-Forwarded-Proto $scheme;',
          ]),
          '}',
        ],
      };
    }
    case 'php': {
      // Fetched from ngx_http_fastcgi_module.html, "The following example
      // shows the minimum required settings for PHP": "fastcgi_param
      // SCRIPT_FILENAME /home/www/scripts/php$fastcgi_script_name;" and
      // "fastcgi_param QUERY_STRING $query_string;". This tool writes
      // SCRIPT_FILENAME from the visitor's own root via the documented
      // $document_root variable rather than a hardcoded path, disclosed in
      // meta.json's ambiguities.
      const root = assertAbsolutePath(options.root ?? '', 'root');
      const fastcgi = assertFastcgi(options.fastcgi ?? '');
      return {
        pre: [`root ${root};`, 'index index.php;'],
        locations: [
          'location / {',
          ...indent(['try_files $uri $uri/ =404;']),
          '}',
          String.raw`location ~ \.php$ {`,
          ...indent([
            `fastcgi_pass ${fastcgi};`,
            'fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;',
            'fastcgi_param QUERY_STRING $query_string;',
          ]),
          '}',
        ],
      };
    }
  }
}

/**
 * Fetched from ngx_http_gzip_module.html ("Syntax: gzip on|off;", "Syntax:
 * gzip_types mime-type ...;") and ngx_http_headers_module.html ("Syntax:
 * expires [modified] time;", "Syntax: add_header name value [always];").
 */
function gzipLines(): string[] {
  return ['gzip on;', 'gzip_types text/css application/javascript application/json image/svg+xml;'];
}

function cacheAssetLines(): string[] {
  return [
    String.raw`location ~* \.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?)$ {`,
    ...indent(['expires 30d;', 'add_header Cache-Control "public, immutable";']),
    '}',
  ];
}

/**
 * Fetched from ngx_http_auth_basic_module.html: "Syntax: auth_basic string
 * | off;" and "Syntax: auth_basic_user_file file;". Never writes a
 * password (D-95): the password file itself must be made on the server
 * with Apache's htpasswd or openssl passwd, as the same fetched page lists.
 */
function basicAuthLines(auth: NginxBasicAuthOptions): string[] {
  const realm = assertNginxText(auth.realm, 'basicAuth realm');
  const userFile = assertAbsolutePath(auth.userFile, 'basicAuth userFile');
  const escapedRealm = realm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [`auth_basic "${escapedRealm}";`, `auth_basic_user_file ${userFile};`];
}

/**
 * Fetched from ngx_http_ssl_module.html ("Syntax: ssl_certificate file;",
 * "Syntax: ssl_certificate_key file;") and ngx_http_v2_module.html
 * ("Syntax: http2 on|off;", "This directive appeared in version 1.25.1."):
 * older nginx builds enable HTTP/2 with the `listen` directive's own
 * `http2` parameter instead (`limits`, AB).
 */
function httpsLines(https: NginxHttpsOptions): string[] {
  const certificate = assertAbsolutePath(https.certificate, 'https certificate');
  const certificateKey = assertAbsolutePath(https.certificateKey, 'https certificateKey');
  return ['listen 443 ssl;', 'http2 on;', `ssl_certificate ${certificate};`, `ssl_certificate_key ${certificateKey};`];
}

/**
 * A structural, internal-only self-check: every `{` is closed by a `}`,
 * and every line that is not a comment, a block opener or a bare `}` ends
 * with a semicolon -- the two properties `test/index.test.ts`'s own
 * required structural test re-derives independently over the built text.
 */
function checkStructure(text: string): void {
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) throw new NginxConfigError('Generated text has an unmatched closing brace.');
  }
  if (depth !== 0) throw new NginxConfigError('Generated text has unbalanced braces.');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.endsWith('{') || line === '}') continue;
    if (!line.endsWith(';')) throw new NginxConfigError(`Generated line "${line}" has no terminating semicolon.`);
  }
}

/**
 * Builds one nginx `server` block (D-94, D-98) for a static site, a
 * single-page app, a reverse proxy or PHP through FastCGI. Every value
 * passes `assertSingleLine` (AA) and then a strict per-field check before
 * it is written.
 */
export function buildNginxConfig(options: BuildNginxConfigOptions): BuildNginxConfigResult {
  const warnings: string[] = [];
  const serverNames = parseServerNames(options.serverNames);
  const { pre, locations } = patternLines(options);

  const bodyLines: string[] = [
    `# ${options.pattern} server block`,
    `listen 80;`,
    `server_name ${serverNames.join(' ')};`,
  ];

  if (options.https) bodyLines.push(...httpsLines(options.https));
  bodyLines.push(...pre);

  const maxBodyMbRaw = options.maxBodyMb ?? 0;
  let maxBodyMb = Math.trunc(maxBodyMbRaw);
  if (maxBodyMb < 0) {
    warnings.push('maxBodyMb cannot be negative; it was clamped to 0 (omitted).');
    maxBodyMb = 0;
  }
  if (maxBodyMb > 0) bodyLines.push(`client_max_body_size ${maxBodyMb}m;`);

  if (options.gzip) bodyLines.push(...gzipLines());

  if (options.https) {
    bodyLines.push(
      '# add_header only inherits into a nested location block when that block',
      '# declares no add_header directives of its own (ngx_http_headers_module).',
      'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
    );
  }

  if (options.basicAuth) bodyLines.push(...basicAuthLines(options.basicAuth));

  bodyLines.push(...locations);
  if (options.cacheAssets) bodyLines.push(...cacheAssetLines());

  const blocks: string[] = ['server {', ...indent(bodyLines), '}'];

  if (options.https) {
    blocks.push(
      '',
      '# Redirect plain HTTP to HTTPS',
      'server {',
      ...indent([`listen 80;`, `server_name ${serverNames.join(' ')};`, 'return 301 https://$host$request_uri;']),
      '}',
    );
  }

  const canonicalHost = options.canonicalHost ?? 'keep';
  if (canonicalHost !== 'keep' && serverNames.length > 0) {
    const primary = serverNames[0]!;
    const isWww = primary.toLowerCase().startsWith('www.');
    const bare = isWww ? primary.slice(4) : primary;
    const canonicalName = canonicalHost === 'www' ? `www.${bare}` : bare;
    const otherName = canonicalHost === 'www' ? bare : `www.${bare}`;
    const scheme = options.https ? 'https' : 'http';
    blocks.push(
      '',
      '# Redirect the non-canonical host to the canonical one',
      'server {',
      ...indent([
        `listen 80;`,
        ...(options.https ? ['listen 443 ssl;', ...httpsLines(options.https)] : []),
        `server_name ${otherName};`,
        `return 301 ${scheme}://${canonicalName}$request_uri;`,
      ]),
      '}',
    );
  }

  const text = blocks.join('\n');
  checkStructure(text);
  return { text, warnings };
}
