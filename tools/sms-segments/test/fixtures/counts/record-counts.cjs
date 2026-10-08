'use strict';
/**
 * Records what the counting library split-sms 0.1.7 (MIT) says about the 690 messages of make-corpus.mjs: the encoding it
 * picks and the number of parts it returns.
 *
 * Run by hand from a scratch folder that already has the package (nothing is installed by this script, and the package is
 * not part of this repository):
 *
 *   node record-counts.cjs <folder holding node_modules/split-sms> <output file>
 *
 * For an empty message the library reports one part, and the specification has nothing to send, so this tool says 0
 * segments for it. Those 30 rows are recorded as the library gave them and the test names them as a difference by design.
 * Unit tests only read the file; they never load the library.
 */
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const modules = process.argv[2];
  const out = process.argv[3];
  if (!modules || !out) {
    console.error('usage: node record-counts.cjs <folder holding node_modules/split-sms> <output file>');
    process.exit(1);
  }
  const packageFolder = path.join(path.resolve(modules), 'node_modules', 'split-sms');
  const version = JSON.parse(fs.readFileSync(path.join(packageFolder, 'package.json'), 'utf8')).version;
  const splitSms = require(packageFolder);
  const { makeCorpus, SEED } = await import('./make-corpus.mjs');

  const rows = makeCorpus().map((text) => {
    const result = splitSms.split(text);
    return { text, encoding: result.characterSet === 'GSM' ? 'gsm7' : 'ucs2', parts: result.parts.length };
  });
  const recorded = {
    recordedAt: new Date().toISOString().replace(/[.]\d{3}Z$/, 'Z'),
    library: 'split-sms ' + version,
    node: process.version,
    seed: SEED,
    generator: 'make-corpus.mjs',
  };
  const head = JSON.stringify(recorded).slice(0, -1);
  fs.writeFileSync(out, head + ',"rows":[\n' + rows.map((row) => JSON.stringify(row)).join(',\n') + '\n]}\n', 'utf8');
  console.log(rows.length + ' rows recorded with split-sms ' + version);
}

main();
