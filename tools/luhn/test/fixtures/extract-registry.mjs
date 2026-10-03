// Writes registry-release.ts from the IBAN registry text file that SWIFT, the registration authority for ISO 13616, publishes.
//
//   node tools/luhn/test/fixtures/extract-registry.mjs <downloaded registry .txt> > tools/luhn/test/fixtures/registry-release.ts
//   pnpm exec prettier --write tools/luhn/test/fixtures/registry-release.ts
//
// The file is a tab separated table with one column per country and one row per data element (the cells are quoted where
// they hold line breaks). This script reads three rows, the country code, the IBAN length and the electronic example, and
// checks each example: it has the stated length, starts with the country code and leaves 1 when divided by 97. It stops
// with an error if any example fails one of those checks.
import fs from 'node:fs';

const text = fs.readFileSync(process.argv[2]).toString('latin1');
const table = [];
let field = '';
let row = [];
let quoted = false;
for (const ch of text) {
  if (quoted) {
    if (ch === '"') quoted = false;
    else field += ch;
  } else if (ch === '"') quoted = true;
  else if (ch === '\t') {
    row.push(field);
    field = '';
  } else if (ch === '\n') {
    row.push(field.replace(/\r$/, ''));
    field = '';
    table.push(row);
    row = [];
  } else field += ch;
}
if (field || row.length) {
  row.push(field);
  table.push(row);
}
const find = (name) => {
  const hit = table.find((r) => r[0] === name);
  if (!hit) throw new Error('no row named ' + name);
  return hit;
};
const codes = find('IBAN prefix country code (ISO 3166)');
const lengths = find('IBAN length');
const examples = find('IBAN electronic format example');

function mod97(digitsAndLetters) {
  let r = 0;
  for (const ch of digitsAndLetters) {
    const v = ch >= 'A' ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48;
    r = (v > 9 ? r * 100 + v : r * 10 + v) % 97;
  }
  return r;
}

const entries = [];
for (let c = 1; c < codes.length; c++) {
  const country = (codes[c] || '').trim();
  if (!country) continue;
  const length = Number(lengths[c]);
  const example = (examples[c] || '').replace(/\s/g, '');
  if (example.length !== length || !example.startsWith(country) || mod97(example.slice(4) + example.slice(0, 4)) !== 1) {
    throw new Error('the registry example for ' + country + ' does not fit its own length or check digits');
  }
  entries.push([country, length, example]);
}

console.log('// Written by extract-registry.mjs from the SWIFT IBAN registry text file; see README.md for the release and where it came from.');
console.log('// Each row: country code, IBAN length, and the electronic format example the registry prints for it.');
console.log('export const REGISTRY_RELEASE_ROWS: [string, number, string][] = [');
for (const [country, length, example] of entries) console.log(`  ['${country}', ${length}, '${example}'],`);
console.log('];');
