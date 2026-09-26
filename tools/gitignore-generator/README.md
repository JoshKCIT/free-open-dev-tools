# .gitignore Generator

Compose a .gitignore from bundled templates for languages, tools and editors.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a .gitignore file by combining templates bundled from github/gitignore's own repository root and Global folder, each kept byte-for-byte identical to the upstream file at a pinned commit. Names are matched without regard to case, an unknown name is listed with the closest real names instead of being dropped, and a custom section for lines of your own can be appended underneath.

## Supported

- 160 language and framework templates from the repository root, and 75 editor/tool templates from Global/, both from github/gitignore at a pinned commit
- Case-insensitive template names, matched by name or by file name (for example Node or Node.gitignore)
- Any number of templates in one file, each under its own ### <name> ### heading in the order chosen
- A Custom section for extra lines typed by hand, appended under the templates
- An optional header comment naming the source commit and licence
- Listing every available template name when none is chosen yet

## Limits

- This tool cannot see the visitor's own repository, so it cannot tell whether a pattern here would hide a file already meant to be committed, or whether a file matching a pattern is already tracked -- git itself keeps tracking a file it already knows about regardless of a later .gitignore rule. Only git, run against the real repository, can show that.
- The community/ folder of the upstream repository is not bundled (D-108); only the repository root and Global/ folders are offered.
- The bundled templates are a snapshot of github/gitignore at one pinned commit; a template added or changed upstream afterwards is not reflected here.
- Duplicate lines across chosen templates are kept rather than merged, because removing one can change what is ignored when a negation pattern sits between two occurrences of the same line -- see the gitignore documentation's own precedence rule.

## Ambiguous cases, and what this does about them

- The upstream repository publishes three templates as symlinks rather than real files: Clojure.gitignore (an alias for Leiningen.gitignore), Fortran.gitignore (an alias for C++.gitignore) and Global/Octave.gitignore (an alias for Global/MATLAB.gitignore). This tool does not follow symlinks when it bundles templates, so these three alias names are not offered separately -- ask for the underlying name (Leiningen, C++ or MATLAB) instead.

## Defined by

- [gitignore(5), Git 2.53.0](https://git-scm.com/docs/gitignore)
- [git-check-ignore(1), Git 2.53.0](https://git-scm.com/docs/git-check-ignore)
- [github/gitignore templates](https://github.com/github/gitignore)

## Bundled data

This folder ships a data file that is not an npm dependency, so it travels with the folder when it is
copied out on its own:

- **github/gitignore templates** (CC0-1.0) — [source](https://github.com/github/gitignore). "gitignore" templates by GitHub, Inc. and contributors, dedicated under CC0 1.0 Universal. Snapshot taken at commit b06d69d5a0b82a187180dac3d46a4ebe1e40bce5.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/gitignore-generator gitignore-generator
cd gitignore-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/gitignore-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { composeGitignore, listTemplates } from '@fodt/gitignore-generator';

const result = composeGitignore({ templates: ['Node', 'macOS'], extra: 'my-secret.env', header: true });
console.log(result.output);
```

`composeGitignore` never throws for an unknown template name -- it lists it under `unknown` with up to three close-name suggestions instead, so a visitor's near-miss is never silently dropped. `listTemplates` returns every bundled name and its folder, for a page to show when no template is chosen yet.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Correctness is checked three ways: every bundled template's content is proven byte-identical to its git blob SHA at the pinned commit (from the vendored tree listing), the bundled set is proven to be exactly the root and Global templates the generator itself would build fresh from the vendored files, and git itself (via git init and git check-ignore --no-index -v --stdin in a real temporary directory) is asked to agree with what this tool composes on a sample file tree. The local git version used for that check is recorded in the SUMMARY.

## Licence

MIT. See [LICENSE](./LICENSE).
