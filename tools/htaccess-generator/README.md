# .htaccess Generator

Generate Apache rules for redirects, HTTPS, caching and directory protection.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Writes Apache 2.4 .htaccess text for forcing HTTPS, choosing the www or bare host, path redirects, caching static assets and turning off directory listings, using only directives quoted from Apache's own documentation. It can also make a bcrypt .htpasswd line for Basic authentication, hashed in a background worker so the password never leaves your browser and never appears in any output.

## Supported

- Forcing HTTPS and choosing the www or bare canonical host with mod_rewrite RewriteCond/RewriteRule
- Path redirects with a chosen status (301, 302, 303, 307 or 308), regular-expression metacharacters and spaces escaped in the old path
- Caching static assets with mod_expires ExpiresActive and ExpiresByType, using the documented "access plus ..." interval syntax
- Turning off directory listings with Options -Indexes
- Password-protecting a directory with AuthType Basic, AuthName, AuthUserFile and Require valid-user
- Making one .htpasswd line, bcrypt-hashed at a cost from 4 to 15 and tagged $2y$ the way Apache's own htpasswd -B writes it, hashed in a background worker and never shown or sent as plaintext
- A value carrying a line break or control character refused before any rule is written, naming the field

## Limits

- These rules cannot be tested without a real Apache server; this tool does not run httpd, so it cannot tell whether your host enables mod_rewrite, mod_expires, or AllowOverride for .htaccess files at all
- Basic authentication sends the password on every request in a format anyone on the network path can decode, so use it only over HTTPS
- The .htpasswd line must still be tested on the target server: making it here means the password was typed into this page, never sent anywhere and never stored
- A password longer than 72 bytes is only ever hashed on its first 72 bytes; bcrypt itself ignores the rest

## Ambiguous cases, and what this does about them

- Apache's own rewrite/avoid.html recommends a plain mod_alias Redirect for a simple path move instead of mod_rewrite. This tool still uses mod_rewrite only, because mixing mod_alias and mod_rewrite changes processing order (mod_rewrite runs first in server/virtual-host context, mod_alias runs first in per-directory .htaccess context, per Module Processing Order) -- combining both in one generated file would make the order depend on where the visitor pastes it

## Defined by

- [Apache HTTP Server 2.4 — mod_rewrite](https://httpd.apache.org/docs/2.4/mod/mod_rewrite.html)
- [Apache HTTP Server 2.4 — RewriteRule flags](https://httpd.apache.org/docs/2.4/rewrite/flags.html)
- [Apache HTTP Server 2.4 — Redirection and Remapping](https://httpd.apache.org/docs/2.4/rewrite/remapping.html)
- [Apache HTTP Server 2.4 — When Not to Use mod_rewrite](https://httpd.apache.org/docs/2.4/rewrite/avoid.html)
- [Apache HTTP Server 2.4 — mod_expires](https://httpd.apache.org/docs/2.4/mod/mod_expires.html)
- [Apache HTTP Server 2.4 — mod_auth_basic](https://httpd.apache.org/docs/2.4/mod/mod_auth_basic.html)
- [Apache HTTP Server 2.4 — mod_authn_file](https://httpd.apache.org/docs/2.4/mod/mod_authn_file.html)
- [Apache HTTP Server 2.4 — mod_authz_core](https://httpd.apache.org/docs/2.4/mod/mod_authz_core.html)
- [Apache HTTP Server 2.4 — core (Options, AuthName, AuthType)](https://httpd.apache.org/docs/2.4/mod/core.html)
- [Apache HTTP Server 2.4 — htpasswd program](https://httpd.apache.org/docs/2.4/programs/htpasswd.html)
- [RFC 7617 — The 'Basic' HTTP Authentication Scheme](https://www.rfc-editor.org/rfc/rfc7617)
- [RFC 9110 — HTTP Semantics, section 5.5 Field Values](https://www.rfc-editor.org/rfc/rfc9110#section-5.5)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/htaccess-generator htaccess-generator
cd htaccess-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/htaccess-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildHtaccess, htpasswdLine } from '@fodt/htaccess-generator';

const { text } = buildHtaccess({ forceHttps: true, host: 'www', domain: 'example.com', noIndexes: true });

const { line } = await htpasswdLine('alice', 'correct horse battery staple', 5);
// 'alice:$2y$05$...'
```

buildHtaccess throws HtaccessError (fields field, line) for a value this tool refuses, an out-of-range redirect status, a malformed MIME type or an invalid host name; every value passes assertSingleLine first. htpasswdLine is async (bcrypt-ts hashing) and never includes the password in its result, warnings, or any thrown error.

## Dependencies

- `bcrypt-ts` ^9.0.2

## Tests

```sh
npm test
```

mod_rewrite, mod_expires, mod_auth_basic, mod_authn_file, mod_authz_core, core and htpasswd directive syntax are checked against the official Apache 2.4 documentation, fetched live and quoted in test comments (D-98). No published known-answer-test vectors exist for an .htaccess file's own text; tests assert the generated lines match the fetched directive syntax exactly. The $2y$ relabel is checked two ways: byte comparison against the un-relabelled $2b$ hash (differing only in the tag) and a real bcrypt-ts compare() call against the relabelled hash with its tag swapped back.

## Licence

MIT. See [LICENSE](./LICENSE).
