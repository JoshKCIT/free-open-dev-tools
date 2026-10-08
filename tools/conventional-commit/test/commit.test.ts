import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ConventionalCommitError,
  MAX_FOOTERS,
  MAX_LINES_PER_MESSAGE,
  MAX_LINE_CHARACTERS,
  MAX_MESSAGES,
  MAX_PASTE_CHARACTERS,
  MAX_VERSION_CHARACTERS,
  adviceFor,
  bumpFor,
  changelogFor,
  checkCommits,
  footerStart,
  formatVersion,
  increment,
  parseMessage,
  parseVersion,
  splitMessages,
  type CheckResult,
  type ParsedMessage,
} from '../src/index';
import { MAX_SCALING_RATIO, scalingRatio } from './scaling';

// Sources of the expected values in this file:
//  - Conventional Commits 1.0.0, git blob 4fa8464d66f7659c3565a2a84ce0577839552046 (CC BY 3.0, see fixtures/UPSTREAM.md):
//    the seven examples of its section "Examples" (re-typed in fixtures/spec-examples.json) and the 16 numbered rules of
//    its section "Specification". A rule is quoted by its number and a fragment of its words.
//  - Semantic Versioning 2.0.0: items 4 (initial development), 6, 7 and 8 (patch, minor and major versions are raised and
//    the lower numbers reset to zero), the official regular expression with its example versions, and the specification's
//    own summary: a fix correlates with PATCH, a feat with MINOR and a breaking change with MAJOR.
//  - The recorded answers of @conventional-commits/parser 0.4.1 (fixtures/reference) and the recorded default output of
//    git 2.53.0 `git log` (fixtures/gitlog).
//  - Hand-derived rows: each is the rule applied by hand, with the rule number beside it.

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const NBSP = cp(0xa0);
const TAB = cp(9);
const FEFF = cp(0xfeff);
const FULLWIDTH_COLON = cp(0xff1a);
const CYRILLIC_E = cp(0x435);
const ZERO_WIDTH_SPACE = cp(0x200b);
const MARKER = 'QZXMARKERQZX';

function fixture(path: string): string {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
}

interface SpecFooter {
  token: string;
  separator: string;
  value: string;
}
interface SpecExample {
  title: string;
  message: string;
  expect: {
    type: string;
    scope: string | null;
    bang: boolean;
    breaking: boolean;
    description: string;
    body: string;
    footers: SpecFooter[];
  };
}
const EXAMPLES = (JSON.parse(fixture('spec-examples.json')) as { examples: SpecExample[] }).examples;

interface RefParts {
  type: string | null;
  scope: string | null;
  bang: boolean;
  description: string;
  body: string;
  footers: { token: string; separator: string; value: string }[];
  breaking: boolean;
}
interface RefRow {
  message: string;
  accepted: boolean;
  parts: RefParts | null;
}
const REFERENCE = JSON.parse(fixture('reference/reference.json')) as {
  recordedAt: string;
  parser: string;
  seed: number;
  rows: RefRow[];
};

const parse = (message: string): ParsedMessage => parseMessage(message);
const rulesOf = (message: string): number[] => parse(message).failures.map((f) => f.rule);
const texts = (text: string, mode: 'separator' | 'lines' | 'gitlog', separator?: string): string[] =>
  splitMessages(text, mode, separator).messages.map((m) => m.text);

/** Runs `fn`, expecting a refusal, and returns it. */
function refusal(fn: () => unknown): ConventionalCommitError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConventionalCommitError);
    return err as ConventionalCommitError;
  }
  throw new Error('expected a refusal, but nothing was refused');
}

afterEach(() => {
  vi.restoreAllMocks();
});

// Rule 11: "Breaking changes MUST be indicated in the type/scope prefix of a commit, or as an entry in the footer."
// Rule 12: as a footer, "the uppercase text BREAKING CHANGE, followed by a colon, space, and description".
// Rule 13: in the prefix, "a ! immediately before the :". Summary item 3: a breaking change correlates with MAJOR.
it('the breaking change example of the specification is valid and adds up to a major bump', () => {
  const footerExample = EXAMPLES[0] as SpecExample;
  expect(footerExample.title).toBe('Commit message with description and breaking change footer');
  const parsed = parseMessage(footerExample.message);
  expect(parsed.valid).toBe(true);
  expect(parsed.failures).toEqual([]);
  expect(parsed.type).toBe('feat');
  expect(parsed.bang).toBe(false);
  expect(parsed.breaking).toBe(true);
  expect(parsed.footers.map((f) => f.token)).toEqual(['BREAKING CHANGE']);
  expect(parsed.breakingText).toBe('`extends` key in config file is now used for extending other config files');
  const checked = checkCommits({ text: footerExample.message });
  expect(checked.messages).toHaveLength(1);
  expect(checked.bump.level).toBe('major');

  // The mark form: the second example has no footer at all and is breaking through the ! alone.
  const markExample = EXAMPLES[1] as SpecExample;
  const marked = parseMessage(markExample.message);
  expect(marked.valid).toBe(true);
  expect(marked.type).toBe('feat');
  expect(marked.bang).toBe(true);
  expect(marked.breaking).toBe(true);
  expect(marked.footers).toEqual([]);
  expect(marked.description).toBe('send an email to the customer when a product is shipped');
  expect(checkCommits({ text: markExample.message }).bump.level).toBe('major');
});

// The "Examples" section of the specification, re-typed in spec-examples.json with the parts each shows.
it('the seven examples of the specification are valid with the type, scope, breaking flag and footers they show', () => {
  expect(EXAMPLES).toHaveLength(7);
  for (const example of EXAMPLES) {
    const parsed = parseMessage(example.message);
    expect(parsed.failures, example.title).toEqual([]);
    expect(parsed.valid, example.title).toBe(true);
    expect(parsed.type, example.title).toBe(example.expect.type);
    expect(parsed.scope, example.title).toBe(example.expect.scope);
    expect(parsed.bang, example.title).toBe(example.expect.bang);
    expect(parsed.breaking, example.title).toBe(example.expect.breaking);
    expect(parsed.description, example.title).toBe(example.expect.description);
    expect(parsed.body, example.title).toBe(example.expect.body);
    expect(
      parsed.footers.map((f) => ({ token: f.token, separator: f.separator, value: f.value })),
      example.title,
    ).toEqual(example.expect.footers);
  }
  // The last example holds the footers Reviewed-by and Refs, as the specification prints them.
  const last = EXAMPLES[6] as SpecExample;
  expect(last.expect.footers.map((f) => f.token)).toEqual(['Reviewed-by', 'Refs']);
  // Seen together the examples add up to a major bump: four are breaking (a footer, a mark, a scope and mark, both).
  const all = checkCommits({ text: EXAMPLES.map((e) => e.message).join('\n---\n') });
  expect(all.messages).toHaveLength(7);
  expect(all.messages.every((m) => m.parsed.valid)).toBe(true);
  expect(all.messages.filter((m) => m.parsed.breaking)).toHaveLength(4);
  expect(all.bump.level).toBe('major');
});

interface RuleCase {
  rule: number;
  /** A fragment of the words of the rule, quoted. */
  words: string;
  /** A message that follows the rule, and what it shows. */
  pass: (assert: (name: string, ok: boolean) => void) => void;
  /** A message that does not, and what it shows: not valid with this rule number, or not recognised as the thing. */
  fail: (assert: (name: string, ok: boolean) => void) => void;
}

const RULE_CASES: RuleCase[] = [
  {
    rule: 1,
    words:
      'Commits MUST be prefixed with a type ... followed by the OPTIONAL scope, OPTIONAL !, and REQUIRED terminal colon and space.',
    pass: (a) => {
      const p = parse('fix(parser)!: array parsing issue');
      a('valid', p.valid);
      a('type, scope and mark', p.type === 'fix' && p.scope === 'parser' && p.bang);
    },
    fail: (a) => {
      a('no type, no colon', rulesOf('Update the readme').join() === '1');
      a('colon without a space', rulesOf('fix:array parsing issue').join() === '1');
      a('no type before the colon', rulesOf(': array parsing issue').join() === '1');
    },
  },
  {
    rule: 2,
    words: 'The type feat MUST be used when a commit adds a new feature to your application or library.',
    pass: (a) => {
      const checked = checkCommits({ text: 'feat: add Polish language' });
      a('feat adds a minor bump', checked.bump.level === 'minor');
    },
    fail: (a) => {
      // The wording cannot be broken by looking at one message: a feature committed under another type is valid (rule 14)
      // and is simply not read as a feature.
      const checked = checkCommits({ text: 'feature: add Polish language' });
      a(
        'another type is valid but adds no release',
        checked.messages[0]?.parsed.valid === true && checked.bump.level === 'none',
      );
    },
  },
  {
    rule: 3,
    words: 'The type fix MUST be used when a commit represents a bug fix for your application.',
    pass: (a) => {
      a('fix adds a patch bump', checkCommits({ text: 'fix: array parsing issue' }).bump.level === 'patch');
    },
    fail: (a) => {
      a('bugfix adds no release', checkCommits({ text: 'bugfix: array parsing issue' }).bump.level === 'none');
    },
  },
  {
    rule: 4,
    words:
      'A scope MUST consist of a noun describing a section of the codebase surrounded by parenthesis, e.g., fix(parser):',
    pass: (a) => {
      const p = parse('fix(parser): array parsing issue');
      a('scope read', p.valid && p.scope === 'parser');
    },
    fail: (a) => {
      a('scope not closed', rulesOf('fix(parser: x').join() === '4');
      a('scope empty', rulesOf('fix(): x').join() === '4');
      a('two scopes', rulesOf('fix(a)(b): x').join() === '4');
      a('nested parentheses', rulesOf('fix((a)): x').join() === '4');
    },
  },
  {
    rule: 5,
    words: 'A description MUST immediately follow the colon and space after the type/scope prefix.',
    pass: (a) => {
      const p = parse('fix: array parsing issue when multiple spaces were contained in string');
      a(
        'description read',
        p.valid && p.description === 'array parsing issue when multiple spaces were contained in string',
      );
    },
    fail: (a) => {
      a('colon and space, nothing after', rulesOf('fix: ').join() === '5');
      a('nothing after the colon', rulesOf('fix(parser):').join() === '1,5');
    },
  },
  {
    rule: 6,
    words: 'The body MUST begin one blank line after the description.',
    pass: (a) => {
      const p = parse('fix: x\n\nbody text');
      a('body read', p.valid && p.body === 'body text');
    },
    fail: (a) => {
      a('body on the next line', rulesOf('fix: x\nbody text').join() === '6');
    },
  },
  {
    rule: 7,
    words: 'A commit body is free-form and MAY consist of any number of newline separated paragraphs.',
    pass: (a) => {
      const body =
        '# a heading\n\n* an item\n* another item\n\n> quoted text with (parentheses), commas and a; semicolon\n\nhttp://example.invalid/a b';
      const p = parse(`fix: x\n\n${body}`);
      a('any paragraphs are body', p.valid && p.body === body && p.footers.length === 0);
    },
    fail: (a) => {
      // A body can only be refused for where it starts, which is rule 6.
      a('free text straight after the description is rule 6', rulesOf('fix: x\nfree-form text').join() === '6');
    },
  },
  {
    rule: 8,
    words:
      'One or more footers MAY be provided one blank line after the body. Each footer MUST consist of a word token, followed by either a :<space> or <space># separator, followed by a string value.',
    pass: (a) => {
      const p = parse('fix: x\n\nbody\n\nReviewed-by: Z\nRefs #123');
      a('two footers', p.valid && p.footers.length === 2);
      a('separators', p.footers[0]?.separator === ': ' && p.footers[1]?.separator === ' #');
      a('values', p.footers[0]?.value === 'Z' && p.footers[1]?.value === '123');
    },
    fail: (a) => {
      a('a footer on the second line is rule 8', rulesOf('fix: x\nReviewed-by: Z').join() === '8');
      const glued = parse('fix: x\n\nbody\nReviewed-by: Z');
      a(
        'a footer glued to the body stays in the body',
        glued.valid && glued.footers.length === 0 && glued.body === 'body\nReviewed-by: Z',
      );
      a('no space after the colon is no footer', parse('fix: x\n\nbody\n\nRefs:5').footers.length === 0);
    },
  },
  {
    rule: 9,
    words:
      "A footer's token MUST use - in place of whitespace characters, e.g., Acked-by. An exception is made for BREAKING CHANGE.",
    pass: (a) => {
      a('Acked-by', parse('fix: x\n\nAcked-by: A').footers[0]?.token === 'Acked-by');
      a('BREAKING CHANGE', parse('fix: x\n\nBREAKING CHANGE: y').footers[0]?.token === 'BREAKING CHANGE');
    },
    fail: (a) => {
      const spaced = parse('fix: x\n\nAcked by: A');
      a(
        'a token with a space is no footer',
        spaced.valid && spaced.footers.length === 0 && spaced.body === 'Acked by: A',
      );
    },
  },
  {
    rule: 10,
    words:
      "A footer's value MAY contain spaces and newlines, and parsing MUST terminate when the next valid footer token/separator pair is observed.",
    pass: (a) => {
      const p = parse('fix: x\n\nReviewed-by: Z\nsecond line of the value\nRefs: #1');
      a('two footers', p.footers.length === 2);
      a('value over a line', p.footers[0]?.value === 'Z\nsecond line of the value');
    },
    fail: (a) => {
      const p = parse('fix: x\n\nReviewed-by: Z\nAcked by: A\nRefs: #1');
      a(
        'a line that is not a valid token pair does not end the value',
        p.footers.length === 2 && p.footers[0]?.value === 'Z\nAcked by: A',
      );
    },
  },
  {
    rule: 11,
    words: 'Breaking changes MUST be indicated in the type/scope prefix of a commit, or as an entry in the footer.',
    pass: (a) => {
      a('prefix', parse('feat(api)!: x').breaking);
      a('footer', parse('feat: x\n\nBREAKING CHANGE: y').breaking);
    },
    fail: (a) => {
      const talk = parse('fix: breaking the old call\n\nThis is a breaking change for callers.');
      a('words about a breaking change are not the mark', talk.valid && !talk.breaking);
    },
  },
  {
    rule: 12,
    words:
      'If included as a footer, a breaking change MUST consist of the uppercase text BREAKING CHANGE, followed by a colon, space, and description.',
    pass: (a) => {
      const p = parse('feat: x\n\nBREAKING CHANGE: environment variables now take precedence over config files');
      a(
        'description is the breaking text',
        p.breakingText === 'environment variables now take precedence over config files',
      );
    },
    fail: (a) => {
      a('no description', rulesOf('feat: x\n\nBREAKING CHANGE: ').join() === '12');
      a('no colon is no footer', !parse('feat: x\n\nBREAKING CHANGE environment variables').breaking);
      // The separator of rule 8 that is a space and a number sign is not the colon and space rule 12 asks for (review
      // B-WR-03): the message is not valid, so it adds no release and no changelog entry.
      const hashed = parse('feat: x\n\nBREAKING CHANGE #12');
      a('a space and # is a rule 12 failure', rulesOf('feat: x\n\nBREAKING CHANGE #12').join() === '12');
      a('the hyphen synonym with a space and # too', rulesOf('feat: x\n\nBREAKING-CHANGE #12').join() === '12');
      a(
        'the failure names the colon and space',
        hashed.failures[0]?.message ===
          'A BREAKING CHANGE footer is written with a colon and a space, not a space and #.',
      );
      a('after another footer too', rulesOf('feat: x\n\nRefs: #1\nBREAKING CHANGE #12').join() === '12');
      const hashedCheck = checkCommits({ text: 'feat: x\n\nBREAKING CHANGE #12\n---\nfix: y' });
      a('adds no release of its own', hashedCheck.bump.level === 'patch');
      a('no changelog entry', !hashedCheck.changelog.includes('- 12'));
      // Other footers keep the space and # separator of rule 8.
      a('Refs #12 is a footer', parse('feat: x\n\nRefs #12').valid);
    },
  },
  {
    rule: 13,
    words: 'If included in the type/scope prefix, breaking changes MUST be indicated by a ! immediately before the :.',
    pass: (a) => {
      const p = parse('feat(api)!: drop v1');
      a('mark read', p.valid && p.bang && p.scope === 'api');
      a('the description describes the break', p.breakingText === 'drop v1');
    },
    fail: (a) => {
      a('mark before the scope', rulesOf('feat!(api): x').join() === '13');
      a('space after the mark', rulesOf('feat! : x').join() === '13');
      a('two marks', rulesOf('feat!!: x').join() === '13');
    },
  },
  {
    rule: 14,
    words: 'Types other than feat and fix MAY be used in your commit messages, e.g., docs: update ref docs.',
    pass: (a) => {
      const p = parse('docs: update ref docs.');
      a('valid', p.valid && p.type === 'docs');
    },
    fail: (a) => {
      // Another type is allowed, but has "no implicit effect in Semantic Versioning" (Summary).
      a('adds no release', checkCommits({ text: 'docs: update ref docs.\n---\nchore: x' }).bump.level === 'none');
    },
  },
  {
    rule: 15,
    words:
      'MUST NOT be treated as case-sensitive by implementors, with the exception of BREAKING CHANGE which MUST be uppercase.',
    pass: (a) => {
      a('type in capitals', checkCommits({ text: 'FEAT: x' }).bump.level === 'minor');
      a('type with a capital', checkCommits({ text: 'Fix(Api): x' }).bump.level === 'patch');
      a('footer token in capitals', parse('fix: x\n\nREVIEWED-BY: Z').footers[0]?.token === 'REVIEWED-BY');
    },
    fail: (a) => {
      a('lower case body text is no breaking change', !parse('feat: x\n\nbreaking change: y').breaking);
      a('mixed case token is no breaking change', !parse('feat: x\n\nBreaking-Change: y').breaking);
    },
  },
  {
    rule: 16,
    words: 'BREAKING-CHANGE MUST be synonymous with BREAKING CHANGE, when used as a token in a footer.',
    pass: (a) => {
      const hyphen = parse('feat: x\n\nBREAKING-CHANGE: y');
      const space = parse('feat: x\n\nBREAKING CHANGE: y');
      a('breaking', hyphen.breaking && space.breaking);
      a('same text', hyphen.breakingText === space.breakingText);
    },
    fail: (a) => {
      a('an underscore is not the synonym', !parse('feat: x\n\nBREAKING_CHANGE: y').breaking);
      a(
        'only the footer token is a synonym, not the prefix',
        rulesOf('BREAKING-CHANGE: y').length === 0 && !parse('BREAKING-CHANGE: y').breaking,
      );
    },
  },
];

// The 16 numbered rules, each with a passing and a failing message written from the words of the rule (quoted in RULE_CASES).
it('each of the 16 rules has a passing message and a failing message written from its words', () => {
  expect(RULE_CASES.map((c) => c.rule)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  for (const ruleCase of RULE_CASES) {
    expect(ruleCase.words.length).toBeGreaterThan(20);
    const check = (side: string) => (name: string, ok: boolean) => {
      expect(ok, `rule ${ruleCase.rule} ${side}: ${name}`).toBe(true);
    };
    ruleCase.pass(check('passing'));
    ruleCase.fail(check('failing'));
  }
});

// Rules 1, 5 and 6, read literally: a colon and a space, a description, and a body one blank line after the description.
// The reference parser accepts all of these (fixtures/reference), so each is also checked against the recording.
it('a missing space after the colon, an empty description and a body with no blank line are not valid', () => {
  expect(rulesOf('feat:x')).toEqual([1]);
  expect(rulesOf('feat!:x')).toEqual([1]);
  expect(rulesOf('feat:')).toEqual([1, 5]);
  expect(rulesOf('feat: ')).toEqual([5]);
  expect(rulesOf('feat:   ')).toEqual([5]);
  expect(rulesOf('feat: x\nbody without blank line')).toEqual([6]);
  expect(rulesOf(' feat: x')).toEqual([1]);
  expect(rulesOf('feat:' + TAB + 'x')).toEqual([1]);
  expect(rulesOf('feat:' + NBSP + 'x')).toEqual([1]);
  const recorded = REFERENCE.rows;
  for (const message of ['feat:x', 'feat!:x', 'feat:', 'feat: ', 'feat: x\nbody without blank line', ' feat: x']) {
    const row = recorded.find((r) => r.message === message);
    expect(row, JSON.stringify(message)).toBeDefined();
    expect(row?.accepted, JSON.stringify(message)).toBe(true);
    expect(parse(message).valid, JSON.stringify(message)).toBe(false);
  }
});

const collapse = (text: string): string => text.split(/\s+/).filter(Boolean).join(' ');

function sameAsReference(row: RefRow, mine: ParsedMessage): boolean {
  if (mine.valid !== row.accepted) return false;
  if (!mine.valid) return true;
  const p = row.parts as RefParts;
  const separator = (s: string): string => (s === ': ' ? ':' : s);
  const footers = (list: { token: string; separator: string; value: string }[]): string =>
    list.map((f) => [f.token, separator(f.separator), collapse(f.value)].join('|')).join('\n');
  return (
    mine.type === p.type &&
    mine.scope === p.scope &&
    mine.bang === p.bang &&
    collapse(mine.description) === collapse(p.description) &&
    collapse(mine.body) === collapse(p.body) &&
    footers(mine.footers) === footers(p.footers) &&
    mine.breaking === p.breaking
  );
}

function linesOf(message: string): string[] {
  const text = message.startsWith(FEFF) ? message.slice(1) : message;
  return text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** The header up to and including the colon: a type, an optional scope, an optional mark. */
const PREFIX = '^[^\\s:()!]+(\\([^()]*\\))?!?';
const WHITE = ` ${TAB}${cp(11)}${cp(12)}${NBSP}${FEFF}`;
const EXOTIC = `${TAB}${cp(11)}${cp(12)}${NBSP}${FEFF}`;

interface Family {
  /** The name, as README.md of fixtures/reference lists it. */
  name: string;
  /** The rule of the specification this page follows where the reference parser does not. */
  rule: string;
  applies: (message: string, mine: ParsedMessage) => boolean;
}

/**
 * The twelve places where this page follows the wording of the specification and the reference parser reads a message
 * another way. The last two were added with the review probes of the phase 20 code review (fixtures/reference/README.md).
 */
const NAMED_DIFFERENCES: Family[] = [
  {
    name: 'no space after the colon',
    rule: 'rule 1: REQUIRED terminal colon and space',
    applies: (m) => new RegExp(`${PREFIX}:[^${WHITE}]`).test(linesOf(m)[0] as string),
  },
  {
    name: 'an empty description',
    rule: 'rule 5: A description MUST immediately follow the colon and space',
    applies: (m) => new RegExp(`${PREFIX}:[${WHITE}]*$`).test(linesOf(m)[0] as string),
  },
  {
    name: 'a tab or a no-break space in place of the space after the colon',
    rule: 'rule 1: the colon and space',
    applies: (m) => new RegExp(`${PREFIX}:[${EXOTIC}]`).test(linesOf(m)[0] as string),
  },
  {
    name: 'white space before the type',
    rule: 'rule 1: Commits MUST be prefixed with a type',
    applies: (m) => new RegExp(`^[${WHITE}]`).test(linesOf(m)[0] as string),
  },
  {
    name: 'a space and a number sign in place of the colon of the header',
    rule: 'rule 1 and rule 8: the separator <space># belongs to footers',
    applies: (m) => new RegExp(`${PREFIX} #`).test(linesOf(m)[0] as string),
  },
  {
    name: 'a second line that is not blank',
    rule: 'rules 6 and 8: one blank line after the description',
    applies: (m) => {
      const second = linesOf(m)[1];
      return second !== undefined && second.trim() !== '';
    },
  },
  {
    name: 'a footer glued to body text',
    rule: 'rule 8: footers one blank line after the body',
    applies: (_m, mine) => {
      const body = mine.body.split('\n');
      for (let i = 1; i < body.length; i++) {
        if (footerStart(body[i] as string) !== null && (body[i - 1] as string).trim() !== '') return true;
      }
      return false;
    },
  },
  {
    name: 'a footer value that runs over a blank or unindented line',
    rule: 'rule 10: a value MAY contain newlines, until the next valid token',
    applies: (m, mine) => {
      if (mine.footers.length === 0) return false;
      const lines = linesOf(m);
      while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop();
      for (let j = (mine.footers[0] as { line: number }).line - 1; j < lines.length; j++) {
        const line = lines[j] as string;
        if (footerStart(line) === null && (line.trim() === '' || !/^\s/.test(line))) return true;
      }
      return false;
    },
  },
  {
    name: 'a footer separator that is not a colon and a space or a space and a number sign',
    rule: 'rule 8: followed by either a :<space> or <space># separator',
    applies: (m) =>
      linesOf(m)
        .slice(1)
        .some((l) => /^([^\s:()!]+|BREAKING CHANGE):/.test(l) && footerStart(l) === null),
  },
  {
    name: 'a footer token that holds a scope or a mark',
    rule: 'rules 8 and 9: a word token',
    applies: (m) =>
      linesOf(m)
        .slice(1)
        .some((l) => /^[^\s:()!]+(\([^()]*\)|!)+(:| #)/.test(l)),
  },
  {
    name: 'a BREAKING CHANGE footer written with a space and a number sign',
    rule: 'rule 12: the uppercase text BREAKING CHANGE, followed by a colon, space, and description',
    applies: (m) =>
      linesOf(m)
        .slice(1)
        .some((l) => /^BREAKING[ -]CHANGE #/.test(l)),
  },
  {
    name: 'a line that starts with BREAKING CHANGES',
    rule: 'rule 12: the token is BREAKING CHANGE, and rule 7: a body is free-form text kept as written',
    applies: (m) =>
      linesOf(m)
        .slice(1)
        .some((l) => l.startsWith('BREAKING CHANGES')),
  },
];

// The reference parser's answers are a second opinion (README.md beside the recording): the two agree wherever the
// wording is unambiguous, and every message they differ on is explained by a named family, each of which explains at least
// one recorded difference.
it('the recorded reference parser agrees wherever the specification is unambiguous and its leniencies are listed by name', () => {
  expect(REFERENCE.parser).toBe('@conventional-commits/parser 0.4.1');
  expect(REFERENCE.recordedAt).toMatch(/^2026-10-0\dT/);
  expect(REFERENCE.rows).toHaveLength(1043);
  expect(NAMED_DIFFERENCES).toHaveLength(12);
  expect(new Set(NAMED_DIFFERENCES.map((f) => f.name)).size).toBe(12);
  // The ten probes of the code review come last; the parser counts BREAKING CHANGE #12 as a breaking change.
  expect(REFERENCE.rows.slice(1033).map((r) => r.message)[7]).toBe('feat: x\n\nBREAKING CHANGE #12');
  expect(REFERENCE.rows[1040]?.parts?.breaking).toBe(true);

  // The 33 probes of the research come first in the recording.
  expect(REFERENCE.rows.slice(0, 33).map((r) => r.message)[0]).toBe('feat: add x');

  const explained = new Map<string, number>();
  let agree = 0;
  let differ = 0;
  for (const row of REFERENCE.rows) {
    const mine = parseMessage(row.message);
    if (sameAsReference(row, mine)) {
      agree += 1;
      continue;
    }
    differ += 1;
    const families = NAMED_DIFFERENCES.filter((f) => f.applies(row.message, mine));
    expect(families.length, `no named family explains ${JSON.stringify(row.message)}`).toBeGreaterThan(0);
    for (const family of families) explained.set(family.name, (explained.get(family.name) ?? 0) + 1);
  }
  for (const family of NAMED_DIFFERENCES) {
    expect(explained.get(family.name) ?? 0, `family never needed: ${family.name}`).toBeGreaterThan(0);
  }
  expect(agree + differ).toBe(1043);
  expect(agree).toBe(768);
  expect(differ).toBe(275);

  // Every message the specification itself shows is read the same by both (they are the clearest ground).
  for (const example of EXAMPLES) {
    const row = REFERENCE.rows.find((r) => r.message === example.message);
    if (row !== undefined) expect(sameAsReference(row, parseMessage(example.message)), example.title).toBe(true);
  }
});

// Rule 15: types are not case-sensitive, "with the exception of BREAKING CHANGE which MUST be uppercase"; rule 16: the
// hyphen form is a synonym. Rule 9 says the footer token uses a hyphen for white space, so a lower case phrase with a space
// cannot be a token at all and stays body text.
it('the type is read without regard to case while BREAKING CHANGE must be upper case and BREAKING-CHANGE is its synonym', () => {
  expect(checkCommits({ text: 'FEAT: x' }).bump.level).toBe('minor');
  expect(checkCommits({ text: 'Fix: x' }).bump.level).toBe('patch');
  expect(parse('FEAT: x').type).toBe('FEAT');
  expect(parse('fix: x\n\nreviewed-by: Z').footers[0]?.token).toBe('reviewed-by');

  const upper = parse('feat: x\n\nBREAKING CHANGE: y');
  const hyphen = parse('feat: x\n\nBREAKING-CHANGE: y');
  expect(upper.breaking).toBe(true);
  expect(hyphen.breaking).toBe(true);
  expect(hyphen.breakingText).toBe(upper.breakingText);
  expect(hyphen.footers[0]?.token).toBe('BREAKING-CHANGE');

  const lower = parse('feat: x\n\nbreaking change: y');
  expect(lower.valid).toBe(true);
  expect(lower.breaking).toBe(false);
  expect(lower.footers).toEqual([]);
  expect(lower.body).toBe('breaking change: y');
  for (const message of ['Breaking Change: y', 'Breaking-Change: y', 'breaking-change: y', 'BREAKING change: y']) {
    const p = parse(`feat: x\n\n${message}`);
    expect(p.breaking, message).toBe(false);
    expect(p.valid, message).toBe(true);
  }
  // Mixed case is an ordinary footer when it is a word token, with a note that rule 12 needs upper case.
  const mixed = parse('feat: x\n\nBreaking-Change: y');
  expect(mixed.footers.map((f) => f.token)).toEqual(['Breaking-Change']);
  expect(adviceFor(mixed, 'feat: x\n\nBreaking-Change: y').some((a) => a.code === 'breaking-case')).toBe(true);
  expect(adviceFor(lower, 'feat: x\n\nbreaking change: y').some((a) => a.code === 'breaking-case')).toBe(true);
});

// Rule 10: "A footer's value MAY contain spaces and newlines, and parsing MUST terminate when the next valid footer
// token/separator pair is observed."
it('a footer value runs over lines until the next valid footer token', () => {
  const message =
    'fix: x\n\nBREAKING CHANGE: first line\ncontinues here\n  and indented\n\nstill the value\nRefs: #1\nlast line of refs';
  const parsed = parse(message);
  expect(parsed.valid).toBe(true);
  expect(parsed.footers.map((f) => f.token)).toEqual(['BREAKING CHANGE', 'Refs']);
  expect(parsed.footers[0]?.value).toBe('first line\ncontinues here\n  and indented\n\nstill the value');
  expect(parsed.footers[1]?.value).toBe('#1\nlast line of refs');
  expect(parsed.breakingText).toBe('first line continues here and indented still the value');
  // The line numbers of the message (the header is line 1).
  expect(parsed.footers.map((f) => f.line)).toEqual([3, 8]);
  // A value stops where the next token starts, with either separator.
  const separators = parse('fix: x\n\nA-b: one\nmore\nC-d #2\nD-e: three');
  expect(separators.footers.map((f) => [f.token, f.separator, f.value])).toEqual([
    ['A-b', ': ', 'one\nmore'],
    ['C-d', ' #', '2'],
    ['D-e', ': ', 'three'],
  ]);
});

// Rule 8: footers come "one blank line after the body". A line such as Note: text inside a paragraph is therefore body.
it('a body paragraph holding Note: text before the footer block stays body', () => {
  const message = 'fix: x\n\nFirst paragraph.\nNote: this stays in the body\nmore text\n\nReviewed-by: Z';
  const parsed = parse(message);
  expect(parsed.valid).toBe(true);
  expect(parsed.body).toBe('First paragraph.\nNote: this stays in the body\nmore text');
  expect(parsed.footers.map((f) => [f.token, f.value])).toEqual([['Reviewed-by', 'Z']]);
  // The first footer-shaped line that follows a blank line starts the footers, whatever its token.
  const first = parse('fix: x\n\nbody text\n\nNote: now a footer\nReviewed-by: Z');
  expect(first.body).toBe('body text');
  expect(first.footers.map((f) => f.token)).toEqual(['Note', 'Reviewed-by']);
  // More than one blank line before the body is read as one (the specification says only that the body begins one blank
  // line after the description).
  expect(parse('fix: x\n\n\n\nbody after many blanks').body).toBe('body after many blanks');
  expect(parse('fix: x\n\n\n\nbody after many blanks').valid).toBe(true);
});

const msg = (header: string, extra = ''): string => (extra === '' ? header : `${header}\n\n${extra}`);
const level = (...messages: string[]): string => checkCommits({ text: messages.join('\n---\n') }).bump.level;

// Conventional Commits 1.0.0, Summary and the FAQ "How does this relate to SemVer?": fix is PATCH, feat is MINOR, a breaking
// change is MAJOR; other types "have no implicit effect in Semantic Versioning (unless they include a BREAKING CHANGE)".
it('any breaking change gives major, else any feat gives minor, else any fix gives patch, else no release', () => {
  expect(level('docs: a', 'chore: b', 'test: c')).toBe('none');
  expect(level('docs: a', 'fix: b')).toBe('patch');
  expect(level('fix: a', 'fix: b')).toBe('patch');
  expect(level('fix: a', 'feat: b', 'docs: c')).toBe('minor');
  expect(level('feat: a', 'fix: b')).toBe('minor');
  expect(level('fix: a', 'feat: b', 'chore!: c')).toBe('major');
  expect(level('docs: a', msg('docs: b', 'BREAKING CHANGE: c'))).toBe('major');
  expect(level(msg('fix: a', 'BREAKING-CHANGE: b'), 'feat: c')).toBe('major');
  // A breaking change of any type counts, and the order of the messages does not matter.
  expect(level('feat!: a', 'fix: b')).toBe('major');
  expect(level('fix: b', 'feat!: a')).toBe('major');
  // A message that is not valid adds nothing, even when it looks like a feat.
  expect(level('feat:x', 'docs: a')).toBe('none');
  expect(level('feat!:x', 'fix: a')).toBe('patch');
  // Nothing at all.
  expect(bumpFor([]).level).toBe('none');
  expect(checkCommits({ text: '' }).bump).toEqual({ level: 'none' });
});

// SemVer 2.0.0 items 6, 7 and 8: a patch, minor or major version is raised and the lower numbers reset to zero; item 4:
// anything may change below 1.0.0, so a breaking change there is the caller's choice.
it('the next version follows SemVer and the zero major option moves a breaking change to the minor part below 1.0.0', () => {
  const next = (current: string, message: string, zeroMajor = false): string | undefined => {
    const messages = [parse(message)];
    return bumpFor(messages, { currentVersion: current, zeroMajor }).next;
  };
  expect(next('1.4.2', 'feat: a')).toBe('1.5.0');
  expect(next('1.4.2', 'fix: a')).toBe('1.4.3');
  expect(next('1.4.2', 'feat!: a')).toBe('2.0.0');
  expect(next('1.4.2', 'docs: a')).toBeUndefined();
  expect(next('0.3.1', 'feat!: a')).toBe('1.0.0');
  expect(next('0.3.1', 'feat!: a', true)).toBe('0.4.0');
  expect(next('0.3.1', 'feat: a', true)).toBe('0.4.0');
  expect(next('0.3.1', 'fix: a', true)).toBe('0.3.2');
  // The option moves only a breaking change that starts below 1.0.0.
  expect(next('1.0.0', 'feat!: a', true)).toBe('2.0.0');
  expect(next('0.0.9', 'feat!: a', true)).toBe('0.1.0');
  // This page's stated rule for a current version that has a pre-release tag or build text: it is raised from its release
  // numbers, and the tag and the build text are dropped.
  expect(next('1.5.0-rc.1', 'fix: a')).toBe('1.5.1');
  expect(next('2.0.0-alpha', 'feat: a')).toBe('2.1.0');
  expect(next('1.2.3+build.5', 'fix: a')).toBe('1.2.4');
  expect(next('1.2.3-beta.2+exp.sha.5114f85', 'feat!: a')).toBe('2.0.0');
  // Large numbers are exact.
  expect(next('9007199254740993.0.0', 'feat!: a')).toBe('9007199254740994.0.0');
  // increment and formatVersion on their own.
  expect(formatVersion(increment(parseVersion('1.4.2'), 'minor', { zeroMajor: false }))).toBe('1.5.0');
  expect(formatVersion(increment(parseVersion('0.9.9'), 'major', { zeroMajor: true }))).toBe('0.10.0');
  expect(formatVersion(parseVersion('1.0.0-alpha.1+meta'))).toBe('1.0.0-alpha.1+meta');
  // A current version given through the whole check.
  const checked = checkCommits({ text: 'feat: a\n---\nfix: b', currentVersion: '1.4.2' });
  expect(checked.bump).toEqual({ level: 'minor', next: '1.5.0' });
  expect(checkCommits({ text: 'feat!: a', currentVersion: ' 0.3.1 ', zeroMajor: true }).bump.next).toBe('0.4.0');
});

// SemVer 2.0.0, its Backus-Naur grammar and the official regular expression: the example versions of the specification
// are the grounds for what is a version and what is not.
it('an invalid current version is refused naming the field and a version over 256 characters is refused before matching', () => {
  const valid = [
    '0.0.0',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-0.3.7',
    '1.0.0-x.7.z.92',
    '1.0.0-x-y-z.--',
    '1.0.0-alpha+001',
    '1.0.0+20130313144700',
    '1.0.0-beta+exp.sha.5114f85',
    '1.0.0+21AF26D3----117B344092BD',
  ];
  for (const version of valid) {
    expect(formatVersion(parseVersion(version)), version).toBe(version);
  }
  const invalid = [
    '1',
    '1.2',
    '1.2.3.4',
    'v1.2.3',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-',
    '1.2.3-01',
    '1.2.3-+',
    '1.2.3+',
    '1.2.3-a..b',
    'x.y.z',
    '1.2.3 4',
    '-1.2.3',
    `1.2.3-${cp(0xe9)}`,
  ];
  for (const version of invalid) {
    const error = refusal(() => parseVersion(version));
    expect(error.field, version).toBe('currentVersion');
    expect(error.message, version).toContain('Current version');
    expect(error.message).not.toContain(version === '1' ? 'zzz' : version);
  }
  // Through the whole check: an invalid current version is refused even when no message asks for a release.
  const refused = refusal(() => checkCommits({ text: 'docs: a', currentVersion: 'not a version' }));
  expect(refused.field).toBe('currentVersion');
  expect(refused.message).toContain('Current version');
  expect(refused.message).not.toContain('not a version');
  // An empty current version is no current version.
  expect(checkCommits({ text: 'feat: a', currentVersion: '' }).bump).toEqual({ level: 'minor' });
  expect(checkCommits({ text: 'feat: a', currentVersion: '   ' }).bump).toEqual({ level: 'minor' });

  // 256 characters are read; 257 are refused before the expression runs.
  const longest = `1.0.${'1'.repeat(MAX_VERSION_CHARACTERS - 4)}`;
  expect(longest).toHaveLength(MAX_VERSION_CHARACTERS);
  expect(formatVersion(parseVersion(longest))).toBe(longest);
  const tooLong = `1.0.${'1'.repeat(MAX_VERSION_CHARACTERS - 3)}`;
  expect(tooLong).toHaveLength(MAX_VERSION_CHARACTERS + 1);
  const exec = vi.spyOn(RegExp.prototype, 'exec');
  const tooLongError = refusal(() => parseVersion(tooLong));
  expect(exec).not.toHaveBeenCalled();
  expect(tooLongError.field).toBe('currentVersion');
  expect(tooLongError.message).toContain('Current version');
  expect(tooLongError.message).toContain('256');
  expect(tooLongError.message).not.toContain(tooLong);
  // The same through the whole check.
  expect(refusal(() => checkCommits({ text: 'feat: a', currentVersion: tooLong })).field).toBe('currentVersion');
});

// The draft changelog is a common convention (Angular style headings), not part of the specification.
it('the draft changelog lists breaking changes, features, bug fixes, performance improvements and reverts in that order with entries in pasted order', () => {
  const text = [
    'fix: b',
    'feat: a',
    'perf: p',
    'revert: r',
    msg('feat(api)!: c', 'BREAKING CHANGE: the old call is gone'),
    'fix(ui): d',
    'feat: e',
    'feat(x)!: f',
  ].join('\n---\n');
  const expected = [
    '### Breaking Changes',
    '',
    '- **api:** the old call is gone',
    '- **x:** f',
    '',
    '### Features',
    '',
    '- a',
    '- **api:** c',
    '- e',
    '- **x:** f',
    '',
    '### Bug Fixes',
    '',
    '- b',
    '- **ui:** d',
    '',
    '### Performance Improvements',
    '',
    '- p',
    '',
    '### Reverts',
    '',
    '- r',
  ].join('\n');
  const checked = checkCommits({ text });
  expect(checked.changelog).toBe(expected);
  // The same text through changelogFor on the parsed messages.
  expect(
    changelogFor(
      checked.messages.map((m) => m.parsed),
      { includeHidden: false },
    ),
  ).toBe(expected);
  // Messages that are not valid are left out, and nothing to list gives an empty text.
  expect(checkCommits({ text: 'feat:x\n---\nfix:' }).changelog).toBe('');
  expect(checkCommits({ text: 'docs: only docs' }).changelog).toBe('');
  expect(checkCommits({ text: '' }).changelog).toBe('');
  // A shown text is made safe: a hidden character in a description is written as an escape.
  expect(checkCommits({ text: `fix: a${ZERO_WIDTH_SPACE}b` }).changelog).not.toContain(ZERO_WIDTH_SPACE);
});

it('the other types join the changelog only when asked', () => {
  const text = [
    'docs: d1',
    'style: s1',
    'chore: c1',
    'test: t1',
    'build: b1',
    'ci: i1',
    'refactor: r1',
    'wip(x): w1',
    'feat: f1',
  ].join('\n---\n');
  expect(checkCommits({ text }).changelog).toBe('### Features\n\n- f1');
  expect(checkCommits({ text, includeHidden: false }).changelog).toBe('### Features\n\n- f1');
  const hidden = checkCommits({ text, includeHidden: true }).changelog;
  expect(hidden).toBe(
    [
      '### Features',
      '',
      '- f1',
      '',
      '### Documentation',
      '',
      '- d1',
      '',
      '### Styles',
      '',
      '- s1',
      '',
      '### Miscellaneous Chores',
      '',
      '- c1',
      '',
      '### Tests',
      '',
      '- t1',
      '',
      '### Build System',
      '',
      '- b1',
      '',
      '### Continuous Integration',
      '',
      '- i1',
      '',
      '### Code Refactoring',
      '',
      '- r1',
      '',
      '### Other Changes',
      '',
      '- **wip(x):** w1',
    ].join('\n'),
  );
  // Case does not matter for the type (rule 15).
  expect(checkCommits({ text: 'DOCS: shout', includeHidden: true }).changelog).toBe('### Documentation\n\n- shout');
  // The version bump does not depend on the option.
  expect(checkCommits({ text, includeHidden: true }).bump).toEqual(checkCommits({ text }).bump);
});

const GIT_MESSAGES = [
  'feat: add a parser',
  'fix(api): handle empty input\n\nThe parser returned null.\n\nRefs: #12',
  'docs: correct spelling of CHANGELOG',
];

/** The default output of git log for these messages, newest first, with the four-space indent git writes. */
function gitLogOf(messages: string[]): string {
  return messages
    .map((message, index) => {
      const hash = `${(index + 1).toString(16).padStart(7, 'a')}`;
      const indented = message
        .split('\n')
        .map((l) => (l === '' ? '    ' : `    ${l}`))
        .join('\n');
      return `commit ${hash}\nAuthor: A <a@example.invalid>\nDate:   Mon Jan 5 10:00:00 2026 +0000\n\n${indented}\n`;
    })
    .join('\n');
}

it('messages split by a separator line, one per line or from recorded git log output give the same messages', () => {
  const one = ['feat: a', 'fix(api): b', 'docs: c'];
  expect(texts(one.join('\n---\n'), 'separator')).toEqual(one);
  expect(texts(one.join('\n'), 'lines')).toEqual(one);
  expect(texts(gitLogOf(one), 'gitlog')).toEqual(one);
  // Multi-line messages through the separator and the git log shape, with the line number each starts on.
  expect(texts(GIT_MESSAGES.join('\n---\n'), 'separator')).toEqual(GIT_MESSAGES);
  expect(texts(gitLogOf(GIT_MESSAGES), 'gitlog')).toEqual(GIT_MESSAGES);
  expect(splitMessages(GIT_MESSAGES.join('\n---\n'), 'separator').messages.map((m) => m.line)).toEqual([1, 3, 9]);
  expect(splitMessages(one.join('\n---\n'), 'separator').messages.map((m) => m.firstLine)).toEqual(one);
  // A custom separator, and a hash that is abbreviated or full.
  expect(texts('feat: a\n===\nfix: b', 'separator', '===')).toEqual(['feat: a', 'fix: b']);
  expect(
    texts(
      'commit 1234567\n\n    feat: a\n\ncommit 0123456789abcdef0123456789abcdef01234567 (HEAD -> main)\n\n    fix: b\n',
      'gitlog',
    ),
  ).toEqual(['feat: a', 'fix: b']);

  // The recorded output of git 2.53.0 (fixtures/gitlog): six messages and five lines git wrote itself, newest first.
  const recorded = fixture('gitlog/gitlog.txt');
  expect(recorded).toMatch(/^commit [0-9a-f]{40}$/m);
  const split = splitMessages(recorded, 'gitlog');
  expect(split.messages.map((m) => m.number)).toEqual([1, 7, 8, 9, 10, 11]);
  expect(split.messages.map((m) => m.text)).toEqual([
    'fix: prevent racing of requests\n\nIntroduce a request id and a reference to latest request. Dismiss\nincoming responses other than from latest request.\n\nRemove timeouts which were used to mitigate the racing issue but are\nobsolete now.\n\nReviewed-by: Z\nRefs: #123',
    'chore: update the build image',
    'docs: correct spelling of CHANGELOG',
    'feat!: drop support for Node 6\n\nBREAKING CHANGE: use JavaScript features not available in Node 6.',
    'fix(api): handle empty input\n\nThe parser returned null.\n\nRefs: #12',
    'feat: add a parser',
  ]);
  expect(split.skipped.map((s) => [s.number, s.kind])).toEqual([
    [2, 'amend'],
    [3, 'squash'],
    [4, 'fixup'],
    [5, 'revert'],
    [6, 'merge'],
  ]);
  expect(split.unread).toBe(0);
  // The same six messages pasted with separators check the same way as the log (parts compared, not just text).
  const fromLog = checkCommits({ text: recorded, mode: 'gitlog' });
  const fromSeparator = checkCommits({ text: split.messages.map((m) => m.text).join('\n---\n') });
  expect(fromLog.messages.map((m) => m.parsed)).toEqual(fromSeparator.messages.map((m) => m.parsed));
  expect(fromLog.bump).toEqual({ level: 'major' });
});

it('merge, revert, fixup, squash and amend lines and comment lines are named and skipped, not judged', () => {
  const lines = [
    "Merge branch 'topic'",
    'Merge pull request #1 from a/b',
    'Revert "feat: x"',
    'fixup! feat: x',
    'squash! fix: y',
    'amend! docs: z',
    '# a comment line',
    'feat: kept',
  ];
  const split = splitMessages(lines.join('\n'), 'lines');
  expect(split.skipped.map((s) => [s.number, s.kind, s.line])).toEqual([
    [1, 'merge', 1],
    [2, 'merge', 2],
    [3, 'revert', 3],
    [4, 'fixup', 4],
    [5, 'squash', 5],
    [6, 'amend', 6],
    [7, 'comment', 7],
  ]);
  expect(split.messages.map((m) => [m.number, m.text])).toEqual([[8, 'feat: kept']]);
  const checked = checkCommits({ text: lines.join('\n'), mode: 'lines' });
  expect(checked.messages).toHaveLength(1);
  expect(checked.skipped).toHaveLength(7);
  expect(checked.bump.level).toBe('minor');
  // Case matters, as it does in what git writes: these are judged, and not valid.
  const judged = splitMessages('merge branch x\nReverted: x\nFixup! x\nMerge', 'lines');
  expect(judged.skipped).toEqual([]);
  expect(judged.messages).toHaveLength(4);
  // In separator mode a whole message is skipped by its first line; a # line inside a body is body.
  const separated = splitMessages(
    "Merge branch 'topic'\n\nConflicts:\n  a.txt\n---\nfeat: kept\n\n# not a comment here",
    'separator',
  );
  expect(separated.skipped.map((s) => [s.number, s.kind, s.line])).toEqual([[1, 'merge', 1]]);
  expect(separated.messages.map((m) => [m.number, m.text])).toEqual([[2, 'feat: kept\n\n# not a comment here']]);
  expect(parse('feat: kept\n\n# not a comment here').body).toBe('# not a comment here');
});

it('a separator touching a message splits it and repeated separators make no empty message', () => {
  expect(texts('feat: a\n---\nfix: b', 'separator')).toEqual(['feat: a', 'fix: b']);
  expect(texts('feat: a\r\n---\r\nfix: b', 'separator')).toEqual(['feat: a', 'fix: b']);
  expect(texts('---\nfeat: a\n---\n---\nfix: b\n---', 'separator')).toEqual(['feat: a', 'fix: b']);
  expect(texts('---\n---\n---', 'separator')).toEqual([]);
  expect(texts('feat: a\n\n---\n\n\nfix: b\n\n', 'separator')).toEqual(['feat: a', 'fix: b']);
  expect(texts('feat: a\n  ---  \nfix: b', 'separator')).toEqual(['feat: a', 'fix: b']);
  // A line that only contains the separator is the separator; anything else on the line is not.
  expect(texts('feat: a\n----\nfix: b', 'separator')).toEqual(['feat: a\n----\nfix: b']);
  expect(texts('feat: a ---\nfix: b', 'separator')).toEqual(['feat: a ---\nfix: b']);
  // The first line of the second message is where it starts, counted over every line of the paste.
  const split = splitMessages('feat: a\n\nbody\n---\n---\n\nfix: b', 'separator');
  expect(split.messages.map((m) => [m.number, m.line])).toEqual([
    [1, 1],
    [2, 7],
  ]);
  // Nothing is lost at the edges of a message: its own blank lines between paragraphs stay.
  expect(texts('feat: a\n\nbody one\n\nbody two\n---\nfix: b', 'separator')).toEqual([
    'feat: a\n\nbody one\n\nbody two',
    'fix: b',
  ]);
  // The same in the other two modes: blank lines are no message.
  expect(texts('feat: a\n\n\nfix: b\n', 'lines')).toEqual(['feat: a', 'fix: b']);
  // A message of only white space is none.
  expect(texts('feat: a\n---\n   \n\t\n---\nfix: b', 'separator')).toEqual(['feat: a', 'fix: b']);
});

it('an empty paste gives nothing and a paste of only separators reads no message', () => {
  const nothing = (result: CheckResult): void => {
    expect(result.messages).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.unread).toBe(0);
    expect(result.bump).toEqual({ level: 'none' });
    expect(result.changelog).toBe('');
    expect(result.advice).toEqual([]);
  };
  nothing(checkCommits({ text: '' }));
  nothing(checkCommits({ text: '---' }));
  nothing(checkCommits({ text: '---\n---\n\n---\n' }));
  nothing(checkCommits({ text: '\n\n   \n\t\n' }));
  nothing(checkCommits({ text: '\n\n   \n', mode: 'lines' }));
  nothing(checkCommits({ text: 'no commit line here\n    feat: a\n', mode: 'gitlog' }));
  nothing(checkCommits({ text: 'commit abcdef1\nAuthor: A <a@example.invalid>\n\n', mode: 'gitlog' }));
  // A single message is checked alone.
  const alone = checkCommits({ text: 'fix: a' });
  expect(alone.messages).toHaveLength(1);
  expect(alone.messages[0]?.number).toBe(1);
  expect(alone.bump.level).toBe('patch');
  expect(checkCommits({ text: 'fix: a\n---\n' }).messages).toHaveLength(1);
});

// Convention advice is not part of the specification (the specification allows any type, any length and any case).
it('convention notes never make a valid message invalid and are labelled as not the specification', () => {
  const longHeader = `feat: ${'a'.repeat(80)}`;
  const messages = [
    'wip: Fix the thing.',
    'Feat: Add a thing',
    'feat(a b): spaces in scope',
    longHeader,
    `feat: ${'a'.repeat(110)}`,
    'feat: x\n\nbreaking change: y',
    'feat: x\n\nsome body\nBREAKING CHANGE: glued',
    `${cp(0xe9)}tude: x`,
  ];
  const all = checkCommits({ text: messages.join('\n---\n') });
  const without = checkCommits({ text: messages.join('\n---\n'), advice: false });
  // The verdicts, the bump and the changelog are the same with the notes on or off.
  expect(all.messages).toEqual(without.messages);
  expect(all.bump).toEqual(without.bump);
  expect(all.changelog).toEqual(without.changelog);
  // Turning the convention notes off keeps the notes on how the specification was applied: they say why a line that
  // looks like a breaking change does not count (review B-WR-01).
  expect(without.advice).toEqual(all.advice.filter((a) => a.label === 'specification'));
  expect(without.advice.map((a) => [a.number, a.code])).toEqual([
    [6, 'breaking-case'],
    [7, 'breaking-glued'],
  ]);
  const gluedOnly = 'feat: x\n\nsome body\nBREAKING CHANGE: removes the v1 API';
  const gluedOff = checkCommits({ text: gluedOnly, currentVersion: '1.4.2', advice: false });
  expect(gluedOff.bump).toEqual({ level: 'minor', next: '1.5.0' });
  expect(gluedOff.advice.map((a) => [a.code, a.label])).toEqual([['breaking-glued', 'specification']]);
  // The note says how to make the line count and that other release tooling may read it as breaking (review B-IN-05).
  const gluedNote = gluedOff.advice[0]?.message ?? '';
  expect(gluedNote).toContain('Put a blank line before it to make it a breaking change.');
  expect(gluedNote).toContain('the version they choose may be higher than the one shown here');
  expect(all.messages.every((m) => m.parsed.valid)).toBe(true);
  const codesFor = (number: number): string[] => all.advice.filter((a) => a.number === number).map((a) => a.code);
  expect(codesFor(1).sort()).toEqual(['capital-first', 'trailing-period', 'unknown-type'].sort());
  expect(codesFor(2)).toEqual(['capital-first']);
  expect(codesFor(3)).toEqual(['scope-space']);
  expect(codesFor(4)).toEqual(['header-long']);
  expect(codesFor(5)).toEqual(['header-very-long']);
  expect(codesFor(6)).toEqual(['breaking-case']);
  expect(codesFor(7)).toEqual(['breaking-glued']);
  expect(codesFor(8).sort()).toEqual(['type-non-ascii', 'unknown-type'].sort());
  // Each note is labelled: a convention, or a note on how the specification is applied. None is called a rule.
  for (const note of all.advice) {
    expect(['convention', 'specification']).toContain(note.label);
    expect(note.message.length).toBeGreaterThan(20);
    expect(note.message).not.toMatch(/^Rule \d/);
  }
  const labelOf = (code: string): string | undefined => all.advice.find((a) => a.code === code)?.label;
  for (const code of [
    'capital-first',
    'trailing-period',
    'unknown-type',
    'scope-space',
    'header-long',
    'header-very-long',
    'type-non-ascii',
  ]) {
    expect(labelOf(code), code).toBe('convention');
  }
  for (const code of ['breaking-case', 'breaking-glued']) expect(labelOf(code), code).toBe('specification');
  // adviceFor on its own changes nothing it is given.
  const parsed = parse('Feat: Add.');
  const before = JSON.parse(JSON.stringify(parsed)) as unknown;
  adviceFor(parsed, 'Feat: Add.');
  expect(parsed).toEqual(before);
  // Common types and a clean message have no notes. Known types in any case need none.
  expect(checkCommits({ text: 'feat: add a thing\n---\nFIX(api): handle it' }).advice).toEqual([]);
  // A header of exactly 72 characters needs no note; 73 does.
  expect(adviceFor(parse(`feat: ${'a'.repeat(66)}`), '')).toEqual([]);
  expect(adviceFor(parse(`feat: ${'a'.repeat(67)}`), '').map((a) => a.code)).toEqual(['header-long']);
  // Notes are also made for a message that is not valid, for what could be read.
  expect(
    adviceFor(parse('Update: The thing.'), 'Update: The thing.')
      .map((a) => a.code)
      .sort(),
  ).toEqual(['capital-first', 'trailing-period', 'unknown-type'].sort());
});

it('look-alike characters such as a fullwidth colon or a no-break space after the colon are flagged', () => {
  const codes = (message: string): string[] => adviceFor(parse(message), message).map((a) => a.code);
  // A fullwidth colon is no colon: the message is not valid (rule 1) and the note says why.
  const fullwidth = `feat${FULLWIDTH_COLON} x`;
  expect(parse(fullwidth).valid).toBe(false);
  expect(codes(fullwidth)).toContain('fullwidth-colon');
  // A no-break space after the colon looks like the space and is not (rule 1).
  const nbsp = `feat:${NBSP}x`;
  expect(parse(nbsp).valid).toBe(false);
  expect(codes(nbsp)).toContain('nbsp-after-colon');
  expect(codes(nbsp)).not.toContain('hidden-character');
  // A tab after the colon is named too.
  expect(codes(`feat:${TAB}x`)).toContain('nbsp-after-colon');
  // A type that mixes Latin and Cyrillic letters is valid (a type is a noun in any script) and flagged.
  const mixed = `f${CYRILLIC_E}at: x`;
  expect(parse(mixed).valid).toBe(true);
  expect(codes(mixed)).toContain('mixed-script');
  expect(codes(mixed)).toContain('type-non-ascii');
  // Characters with no shape, or that change direction, are flagged by what they are.
  expect(codes(`feat: a${ZERO_WIDTH_SPACE}b`)).toContain('hidden-character');
  expect(codes(`feat: a${cp(0x202e)}b`)).toContain('hidden-character');
  // A plain ASCII message has none of these.
  expect(codes('feat: x')).toEqual([]);
  // The notes never repeat more than 40 characters of the message.
  const long = `${'z'.repeat(60)}: ${MARKER}`;
  for (const note of adviceFor(parse(long), long)) expect(note.message).not.toContain('z'.repeat(41));
});

// Rules 8, 10 and 12: a breaking change footer is the upper case token, a colon, a space and a description, one blank line
// after the body, and a footer value runs until the next valid token. A line that comes close and does not count is named
// in a note saying why, in the body and inside another footer value (review B-WR-02).
it('a BREAKING CHANGE line that does not make a breaking footer gets a note naming why', () => {
  const notes = (message: string) => adviceFor(parse(message), message).filter((a) => a.label === 'specification');
  const codes = (message: string): string[] => notes(message).map((a) => a.code);
  const noteText = (message: string): string =>
    notes(message).find((a) => a.code === 'breaking-not-footer')?.message ?? '';

  // The colon ends the line, as it does when an editor strips trailing spaces: body text, not a breaking change.
  const bare = 'feat: x\n\nBREAKING CHANGE:\nthe config format changed';
  expect(parse(bare)).toMatchObject({ valid: true, breaking: false, footers: [] });
  expect(codes(bare)).toEqual(['breaking-not-footer']);
  expect(noteText(bare)).toContain('the colon ends the line');
  expect(noteText(bare)).toContain('read as body text');
  // Side by side: one space after that colon makes it a footer whose description is the next line (rule 10).
  const spaced = 'feat: x\n\nBREAKING CHANGE: \nthe config format changed';
  expect(parse(spaced)).toMatchObject({ valid: true, breaking: true, breakingText: 'the config format changed' });
  expect(codes(spaced)).toEqual([]);
  expect(checkCommits({ text: bare, currentVersion: '1.4.2' }).bump).toEqual({ level: 'minor', next: '1.5.0' });
  expect(checkCommits({ text: spaced, currentVersion: '1.4.2' }).bump).toEqual({ level: 'major', next: '2.0.0' });

  // No space after the colon.
  const tight = 'feat: x\n\nBREAKING CHANGE:the config format changed';
  expect(parse(tight)).toMatchObject({ valid: true, breaking: false, footers: [] });
  expect(codes(tight)).toEqual(['breaking-not-footer']);
  expect(noteText(tight)).toContain('the colon is not followed by a space');
  // A plural, written with a space (body text) or with a hyphen (an ordinary footer).
  const plural = 'feat: x\n\nBREAKING CHANGES: plural';
  expect(parse(plural)).toMatchObject({ valid: true, breaking: false, footers: [] });
  expect(codes(plural)).toEqual(['breaking-not-footer']);
  expect(noteText(plural)).toContain('BREAKING CHANGES');
  const hyphenPlural = 'feat: x\n\nBREAKING-CHANGES: plural';
  expect(parse(hyphenPlural).breaking).toBe(false);
  expect(parse(hyphenPlural).footers.map((f) => f.token)).toEqual(['BREAKING-CHANGES']);
  expect(codes(hyphenPlural)).toEqual(['breaking-not-footer']);
  expect(noteText(hyphenPlural)).toContain('read as an ordinary footer');
  // No colon at all.
  const noColon = 'feat: x\n\nBREAKING CHANGE removes the v1 API';
  expect(parse(noColon).breaking).toBe(false);
  expect(codes(noColon)).toEqual(['breaking-not-footer']);
  expect(noteText(noColon)).toContain('no colon');

  // Inside the footer block a line that is not a valid token continues the value before it (rule 10).
  const lowerInFooter = 'feat: x\n\nRefs: #1\nbreaking change: lower in footer area';
  expect(parse(lowerInFooter).footers.map((f) => [f.token, f.value])).toEqual([
    ['Refs', '#1\nbreaking change: lower in footer area'],
  ]);
  expect(parse(lowerInFooter).breaking).toBe(false);
  expect(codes(lowerInFooter)).toEqual(['breaking-case']);
  const inValue = 'feat: x\n\nRefs: #1\nBREAKING CHANGE:\nthe config format changed';
  expect(parse(inValue)).toMatchObject({ valid: true, breaking: false });
  expect(codes(inValue)).toEqual(['breaking-not-footer']);
  expect(noteText(inValue)).toContain('the colon ends the line');
  expect(noteText(inValue)).toContain('part of the value of another footer');

  // A breaking footer written right gets no note; prose that only mentions a breaking change gets none either.
  for (const message of [
    'feat: x\n\nBREAKING CHANGE: y',
    'feat: x\n\nBREAKING-CHANGE: y',
    'feat: x\n\nBreaking changes are listed in the docs.',
    'feat: x\n\nThis is a BREAKING CHANGE: see below',
    'feat: x\n\nBREAKING-CHANGELOG: y',
  ]) {
    expect(codes(message), JSON.stringify(message)).toEqual([]);
  }
  // One note per message, naming each distinct reason once.
  const several = 'feat: x\n\nBREAKING CHANGES: a\nBREAKING CHANGES: b\nBREAKING CHANGE:c';
  expect(codes(several)).toEqual(['breaking-not-footer']);
  expect(noteText(several).split('BREAKING CHANGES').length - 1).toBe(1);
  expect(noteText(several)).toContain('the colon is not followed by a space');
  // The note is kept with the convention notes turned off, and repeats no pasted text.
  const marked = `feat: x\n\nBREAKING CHANGE:${MARKER}`;
  const off = checkCommits({ text: marked, advice: false }).advice;
  expect(off.map((a) => a.code)).toEqual(['breaking-not-footer']);
  expect(off[0]?.message).not.toContain(MARKER);
});

it('a paste over 200,000 characters, a line over 10,000 characters and more than 1,000 messages are refused or counted as the limits say', () => {
  expect(MAX_PASTE_CHARACTERS).toBe(200_000);
  expect(MAX_LINE_CHARACTERS).toBe(10_000);
  expect(MAX_MESSAGES).toBe(1_000);
  // The paste: exactly 200,000 characters are read (40,000 lines of 5), 200,001 are refused.
  const edge = 'a: b\n'.repeat(40_000);
  expect(edge).toHaveLength(200_000);
  const edgeResult = checkCommits({ text: edge, mode: 'lines' });
  expect(edgeResult.messages).toHaveLength(MAX_MESSAGES);
  expect(edgeResult.unread).toBe(40_000 - MAX_MESSAGES);
  const over = refusal(() => checkCommits({ text: `${edge}x`, mode: 'lines' }));
  expect(over.message).toContain('200,001');
  expect(over.message).toContain('200,000');
  expect(over.field).toBe('messages');
  // A line: 10,000 characters are read, 10,001 are refused naming the pasted line.
  const header = 'feat: ';
  const longest = header + 'a'.repeat(MAX_LINE_CHARACTERS - header.length);
  expect(longest).toHaveLength(10_000);
  expect(checkCommits({ text: `fix: x\n---\n${longest}` }).messages).toHaveLength(2);
  const longLine = refusal(() => checkCommits({ text: `fix: x\n\nbody\n---\n${longest}b` }));
  expect(longLine.line).toBe(5);
  expect(longLine.message).toContain('Line 5');
  // The same limit in every mode.
  expect(refusal(() => checkCommits({ text: `${longest}b`, mode: 'lines' })).line).toBe(1);
  expect(refusal(() => checkCommits({ text: `commit abcdef1\n\n    ${longest}b`, mode: 'gitlog' })).line).toBe(3);
  // Messages: 1,000 are read; later ones are counted and not read.
  const thousand = Array.from({ length: MAX_MESSAGES }, (_, i) => `fix: n${i}`);
  for (const [text, mode] of [
    [thousand.join('\n---\n'), 'separator'],
    [thousand.join('\n'), 'lines'],
    [gitLogOf(thousand), 'gitlog'],
  ] as const) {
    const exact = splitMessages(text, mode);
    expect(exact.messages).toHaveLength(MAX_MESSAGES);
    expect(exact.unread).toBe(0);
    const more = splitMessages(
      `${text}\n${mode === 'separator' ? '---\n' : mode === 'gitlog' ? 'commit abcdef1\n\n    ' : ''}fix: extra`,
      mode,
    );
    expect(more.messages).toHaveLength(MAX_MESSAGES);
    expect(more.unread).toBe(1);
  }
  // Lines git wrote count toward the 1,000 (they are numbered with the messages).
  const mixedKinds = splitMessages(['Merge x', ...thousand].join('\n'), 'lines');
  expect(mixedKinds.skipped).toHaveLength(1);
  expect(mixedKinds.messages).toHaveLength(MAX_MESSAGES - 1);
  expect(mixedKinds.unread).toBe(1);
  // Lines in one message: 2,000 are read, 2,001 are refused naming the message.
  expect(MAX_LINES_PER_MESSAGE).toBe(2_000);
  const manyLines = (n: number): string => `feat: x\n${Array.from({ length: n - 1 }, (_, i) => `l${i}`).join('\n')}`;
  expect(checkCommits({ text: manyLines(MAX_LINES_PER_MESSAGE) }).messages).toHaveLength(1);
  const tooMany = refusal(() => checkCommits({ text: `fix: a\n---\n${manyLines(MAX_LINES_PER_MESSAGE + 1)}` }));
  expect(tooMany.message).toContain('Message 2');
  expect(tooMany.message).toContain('2,000');
  // Footers: 100 are read, 101 are refused naming the message.
  expect(MAX_FOOTERS).toBe(100);
  const footers = (n: number): string => `fix: x\n\n${Array.from({ length: n }, (_, i) => `K${i}: v`).join('\n')}`;
  expect(parseMessage(footers(MAX_FOOTERS)).footers).toHaveLength(MAX_FOOTERS);
  const tooManyFooters = refusal(() => checkCommits({ text: `fix: a\n---\n${footers(MAX_FOOTERS + 1)}` }));
  expect(tooManyFooters.message).toContain('Message 2');
  expect(tooManyFooters.message).toContain('100 footers');
  // The separator: empty and over 100 characters are refused naming the field.
  expect(refusal(() => checkCommits({ text: 'fix: a', separator: '   ' })).field).toBe('separator');
  expect(refusal(() => checkCommits({ text: 'fix: a', separator: '-'.repeat(101) })).field).toBe('separator');
  expect(
    checkCommits({ text: 'fix: a\n' + '-'.repeat(100) + '\nfix: b', separator: '-'.repeat(100) }).messages,
  ).toHaveLength(2);
  // The separator is only looked at in separator mode.
  expect(checkCommits({ text: 'fix: a', mode: 'lines', separator: '' }).messages).toHaveLength(1);
});

it('refusals name a message or line number and never repeat pasted text', () => {
  const refusals: ConventionalCommitError[] = [];
  const attempts: Array<() => unknown> = [
    () => checkCommits({ text: `${MARKER}${'x'.repeat(200_000)}` }),
    () => checkCommits({ text: `fix: a\n---\n${MARKER}${'x'.repeat(MAX_LINE_CHARACTERS)}` }),
    () => checkCommits({ text: `fix: a\n${MARKER}${'x'.repeat(MAX_LINE_CHARACTERS)}`, mode: 'lines' }),
    () => checkCommits({ text: `commit abcdef1\n\n    ${MARKER}${'x'.repeat(MAX_LINE_CHARACTERS)}`, mode: 'gitlog' }),
    () => checkCommits({ text: `fix: ${MARKER}\n${Array.from({ length: 2_000 }, () => `${MARKER} line`).join('\n')}` }),
    () =>
      checkCommits({
        text: `fix: x\n\n${Array.from({ length: 101 }, (_, i) => `${MARKER}${i}: ${MARKER}`).join('\n')}`,
      }),
    () => checkCommits({ text: 'fix: a', separator: `${MARKER}${'-'.repeat(100)}` }),
    () => checkCommits({ text: 'fix: a', currentVersion: `${MARKER}.1.2` }),
    () => checkCommits({ text: 'fix: a', currentVersion: `1.2.3-${MARKER}${'a'.repeat(300)}` }),
    () => checkCommits({ text: 'fix: a', separator: '' }),
  ];
  for (const attempt of attempts) refusals.push(refusal(attempt));
  for (const error of refusals) {
    expect(error.message, error.message).not.toContain(MARKER);
    expect(error.message).not.toContain('xxxxx');
    expect(['messages', 'separator', 'currentVersion']).toContain(error.field);
  }
  // A line number or a message number is named where one is to blame.
  expect(refusals[1]?.line).toBe(3);
  expect(refusals[2]?.line).toBe(2);
  expect(refusals[3]?.line).toBe(3);
  expect(refusals[4]?.message).toMatch(/Message 1 has more than 2,000 lines/);
  expect(refusals[5]?.message).toMatch(/Message 1 has more than 100 footers/);
  // A message that is not valid is a result: its failures say what is wrong in plain words and never repeat the message.
  const bad = parse(`${MARKER}: ${MARKER}\nnot a blank line ${MARKER}`);
  expect(bad.valid).toBe(false);
  for (const failure of bad.failures) expect(failure.message).not.toContain(MARKER);
  const badFooter = parse(`feat: ok\n\nBREAKING CHANGE: `);
  expect(badFooter.failures.map((f) => f.rule)).toEqual([12]);
  // Advice shows at most 40 characters of the message, cut by `visible`, so a marker past them is not shown.
  const longType = `${'t'.repeat(45)}${MARKER}: x`;
  for (const note of adviceFor(parse(longType), longType)) expect(note.message).not.toContain(MARKER);
});

// Footer tokens, types and scopes are plain strings and never keys of an object (Map and Object.hasOwn only).
it('footer tokens and types named __proto__, constructor and toString are plain text', () => {
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  for (const name of names) {
    const asType = parse(`${name}(${name}): ${name}`);
    expect(asType.valid, name).toBe(true);
    expect(asType.type, name).toBe(name);
    expect(asType.scope, name).toBe(name);
    const asFooter = parse(`fix: x\n\n${name}: one\n${name} #2`);
    expect(
      asFooter.footers.map((f) => [f.token, f.value]),
      name,
    ).toEqual([
      [name, 'one'],
      [name, '2'],
    ]);
    expect(asFooter.breaking).toBe(false);
  }
  const text = names.map((name) => `${name}: ${name}`).join('\n---\n');
  const checked = checkCommits({ text, includeHidden: true, currentVersion: '1.0.0' });
  expect(checked.messages).toHaveLength(5);
  expect(checked.bump).toEqual({ level: 'none' });
  expect(checked.changelog).toBe(
    ['### Other Changes', '', ...names.map((name) => `- **${name}:** ${name}`)].join('\n'),
  );
  // A type named like the types that matter changes nothing, and nothing leaked onto the shared object prototype.
  expect(Object.keys(Object.prototype)).toEqual([]);
  expect(({} as Record<string, unknown>)['type']).toBeUndefined();
  expect(({} as Record<string, unknown>)['token']).toBeUndefined();
  // Types and footer values named like object methods leave the results ordinary objects.
  const result = checkCommits({ text: `__proto__: x\n---\nconstructor: y` });
  expect(Object.getPrototypeOf(result.bump)).toBe(Object.prototype);
  expect(result.bump.level).toBe('none');
});

it('every parser stays linear on hostile input', () => {
  const median = (values: number[]): number => [...values].sort((x, y) => x - y)[1] as number;
  const shapes: Array<[string, (n: number) => string]> = [
    ['opening parentheses', (n) => `feat${'('.repeat(n)}`],
    ['exclamation marks', (n) => `feat${'!'.repeat(n)}: x`],
    ['colons', (n) => `feat${':'.repeat(n)} x`],
    ['one long word', (n) => 'a'.repeat(n)],
    ['a long description', (n) => `feat: ${'word '.repeat(Math.floor(n / 5))}`],
    ['a repeated breaking footer on one line', (n) => `feat: x\n\n${'BREAKING CHANGE: '.repeat(Math.floor(n / 17))}`],
    ['repeated blank lines', (n) => `feat: x${'\n\n'.repeat(Math.floor(n / 2))}`],
    ['paragraphs', (n) => `feat: x\n\n${'p\n\n'.repeat(Math.floor(n / 3))}`],
    ['a long footer value over many lines', (n) => `feat: x\n\nRefs: a\n${'line\n'.repeat(Math.floor(n / 5))}`],
    ['footer-shaped body lines', (n) => `feat: x\n\nbody\n${'Note: a\n'.repeat(Math.floor(n / 8))}`],
    ['long scopes', (n) => `feat(${'s'.repeat(n)}): x`],
    ['spaces', (n) => ' '.repeat(n) + '!'],
  ];
  const runs: Array<[string, (text: string) => unknown]> = [
    ['parse', (text) => parseMessage(text)],
    ['advice', (text) => adviceFor(parseMessage(text), text)],
  ];
  for (const [fn, run] of runs) {
    for (const [name, make] of shapes) {
      // The doubling rule (over 6 fails) and, because it does not catch quadratic growth by itself, an input four times as
      // long against a limit of 12; each is the median of three measurements.
      const doublings: number[] = [];
      const fourfold: number[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const first = scalingRatio(run, make, 5000);
        const second = scalingRatio(run, make, 10_000);
        doublings.push(first);
        fourfold.push(first * second);
      }
      expect(Number.isFinite(median(doublings)), `${fn} ${name}`).toBe(true);
      expect(median(doublings), `${fn} ${name}`).toBeLessThanOrEqual(MAX_SCALING_RATIO);
      expect(median(fourfold), `${fn} ${name}`).toBeLessThanOrEqual(12);
    }
  }
  // The splitters, the changelog and the version parser.
  const splitShapes: Array<[string, (n: number) => string]> = [
    ['separator lines', (n) => '---\n'.repeat(Math.floor(n / 4))],
    ['many short messages', (n) => 'a: b\n---\n'.repeat(Math.floor(n / 9))],
    ['one message of short lines', (n) => 'feat: x\n' + 'l\n'.repeat(Math.min(1990, Math.floor(n / 20)))],
    ['git log blocks', (n) => 'commit abcdef1\n\n    fix: a\n'.repeat(Math.floor(n / 26))],
    ['blank lines', (n) => '\n'.repeat(n)],
  ];
  for (const [name, make] of splitShapes) {
    for (const mode of ['separator', 'lines', 'gitlog'] as const) {
      const run = (text: string): unknown => checkCommits({ text, mode, includeHidden: true, currentVersion: '1.2.3' });
      const doublings: number[] = [];
      const fourfold: number[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const first = scalingRatio(run, make, 5000);
        const second = scalingRatio(run, make, 10_000);
        doublings.push(first);
        fourfold.push(first * second);
      }
      expect(median(doublings), `check ${mode} ${name}`).toBeLessThanOrEqual(MAX_SCALING_RATIO);
      expect(median(fourfold), `check ${mode} ${name}`).toBeLessThanOrEqual(12);
    }
  }
  // A refusal at a limit costs nothing like reading what was refused.
  expect(
    scalingRatio(
      (t) => checkCommits({ text: t, mode: 'lines' }),
      (n) => 'a'.repeat(n),
      100_001,
    ),
  ).toBeLessThanOrEqual(MAX_SCALING_RATIO);
  expect(
    scalingRatio(
      (t) => parseVersion(t),
      (n) => `1.0.${'1'.repeat(Math.min(n, 250))}x`,
      100,
    ),
  ).toBeLessThanOrEqual(MAX_SCALING_RATIO);
}, 300_000);

it('checking the same messages twice gives the same rows, bump and changelog', () => {
  const text = [
    ...EXAMPLES.map((e) => e.message),
    'Feat: Add.',
    'feat:x',
    'Merge branch x',
    msg('wip: y', 'breaking change: z'),
  ].join('\n---\n');
  const options = { text, currentVersion: '0.9.9', zeroMajor: true, includeHidden: true } as const;
  const first = checkCommits(options);
  const second = checkCommits(options);
  expect(second).toEqual(first);
  expect(first.bump).toEqual({ level: 'major', next: '0.10.0' });
  // Each answer is fresh: changing one does not change the next.
  first.messages.length = 0;
  first.skipped.length = 0;
  first.advice.push({ number: 0, code: 'x', label: 'convention', message: 'x' });
  const third = checkCommits(options);
  expect(third).toEqual(second);
  expect(third.messages.length).toBeGreaterThan(0);
  // The order of the rows is the order of the paste, with their numbers.
  expect(third.messages.map((m) => m.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11]);
  expect(third.skipped.map((s) => s.number)).toEqual([10]);
  // The package prints nothing.
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  checkCommits(options);
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
