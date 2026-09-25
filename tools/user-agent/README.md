# User Agent Parser

Parse a User-Agent string into browser, engine, OS and device, with confidence noted.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Parses a pasted User-Agent string into its browser, engine, operating system and device, using bowser's reviewed rule set, and splits it into the RFC 9110 product tokens and comments it is actually built from. Every result carries a stated confidence level and the reasons behind it, and always notes that a User-Agent string can be spoofed and that Client Hints are never available from a pasted string alone.

## Supported

- Splitting a User-Agent string into its RFC 9110 section 10.1.5 product tokens (name and version) and comments, including nested comments and quoted pairs
- Reporting the browser, rendering engine, operating system and device type bowser recognises
- Recognising a reduced Chromium User-Agent (the Chromium User-Agent Reduction's frozen platform strings) and lowering confidence with a reason
- A stated confidence level (low, medium or high) with the exact reasons for any downgrade
- Refusing an input over 8192 characters rather than parsing it
- Always stating that a User-Agent string can be spoofed by the client that sent it, and that Client Hints (the Sec-CH-UA headers) are not available from a pasted string

## Limits

- This reads only the pasted string, so it cannot see the request headers a real server receives, including Client Hints, or check which client actually sent it -- that needs a real server
- bowser's rule set describes browsers known at the version this was built with; a brand-new browser or an unusual User-Agent string may be reported with low confidence or not recognised at all
- A reduced Chromium User-Agent always reports Windows NT 10.0 as the operating system version, because Chromium's own reduction freezes it there regardless of the real Windows version

## Ambiguous cases, and what this does about them

- Confidence is low when the input is empty, has no product token, or bowser recognises no browser; medium when the browser is recognised but the engine or the operating system is not, the string is a reduced Chromium User-Agent, the browser version is missing, or the product tokens are not well-formed RFC 9110 tokens; otherwise high

## Defined by

- [RFC 9110 -- HTTP Semantics, section 10.1.5 (the User-Agent field)](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.5)
- [RFC 9110 -- HTTP Semantics, section 5.6.2 (tokens) and 5.6.5 (comments)](https://www.rfc-editor.org/rfc/rfc9110#section-5.6.2)
- [Chromium User-Agent Reduction](https://www.chromium.org/updates/ua-reduction/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/user-agent user-agent
cd user-agent
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/user-agent
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { parseUserAgent } from '@fodt/user-agent';

parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
```

`parseUserAgent(ua)` trims the input; an input over `MAX_USER_AGENT_LENGTH` (8192) characters throws `UserAgentError`. It never throws for any other input, however malformed: an empty or unrecognised string simply gets low confidence. `browser`, `engine`, `os` and `device` fields are `undefined` wherever bowser itself does not know a value.

## Dependencies

- `bowser` 2.14.1

## Tests

```sh
npm test
```

Every entry in bowser's own vendored acceptance fixture is asserted to map to the same browser, engine, operating system and device this report gives, with any genuine difference named in a KNOWN_DIFFERENCES list rather than silently ignored.

## Licence

MIT. See [LICENSE](./LICENSE).
