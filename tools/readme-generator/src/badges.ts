/**
 * Badge definitions and the Markdown they produce. Every badge is written
 * as `[![alt](image-url)](link-url)`: Markdown text only, D-105 -- no badge
 * image is ever loaded by this tool itself (the preview replaces each badge
 * with its own text before rendering, see index.ts).
 */
import { escapeInline, linkDestination } from './markdown-text';

export class ReadmeBadgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadmeBadgeError';
  }
}

export type BadgeId = 'npm' | 'license' | 'workflow' | 'release' | 'static';

export interface BadgeParams {
  packageName?: string;
  owner?: string;
  repo?: string;
  workflowFile?: string;
  branch?: string;
  label?: string;
  message?: string;
  color?: string;
}

interface BadgeDefinition {
  readonly id: BadgeId;
  readonly label: string;
  readonly docsUrl: string;
  readonly required: readonly (keyof BadgeParams)[];
  imageUrl(params: BadgeParams): string;
  linkUrl(params: BadgeParams): string;
  alt(params: BadgeParams): string;
}

/**
 * shields.io percent-encodes a URL path segment the ordinary way, but
 * `encodeURIComponent` deliberately leaves `!'()*` unescaped (ECMA-262's own
 * URI-encoding algorithm), and an unescaped `(` or `)` in a link destination
 * breaks CommonMark's own link syntax (see markdown-text.ts's
 * `linkDestination`, and threat T-07-35). This project additionally encodes
 * those two characters after `encodeURIComponent`, so a project or owner
 * name containing them still produces an intact Markdown link.
 */
function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * shields.io's own static-badge escaping (services/static-badge/static-badge.service.js
 * and core/badge-urls/path-helpers.js in badges/shields, fetched this
 * session): a segment's underscore and dash characters are doubled first (so
 * they survive as themselves), then a literal space becomes a single
 * underscore -- the documented table is "Underscore _ or %20 -> Space",
 * "Double underscore __ -> Underscore _", "Double dash -- -> Dash -". The
 * result is then percent-encoded the same way every other badge's segments
 * are (`encodePathSegment`): shields.io's own router percent-decodes a path
 * segment before its escapeFormat step ever runs, so an encoded `(` or `)`
 * still reaches escapeFormat as a literal, unaffected character, but the
 * *unencoded* URL this tool builds a Markdown link from never contains one
 * to break that link's own syntax (T-07-35).
 */
function escapeStaticBadgeSegment(value: string): string {
  const formatEscaped = value.replace(/-/g, '--').replace(/_/g, '__').replace(/ /g, '_');
  return encodePathSegment(formatEscaped);
}

function require1(params: BadgeParams, key: keyof BadgeParams): string {
  const value = params[key];
  if (!value) throw new ReadmeBadgeError(`A badge needs "${key}" to be filled in.`);
  return value;
}

export const BADGES: readonly BadgeDefinition[] = [
  {
    id: 'npm',
    label: 'npm version',
    docsUrl: 'https://img.shields.io/badges/npm-version',
    required: ['packageName'],
    imageUrl: (p) => `https://img.shields.io/npm/v/${encodePathSegment(require1(p, 'packageName'))}`,
    linkUrl: (p) => `https://www.npmjs.com/package/${encodePathSegment(require1(p, 'packageName'))}`,
    alt: () => 'npm',
  },
  {
    id: 'license',
    label: 'GitHub license',
    docsUrl: 'https://img.shields.io/badges/github-license',
    required: ['owner', 'repo'],
    imageUrl: (p) =>
      `https://img.shields.io/github/license/${encodePathSegment(require1(p, 'owner'))}/${encodePathSegment(require1(p, 'repo'))}`,
    linkUrl: (p) =>
      `https://github.com/${encodePathSegment(require1(p, 'owner'))}/${encodePathSegment(require1(p, 'repo'))}/blob/HEAD/LICENSE`,
    alt: () => 'license',
  },
  {
    id: 'workflow',
    label: 'GitHub Actions workflow status',
    // GitHub's own native badge endpoint, not a shields.io badge (github/docs,
    // actions/how-tos/monitor-workflows/add-a-status-badge.md, fetched this session):
    // "https://github.com/OWNER/REPOSITORY/actions/workflows/WORKFLOW-FILE/badge.svg".
    docsUrl: 'https://docs.github.com/en/actions/how-tos/monitor-workflows/add-a-status-badge',
    required: ['owner', 'repo', 'workflowFile'],
    imageUrl: (p) =>
      `https://github.com/${encodePathSegment(require1(p, 'owner'))}/${encodePathSegment(require1(p, 'repo'))}/actions/workflows/${encodePathSegment(require1(p, 'workflowFile'))}/badge.svg`,
    linkUrl: (p) =>
      `https://github.com/${encodePathSegment(require1(p, 'owner'))}/${encodePathSegment(require1(p, 'repo'))}/actions/workflows/${encodePathSegment(require1(p, 'workflowFile'))}`,
    alt: () => 'build status',
  },
  {
    id: 'release',
    label: 'GitHub release',
    docsUrl: 'https://img.shields.io/badges/github-release',
    required: ['owner', 'repo'],
    imageUrl: (p) =>
      `https://img.shields.io/github/v/release/${encodePathSegment(require1(p, 'owner'))}/${encodePathSegment(require1(p, 'repo'))}`,
    linkUrl: (p) =>
      `https://github.com/${encodePathSegment(require1(p, 'owner'))}/${encodePathSegment(require1(p, 'repo'))}/releases`,
    alt: () => 'release',
  },
  {
    id: 'static',
    label: 'Static label',
    docsUrl: 'https://img.shields.io/badges/static-badge',
    required: ['label', 'message'],
    imageUrl: (p) =>
      `https://img.shields.io/badge/${escapeStaticBadgeSegment(require1(p, 'label'))}-${escapeStaticBadgeSegment(require1(p, 'message'))}-${encodePathSegment(p.color ?? 'blue')}`,
    linkUrl: (p) =>
      `https://img.shields.io/badge/${escapeStaticBadgeSegment(require1(p, 'label'))}-${escapeStaticBadgeSegment(require1(p, 'message'))}-${encodePathSegment(p.color ?? 'blue')}`,
    alt: (p) => `${p.label ?? ''}: ${p.message ?? ''}`,
  },
];

export function findBadge(id: BadgeId): BadgeDefinition {
  const found = BADGES.find((b) => b.id === id);
  if (!found) throw new ReadmeBadgeError(`"${id}" is not a badge this tool knows.`);
  return found;
}

/**
 * Builds one badge's Markdown line: `[![alt](image-url)](link-url)`, every
 * visitor value percent-encoded as one URL path segment (or, for the static
 * badge, shields.io's own dash/underscore/space escaping) so a value
 * containing `)`, a space, or another Markdown-active character can never
 * break out of the link syntax around it (T-07-35).
 */
export function badgeMarkdown(id: BadgeId, params: BadgeParams): string {
  const badge = findBadge(id);
  const image = badge.imageUrl(params);
  const link = badge.linkUrl(params);
  const alt = escapeInline(badge.alt(params));
  return `[![${alt}](${linkDestination(image)})](${linkDestination(link)})`;
}
