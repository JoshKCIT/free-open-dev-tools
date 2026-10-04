# Upstream: npm/node-semver

- Repository: https://github.com/npm/node-semver
- Tag: v7.8.5
- Commit: 6e05b7637396ac66522cff8731f07cfe0ef49a29
- Fetch date: 2026-10-04
- Licence: ISC (see LICENSE in this folder)

Each file here is `test/fixtures/<name>.js` at the tag above, copied byte for byte with `curl -fsSL
https://raw.githubusercontent.com/npm/node-semver/v7.8.5/test/fixtures/<name>.js`. LICENSE is `LICENSE` at the same tag.
Nothing in this folder is edited: the tests check each file against the git blob SHA below.

`range-parse.js` and `invalid-versions.js` start with a require of `../../internal/constants`, a path inside node-semver's
own repository. The test loader answers it with the same module from the installed `semver` package.

## Files

- range-include.js: 3df851b882da4df91cc2343dd929f645caead99c
- range-exclude.js: a4b92d1d72d8bfdd1eb450b137ffa62615b3d07d
- range-parse.js: 1c69c96d68aeb1537f5cd7b25e037684dd723105
- valid-versions.js: e2bf3d11b94f8ef822020ab4a242715257bb8323
- invalid-versions.js: c0c2fcd3ad0defe7c8f88988f597fbd3fdc786ad
- comparator-intersection.js: 08c4bc08a1f841918068e4f41c655862b77b85f5
- LICENSE: 19129e315fe593965a2fdd50ec0d1253bcbd2ece
