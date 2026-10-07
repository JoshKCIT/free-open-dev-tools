// Assembles fixture.wat with wabt 1.0.39 (a development dependency of this folder) and writes fixture.ts.
// Run from the tool folder: node test/fixtures/make-fixture.mjs
// The assembler is an authoring-time tool only; the tests read the Base64 text in fixture.ts and never run wabt.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import wabt from 'wabt';

const here = dirname(fileURLToPath(import.meta.url));
const wat = readFileSync(join(here, 'fixture.wat'), 'utf8');
const assembler = await wabt();
const parsed = assembler.parseWat('fixture.wat', wat, { mutable_globals: true });
parsed.generateNames();
parsed.applyNames();
const { buffer } = parsed.toBinary({ log: false, write_debug_names: true });
const bytes = new Uint8Array(buffer);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const base64 = Buffer.from(bytes).toString('base64');

const text = `// Written by make-fixture.mjs from fixture.wat with wabt 1.0.39. Do not edit by hand.
// The module has an imported function (env.log) and global (env.limit), a memory, a table, a mutable global,
// the data segment "hello fixture", an element segment, the exports memory, add, twice and counter, a start function and
// a name section.
export const FIXTURE_BASE64 =
  '${base64}';
export const FIXTURE_BYTES = ${bytes.length};
export const FIXTURE_SHA256 = '${sha256}';

/** The bytes of the fixture module. */
export function fixtureBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(FIXTURE_BASE64, 'base64'));
}
`;
writeFileSync(join(here, 'fixture.ts'), text);
console.log(`wrote fixture.ts: ${bytes.length} bytes, sha256 ${sha256}`);
