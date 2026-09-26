# README Generator

Assemble a project README from sections and badges.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Fills in a project name, description, badges and sections (installation, usage, features, contributing, licence) and gives back CommonMark and GitHub Flavored Markdown you can paste straight into a README.md, plus a safe preview of how it will look. Badges are written as Markdown text pointing at the real badge image and its target page -- this tool itself never loads any image, and neither does the preview, which shows every badge as its own text instead.

## Supported

- A title, description, an optional table of contents, and Installation, Usage, Features, Contributing and Licence sections, each included only when it has content
- npm version, GitHub licence, GitHub Actions workflow status and GitHub release badges, plus a static label badge, all written as Markdown text with every visitor value percent-encoded into its URL
- An install command for npm, pnpm, yarn or bun
- A sanitised, image-free preview shown only in a sandboxed frame, rendered with the same CommonMark and GitHub Flavored Markdown support used elsewhere on this site
- Backslash-escaping of plain fields (the project name, badge alt text) so punctuation in them renders literally rather than as Markdown syntax

## Limits

- This tool cannot check that a badge URL actually resolves or shows what it claims -- loading it would be a network request, and only viewing the rendered README on the hosting site (or a browser tab pointed at the badge URL directly) can show that.
- GitHub's own Markdown renderer may differ from the preview in small ways (for example its exact heading-anchor generation for non-Latin letters, see markdown-text.ts); this preview is a close approximation, not a guarantee of pixel-identical rendering.
- Badges always appear as their own text, never an image, inside the preview -- by design (D-105), not a limitation the visitor can turn off.
- The description and free-text sections are rendered as the visitor typed them; this tool does not check that the Markdown they contain is well-formed CommonMark beyond what the preview itself shows.
- A README with more than 800 list items refuses only the preview (measured directly: rendering and sanitising a flat list grows super-linearly past roughly a thousand items in a real browser) -- the Markdown itself has no such limit and still downloads.

## Ambiguous cases, and what this does about them

- GitHub's own section-link documentation says heading letters are lower-cased, but that same page's worked example keeps a Greek capital letter unlowercased in the generated anchor -- a real self-contradiction in GitHub's own current docs (see markdown-text.ts's githubSlug). This tool follows the stated rule (lower-case) since that is also what the widely used github-slugger reference implementation does.
- This tool's badge URLs are always built from https://, so the scp-like git URL ambiguity another phase 7 tool discloses for its own URL-shaped input does not apply here.

## Defined by

- [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/)
- [GitHub Flavored Markdown (tables)](https://github.github.com/gfm/#tables-extension-)
- [GitHub section links (heading anchors)](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#section-links)
- [shields.io static badge escaping](https://github.com/badges/shields/blob/master/services/static-badge/static-badge.service.js)
- [shields.io npm version badge](https://img.shields.io/npm/v/example)
- [shields.io GitHub license badge](https://img.shields.io/github/license/example/example)
- [shields.io GitHub release badge](https://img.shields.io/github/v/release/example/example)
- [GitHub Actions workflow status badge](https://docs.github.com/en/actions/how-tos/monitor-workflows/add-a-status-badge)
- [npm install](https://docs.npmjs.com/cli/commands/npm-install)
- [pnpm add](https://pnpm.io/cli/add)
- [yarn add](https://yarnpkg.com/cli/add)
- [bun add](https://bun.sh/docs/cli/add)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/readme-generator readme-generator
cd readme-generator
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/readme-generator
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { buildReadme, renderPreview } from '@fodt/readme-generator';

const { markdown } = buildReadme({ name: 'my-lib', description: 'A tiny library.', packageName: 'my-lib' });
const { html } = renderPreview(markdown, window);
```

buildReadme({ name, description?, badges?, toc?, packageManager?, packageName?, sections?, license? }) returns { markdown, headings }. renderPreview(markdown, win) returns { html, removed } -- html is already sanitised and safe to render in a sandboxed frame; win is the caller's own window, never read from a DOM global inside this package. badgeMarkdown(id, params) builds one badge's own Markdown line and throws ReadmeBadgeError when a badge's required parameters are missing (buildReadme catches this per badge and simply omits it).

## Dependencies

- `micromark` 4.0.2
- `micromark-extension-gfm` 3.0.0
- `dompurify` 3.4.16

## Tests

```sh
npm test
```

OWASP XSS Filter Evasion Cheat Sheet payloads (107 vectors, shared canonically across this project's markup-rendering tools) are typed into every field this tool renders and checked to leave no active content, using the same independent active-content checker those tools use. Badge URL building is checked against a battery of hostile owner/package names (spaces, parentheses, slashes, unicode) for both encodeURIComponent's own path-segment form and shields.io's dash/underscore/space static-badge form.

## Licence

MIT. See [LICENSE](./LICENSE).
