import metaJson from './meta.json';
import { GITIGNORE_TEMPLATES, GITIGNORE_COMMIT } from './gitignore-templates';

export const meta = metaJson;
export { GITIGNORE_TEMPLATES, GITIGNORE_COMMIT };

export class GitignoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitignoreError';
  }
}

export interface GitignoreTemplateSummary {
  name: string;
  folder: string;
}

export interface UsedTemplate {
  name: string;
  folder: string;
  path: string;
  lines: number;
}

export interface UnknownTemplate {
  name: string;
  suggestions: string[];
}

export interface ComposeGitignoreOptions {
  /** Template names, matched case-insensitively against a name or a file name. */
  templates?: string[];
  /** Extra lines appended under their own "### Custom ###" section. */
  extra?: string;
  /** Adds one leading comment line naming the source commit and licence. Default false. */
  header?: boolean;
}

export interface ComposeGitignoreResult {
  output: string;
  used: UsedTemplate[];
  unknown: UnknownTemplate[];
}

const HEADER_LINE = `# Templates from https://github.com/github/gitignore at commit ${GITIGNORE_COMMIT.slice(0, 7)} (CC0-1.0)`;

/** Returns every bundled template's name and folder, root templates before Global. */
export function listTemplates(): GitignoreTemplateSummary[] {
  return GITIGNORE_TEMPLATES.map((t) => ({ name: t.name, folder: t.folder }));
}

function findTemplate(name: string): (typeof GITIGNORE_TEMPLATES)[number] | undefined {
  const lower = name.toLowerCase();
  return GITIGNORE_TEMPLATES.find(
    (t) => t.name.toLowerCase() === lower || `${t.name}.gitignore`.toLowerCase() === lower,
  );
}

/** Levenshtein edit distance, used only to suggest a close-enough template name (capped, never a hot path). */
function editDistance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }
  return dp[b.length]!;
}

/** Up to three template names closest to `name` by edit distance, closest first. */
function suggestNames(name: string): string[] {
  const lower = name.toLowerCase();
  const scored = GITIGNORE_TEMPLATES.map((t) => ({
    name: t.name,
    distance: editDistance(lower, t.name.toLowerCase()),
  }));
  scored.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  return scored.slice(0, 3).map((s) => s.name);
}

function countLines(text: string): number {
  if (text === '') return 0;
  return text.split(/\r\n|\r|\n/).length;
}

/**
 * Composes a .gitignore from the bundled templates named in `templates`
 * (case-insensitive, matched in the order given, a name repeated more than
 * once is used only once), an optional `extra` block of hand-typed lines
 * under a "### Custom ###" heading, and an optional leading `header`
 * comment naming the source commit and licence. Duplicate lines across
 * chosen templates are never removed: git evaluates .gitignore patterns in
 * order, with the LAST matching pattern within one precedence level
 * deciding the outcome (gitignore(5)), and a negation pattern from one
 * template can sit between two occurrences of the same plain pattern from
 * another -- removing either occurrence could change what the file
 * actually ignores. An unknown name is never dropped silently: it is
 * listed under `unknown` with up to three real names close to it by edit
 * distance.
 */
export function composeGitignore(options: ComposeGitignoreOptions = {}): ComposeGitignoreResult {
  const requested = options.templates ?? [];
  const seen = new Set<string>();
  const used: UsedTemplate[] = [];
  const unknown: UnknownTemplate[] = [];
  const sections: string[] = [];

  for (const rawName of requested) {
    const name = rawName.trim();
    if (name === '') continue;
    const template = findTemplate(name);
    if (!template) {
      unknown.push({ name, suggestions: suggestNames(name) });
      continue;
    }
    const dedupeKey = `${template.folder}\u0000${template.name}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    used.push({
      name: template.name,
      folder: template.folder,
      path: template.path,
      lines: countLines(template.content),
    });
    sections.push(`### ${template.name} ###\n${template.content}`);
  }

  const extra = (options.extra ?? '').replace(/\r\n/g, '\n');
  if (extra.trim() !== '') {
    sections.push(`### Custom ###\n${extra.endsWith('\n') ? extra : `${extra}\n`}`);
  }

  const body = sections.join('\n');
  const output = options.header ? `${HEADER_LINE}\n${body}` : body;

  return { output, used, unknown };
}
