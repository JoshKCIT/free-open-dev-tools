# robots.txt Generator & Validator

Build a robots.txt file and check it against the REP specification.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a robots.txt file from crawler groups, paths and sitemap lines, and checks whether a named crawler may fetch a given path against a pasted robots.txt. Matching follows RFC 9309, the Robots Exclusion Protocol, including how groups are chosen and merged, how the most specific rule wins, and the star and dollar special characters, proven against the RFC's own worked examples.

## Supported

- Building a robots.txt from one or more crawler groups, each with allow and disallow paths, plus Sitemap lines
- Checking whether a named crawler may fetch a path or full URL against a pasted robots.txt, showing the deciding line
- Case-insensitive group selection with merging of duplicate groups and a * fallback group, exactly as RFC 9309 section 2.2.1 states
- The longest-match precedence rule, with an equal-length allow beating disallow, as RFC 9309 section 2.2.2 states
- The * and $ special characters (RFC 9309 section 2.2.3), matched with a linear scan rather than a regular expression built from the pasted pattern
- Percent-encoding and selective decoding of paths and query values as RFC 9309 section 2.2.2 and its Figure 4 describe
- /robots.txt itself always reported as allowed, as the RFC states
- A non-RFC record such as crawl-delay kept and shown, with a note that crawlers may interpret it differently or not at all

## Limits

- This tool cannot fetch the live robots.txt from your server or observe how a real crawler actually treats it; only the text you paste or build here is checked
- RFC 9309 says these rules are not an access-authorisation mechanism, so a disallowed path is still publicly reachable to anyone who requests it directly
- crawl-delay and any other non-RFC record are kept and shown but never affect the allowed/disallowed verdict, since RFC 9309 does not define them

## Ambiguous cases, and what this does about them

- A rule that appears before any User-agent line has no group to belong to; RFC 9309 section 2.2.2 says crawlers SHOULD ignore it, so this tool reports it as a problem and does not let it affect any verdict
- The differential comparison against robots-parser (a second, independent implementation) turns up a small, named set of cases where the two disagree, each explained by the RFC section that decides it in favour of this tool's own hand-rolled matcher

## Defined by

- [RFC 9309 — Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309)
- [RFC 3986 — Uniform Resource Identifier (URI): Generic Syntax](https://www.rfc-editor.org/rfc/rfc3986)
- [sitemaps.org protocol — the robots.txt Sitemap line](https://www.sitemaps.org/protocol.html)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/robots-txt robots-txt
cd robots-txt
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/robots-txt
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildRobotsTxt, parseRobotsTxt, checkPath } from '@fodt/robots-txt';

const { text } = buildRobotsTxt({ groups: [{ agents: ['*'], rules: [{ type: 'disallow', pattern: '/private/' }] }], sitemaps: [] });
const parsed = parseRobotsTxt(text);
checkPath(parsed, 'ExampleBot', '/private/page');
```

`parseRobotsTxt` never throws for malformed robots.txt content (RFC 9309 says crawlers MUST try to parse every line); problems are reported in its `problems` array with a 1-based line number. `buildRobotsTxt` throws `RobotsTxtError` for a value that cannot become a safe robots.txt line at all (a line break, an invalid product token, an invalid Sitemap URL). `checkPath` never throws.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Asserts every RFC 9309 section 5 worked example against the vendored RFC text, the longest-match and equal-length-allow-wins precedence rule, the * and $ special characters, the Figure 4 percent-encoding table, group selection and merging, and a seeded 2,000-case differential battery against robots-parser (a second, independent implementation) with any disagreement named and explained by RFC section.

## Licence

MIT. See [LICENSE](./LICENSE).
