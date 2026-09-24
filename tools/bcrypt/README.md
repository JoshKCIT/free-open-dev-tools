# Bcrypt Hash & Verify

Hash a password with bcrypt at a chosen cost, and verify a password against a hash.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Hashes a password with bcrypt at a cost you choose, from 4 to 15, or checks a password against a hash you paste in. Verification accepts every tag bcrypt has ever produced, including one a lot of libraries refuse outright, so an old hash from another system still checks here.

## Supported

- Generating a $2b$ hash at any cost from 4 to 15, default 10
- Verifying a password against a hash carrying any of the five historical tags: $2$, $2a$, $2b$, $2x$ or $2y$
- Verification with no cost ceiling: a hash generated elsewhere at a far higher cost still checks correctly, because the cost is read out of the hash itself
- A warning above cost 12 stating roughly how long that hash will take, before you press Run
- Reporting whether your password was longer than bcrypt's 72-byte limit, and whether the cut falls inside a multi-byte character
- Cancelling a hash in progress; work above the warning threshold runs on a background worker so the tab stays responsive

## Limits

- Bcrypt only ever uses the first 72 bytes of a password. Anything after that is ignored completely, by the algorithm itself, not by this tool. A long passphrase is not stronger than its first 72 bytes.
- A $2x$ hash checked against a password containing a byte at or above 0x80 (i.e. not plain ASCII) cannot be checked by this tool. That tag marks a hash made by a historically buggy implementation that mishandled such bytes, and this tool refuses to guess rather than risk answering 'incorrect' for a password that is actually correct. Every other tag, and every ASCII-only password, verifies normally including against a $2x$ hash.
- Generation is capped at cost 15, well under the 31 the algorithm allows, because a cost in the twenties in a browser tab is a very long wait with no way to speed it up.
- A bcrypt hash is not a secret by itself, but it does reveal its own cost and salt — that is by design, not a flaw, and is how verification works at all.
- A cost that feels slow enough today will not stay that way. Hardware gets faster; the point of a tunable cost factor is to raise it later, not to pick a number once.

## Ambiguous cases, and what this does about them

- The duration warning above cost 12 is a rough order-of-magnitude estimate for typical current hardware, not a promise. The same cost can take very different amounts of time on different machines.

## Defined by

- [Niels Provos and David Mazières, "A Future-Adaptable Password Scheme" (USENIX 1999) — the paper that introduced bcrypt](https://www.usenix.org/legacy/events/usenix99/provos/provos.pdf)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/bcrypt bcrypt
cd bcrypt
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/bcrypt
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { hashPassword, verifyPassword, COST_RANGE } from '@fodt/bcrypt';

const { hash } = await hashPassword('correct horse battery staple', 10);
// '$2b$10$...'

const { outcome } = await verifyPassword('correct horse battery staple', hash);
// 'correct' | 'incorrect' | 'cannot-check'
```

hashPassword and verifyPassword are both promise-returning, matching bcrypt-ts's own API. Both take an optional onProgress(fraction) callback, fired at most about ten times a second by the library's own round-by-round progress reporting, and an optional AbortSignal: checked before work starts (rejects immediately if already aborted) and again once work finishes (rejects rather than resolving if the signal fired while work was in flight). The library exposes no way to interrupt work already running, so the signal cannot stop a hash mid-computation on its own; real cancellation of a running hash comes from terminating the worker it runs on. Generation always produces a $2b$ tag. Verification accepts $2$, $2a$, $2b$, $2x$ and $2y$; a $2x$ hash is normalised to $2a$ before the library sees it, since the library's own salt parser throws on $2x$ outright. A $2x$ hash checked against a password containing a byte at or above 0x80 returns the third VerifyReport outcome, 'cannot-check', rather than a true/false verdict, because this tool does not reproduce the historical sign-extension bug that tag exists to mark — see the narrowed D-07 decision. truncateToLimit never truncates or re-encodes the password itself; it only reports what bcrypt's own 72-byte limit will do to it.

## Dependencies

- `bcrypt-ts` ^9.0.2

## Tests

```sh
npm test
```

No canonical published known-answer-test vector table exists for bcrypt (confirmed by research; only ad hoc regression suites exist across implementations). Tests are self-consistency (hash then verify, at every supported generation cost and at a cost above the generation maximum), differential checks against bcrypt-ts's own compare()/compareSync() called directly rather than only through this package's wrapper, and one hand-verified historical hash pasted from a widely reproduced source. The truncation equivalence is asserted the one way that is actually true of independently salted calls: hashing one password and verifying a second, different-only-after-byte-72 password against that same hash — not by comparing two hash strings, which never match because each hashPassword call draws its own salt.

## Licence

MIT. See [LICENSE](./LICENSE).
