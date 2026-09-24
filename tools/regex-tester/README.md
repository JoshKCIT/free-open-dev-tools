# Regex Tester & Explainer

Test, replace and explain regular expressions with a time limit that stops runaway patterns.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Tests a JavaScript regular expression against text and lists every match with its position and capture groups. A match runs in a background worker with a page-side time limit, so a pattern that would backtrack catastrophically is stopped with a plain message instead of freezing the tab.

## Supported

- The g, i, m, s, u and y flags, in any combination the engine itself allows
- Every match, its zero-based index in the input and every named and numbered capture group
- The global flag advancing past a zero-length match instead of repeating forever
- Up to 1000 displayed matches, with the true total still counted past that cap
- A plain message naming the engine's own SyntaxError when a pattern or flag combination is invalid
- A time limit around 1.5 seconds that stops a runaway match and reports it instead of freezing the page
- Replace mode: ECMA-262 replacement patterns ($$, $&, $`, $', $1-$99 and $<name>) applied by the engine itself, with a count of matches replaced
- Replace without the global flag changing only the first match, exactly as String.prototype.replace does
- Explain mode: every alternative, group, character class, character set, quantifier, assertion and backreference named with its own source text, indented to show nesting
- Explain describes lookahead, lookbehind, backreferences and Unicode property escapes, each with a plain-language meaning

## Limits

- JavaScript regular expression syntax only. No other regex flavour (PCRE, POSIX, RE2, .NET) is read or described.
- The 1.5 second stop cannot tell a pattern that is merely slow from one that would never finish; both are reported the same way.
- The v and d flags are not offered. v changes character class set semantics in ways this tool does not parse; d only adds match indices this tool does not surface.
- Only the first 1000 matches are listed; the count of matches beyond that point is still reported.

## Ambiguous cases, and what this does about them

- A pattern with the global flag matching a zero-length string (for example an empty alternative) advances the search position by one code unit after each match rather than looping forever, which is the engine's own defined behaviour, not a choice this tool makes.
- Explain describes what a piece of the pattern means in JavaScript only. It never claims the same syntax would mean the same thing, or would even be valid, in another regex flavour.

## Defined by

- [ECMA-262 — RegExp (Regular Expression) Objects (section 22.2)](https://tc39.es/ecma262/#sec-regexp-regular-expression-objects)
- [ECMA-262 — GetSubstitution, the replacement-pattern algorithm (section 22.1.3.19.1)](https://tc39.es/ecma262/#sec-getsubstitution)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/regex-tester regex-tester
cd regex-tester
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/regex-tester
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { testPattern, replacePattern, explainPattern, runRegexJob } from '@fodt/regex-tester';

testPattern('[0-9]+', 'g', 'a1 b22');
// { mode: 'test', matches: [...], total: 2, truncated: false }

replacePattern('(?<year>[0-9]{4})-([0-9]{2})', '', '2024-03', '$<year>/$2');
// { mode: 'replace', output: '2024/03', count: 1 }

explainPattern('^(?<year>[0-9]{4})$', '');
// { mode: 'explain', parts: [{ depth: 0, source: '^', description: '...' }, ...] }

runRegexJob({ mode: 'test', pattern: '[0-9]+', flags: 'g', input: 'a1 b22' });
```

testPattern, replacePattern and explainPattern are synchronous and can run for an unbounded time on a pathological pattern; this package never times out on its own. The page composes a time limit around it by running the match in a worker and terminating it from the page, which is why this package itself contains no timer, no worker and no DOM reference. A malformed pattern or an unsupported/repeated flag throws RegexToolError carrying the engine's own message. replacePattern hands the replacement string straight to the engine's own String.prototype.replace, so $$, $&, $`, $', $n and $<name> expand exactly as ECMA-262 defines -- unlike this project's separate literal find-and-replace tool, where a dollar sequence is deliberately never expanded. explainPattern validates with the engine's own RegExp constructor first (the identical error path testPattern and replacePattern use), then parses with @eslint-community/regexpp and walks its AST into a flat ExplainPart list; each part's depth says how deeply it is nested so the page can indent it.

## Dependencies

- `@eslint-community/regexpp` 4.12.2

## Tests

```sh
npm test
```

Test mode is checked against ECMA-262 section 22.2's own defined matching behaviour: every match's index and capture groups, the global flag's defined advance-past-zero-length-match rule, the display cap counting past 1000 while still reporting the true total, and the engine's own SyntaxError message surfacing for an invalid pattern or an unsupported or repeated flag. Replace mode is checked against ECMA-262 section 22.1.3.19.1 (GetSubstitution): the whole match, a named group, a numbered group and a literal dollar sign each substitute exactly as that algorithm defines, and replacing without the global flag changes only the first match. Explain mode is checked against the AST @eslint-community/regexpp's own parser produces (printed and read directly this session before the assertions were written): a named capturing group, a character class, an exact-count quantifier, a lazy quantifier and both string anchors from one pattern, and lookahead, lookbehind, a named backreference and a Unicode property escape from another; an invalid pattern is checked to still throw RegexToolError. The time-limit browser spec feeds a known catastrophic-backtracking pattern, quoted from OWASP's own Regular Expression Denial of Service page, and asserts the 1.5 second time-limit message.

## Licence

MIT. See [LICENSE](./LICENSE).
