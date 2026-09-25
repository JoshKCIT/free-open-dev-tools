import { it, expect, vi } from 'vitest';
import { buildNginxConfig, NginxConfigError } from '../src/index';

it('a static site server block uses listen, server_name, root, index and try_files as ngx_http_core_module documents', () => {
  // ngx_http_core_module.html: "Syntax: listen address[:port]..." (the
  // parameterless port-only form is documented as "listen port ...;");
  // "Syntax: root path;"; ngx_http_index_module.html: "Syntax: index
  // file ...;"; ngx_http_core_module.html: "Syntax: try_files file ... uri;".
  const result = buildNginxConfig({
    pattern: 'static',
    serverNames: 'example.com',
    root: '/var/www/example.com',
  });
  expect(result.text).toContain('listen 80;');
  expect(result.text).toContain('server_name example.com;');
  expect(result.text).toContain('root /var/www/example.com;');
  expect(result.text).toContain('index index.html;');
  expect(result.text).toContain('try_files $uri $uri/ =404;');
});

it('a single-page app falls back to index.html through try_files', () => {
  const result = buildNginxConfig({
    pattern: 'spa',
    serverNames: 'app.example.com',
    root: '/var/www/app',
  });
  expect(result.text).toContain('try_files $uri $uri/ /index.html;');
});

it('a reverse proxy uses proxy_pass with the proxy_set_header lines ngx_http_proxy_module documents', () => {
  // ngx_http_proxy_module.html: "Syntax: proxy_pass URL;" and "Syntax:
  // proxy_set_header field value;".
  const result = buildNginxConfig({
    pattern: 'proxy',
    serverNames: 'example.com',
    upstream: 'http://127.0.0.1:3000',
  });
  expect(result.text).toContain('proxy_pass http://127.0.0.1:3000;');
  expect(result.text).toContain('proxy_set_header Host $host;');
  expect(result.text).toContain('proxy_set_header X-Real-IP $remote_addr;');

  // Only scheme, host and port survive; a path in the typed URL is dropped.
  const withPath = buildNginxConfig({
    pattern: 'proxy',
    serverNames: 'example.com',
    upstream: 'https://api.example.invalid:8443/some/path',
  });
  expect(withPath.text).toContain('proxy_pass https://api.example.invalid:8443;');

  expect(() => buildNginxConfig({ pattern: 'proxy', serverNames: 'example.com', upstream: 'ftp://x' })).toThrow(
    NginxConfigError,
  );
});

it('PHP through FastCGI uses fastcgi_pass and the SCRIPT_FILENAME parameter from the ngx_http_fastcgi_module example', () => {
  // ngx_http_fastcgi_module.html, "minimum required settings for PHP":
  // "fastcgi_param SCRIPT_FILENAME /home/www/scripts/php$fastcgi_script_name;"
  // and "fastcgi_param QUERY_STRING $query_string;" -- SCRIPT_FILENAME's
  // value here is this tool's own $document_root idiom (meta.json
  // ambiguities), not the fetched page's own literal path.
  const result = buildNginxConfig({
    pattern: 'php',
    serverNames: 'example.com',
    root: '/var/www/example.com',
    fastcgi: 'unix:/run/php/php-fpm.sock',
  });
  expect(result.text).toContain('fastcgi_pass unix:/run/php/php-fpm.sock;');
  expect(result.text).toContain('fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;');
  expect(result.text).toContain('fastcgi_param QUERY_STRING $query_string;');

  const hostPort = buildNginxConfig({
    pattern: 'php',
    serverNames: 'example.com',
    root: '/var/www/example.com',
    fastcgi: '127.0.0.1:9000',
  });
  expect(hostPort.text).toContain('fastcgi_pass 127.0.0.1:9000;');

  expect(() =>
    buildNginxConfig({ pattern: 'php', serverNames: 'example.com', root: '/x', fastcgi: 'not-a-target' }),
  ).toThrow(NginxConfigError);
});

it('HTTPS adds the ngx_http_ssl_module certificate lines, http2 on and a port 80 server that returns 301', () => {
  // ngx_http_ssl_module.html: "Syntax: ssl_certificate file;" and "Syntax:
  // ssl_certificate_key file;"; ngx_http_v2_module.html: "Syntax: http2
  // on|off;" ("This directive appeared in version 1.25.1."); ngx_http_rewrite_module.html:
  // "Syntax: return code URL;".
  const result = buildNginxConfig({
    pattern: 'static',
    serverNames: 'example.com',
    root: '/var/www/example.com',
    https: { certificate: '/etc/ssl/example.com.crt', certificateKey: '/etc/ssl/example.com.key' },
  });
  expect(result.text).toContain('listen 443 ssl;');
  expect(result.text).toContain('http2 on;');
  expect(result.text).toContain('ssl_certificate /etc/ssl/example.com.crt;');
  expect(result.text).toContain('ssl_certificate_key /etc/ssl/example.com.key;');
  expect(result.text).toContain('return 301 https://$host$request_uri;');
  // The redirect server also still listens on 80.
  const port80Count = (result.text.match(/listen 80;/g) ?? []).length;
  expect(port80Count).toBeGreaterThanOrEqual(2);
});

it('gzip and static asset expiry use the ngx_http_gzip_module and ngx_http_headers_module directives', () => {
  // ngx_http_gzip_module.html: "Syntax: gzip on|off;" and "Syntax:
  // gzip_types mime-type ...;"; ngx_http_headers_module.html: "Syntax:
  // expires [modified] time;" and "Syntax: add_header name value [always];".
  const result = buildNginxConfig({
    pattern: 'static',
    serverNames: 'example.com',
    root: '/x',
    gzip: true,
    cacheAssets: true,
  });
  expect(result.text).toContain('gzip on;');
  expect(result.text).toContain('gzip_types text/css application/javascript application/json image/svg+xml;');
  expect(result.text).toContain('expires 30d;');
  expect(result.text).toContain('add_header Cache-Control "public, immutable";');
});

it('basic auth points auth_basic_user_file at a file and never writes a password', () => {
  // ngx_http_auth_basic_module.html: "Syntax: auth_basic string | off;" and
  // "Syntax: auth_basic_user_file file;".
  const result = buildNginxConfig({
    pattern: 'static',
    serverNames: 'example.com',
    root: '/x',
    basicAuth: { realm: 'Restricted Area', userFile: '/etc/nginx/.htpasswd' },
  });
  expect(result.text).toContain('auth_basic "Restricted Area";');
  expect(result.text).toContain('auth_basic_user_file /etc/nginx/.htpasswd;');
  expect(result.text).not.toMatch(/[:=]\s*\S*(password|correct horse)/i);
});

it('a semicolon, brace, dollar sign, quote, space or line break in a value is refused so it cannot add a directive', () => {
  const base = { pattern: 'static' as const, serverNames: 'example.com', root: '/x' };

  expect(() => buildNginxConfig({ ...base, serverNames: 'example.com; include /etc/passwd' })).toThrow(
    NginxConfigError,
  );
  expect(() => buildNginxConfig({ ...base, root: '/var/www/{x}' })).toThrow(NginxConfigError);
  expect(() => buildNginxConfig({ ...base, basicAuth: { realm: 'r $bad', userFile: '/x' } })).toThrow(NginxConfigError);
  expect(() => buildNginxConfig({ ...base, basicAuth: { realm: 'r "bad"', userFile: '/x' } })).toThrow(
    NginxConfigError,
  );
  // Whitespace is refused inside a single name/path token (a root path is
  // never split, unlike serverNames which is deliberately whitespace
  // separated into several valid single-label names)...
  expect(() => buildNginxConfig({ ...base, root: '/var/www/my site' })).toThrow(NginxConfigError);
  // ...but not inside free text (a realm may hold ordinary spaces).
  expect(buildNginxConfig({ ...base, basicAuth: { realm: 'Restricted Area', userFile: '/x' } }).text).toContain(
    'Restricted Area',
  );
  expect(() => buildNginxConfig({ ...base, root: '/x\ny' })).toThrow(/line break|control character/);
});

it('the output has balanced braces and every simple directive ends with a semicolon', () => {
  const result = buildNginxConfig({
    pattern: 'php',
    serverNames: 'example.com www.example.com',
    root: '/var/www/example.com',
    fastcgi: 'unix:/run/php/php-fpm.sock',
    https: { certificate: '/etc/ssl/a.crt', certificateKey: '/etc/ssl/a.key' },
    canonicalHost: 'www',
    gzip: true,
    cacheAssets: true,
    basicAuth: { realm: 'R', userFile: '/x' },
    maxBodyMb: 10,
  });

  // Independent re-derivation of the same structural properties the
  // package's own internal checkStructure asserts, so a regression in one
  // does not silently pass the other.
  let depth = 0;
  for (const ch of result.text) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    expect(depth).toBeGreaterThanOrEqual(0);
  }
  expect(depth).toBe(0);

  for (const rawLine of result.text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.endsWith('{') || line === '}') continue;
    expect(line.endsWith(';'), `line "${line}" has no terminating semicolon`).toBe(true);
  }
});

it('nothing is written to the console while building', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  buildNginxConfig({
    pattern: 'php',
    serverNames: 'example.com www.example.com',
    root: '/var/www/example.com',
    fastcgi: 'unix:/run/php/php-fpm.sock',
    https: { certificate: '/etc/ssl/a.crt', certificateKey: '/etc/ssl/a.key' },
    canonicalHost: 'www',
    gzip: true,
    cacheAssets: true,
    basicAuth: { realm: 'R', userFile: '/x' },
    maxBodyMb: -5,
  });

  expect(logSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();

  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});
