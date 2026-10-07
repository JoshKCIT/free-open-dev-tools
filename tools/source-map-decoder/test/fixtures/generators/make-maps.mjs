// Builds the maps in maps.json with the repository's own esbuild, terser and TypeScript, from small sample sources made
// here (nothing is downloaded), plus two hand-made index maps that join two of them. Run from anywhere:
//   node tools/source-map-decoder/test/fixtures/generators/make-maps.mjs
// The versions of the three programs are written into maps.json. The decoder tests use these maps as extra input for
// the lookup oracles (Node's module.SourceMap and trace-mapping), so a map is only ever compared against another reader.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..', '..');
const store = join(root, 'node_modules', '.pnpm');
const find = (prefix) => {
  const hit = readdirSync(store).find((name) => name.startsWith(prefix));
  if (!hit) throw new Error(`${prefix} is not in the repository's node_modules`);
  return hit;
};
const esbuildDir = find('esbuild@');
const terserDir = find('terser@');
const typescriptDir = find('typescript@');
const load = createRequire(import.meta.url);
const esbuild = load(join(store, esbuildDir, 'node_modules', 'esbuild', 'lib', 'main.js'));
const terser = load(join(store, terserDir, 'node_modules', 'terser', 'dist', 'bundle.min.js'));
const ts = load(join(store, typescriptDir, 'node_modules', 'typescript', 'lib', 'typescript.js'));

/** TypeScript sample: classes, generics, async, template strings, and a string with a character outside the BMP. */
function sampleTypeScript(count) {
  const lines = ['export interface Item { id: number; label: string }', ''];
  for (let i = 0; i < count; i++) {
    lines.push(`export class Worker${i}<T extends Item> {`);
    lines.push(`  private seen: T[] = [];`);
    lines.push(`  note = 'item ${i} \u{1F600} done';`);
    lines.push(`  async run(item: T, extra = ${i}): Promise<string> {`);
    lines.push(`    this.seen.push(item);`);
    lines.push(`    if (item.id < 0) throw new RangeError(\`bad id \${item.id} in worker ${i}\`);`);
    lines.push(`    return (await Promise.resolve(item.label)) + this.note + extra;`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Plain JavaScript sample for terser: functions with local names to mangle and a few calls between them. */
function sampleJavaScript(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(`function compute${i}(firstValue, secondValue) {`);
    lines.push(`  const total = firstValue + secondValue * ${i + 1};`);
    lines.push(`  const message = 'total for ${i} is ' + total;`);
    lines.push(`  if (total > 1000) { throw new Error(message); }`);
    lines.push(`  return ${i === 0 ? 'total' : `compute${i - 1}(total, ${i}) + total`};`);
    lines.push(`}`);
    lines.push('');
  }
  lines.push(`console.log(compute${count - 1}(1, 2));`);
  return lines.join('\n');
}

const cases = [];

const tsSource = sampleTypeScript(24);
const viaEsbuild = await esbuild.transform(tsSource, {
  loader: 'ts',
  sourcemap: 'external',
  sourcefile: 'sample.ts',
  minify: true,
  sourcesContent: true,
});
cases.push({ name: 'esbuild-minified-typescript', tool: 'esbuild', generated: viaEsbuild.code, map: JSON.parse(viaEsbuild.map) });

const viaTsc = ts.transpileModule(tsSource, {
  fileName: 'sample.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.ESNext, sourceMap: true, inlineSources: true },
});
cases.push({
  name: 'tsc-es2019-typescript',
  tool: 'typescript',
  generated: viaTsc.outputText.replace(/\n\/\/# sourceMappingURL=.*$/, '\n'),
  map: JSON.parse(viaTsc.sourceMapText),
});

const jsSource = sampleJavaScript(30);
const viaTerser = await terser.minify(
  { 'util.js': jsSource },
  { sourceMap: { includeSources: true, filename: 'util.min.js' }, compress: true, mangle: true },
);
cases.push({ name: 'terser-mangled-javascript', tool: 'terser', generated: viaTerser.code, map: JSON.parse(viaTerser.map) });

// Two index maps made by hand from the first two maps. The first puts the second map on the line after the first. The
// second puts it on the last line of the first, after its last character, so the column offset of a section's first
// line is exercised.
const [first, second] = cases;
const firstLines = first.generated.split('\n');
const lastLine = firstLines[firstLines.length - 1] ?? '';
cases.push({
  name: 'index-map-by-lines',
  tool: 'hand made',
  generated: first.generated.endsWith('\n') ? first.generated + second.generated : first.generated + '\n' + second.generated,
  map: {
    version: 3,
    file: 'joined.js',
    sections: [
      { offset: { line: 0, column: 0 }, map: first.map },
      {
        offset: { line: first.generated.endsWith('\n') ? firstLines.length - 1 : firstLines.length, column: 0 },
        map: second.map,
      },
    ],
  },
});
const joinedLine = first.generated.endsWith('\n') ? firstLines.length - 2 : firstLines.length - 1;
const joinedColumn = first.generated.endsWith('\n') ? (firstLines[firstLines.length - 2] ?? '').length : lastLine.length;
cases.push({
  name: 'index-map-by-column',
  tool: 'hand made',
  generated: first.generated.replace(/\n$/, '') + second.generated,
  map: {
    version: 3,
    file: 'joined-on-a-line.js',
    sections: [
      { offset: { line: 0, column: 0 }, map: first.map },
      { offset: { line: joinedLine, column: joinedColumn }, map: second.map },
    ],
  },
});

const versionOf = (dir) => dir.split('@')[1]?.split('_')[0] ?? 'unknown';
writeFileSync(
  join(here, 'maps.json'),
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      tools: { esbuild: versionOf(esbuildDir), terser: versionOf(terserDir), typescript: versionOf(typescriptDir) },
      cases,
    },
    null,
    1,
  ) + '\n',
);
console.log(`wrote maps.json: ${cases.length} cases, esbuild ${versionOf(esbuildDir)}, terser ${versionOf(terserDir)}, typescript ${versionOf(typescriptDir)}`);
