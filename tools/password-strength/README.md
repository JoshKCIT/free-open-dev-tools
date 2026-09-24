# Password Strength Estimator

Estimate guessing resistance and show the reasoning, without sending the password anywhere.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Scores a password against a real word-list-backed model rather than counting character classes, so the result comes with a reason: a common leaked password, a dictionary word, a keyboard pattern or a predictable date, each named in plain language alongside how long it would take to guess under a few different kinds of attack.

## Supported

- A score from 0 (very weak) to 4 (very strong), with a plain-language label for each
- Plain-language reasons for the score: a common leaked password, a dictionary word (optionally with digits or symbols attached), a keyboard-adjacent sequence, a repeated character run, or a predictable date
- Estimated time to crack under four attack scenarios: an online attack that is rate-limited, an online attack that is not, an offline attack against a slow hash such as bcrypt, and an offline attack against a fast hash such as SHA-256
- Scoring as you type, with the same 140ms debounce every other live-scoring tool on this site uses
- English common-password and common-word dictionaries, plus keyboard-adjacency data for the most common layouts
- Passwords up to 256 characters; anything longer is truncated before scoring and the report says so

## Limits

- This is an estimate against a model's own assumptions, not a guarantee. A password this tool rates highly can still be rejected by a service's own policy, and a password it rates poorly is not automatically compromised.
- The dictionaries are English and weighted towards passwords leaked from English-language services, so a strong password in another language may score higher than it deserves.
- The score is not a policy. Nothing here enforces a minimum score or blocks a choice; it only explains one.
- Input longer than 256 characters is truncated to that length before scoring, and the report states when truncation happened.
- The password is scored inside this page and never leaves the browser: no request, no storage, no cookie, no URL parameter.

## Ambiguous cases, and what this does about them

- The reference for every test in this tool's suite is the installed scorer itself, not an external vector table: this tool exposes what the library computed for a given input rather than reimplementing a published algorithm from a paper. The common-password and dictionary-word test cases are asserted by the kind of match the library reports, not by an exact score, so a future dictionary update in the library does not turn the suite red for no reason.

## Defined by

- [Dan Wheeler, "zxcvbn: Low-Budget Password Strength Estimation", USENIX Security 2016 — the model the scorer this tool wraps implements](https://www.usenix.org/conference/usenixsecurity16/technical-sessions/presentation/wheeler)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/password-strength password-strength
cd password-strength
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/password-strength
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { score, SCORE_LABELS } from '@fodt/password-strength';

const report = score('correct horse battery staple');
report.score;      // 0-4
report.label;       // 'Very strong'
report.reasons;     // plain-language StrengthReason[]
report.crackTimes;  // one entry per attack scenario
```

The scorer (`@zxcvbn-ts/core`) and both language packs (`@zxcvbn-ts/language-common`, `@zxcvbn-ts/language-en`) are imported statically at the top of this file so their dictionaries land in this page's own build chunk rather than being fetched on first use. The scorer's one-time options-setting call is reachable only from inside `score()`, guarded by a module-level flag, because this package (like every tool package here) declares `sideEffects: false`, which permits a bundler to drop an unused top-level call.

## Dependencies

- `@zxcvbn-ts/core` 4.2.0
- `@zxcvbn-ts/language-common` 4.1.3
- `@zxcvbn-ts/language-en` 4.1.1

## Tests

```sh
npm test
```

The installed library is the oracle: these tests assert that a known leaked password is reported via a dictionary match, that a dictionary word with digits appended reports both parts, that a long random passphrase scores at the top of the range, that a keyboard-adjacent run and a repeated-character run are each named, and that the score-to-tone mapping and the plain-language crack-time scenario names match the design contract. None of this cites an external vector table, because the scorer's own output is what this tool exposes.

## Licence

MIT. See [LICENSE](./LICENSE).
