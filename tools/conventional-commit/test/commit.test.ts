import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkCommits, parseMessage } from '../src/index';

// Sources of the expected values in this file:
//  - Conventional Commits 1.0.0, git blob 4fa8464d66f7659c3565a2a84ce0577839552046 (CC BY 3.0, see fixtures/UPSTREAM.md):
//    the seven examples of its section "Examples" (re-typed in fixtures/spec-examples.json) and the 16 numbered rules of
//    its section "Specification". A rule is quoted by its number and a fragment of its words.
//  - Semantic Versioning 2.0.0: "MAJOR version when you make incompatible API changes", and the specification's own
//    summary: a breaking change correlates with MAJOR, a feat with MINOR and a fix with PATCH.

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

function fixture(path: string): string {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
}

const EXAMPLES = (JSON.parse(fixture('spec-examples.json')) as { examples: SpecExample[] }).examples;

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
