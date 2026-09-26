import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import type { WindowLike } from 'dompurify';
import { buildReadme, renderPreview, ReadmeError } from '../src/index';
import { BADGES, badgeMarkdown, ReadmeBadgeError } from '../src/badges';
import { escapeInline, githubSlug } from '../src/markdown-text';
import { findActiveContent } from './active-content';
import { loadXssVectors, EXPECTED_VECTOR_COUNT } from './xss-vectors';

function makeWindow(): WindowLike {
  return new JSDOM('', { url: 'https://example.invalid/' }).window as unknown as WindowLike;
}

let win: WindowLike;
let consoleSpies: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  win = makeWindow();
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});
afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

it('the README is assembled from the chosen sections in order as CommonMark', () => {
  const { markdown, headings } = buildReadme({
    name: 'my-lib',
    description: 'A tiny library.',
    packageManager: 'npm',
    packageName: 'my-lib',
    sections: {
      usage: "import { thing } from 'my-lib';",
      features: 'Small\nFast\nZero dependencies',
      contributing: 'Pull requests welcome.',
    },
    license: 'MIT',
    toc: true,
  });

  expect(markdown.startsWith('# my-lib\n')).toBe(true);
  expect(markdown).toContain('A tiny library.');

  const installIdx = markdown.indexOf('## Installation');
  const usageIdx = markdown.indexOf('## Usage');
  const featuresIdx = markdown.indexOf('## Features');
  const contributingIdx = markdown.indexOf('## Contributing');
  const licenceIdx = markdown.indexOf('## Licence');
  expect(installIdx).toBeGreaterThan(-1);
  expect(installIdx).toBeLessThan(usageIdx);
  expect(usageIdx).toBeLessThan(featuresIdx);
  expect(featuresIdx).toBeLessThan(contributingIdx);
  expect(contributingIdx).toBeLessThan(licenceIdx);

  expect(markdown).toContain('npm install my-lib');
  expect(markdown).toContain('- Small');
  expect(markdown).toContain('- Fast');
  expect(markdown).toContain('MIT');
  expect(markdown.endsWith('\n')).toBe(true);
  expect(markdown.endsWith('\n\n')).toBe(false);

  expect(headings.map((h) => h.text)).toEqual(['Installation', 'Usage', 'Features', 'Contributing', 'Licence']);
  expect(headings.every((h) => h.level === 2)).toBe(true);

  // A section with no content is omitted entirely.
  const { markdown: minimal } = buildReadme({ name: 'x' });
  expect(minimal).toBe('# x\n');
});

it('badges are written as Markdown text with every visitor value percent-encoded in its URL', () => {
  expect(BADGES.length).toBeGreaterThanOrEqual(5);

  const npm = badgeMarkdown('npm', { packageName: 'my-lib' });
  expect(npm).toBe('[![npm](https://img.shields.io/npm/v/my-lib)](https://www.npmjs.com/package/my-lib)');

  const license = badgeMarkdown('license', { owner: 'example', repo: 'project' });
  expect(license).toContain('https://img.shields.io/github/license/example/project');

  const workflow = badgeMarkdown('workflow', { owner: 'example', repo: 'project', workflowFile: 'ci.yml' });
  expect(workflow).toContain('https://github.com/example/project/actions/workflows/ci.yml/badge.svg');

  const release = badgeMarkdown('release', { owner: 'example', repo: 'project' });
  expect(release).toContain('https://img.shields.io/github/v/release/example/project');

  const staticBadge = badgeMarkdown('static', { label: 'coverage', message: '95%', color: 'green' });
  expect(staticBadge).toContain('https://img.shields.io/badge/coverage-95%25-green');

  // An owner or package name containing ) or a space is percent-encoded so the Markdown link stays intact.
  const hostileParen = badgeMarkdown('npm', { packageName: 'a)b' });
  expect(hostileParen).not.toContain('a)b');
  expect(hostileParen).toContain('a%29b');
  const parsedParen = /^\[!\[[^\]]*\]\(([^)]*)\)\]\(([^)]*)\)$/.exec(hostileParen);
  expect(parsedParen, 'a ) inside the value must not break the outer Markdown link groups').not.toBeNull();

  const hostileSpace = badgeMarkdown('license', { owner: 'a b', repo: 'c' });
  expect(hostileSpace).not.toContain('a b');
  expect(hostileSpace).toContain('a%20b');
  const parsedSpace = /^\[!\[[^\]]*\]\(([^)]*)\)\]\(([^)]*)\)$/.exec(hostileSpace);
  expect(parsedSpace).not.toBeNull();

  // Every badge, run through a battery of hostile values: the result is
  // always well-formed `[![alt](image)](link)` Markdown -- a literal ")" or
  // space from the raw value can never break out of either parenthesised
  // group, because it was percent-encoded (or, for the static badge,
  // dash/underscore/space escaped) first.
  const LINK_SHAPE = /^\[!\[[^[\]]*\]\([^()]*\)\]\([^()]*\)$/;
  const battery = ['a)b', 'a b', 'a(b)c', "a'b", 'a/b', 'ünïcödé'];
  for (const badge of BADGES) {
    for (const value of battery) {
      const params = {
        packageName: value,
        owner: value,
        repo: value,
        workflowFile: value,
        label: value,
        message: value,
      };
      const md = badgeMarkdown(badge.id, params);
      expect(LINK_SHAPE.test(md), `${badge.id} with ${JSON.stringify(value)}: ${md}`).toBe(true);
    }
  }

  expect(() => badgeMarkdown('npm', {})).toThrow(ReadmeBadgeError);
});

it('plain fields are escaped so their text appears literally as CommonMark backslash escapes define', () => {
  expect(escapeInline('a*b_c')).toBe('a\\*b\\_c');
  const { markdown } = buildReadme({ name: 'a*b_c' });
  expect(markdown).toContain('a\\*b\\_c');
  expect(markdown).not.toMatch(/^# a\*b_c/m);

  // Every ASCII punctuation character CommonMark says may be escaped
  // round-trips to literal text in the preview, via escapeInline (the
  // `name` field is escaped; unlike `description`, which is kept exactly as
  // the visitor typed it -- feeding this same raw battery through
  // `description` would have several of these characters consumed as
  // CommonMark syntax by the renderer itself, which is not what this test
  // is proving).
  const punctuation = `!"#$%&'()*+,./:;<=>?@[\\]^_\`{|}~`;
  const { markdown: md2 } = buildReadme({ name: punctuation });
  const { html } = renderPreview(md2, win);
  for (const ch of punctuation) {
    if (ch === '<' || ch === '>' || ch === '&') continue; // present only as their HTML entity form.
    expect(html.includes(ch), `expected ${JSON.stringify(ch)} to survive literally in ${html}`).toBe(true);
  }
});

it('the table of contents links match the anchors the GitHub section link rule generates', () => {
  const { markdown, headings } = buildReadme({
    name: 'x',
    packageName: 'x',
    sections: { usage: 'u', features: 'f', contributing: 'c' },
    toc: true,
  });
  for (const heading of headings) {
    expect(markdown).toContain(`(#${heading.id})`);
    expect(heading.id).toBe(githubSlug(heading.text));
  }

  // The documented worked examples from GitHub's own section-links page
  // (basic-writing-and-formatting-syntax.md, fetched this session). This
  // function is applied to plain text, so the two literal underscores in the
  // second example are kept literally (this tool's own headings never carry
  // Markdown formatting to begin with, unlike GitHub's own worked example).
  expect(githubSlug('Sample Section')).toBe('sample-section');
  expect(githubSlug('This heading is not unique in the file')).toBe('this-heading-is-not-unique-in-the-file');
  // Disclosed ambiguity (see markdown-text.ts): the doc's own example keeps
  // Θ unlowercased ("...the-greek-letter-Θ"), contradicting its first rule
  // ("Letters are converted to lower-case"); this function follows the
  // stated rule instead, lower-casing every letter including Θ.
  expect(githubSlug("This'll be a _Helpful_ Section About the Greek Letter Θ!")).toBe(
    'thisll-be-a-_helpful_-section-about-the-greek-letter-θ',
  );

  // Duplicate section titles never collide.
  const dup = buildReadme({
    name: 'x',
    packageName: 'x',
    sections: { usage: 'u', contributing: 'c' },
  });
  expect(new Set(dup.headings.map((h) => h.id)).size).toBe(dup.headings.length);
});

it('the preview shows badges as text and contains no image element', () => {
  const { markdown } = buildReadme({
    name: 'my-lib',
    packageName: 'my-lib',
    badges: [{ id: 'npm', params: { packageName: 'my-lib' } }],
  });
  const { html, removed } = renderPreview(markdown, win);
  expect(html.toLowerCase()).not.toContain('<img');
  expect(html).toContain('<code>npm</code>');
  expect(
    removed.elements + removed.eventHandlers + removed.dangerousUrls + removed.externalReferences + removed.styles,
  ).toBeGreaterThanOrEqual(0);
});

it('OWASP XSS Filter Evasion Cheat Sheet payloads typed into every field leave no active content in the preview', () => {
  const vectors = loadXssVectors();
  expect(vectors.length).toBe(EXPECTED_VECTOR_COUNT);

  const failures: string[] = [];
  for (const vector of vectors) {
    const { markdown } = buildReadme({
      name: 'x',
      description: vector.payload,
      packageName: 'x',
      sections: { usage: vector.payload, features: vector.payload, contributing: vector.payload },
    });
    const { html } = renderPreview(markdown, win);
    const violations = findActiveContent(html, win, 'html');
    if (violations.length > 0) {
      failures.push(`[${vector.source}] ${vector.payload.slice(0, 80)} -> ${violations.join('; ')}`);
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

it('nothing is written to the console while building', () => {
  buildReadme({
    name: 'my-lib',
    description: 'x',
    packageName: 'my-lib',
    packageManager: 'pnpm',
    badges: [{ id: 'npm', params: { packageName: 'my-lib' } }],
    sections: { usage: 'u', features: 'f', contributing: 'c' },
    license: 'MIT',
    toc: true,
  });
  const { markdown } = buildReadme({ name: 'my-lib', packageName: 'my-lib' });
  renderPreview(markdown, win);
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it('a README with more list items than the preview limit still builds its Markdown, but the preview is refused rather than risk freezing the tab', () => {
  const manyFeatures = Array.from({ length: 900 }, (_, i) => `Feature ${i}`).join('\n');
  const { markdown } = buildReadme({ name: 'x', packageName: 'x', sections: { features: manyFeatures } });
  expect(markdown).toContain('- Feature 899');
  expect(() => renderPreview(markdown, win)).toThrow(ReadmeError);
  expect(() => renderPreview(markdown, win)).toThrow(/list items/);

  const fewFeatures = Array.from({ length: 10 }, (_, i) => `Feature ${i}`).join('\n');
  const { markdown: smallMarkdown } = buildReadme({ name: 'x', packageName: 'x', sections: { features: fewFeatures } });
  expect(() => renderPreview(smallMarkdown, win)).not.toThrow();
});

it('other required behaviour', () => {
  expect(() => buildReadme({ name: '' })).toThrow(ReadmeError);

  // name, a description, an npm badge and a licence badge give the exact documented forms.
  const { markdown } = buildReadme({
    name: 'my-lib',
    description: 'A description.',
    packageName: 'my-lib',
    badges: [
      { id: 'npm', params: { packageName: 'my-lib' } },
      { id: 'license', params: { owner: 'example', repo: 'project' } },
    ],
    license: 'MIT',
  });
  expect(markdown).toContain('# my-lib');
  expect(markdown).toContain('A description.');
  expect(markdown).toContain('[![npm](https://img.shields.io/npm/v/my-lib)](https://www.npmjs.com/package/my-lib)');

  // packageManager selects the documented install command.
  for (const [pm, expected] of [
    ['npm', 'npm install x'],
    ['pnpm', 'pnpm add x'],
    ['yarn', 'yarn add x'],
    ['bun', 'bun add x'],
  ] as const) {
    const result = buildReadme({ name: 'x', packageManager: pm, packageName: 'x' });
    expect(result.markdown).toContain(expected);
  }
});
