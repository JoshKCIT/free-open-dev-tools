/**
 * Writes the ten Python arrays that record.py runs, made by the package's own exportCodeArray from seeded bytes.
 *
 *   node tools/hex-viewer/test/fixtures/langs/make-texts.mjs <empty folder>
 *
 * The package is TypeScript, so src/export.ts is turned into JavaScript in memory with the TypeScript compiler that
 * the folder already depends on, and loaded from a data address. The one import it has (the error class from index.ts)
 * is replaced by a stand-in class, because the texts do not depend on it. Each file is named python-<size>.py and holds
 * exactly the text the unit test regenerates, so the recording made from it (python.json) is a recording of that text.
 *
 * The bytes are seeded (mulberry32, seed 1900 plus the size) and the unit test uses the same generator.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? '');
if (process.argv[2] === undefined) {
  console.error('usage: node make-texts.mjs <empty folder>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const source = readFileSync(join(here, '..', '..', '..', 'src', 'export.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const standIn = 'class HexViewerError extends Error { constructor(message) { super(message); } }';
const loadable = compiled.replace(/import \{ HexViewerError \} from ['"]\.\/index['"];?/, standIn);
if (loadable === compiled) throw new Error('the import of the error class was not found in export.ts');
const { exportCodeArray } = await import(`data:text/javascript;base64,${Buffer.from(loadable).toString('base64')}`);

function seededBytes(size) {
  let a = 1900 + size;
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 256);
  }
  return out;
}

for (const size of [0, 1, 2, 11, 12, 13, 24, 25, 1000, 4096]) {
  const { text, identifier } = exportCodeArray(seededBytes(size), {
    language: 'python',
    name: 'my data.bin',
    perLine: 12,
    upper: false,
  });
  if (identifier !== 'my_data_bin') throw new Error(`unexpected identifier ${identifier}`);
  writeFileSync(join(outDir, `python-${size}.py`), text, 'utf8');
}
console.log(`wrote 10 texts to ${outDir}`);
