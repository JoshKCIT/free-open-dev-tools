import meta from './meta.json';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import type { WindowLike } from 'dompurify';
import { sanitiseToFragment, serialiseFragment, type RemovedSummary } from './sanitise';
import { escapeInline, githubSlug, linkDestination } from './markdown-text';
import { BADGES, badgeMarkdown, findBadge, ReadmeBadgeError, type BadgeId, type BadgeParams } from './badges';

export { meta, BADGES, badgeMarkdown, escapeInline, githubSlug };
export type { BadgeId, BadgeParams };

export class ReadmeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadmeError';
  }
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Each package manager's own documented add-a-dependency command
 * (docs.npmjs.com/cli/commands/npm-install, pnpm.io/cli/add,
 * yarnpkg.com/cli/add, bun.sh/docs/cli/add).
 */
const INSTALL_COMMAND: Record<PackageManager, (name: string) => string> = {
  npm: (name) => `npm install ${name}`,
  pnpm: (name) => `pnpm add ${name}`,
  yarn: (name) => `yarn add ${name}`,
  bun: (name) => `bun add ${name}`,
};

export interface ReadmeSectionsInput {
  /** Extra prose appended under the auto-generated install command. */
  installation?: string;
  usage?: string;
  /** One feature per line; rendered as a Markdown list. */
  features?: string;
  contributing?: string;
}

export interface BuildReadmeOptions {
  name: string;
  description?: string;
  badges?: { id: BadgeId; params: BadgeParams }[];
  toc?: boolean;
  packageManager?: PackageManager;
  packageName?: string;
  sections?: ReadmeSectionsInput;
  /** An SPDX licence identifier (e.g. "MIT"); adds a Licence section naming it. */
  license?: string;
}

export interface MarkdownHeading {
  level: number;
  id: string;
  text: string;
}

export interface BuildReadmeResult {
  markdown: string;
  headings: MarkdownHeading[];
}

interface SectionDraft {
  title: string;
  body: string;
}

function featureList(features: string): string {
  const lines = features
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lines.map((l) => `- ${escapeInline(l)}`).join('\n');
}

function buildSections(options: BuildReadmeOptions): SectionDraft[] {
  const sections: SectionDraft[] = [];
  const sec = options.sections ?? {};

  if (options.packageName && options.packageName.trim() !== '') {
    const pm = options.packageManager ?? 'npm';
    const command = INSTALL_COMMAND[pm](options.packageName.trim());
    const extra = (sec.installation ?? '').trim();
    const body = ['```sh', command, '```', ...(extra ? ['', extra] : [])].join('\n');
    sections.push({ title: 'Installation', body });
  }

  if (sec.usage && sec.usage.trim() !== '') {
    sections.push({ title: 'Usage', body: sec.usage.trim() });
  }

  if (sec.features && sec.features.trim() !== '') {
    const list = featureList(sec.features);
    if (list !== '') sections.push({ title: 'Features', body: list });
  }

  if (sec.contributing && sec.contributing.trim() !== '') {
    sections.push({ title: 'Contributing', body: sec.contributing.trim() });
  }

  if (options.license && options.license.trim() !== '') {
    sections.push({
      title: 'Licence',
      body: `This project is licensed under the ${escapeInline(options.license.trim())} licence.`,
    });
  }

  return sections;
}

/**
 * Assembles a README as CommonMark (with GitHub Flavored Markdown allowed in
 * the visitor's own free-text fields): a top-level heading, the description
 * kept exactly as typed, one line of badges, an optional table of contents,
 * then Installation, Usage, Features, Contributing and Licence sections in
 * that fixed order, each included only when it has content. Ends with
 * exactly one trailing newline.
 */
export function buildReadme(options: BuildReadmeOptions): BuildReadmeResult {
  if (!options.name || options.name.trim() === '') {
    throw new ReadmeError('A README needs a project name.');
  }

  const lines: string[] = [];
  lines.push(`# ${escapeInline(options.name.trim())}`);

  if (options.description && options.description.trim() !== '') {
    lines.push('', options.description.trim());
  }

  const badgeLine = (options.badges ?? [])
    .map((b) => {
      try {
        return badgeMarkdown(b.id, b.params);
      } catch (err) {
        if (err instanceof ReadmeBadgeError) return '';
        throw err;
      }
    })
    .filter((m) => m !== '')
    .join(' ');
  if (badgeLine !== '') {
    lines.push('', badgeLine);
  }

  const sections = buildSections(options);
  const headings: MarkdownHeading[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const base = githubSlug(section.title) || 'section';
    let id = base;
    let suffix = 1;
    while (seen.has(id)) {
      id = `${base}-${suffix}`;
      suffix++;
    }
    seen.add(id);
    headings.push({ level: 2, id, text: section.title });
  }

  if (options.toc && headings.length > 0) {
    const tocLines = headings.map((h) => `- [${escapeInline(h.text)}](#${h.id})`);
    lines.push('', '## Table of Contents', '', ...tocLines);
  }

  for (const [index, section] of sections.entries()) {
    const heading = headings[index]!;
    lines.push('', `## ${escapeInline(heading.text)}`, '', section.body);
  }

  const markdown = `${lines.join('\n').replace(/\n+$/, '')}\n`;
  return { markdown, headings };
}

/**
 * Replaces each badge Markdown image link `[![alt](image)](link)` with the
 * same alt text shown as inline code instead, so the preview never loads a
 * badge image (D-105): a badge is an image hosted elsewhere, and loading it
 * would be a request no different from any other external image this
 * project's sanitiser already strips.
 */
function replaceBadgesWithText(markdown: string): string {
  return markdown.replace(/\[!\[([^\]]*)\]\([^)]*\)\]\([^)]*\)/g, (_match, alt: string) => `\`${alt}\``);
}

export interface RenderPreviewResult {
  html: string;
  removed: RemovedSummary;
}

/**
 * Removes every `<img>` element outright (not just its `src`, which the
 * shared sanitiser already neutralises for an external reference). D-105
 * says no image is ever loaded by this preview; taken to its conclusion, no
 * `<img>` element belongs in a README preview at all -- a legitimate badge
 * is already text by the time this runs (see `replaceBadgesWithText`), so
 * the only way an `<img>` could still appear is a visitor typing raw
 * `<img>` HTML or a Markdown image into a free-text field, neither of which
 * this tool renders as a picture.
 */
function stripImages(fragment: DocumentFragment): number {
  const images = Array.from(fragment.querySelectorAll('img'));
  for (const img of images) img.remove();
  return images.length;
}

/**
 * Renders `markdown` to a sanitised HTML preview: badges are replaced by
 * their own text first (D-105, so no badge image is ever fetched), then
 * rendered with `micromark` plus `micromark-extension-gfm` (the same
 * combination and options this project's own Markdown-rendering pages use,
 * quoted from micromark's installed README: `allowDangerousHtml: true` lets
 * raw HTML in the source through, `allowDangerousProtocol: false` keeps its
 * own scheme allow-list),
 * then sanitised through the byte-identical `sanitise.ts` this package
 * shares with every other markup-rendering tool on this site, with every
 * remaining `<img>` element then removed outright (see `stripImages`) --
 * the only thing ever shown to the visitor. `win` is the caller's own
 * `window`; this function never reads a DOM global itself.
 */
export function renderPreview(markdown: string, win: WindowLike): RenderPreviewResult {
  const withTextBadges = replaceBadgesWithText(markdown);
  const rawHtml = micromark(withTextBadges, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
    allowDangerousHtml: true,
    allowDangerousProtocol: false,
  });
  const { fragment, removed } = sanitiseToFragment(rawHtml, win, 'html');
  const imagesRemoved = stripImages(fragment);
  removed.elements += imagesRemoved;
  const html = serialiseFragment(fragment, win, 'html');
  return { html, removed };
}

export { findBadge, linkDestination };
