// Generates the (glob, path) pairs that record-editorconfig.cjs asks the reference library about.
//
// A seeded linear congruential generator (seed 99) draws 6,000 times: a glob of one to four tokens from GLOB_TOKENS and a
// path of one to five tokens from PATH_TOKENS. A path has runs of slashes collapsed and a leading and a trailing slash
// removed, and a draw whose path is empty or holds a . or .. part is dropped. The recorder then drops a draw that the
// reference library refuses, which leaves the 5,900 pairs of differential.json.
export const SEED = 99;
export const DRAWS = 6000;
export const GLOB_TOKENS = [
  '*',
  '**',
  '?',
  'a',
  'b',
  'c',
  '.js',
  '/',
  '{a,b}',
  '{b,c,}',
  '{1..3}',
  '[ab]',
  '[!a]',
  '\\*',
  'ab',
  'x/',
  '**/',
  '/**',
  '{*.js,*.ts}',
];
export const PATH_TOKENS = ['a', 'b', 'c', 'ab', '.js', '.ts', '/', 'x', '1', '2', '*'];

export function makePairs() {
  let state = SEED;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const pick = (list) => list[Math.floor(next() * list.length)];
  const draw = (tokens, count) => {
    let text = '';
    for (let i = 0; i < count; i++) text += pick(tokens);
    return text;
  };
  const pairs = [];
  for (let k = 0; k < DRAWS; k++) {
    const glob = draw(GLOB_TOKENS, 1 + Math.floor(next() * 4));
    const path = draw(PATH_TOKENS, 1 + Math.floor(next() * 5))
      .replace(/\/\/+/g, '/')
      .replace(/^\//, '')
      .replace(/\/$/, '');
    if (path === '' || /(^|\/)\.\.?(\/|$)/.test(path)) continue;
    pairs.push([glob, path]);
  }
  return pairs;
}
