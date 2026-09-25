# Nginx Config Generator

Generate an nginx server block for common hosting patterns.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Writes an nginx server block for a static site, a single-page app, a reverse proxy or PHP through FastCGI, with HTTPS, gzip compression, static asset expiry and Basic authentication options, using only directives quoted from nginx's own documentation.

## Supported

- Directive syntax checked against nginx's stable release 1.30.5 (nginx.org/en/download.html, fetched 2026-09-25)
- A static site server block with listen, server_name, root, index and try_files
- A single-page app that falls back to index.html through try_files
- A reverse proxy with proxy_pass and the standard proxy_set_header lines
- PHP through FastCGI with fastcgi_pass and the fastcgi_param settings the fastcgi module's own minimum example lists
- HTTPS with ssl_certificate, ssl_certificate_key, http2 on and a port 80 server that redirects to HTTPS
- gzip compression and expiry headers for static assets
- Basic authentication pointing auth_basic_user_file at a password file, never writing a password
- A value carrying a semicolon, brace, dollar sign, quote, backslash or (for a name or path) whitespace is refused before any output is written

## Limits

- This configuration cannot be tested without a real nginx server; this tool does not run nginx -t, so a module your build lacks, a clashing server block or a missing certificate only shows up there
- http2 on; needs nginx 1.25.1 or later; older builds use the listen directive's own http2 parameter instead
- The password file for Basic authentication must be created on the server with Apache's htpasswd or openssl passwd; this tool never writes one
- Choosing a canonical host together with a second server name that happens to match the other name's own www/bare form can make nginx warn about a conflicting server name at startup; this tool checks each value's own grammar, not the whole file's semantic consistency

## Ambiguous cases, and what this does about them

- The PHP pattern's SCRIPT_FILENAME parameter is written as $document_root$fastcgi_script_name (the common real-world idiom, computed from the root this tool already validated) rather than the fetched documentation's own illustrative hardcoded path example (/home/www/scripts/php$fastcgi_script_name), since this tool has no separate 'scripts root' field

## Defined by

- [nginx — Download (current stable version)](https://nginx.org/en/download.html)
- [nginx — ngx_http_core_module](https://nginx.org/en/docs/http/ngx_http_core_module.html)
- [nginx — ngx_http_index_module](https://nginx.org/en/docs/http/ngx_http_index_module.html)
- [nginx — Server names](https://nginx.org/en/docs/http/server_names.html)
- [nginx — ngx_http_rewrite_module](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html)
- [nginx — ngx_http_ssl_module](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)
- [nginx — ngx_http_v2_module](https://nginx.org/en/docs/http/ngx_http_v2_module.html)
- [nginx — ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [nginx — ngx_http_fastcgi_module](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html)
- [nginx — ngx_http_gzip_module](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)
- [nginx — ngx_http_headers_module](https://nginx.org/en/docs/http/ngx_http_headers_module.html)
- [nginx — ngx_http_auth_basic_module](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html)
- [RFC 1123 — Requirements for Internet Hosts](https://www.rfc-editor.org/rfc/rfc1123)
- [RFC 9110 — HTTP Semantics, section 5.5 Field Values](https://www.rfc-editor.org/rfc/rfc9110#section-5.5)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/nginx-config nginx-config
cd nginx-config
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/nginx-config
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildNginxConfig } from '@fodt/nginx-config';

const { text } = buildNginxConfig({
  pattern: 'static',
  serverNames: 'example.com www.example.com',
  root: '/var/www/example.com',
});
```

buildNginxConfig throws NginxConfigError (field) for a value this tool refuses, a malformed server name, an out-of-scheme upstream URL or a malformed FastCGI target. Every value passes assertSingleLine first, then a per-field check refusing nginx's own syntax characters (;{}#$"'\\) and, for a name or path, any whitespace.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

listen, server_name, root, index, try_files, proxy_pass, proxy_set_header, fastcgi_pass, fastcgi_param, ssl_certificate, ssl_certificate_key, http2, gzip, gzip_types, expires, add_header, auth_basic and auth_basic_user_file syntax are checked against the official nginx documentation, fetched live and quoted in test comments (D-98); the config-file tokenizer's own escape handling is checked against nginx's own src/core/ngx_conf_file.c, fetched at the same time. No published known-answer-test vectors exist for a generated server block's own text; tests assert the generated lines match the fetched directive syntax exactly, plus a structural scan (balanced braces, every simple directive terminated).

## Licence

MIT. See [LICENSE](./LICENSE).
