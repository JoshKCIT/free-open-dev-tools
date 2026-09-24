# Scientific Notation Converter

Convert between decimal, scientific, engineering and E notation.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

TODO: two or three sentences on what this does and when to reach for it.

## Supported

- TODO

## Limits

- TODO: what this will not do. Never leave this empty.

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/scientific-notation scientific-notation
cd scientific-notation
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/scientific-notation
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { run } from '@fodt/scientific-notation';
```



## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

Tests are written against the specifications listed above rather than against another implementation.

## Licence

MIT. See [LICENSE](./LICENSE).
