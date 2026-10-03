// Writes published-cases.ts next to this script: a dozen input and output pairs taken from the Sass project's own
// published test suite (sass-spec) and the Less project's own published test data, each at a pinned commit.
//
//   node make-published-cases.mjs
//
// Needs Node 22 (global fetch) and a network connection. It is run by hand, never by the unit tests, so the tests do
// not depend on either repository being reachable. The commits and the download date are written into the output and
// into README.md in this folder.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SASS_SPEC_COMMIT = '49bf57edf18c4938599b3afd53dd826ee2f4e0e6';
const LESS_COMMIT = '713331655e437401dfea6cd233893a69762734e1';
const sassRaw = (path) => `https://raw.githubusercontent.com/sass/sass-spec/${SASS_SPEC_COMMIT}/${path}`;
const lessRaw = (path) => `https://raw.githubusercontent.com/less/less.js/${LESS_COMMIT}/${path}`;

// [hrx file, case directory inside it, input file name, syntax]
const SASS_CASES = [
  ['spec/directives/for/for.hrx', 'inclusive_forward/scss', 'input.scss', 'scss'],
  ['spec/directives/for/for.hrx', 'inclusive_forward/sass', 'input.sass', 'sass'],
  ['spec/directives/for/for.hrx', 'inclusive_backward', 'input.scss', 'scss'],
  ['spec/variables/semi_global.hrx', 'in_local/double_nested', 'input.scss', 'scss'],
  ['spec/directives/extend/pseudo.hrx', 'into_pseudo/extends_after', 'input.scss', 'scss'],
  ['spec/non_conformant/scss/while_directive.hrx', '', 'input.scss', 'scss'],
  ['spec/directives/if/sass.hrx', 'if', 'input.sass', 'sass'],
  ['spec/directives/each.hrx', 'sass/inline', 'input.sass', 'sass'],
];

// [directory, name] under packages/test-data/tests-unit
const LESS_CASES = [
  ['operations', 'operations'],
  ['scope', 'scope'],
  ['strings', 'strings'],
  ['css-guards', 'css-guards'],
  ['merge', 'merge'],
  ['lazy-eval', 'lazy-eval'],
];

/** The files of one HRX archive, by name. A file's body ends at the newline before the next boundary line. */
function hrxFiles(text) {
  const files = new Map();
  const parts = text.split(/^<===>[ \t]*/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const name = part.slice(0, newline).trim();
    if (name === '') continue; // a comment block
    files.set(name, part.slice(newline + 1));
  }
  return files;
}

async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

const sass = [];
for (const [path, directory, inputName, syntax] of SASS_CASES) {
  const files = hrxFiles(await get(sassRaw(path)));
  const prefix = directory === '' ? '' : `${directory}/`;
  const input = files.get(`${prefix}${inputName}`);
  const output = files.get(`${prefix}output.css`);
  if (input === undefined || output === undefined) throw new Error(`${path} ${directory} not found`);
  sass.push({
    path: `${path} (${directory === '' ? 'whole file' : directory})`,
    syntax,
    source: input.replace(/\n+$/, '\n'),
    expected: output.replace(/\n+$/, ''),
  });
}

const less = [];
for (const [directory, name] of LESS_CASES) {
  const base = `packages/test-data/tests-unit/${directory}/${name}`;
  less.push({
    path: `${base}.less`,
    source: await get(lessRaw(`${base}.less`)),
    expected: (await get(lessRaw(`${base}.css`))).replace(/\r\n/g, '\n').trim(),
  });
}

const header = `// Written by make-published-cases.mjs on ${new Date().toISOString().slice(0, 10)}. Do not edit by hand.
// Sass cases: https://github.com/sass/sass-spec at commit ${SASS_SPEC_COMMIT} (MIT licence).
// Less cases: https://github.com/less/less.js at commit ${LESS_COMMIT} (Apache-2.0 licence).

export interface SassCase {
  /** The upstream path, with the case directory inside the archive file. */
  path: string;
  syntax: 'scss' | 'sass';
  source: string;
  /** The published output, without its trailing newline. */
  expected: string;
}

export interface LessCase {
  /** The upstream path of the input; the published output sits beside it with the extension .css. */
  path: string;
  source: string;
  /** The published output with line ends normalised and the ends trimmed. */
  expected: string;
}

export const SASS_SPEC_COMMIT = '${SASS_SPEC_COMMIT}';
export const LESS_COMMIT = '${LESS_COMMIT}';

`;

const body =
  `export const SASS_CASES: SassCase[] = ${JSON.stringify(sass, null, 2)};\n\n` +
  `export const LESS_CASES: LessCase[] = ${JSON.stringify(less, null, 2)};\n`;

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'published-cases.ts'), header + body);
console.log(`wrote ${sass.length} Sass cases and ${less.length} Less cases`);
