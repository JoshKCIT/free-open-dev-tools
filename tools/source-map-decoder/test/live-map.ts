/**
 * The map and the trace of the live fixture: two TypeScript files bundled and minified by esbuild 0.25.12, and the stack
 * a thrown RangeError printed in V8. The positions the tests expect are read from Node's own source map reader on this
 * same map, never from the decoder under test.
 */
export const LIVE_MAP = {
  version: 3,
  sources: ['src/math.ts', 'src/main.ts'],
  sourcesContent: [
    "export function checkPositive(value: number): number {\n  if (value <= 0) {\n    throw new RangeError('value must be positive: ' + value);\n  }\n  return value;\n}\n\nexport class Accumulator {\n  total = 0;\n  add(value: number): void {\n    this.total += checkPositive(value);\n  }\n}\n",
    "import { Accumulator } from './math';\n\nfunction sumAll(values: number[]): number {\n  const acc = new Accumulator();\n  for (const v of values) {\n    acc.add(v);\n  }\n  return acc.total;\n}\n\nexport function run(): number {\n  return sumAll([3, 5, -2, 7]);\n}\n\nrun();\n",
  ],
  mappings:
    'MAAO,SAASA,EAAcC,EAAuB,CACnD,GAAIA,GAAS,EACX,MAAM,IAAI,WAAW,2BAA6BA,CAAK,EAEzD,OAAOA,CACT,CAEO,IAAMC,EAAN,KAAkB,CACvB,MAAQ,EACR,IAAID,EAAqB,CACvB,KAAK,OAASD,EAAcC,CAAK,CACnC,CACF,ECVA,SAASE,EAAOC,EAA0B,CACxC,IAAMC,EAAM,IAAIC,EAChB,QAAWC,KAAKH,EACdC,EAAI,IAAIE,CAAC,EAEX,OAAOF,EAAI,KACb,CAEO,SAASG,GAAc,CAC5B,OAAOL,EAAO,CAAC,EAAG,EAAG,GAAI,CAAC,CAAC,CAC7B,CAEAK,EAAI',
  names: ['checkPositive', 'value', 'Accumulator', 'sumAll', 'values', 'acc', 'Accumulator', 'v', 'run'],
};

export const LIVE_MAP_TEXT = JSON.stringify(LIVE_MAP);

/** The stack of the throw, as V8 printed it for a script at https://example.test/assets/min.js. */
export const LIVE_TRACE = [
  'RangeError: value must be positive: -2',
  '    at e (https://example.test/assets/min.js:1:35)',
  '    at n.add (https://example.test/assets/min.js:1:128)',
  '    at u (https://example.test/assets/min.js:1:178)',
  '    at i (https://example.test/assets/min.js:1:220)',
  '    at https://example.test/assets/min.js:1:234',
].join('\n');
