# EXIF Viewer & Remover

Read image metadata and write a copy with it removed.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

TODO

## Supported

- TODO

## Limits

- TODO

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/exif-viewer exif-viewer
cd exif-viewer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/exif-viewer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { readMetadata } from '@fodt/exif-viewer';
```



## Dependencies

- `exifr` 7.1.3

## Tests

```sh
npm test
```

Tests are written against the specifications listed above rather than against another implementation.

## Licence

MIT. See [LICENSE](./LICENSE).
