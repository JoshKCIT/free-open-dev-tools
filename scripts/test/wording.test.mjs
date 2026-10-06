import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/catalog.mjs';
import { EVAL_PAGES } from '../check-csp.mjs';

/**
 * HARD-08 (D-221, D-223 i): every file that says something about the page policy says the same true thing, and none
 * keeps a sentence that was true only before the policy was written into each page.
 *
 * `.planning/PROJECT.md` is git-ignored, so it is not read here (CI never has it); the planning record is checked by a
 * command the plan runs by hand. Everything else that mentions the policy is listed below with the words it must hold.
 *
 * The stale phrases are spelled out on purpose: they are the sentences the files held before the policy existed, and
 * the point of the test is that none of them comes back. Text is flattened first (comment stars, slashes and line
 * breaks become one space), so a phrase wrapped across lines or comment lines is still found.
 */

const EM_DASH = String.fromCodePoint(0x2014);

/** Sentences the project files used to say. A listed file holding any of them is stale. */
export const STALE_PHRASES = [
  'as of the v1.1 close no page carries one',
  'still states the intent as fact',
  'The intent is a content security policy',
  'applied per page rather than at the header level',
  'The page-level content security policy is applied where it can be',
  'a site with no page-level content security policy',
  'there is no content security policy here',
  'not set today only because GitHub Pages cannot',
  'GitHub Pages sends no policy at all',
  'there is no content security policy stopping',
  // Claims wider than the policy: the page loads its own scripts and styles, the theme script and the Mermaid frame
  // scripts are inline (hashed), a page can still navigate away, and not every code-generation page is a validator.
  'forbids the page from requesting anything.',
  'forbids a page from requesting anything and',
  'whatever its code tries',
  'No page gets inline scripts',
  'generating code for a validator,',
];

/**
 * The limits of a policy in markup: no framing protection, no violation reports, no sandboxing the way a header can,
 * no stop on navigation, WebRTC and connection hints not governed in every browser, extensions outside it.
 */
const LIMIT_WORDS = ['framing', 'report violations', 'sandbox', 'navigat', 'WebRTC', 'extension'];

/** The words that make the account true: each page has its own policy, and the limits of a policy in markup. */
const TRUTH_WORDS = ['its own', ...LIMIT_WORDS];

/** Collapses line breaks, comment stars and comment slashes so a wrapped phrase is one run of text. */
export function flat(text) {
  return text
    .replace(/\s*\n\s*(?:\/\*\*\s*|\*\/\s*|\*\s+|\/\/\s*)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The required words that `text` does not hold. */
export function missingWords(text, words) {
  const body = flat(text);
  return words.filter((word) => !body.includes(word));
}

/** The stale phrases that `text` still holds. */
export function stalePhrasesIn(text, phrases = STALE_PHRASES) {
  const body = flat(text);
  return phrases.filter((phrase) => body.includes(phrase));
}

/** The text between two markers (the start marker included), or null when either marker is missing. */
export function between(text, start, end) {
  const from = text.indexOf(start);
  if (from < 0) return null;
  const to = end === undefined ? text.length : text.indexOf(end, from + start.length);
  if (to < 0) return null;
  return text.slice(from, to);
}

/**
 * The files that state the page policy. `required` words must be present; `sections` are the changed parts, checked
 * for em dashes (older text in the same files may hold some, so only these parts are held to the rule); `limits` is the
 * passage that lists what the policy cannot do, which must hold every limit word itself (a word used elsewhere in the
 * file does not count).
 */
export const FILES = [
  {
    path: 'apps/web/src/pages/Privacy.tsx',
    required: [...TRUTH_WORDS, 'Each page has its own content security policy', 'a short fixed list of pages'],
    sections: [
      ['<h2>Each page has its own content security policy</h2>', '<h2>Tools that would need the network</h2>'],
    ],
    order: ['What it blocks', 'What it cannot do'],
    limits: ['<p>What it cannot do', 'The policy sits behind three checks'],
  },
  {
    path: '.claude/CLAUDE.md',
    required: [...TRUTH_WORDS, 'weak copyleft (MPL and similar) needs an explicit owner OK'],
    sections: [
      ['- **Licensing**', '- **Hosting**'],
      ['- **Hosting**', '- **Provenance**'],
    ],
    limits: ['markup cannot give framing protection', '- **Provenance**'],
  },
  {
    path: 'docs/ARCHITECTURE.md',
    required: [
      ...TRUTH_WORDS,
      'needs',
      'meta.json',
      'csp-acks.json',
      'check-csp.mjs',
      'tree',
      'countdown',
      'runLimit',
      'refreshAfterMs',
      'inlineFiles',
      'fresh document',
      'Content security policy per page',
      "no `'unsafe-inline'` for scripts",
      ...EVAL_PAGES,
    ],
    sections: [['### Content security policy per page', '## The privacy harness']],
    order: ['What it blocks', 'What it cannot do'],
    limits: ['**What it cannot do.**', '**If the site moves'],
  },
  {
    path: 'docs/DEPLOYMENT.md',
    required: ['its own', 'framing', 'frame-ancestors', 'per-route', 'check-csp.mjs --live'],
    sections: [
      ['GitHub Pages was chosen', '## One-time setup'],
      ["- Any of the catalog's tool pages fails", '- Any live page does not open its head'],
      ['- Any live page does not open its head', '## Rollback'],
      ['On a host that supports custom headers', '## Operational notes'],
    ],
  },
  {
    path: 'SECURITY.md',
    required: TRUTH_WORDS,
    sections: [['**Each page carries its own content security policy.**', '**Cryptography is not invented here.**']],
    limits: ['## What this project cannot protect you from', '- Your own clipboard'],
  },
  {
    path: 'CONTRIBUTING.md',
    required: [
      'its own',
      'needs',
      'meta.json',
      'content security policy',
      'build fails when',
      'requesting anything outside the site',
    ],
    sections: [['### 6. It must declare what its page needs', '## Adding a tool, step by step']],
  },
  {
    path: 'README.md',
    required: [...TRUTH_WORDS, 'requesting anything outside the site'],
    sections: [['- **Each page has its own content security policy.**', '[`e2e/privacy.spec.ts`]']],
    limits: ['- **Each page has its own content security policy.**', '[`e2e/privacy.spec.ts`]'],
  },
  {
    path: 'apps/web/src/components/CssPreview.tsx',
    required: ["page's own content security policy", 'second layer'],
    sections: [['The preview stage', 'export default function CssPreview']],
  },
  {
    path: 'apps/web/src/lib/css-preview-guard.ts',
    required: ["page's own content security policy", 'second layer'],
    sections: [['A second, independent fence', 'export function previewHazard']],
  },
];

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

describe('the page policy is described truthfully in every listed file', () => {
  for (const file of FILES) {
    describe(file.path, () => {
      const text = read(file.path);

      it('holds every required word', () => {
        expect(missingWords(text, file.required)).toEqual([]);
      });

      it('holds none of the stale phrases', () => {
        expect(stalePhrasesIn(text)).toEqual([]);
      });

      it('holds no em dash in the sections that state the policy', () => {
        for (const [start, end] of file.sections) {
          const part = between(text, start, end);
          expect(part, `section starting ${start} was not found`).not.toBeNull();
          expect(part.includes(EM_DASH)).toBe(false);
        }
      });

      if (file.limits) {
        it('lists every limit of the policy in the passage that states its limits', () => {
          const part = between(text, ...file.limits);
          expect(part, `passage starting ${file.limits[0]} was not found`).not.toBeNull();
          expect(missingWords(part, LIMIT_WORDS)).toEqual([]);
        });
      }

      if (file.order) {
        it('says what the policy blocks before what it cannot do', () => {
          const body = flat(text);
          const [first, second] = file.order.map((marker) => body.indexOf(marker));
          expect(first, `marker ${file.order[0]} not found`).toBeGreaterThanOrEqual(0);
          expect(second, `marker ${file.order[1]} not found`).toBeGreaterThanOrEqual(0);
          expect(first).toBeLessThan(second);
        });
      }
    });
  }
});

/** The names of the steps and jobs of a workflow file, read line by line (no YAML library is needed for names). */
export function stepNames(workflowText) {
  return workflowText
    .split(/\r?\n/)
    .map((line) => /^\s*(?:-\s+)?name:\s*(.+?)\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

const COUNTED_PAGES = /\d+\s+tool pages/;
const LIVE_ADDRESS = 'https://joshkcit.github.io/free-open-dev-tools';

describe('the deploy workflow checks the live site without a catalog size in any step name', () => {
  const text = read('.github/workflows/deploy.yml');

  it('has no step name holding a number of tool pages', () => {
    expect(stepNames(text).filter((name) => COUNTED_PAGES.test(name))).toEqual([]);
  });

  it('checks every live page policy after a deploy', () => {
    expect(text).toContain(`node scripts/check-csp.mjs --live ${LIVE_ADDRESS}/`);
  });

  it('runs the navigation and policy specs against the live site', () => {
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((entry) => entry.includes('e2e/navigation.spec.ts e2e/csp.spec.ts'));
    expect(at, 'no step runs both specs').toBeGreaterThan(-1);
    expect(lines[at]).toContain('--project=chromium');
    expect(lines.slice(at, at + 4).join('\n')).toContain(`E2E_BASE_URL: ${LIVE_ADDRESS}`);
  });

  it('checks the live site against the commit that was deployed, not the tip of main', () => {
    const ref = 'ref: ${{ inputs.commit || github.event.workflow_run.head_sha || github.sha }}';
    const jobText = (name) => {
      const start = text.search(new RegExp(`^  ${name}:`, 'm'));
      expect(start, `no ${name} job`).toBeGreaterThan(-1);
      const rest = text.slice(start + 1);
      const next = rest.search(/^ {2}[A-Za-z][\w-]*:/m);
      return next < 0 ? rest : rest.slice(0, next);
    };
    const firstCheckout = (job) => {
      const at = job.indexOf('uses: actions/checkout@');
      expect(at, 'the job checks nothing out').toBeGreaterThan(-1);
      const end = job.indexOf('- ', at);
      return job.slice(at, end < 0 ? job.length : end);
    };
    expect(firstCheckout(jobText('build'))).toContain(ref);
    expect(firstCheckout(jobText('verify'))).toContain(ref);
  });

  it('finds a counted step name when one is written', () => {
    const names = stepNames('steps:\n  - name: The 211 tool pages load\n    run: true');
    expect(names.filter((name) => COUNTED_PAGES.test(name))).toEqual(['The 211 tool pages load']);
  });
});

/** Every copy of the canonical CSS safety writer, which says why the live preview needs it. */
const CSS_SAFE_COPIES = readdirSync(join(ROOT, 'tools'))
  .map((id) => `tools/${id}/src/css-safe.ts`)
  .filter((path) => existsSync(join(ROOT, path)));

describe('every copy of the CSS safety writer describes the page policy truthfully', () => {
  it('finds the copies and they are byte for byte the same', () => {
    expect(CSS_SAFE_COPIES.length).toBeGreaterThan(0);
    expect(new Set(CSS_SAFE_COPIES.map(read)).size).toBe(1);
  });

  it('names the page policy as a second layer and holds none of the stale phrases', () => {
    const text = read(CSS_SAFE_COPIES[0]);
    expect(missingWords(text, ["page's own content security policy", 'second layer'])).toEqual([]);
    expect(stalePhrasesIn(text)).toEqual([]);
  });
});

describe('the list of checked files', () => {
  it('covers at least eight files and names each only once', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(FILES.map((file) => file.path)).size).toBe(FILES.length);
  });
});

describe('the wording helpers can fail', () => {
  it('reports a required word that a text lacks', () => {
    expect(missingWords('each page carries its own policy', TRUTH_WORDS)).toEqual([
      'framing',
      'report violations',
      'sandbox',
      'navigat',
      'WebRTC',
      'extension',
    ]);
  });

  it('every file that states the limits names the passage that lists them', () => {
    const stating = FILES.filter((file) => LIMIT_WORDS.every((word) => file.required.includes(word)));
    expect(stating.map((file) => file.path).sort()).toEqual(
      [
        '.claude/CLAUDE.md',
        'README.md',
        'SECURITY.md',
        'apps/web/src/pages/Privacy.tsx',
        'docs/ARCHITECTURE.md',
      ].sort(),
    );
    for (const file of stating) expect(file.limits, file.path).toBeDefined();
  });

  it('reports a stale phrase even when a comment wraps it across lines', () => {
    const wrapped = '/**\n * a site with no page-level\n * content security policy outside that frame\n */';
    expect(stalePhrasesIn(wrapped)).toEqual(['a site with no page-level content security policy']);
  });

  it('finds nothing stale in a true sentence', () => {
    expect(stalePhrasesIn('Each page carries its own policy in its markup.')).toEqual([]);
  });

  it('returns null for a section whose marker is missing', () => {
    expect(between('abc', 'x', 'y')).toBeNull();
    expect(between('abc xyz', 'abc', 'xyz')).toBe('abc ');
  });
});
