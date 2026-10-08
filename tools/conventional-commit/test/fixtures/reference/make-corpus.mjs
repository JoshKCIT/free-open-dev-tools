/**
 * The messages the reference parser is recorded on: the 33 probes of the research (kept in their order), 1,000 generated
 * messages from a seeded generator (mulberry32, seed 20261008), then the 10 probes of the phase 20 code review
 * (REVIEW_PROBES). The generator writes three classes:
 *
 *   clean       60 %  a well-formed header, plain prose paragraphs, then footers after one blank line; the reference parser
 *                     and this page are expected to read these the same way
 *   structural  25 %  footer-shaped lines in the body, one or two blank lines, footers glued to the body, footer values that
 *                     run over unindented or blank lines
 *   header      15 %  one mutation of a clean header: no space after the colon, a tab or a no-break space, an empty
 *                     description, an empty or nested scope, doubled or misplaced marks, a leading space, look-alikes
 *
 * Every non-ASCII character is built from its code point, so the file holds ASCII only.
 */

export const SEED = 20261008;
export const GENERATED = 1000;

const cp = (...codes) => String.fromCodePoint(...codes);
const NBSP = cp(0xa0);
const E_ACUTE = cp(0xe9);
const CYRILLIC_E = cp(0x435);
const FULLWIDTH_COLON = cp(0xff1a);
const BOM = cp(0xfeff);

/** The 33 probes of the research, in their order (cc-probe.cjs). */
export const PROBES = [
  'feat: add x',
  'feat:',
  'feat: ',
  'feat:x',
  'feat(): x',
  'feat(a b): x',
  'feat((a)): x',
  'Feat: x',
  'feat !: x',
  'feat!:x',
  'feat!: x',
  'feat(api)!: x',
  'fix(a)(b): x',
  'feat(a)!!: x',
  ' feat: x',
  'feat : x',
  'revert: x',
  'feat: x\nbody without blank line',
  'feat: x\n\nbody',
  'feat: x\n\nBREAKING CHANGE: y',
  'feat: x\n\nbreaking change: y',
  'feat: x\n\nBREAKING-CHANGE: y',
  'feat: x\n\nRefs #1',
  'feat: x\n\nCloses: #3',
  'feat: x\n\nReviewed-by: Z\nRefs: #123',
  'feat: x\r\n\r\nBREAKING CHANGE: crlf',
  BOM + 'feat: x',
  'feat: x\n\npara1\n\nBREAKING CHANGE: a\nsecond line\nRefs: #9',
  'feat: x\n\nA B: not a footer\n',
  'feat: x\n\nbody line\nSigned-off-by: A',
  E_ACUTE + 'tude: x',
  'feat' + E_ACUTE + ': x',
  'feat: x\n\n\n\nbody after many blanks',
];

/**
 * The messages of the phase 20 code review (part B, findings B-WR-01 to B-WR-03): BREAKING CHANGE lines that come close to
 * a breaking footer and are not one, and a BREAKING CHANGE footer written with a space and a number sign. Appended after the
 * generated messages, in this order.
 */
export const REVIEW_PROBES = [
  'feat: x\n\nsome body\nBREAKING CHANGE: removes the v1 API',
  'feat: x\n\nBREAKING CHANGE:\nthe config format changed',
  'feat: x\n\nBREAKING CHANGE: \nthe config format changed',
  'feat: x\n\nBREAKING CHANGE:the config format changed',
  'feat: x\n\nBREAKING CHANGES: plural',
  'feat: x\n\nRefs: #1\nbreaking change: lower in footer area',
  'feat: x\n\nRefs: #1\nBREAKING CHANGE:\nthe config format changed',
  'feat: x\n\nBREAKING CHANGE #12',
  'feat: x\n\nBREAKING-CHANGE #12',
  'feat: x\n\nRefs: #1\nBREAKING CHANGE #12',
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ['feat', 'fix', 'docs', 'chore', 'refactor', 'perf', 'test', 'build', 'ci', 'style', 'revert', 'Feat', 'FIX', 'Docs', 'x', 'a-b', 'ship_it'];
const SCOPES = ['api', 'lang', 'parser', 'deps', 'ui', 'x/y', 'core-lib', 'a1'];
const DESCRIPTIONS = [
  'add a health check',
  'correct spelling of CHANGELOG',
  'drop support for Node 6',
  'handle empty input.',
  'send an email to the customer',
  'x',
  'update (the) readme',
  'use a: colon in the text',
  'close #12',
  'keep   spaces   inside',
  'Add the thing',
  'support the ! mark',
];
const PROSE = [
  'Introduce a request id and a reference to latest request.',
  'Remove timeouts which were used to mitigate the racing issue.',
  'The parser now reads the second line as well.',
  'This is a longer sentence with, commas, and (parentheses).',
  'See the docs for details',
  '- first item',
  '- second item',
  '  an indented line',
  'a line that ends with a colon:',
  'quoted "text" inside',
  'http://example.invalid/a b',
];
/** Lines that look like the start of a footer. */
const FOOTER_LINES = [
  'Reviewed-by: Z',
  'Refs: #123',
  'Closes #4',
  'BREAKING CHANGE: the API changed',
  'BREAKING-CHANGE: drop v1',
  'Acked-by: A',
  'Signed-off-by: Name <name@example.invalid>',
  'Co-authored-by: Pat <pat@example.invalid>',
  'Note: this changes the default',
  'See also: the docs',
  'TODO: later',
  'Refs:#5',
  'Refs: ',
  'Fixes #9',
  'Closes(api): #5',
  'Break!: now',
];
const CONTINUATIONS = ['  continued value', '\tcontinued with a tab', 'plain continuation text', ''];

export function makeCorpus() {
  const rnd = mulberry32(SEED);
  const chance = (p) => rnd() < p;
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const between = (low, high) => low + Math.floor(rnd() * (high - low + 1));

  const cleanHeader = () => {
    const scope = chance(0.4) ? '(' + pick(SCOPES) + ')' : '';
    return pick(TYPES) + scope + (chance(0.25) ? '!' : '') + ': ' + pick(DESCRIPTIONS);
  };
  const paragraphs = (count) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const lines = [];
      for (let j = between(1, 3); j > 0; j--) lines.push(pick(PROSE));
      out.push(lines.join('\n'));
    }
    return out;
  };
  const footers = (count) => {
    const lines = [];
    for (let i = 0; i < count; i++) {
      lines.push(pick(FOOTER_LINES.slice(0, 8)));
      if (chance(0.3)) lines.push(pick(CONTINUATIONS.slice(0, 2)));
    }
    return lines.join('\n');
  };
  const crlf = (message) => (chance(0.1) ? message.split('\n').join('\r\n') : message);

  const makeClean = () => {
    let message = cleanHeader();
    const body = chance(0.55) ? paragraphs(between(1, 3)) : [];
    if (body.length) message += '\n\n' + body.join('\n\n');
    if (chance(0.5)) message += '\n\n' + footers(between(1, 3));
    if (chance(0.2)) message += '\n';
    return crlf(message);
  };

  const makeStructural = () => {
    const lines = [cleanHeader()];
    const gap = chance(0.1) ? 0 : chance(0.75) ? 1 : 2;
    for (let i = 0; i < gap; i++) lines.push('');
    const count = between(1, 6);
    for (let i = 0; i < count; i++) {
      if (i > 0 && chance(0.3)) lines.push('');
      lines.push(chance(0.5) ? pick(FOOTER_LINES) : pick(PROSE));
      if (chance(0.15)) lines.push(pick(CONTINUATIONS));
    }
    if (chance(0.5)) {
      if (chance(0.7)) lines.push('');
      lines.push(pick(FOOTER_LINES.slice(0, 8)));
      if (chance(0.3)) lines.push(pick(CONTINUATIONS));
    }
    if (chance(0.15)) lines.push('', 'trailing paragraph after the footers');
    return crlf(lines.join('\n'));
  };

  const makeHeader = () => {
    const type = pick(TYPES);
    const description = pick(DESCRIPTIONS);
    const scope = pick(SCOPES);
    const mutations = [
      () => type + ':' + description,
      () => type + ':\t' + description,
      () => type + ':' + NBSP + description,
      () => type + ':  ' + description,
      () => type + ' ' + description,
      () => type + ' : ' + description,
      () => type + ':',
      () => type + ': ',
      () => type + ':   ',
      () => type + '(): ' + description,
      () => type + '((' + scope + ')): ' + description,
      () => type + '(' + scope + ')(' + scope + '): ' + description,
      () => type + '!!: ' + description,
      () => type + '!(' + scope + '): ' + description,
      () => type + '(' + scope + ')!!: ' + description,
      () => ' ' + type + ': ' + description,
      () => '\t' + type + ': ' + description,
      () => type + '(' + scope + ': ' + description,
      () => type + scope + '): ' + description,
      () => type + ': ' + description + '   ',
      () => type.toUpperCase() + ': ' + description,
      () => E_ACUTE + 'tude: ' + description,
      () => 'f' + CYRILLIC_E + 'at: ' + description,
      () => type + FULLWIDTH_COLON + ' ' + description,
      () => type + '! : ' + description,
      () => type + ':: ' + description,
      () => type + '/x: ' + description,
      () => 'fix #12: ' + description,
      () => ': ' + description,
      () => type + '(a b): ' + description,
      () => type + '( ): ' + description,
    ];
    let message = pick(mutations)();
    if (chance(0.3)) message += '\n\n' + paragraphs(1)[0];
    if (chance(0.2)) message += '\n\n' + footers(1);
    return message;
  };

  const rows = [...PROBES];
  const seen = new Set(rows);
  while (rows.length < PROBES.length + GENERATED) {
    const roll = rnd();
    const message = roll < 0.6 ? makeClean() : roll < 0.85 ? makeStructural() : makeHeader();
    if (!seen.has(message)) {
      seen.add(message);
      rows.push(message);
    }
  }
  // The review probes come last, so the rows before them are the same as in the first recording.
  for (const message of REVIEW_PROBES) {
    if (!seen.has(message)) {
      seen.add(message);
      rows.push(message);
    }
  }
  return rows;
}
