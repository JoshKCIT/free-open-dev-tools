# package.json Generator

Build a valid package.json with the fields npm actually reads.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Builds a package.json from only the fields npm's own documentation or the Node.js packages documentation define, each explained in plain words with a link. Every name, version, dependency range and licence identifier is checked the same way npm's own packages check them, so the file this tool hands back is one npm accepts as written.

## Supported

- 20 fields across name, version, description, keywords, homepage, author, licence, repository, main, type, exports, bin, scripts, dependencies, devDependencies, peerDependencies, files, engines, packageManager and private, each with who reads it (npm, Node.js or Corepack), an explanation and a documentation link
- Package names checked exactly as validate-npm-package-name decides, including its own wording
- Versions checked against the Semantic Versioning 2.0.0 specification's own recommended regular expression
- Dependency specifiers classified as a semver range, a dist-tag, an npm: alias, a file: path, a git URL, a GitHub user/repo shorthand, or a tarball URL, with workspace: and link: accepted but flagged since npm itself does not read them
- 11 SPDX licence identifiers verified against the SPDX License List, plus UNLICENSED and SEE LICENSE IN <file>
- Prototype-pollution-safe scripts, dependency and exports maps

## Limits

- This tool cannot check that a name is actually free on the npm registry, that a dependency's version exists, or that a bin, main or exports path actually exists in the project -- only npm itself and the visitor's own files can show that.
- Only the 20 listed fields are written; a field npm or Node.js documents that is not in that list (for example bundleDependencies or workspaces) is not offered.
- The hand-written dependency range parser is checked against the real npm semver package only on the battery this project's own tests run; a range outside that battery that the two disagree on would only show up when npm itself installs the package.

## Ambiguous cases, and what this does about them

- A name that validate-npm-package-name accepts only 'for old packages' (a warning, not an error -- for example capital letters) is treated the same as a refused name here, since this tool only ever builds a fresh package.json for a package that does not exist yet.
- packageManager and a small number of other Node.js- and Corepack-read fields are documented in the field table even though the page itself has no dedicated control for them yet; they exist in this package's own API for a future page revision.

## Defined by

- [npm package.json documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
- [Node.js packages documentation](https://nodejs.org/api/packages.html)
- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
- [SPDX License List](https://spdx.org/licenses/)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/package-json-generator package-json-generator
cd package-json-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/package-json-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildPackageJson } from '@fodt/package-json-generator';

const { output, problems, warnings } = buildPackageJson({ name: '@scope/my-lib', version: '1.0.0', license: 'MIT' });
```

`buildPackageJson(input)` always returns `{ output, object, problems, warnings }` and never throws for ordinary input; `PackageJsonError` exists for a genuinely malformed direct call. A refused value (an invalid name, version, licence, engines range or dependency specifier) is listed in `problems` and never written; a value that is written but worth a second look (for example a `workspace:` dependency) is listed in `warnings`.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

checkPackageName, isValidVersion and classifySpecifier are proven against the real, devDependency-only validate-npm-package-name and semver packages (D-82, never bundled): the package-name check on validate-npm-package-name's own README examples plus a generated battery, and the range parser on the semver README's own examples plus a generated battery, with zero disagreements found. normalize-package-data (also devDependency-only) proves the finished output passes npm's own strict-mode normalisation with no warnings.

## Licence

MIT. See [LICENSE](./LICENSE).
