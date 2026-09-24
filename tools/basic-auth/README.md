# HTTP Basic Auth Header

Build and decode an RFC 7617 Basic authorization header.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds and parses the HTTP Basic authentication scheme's Authorization header value, and builds the WWW-Authenticate challenge a server sends to ask for one. Basic authentication is nothing more than Base64 of a colon-separated user identifier and password, and this tool states that plainly rather than dressing it up as anything more secure.

## Supported

- Building the credentials half of the header from a user identifier and password, UTF-8 encoded before Base64
- Parsing an existing header value back into its user identifier and password, splitting on the first colon only so a password may itself contain a colon
- Building a WWW-Authenticate challenge with a realm and, optionally, the charset parameter — the one place RFC 7617 actually allows that parameter
- Safe realm serialisation for the challenge: quoted-string escaping of a double quote or backslash, and outright rejection of control characters
- Round-tripping non-ASCII passwords correctly through UTF-8

## Limits

- This is an encoding, not encryption: anyone who sees a Basic header can read the password with nothing more than a Base64 decoder. It provides no confidentiality at all, so it is only meaningful over a connection that is already encrypted, such as TLS.
- The user identifier cannot contain a colon, because the first colon in the decoded credentials is what separates the user identifier from the password. A password may contain colons.
- This tool does not check the credentials against anything. There is no account, no server and no stored password here to verify against — it only builds and parses the header's syntax.
- The charset parameter on the challenge is advisory only. A server that sends it is stating a preference; nothing forces a client to honour it.

## Ambiguous cases, and what this does about them

- RFC 7617 leaves the character encoding of the credentials undefined for backward compatibility, though it recommends UTF-8 and lets a server advertise that preference with the charset parameter on the challenge. This tool always encodes as UTF-8 on the credentials side, because that parameter cannot legally appear on the credentials themselves.
- Older servers that predate RFC 7617 may have expected Latin-1 rather than UTF-8 for non-ASCII passwords. A header built here that does not decode correctly against such a server is a server-side compatibility issue, not a defect in this tool.

## Defined by

- [RFC 7617 — The 'Basic' HTTP Authentication Scheme](https://www.rfc-editor.org/rfc/rfc7617)
- [RFC 7235 section 2.1 — token68 credential syntax](https://www.rfc-editor.org/rfc/rfc7235#section-2.1)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/basic-auth basic-auth
cd basic-auth
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/basic-auth
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildHeader, parseHeader, buildChallenge } from '@fodt/basic-auth';

buildHeader({ userid: 'Aladdin', password: 'open sesame' });
// 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='
parseHeader('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
// { userid: 'Aladdin', password: 'open sesame' }
buildChallenge('WallyWorld');                       // 'Basic realm="WallyWorld"'
buildChallenge('foo', { charset: true });           // 'Basic realm="foo", charset="UTF-8"'
```

`parseHeader` throws `BasicAuthError`, which carries a `position` field for base64 decode failures. `buildHeader` takes no charset option and its output is always a single token68 run with no comma and no auth-param — RFC 7617 section 2.1 defines charset on the challenge only, because credentials are non-extensible token68 syntax. `buildChallenge(realm, options?)` returns a field value such as `Basic realm="Example"`, not a full header line, and escapes or rejects the realm per the quoted-string rule.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

RFC 7617 section 2's own worked example — user identifier 'Aladdin', password 'open sesame', header value 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='  — is quoted verbatim and asserted in both directions. The terminal '==' padding in that example is asserted as required output, not stripped, because it is valid base64 padding rather than an authentication parameter.

## Licence

MIT. See [LICENSE](./LICENSE).
