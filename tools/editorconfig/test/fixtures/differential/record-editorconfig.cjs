'use strict';
// Records what the `editorconfig` library (npm, 3.0.2, MIT) says about generated (glob, path) pairs.
//
//   node record-editorconfig.cjs <folder that holds node_modules/editorconfig> <out.json> [ours.mjs]
//
// For each pair from make-pairs.mjs the library is given the file "root = true", an empty line, "[glob]" and "k = v", and
// asked about the path; the pair matched when the answer holds k = v. The library is only read from the folder named on the
// command line (installed there once, by hand, with scripts turned off); nothing is installed by this script.
//
// With a third argument, an ES module that exports matches(glob, path) (this package's matcher, bundled), the pairs where
// the two disagree are listed in `differences` with the family they belong to. A disagreement that fits no family stops the
// script, and so does a family that explains nothing.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

/**
 * The three named families of degenerate globs that the specification does not define. They are tried in this order: a
 * glob that holds an escaped star followed by two stars also holds three stars in a row, and belongs to the escaped family.
 * They cover every disagreement of seed 99 only: other seeds also draw globs with an empty alternative first, a double star
 * after a brace that may expand to nothing, or a double star at the start of a brace branch (README.md, "Other seeds",
 * gives one glob of each), and this script then stops until such a family is named here and in README.md.
 */
const FAMILIES = [
  ['escaped star followed by a star', (glob) => glob.includes('\\**')],
  ['runs of slashes and stars', (glob) => glob.includes('//') || glob.includes('***')],
  ['empty brace alternative before a slash', (glob) => glob.includes(',}/')],
];

function familyOf(glob) {
  for (const [name, test] of FAMILIES) if (test(glob)) return name;
  return null;
}

async function main() {
  const [folder, out, oursPath] = process.argv.slice(2);
  if (!folder || !out) {
    console.error('usage: node record-editorconfig.cjs <folder> <out.json> [ours.mjs]');
    process.exit(2);
  }
  const requireFrom = createRequire(path.join(path.resolve(folder), 'noop.js'));
  const editorconfig = requireFrom('editorconfig');
  const version = requireFrom('editorconfig/package.json').version;
  const { makePairs, SEED, DRAWS } = await import(pathToFileURL(path.join(__dirname, 'make-pairs.mjs')).href);
  const ours = oursPath ? (await import(pathToFileURL(path.resolve(oursPath)).href)).matches : null;

  const base = path.resolve('/proj');
  const pairs = [];
  const differences = [];
  for (const [glob, file] of makePairs()) {
    const text = `root = true\n\n[${glob}]\nk = v\n`;
    let theirs;
    try {
      const answer = editorconfig.parseFromFilesSync(path.join(base, ...file.split('/')), [
        { name: path.join(base, '.editorconfig'), contents: Buffer.from(text) },
      ]);
      theirs = answer.k === 'v';
    } catch (err) {
      continue;
    }
    pairs.push([glob, file, theirs]);
    if (ours) {
      const mine = ours(glob, file);
      if (mine !== theirs) {
        const family = familyOf(glob);
        if (family === null) {
          console.error('a disagreement outside the named families:', JSON.stringify([glob, file, theirs, mine]));
          process.exit(1);
        }
        differences.push({ glob, path: file, theirs, ours: mine, family });
      }
    }
  }
  if (ours) {
    for (const [name] of FAMILIES) {
      if (!differences.some((d) => d.family === name)) {
        console.error('the family "' + name + '" explains no disagreement');
        process.exit(1);
      }
    }
  }
  const lines = [
    '{',
    `  "recordedAt": ${JSON.stringify(new Date().toISOString())},`,
    `  "version": ${JSON.stringify(version)},`,
    `  "library": "editorconfig (npm)",`,
    `  "node": ${JSON.stringify(process.version)},`,
    `  "seed": ${SEED},`,
    `  "draws": ${DRAWS},`,
    '  "pairs": [',
    pairs.map((p) => '    ' + JSON.stringify(p)).join(',\n'),
    '  ],',
    '  "differences": [',
    differences.map((d) => '    ' + JSON.stringify(d)).join(',\n'),
    '  ]',
    '}',
    '',
  ];
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`${pairs.length} pairs, ${differences.length} differences`);
}

main();
