/**
 * Test-side generator for `src/gitignore-templates.ts`: builds the bundled
 * templates module's export from the vendored
 * `test/fixtures/github-gitignore/` tree (every `*.gitignore` file directly
 * in the repository root and in `Global/`, mirroring the upstream layout),
 * guided by the vendored `tree.json` listing (which file is a real blob
 * versus a symlink alias this tool does not follow -- see the tool's own
 * `ambiguities`). A required test asserts the committed module is exactly
 * what a fresh build from the vendored files produces.
 *
 * Only writes `src/gitignore-templates.ts` back to disk when
 * `process.env.FODT_REGENERATE === '1'`; every other run is read-only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const FIXTURES_DIR = join(ROOT, 'test', 'fixtures', 'github-gitignore');
const OUTPUT_PATH = join(ROOT, 'src', 'gitignore-templates.ts');

export const GITIGNORE_COMMIT = 'b06d69d5a0b82a187180dac3d46a4ebe1e40bce5';

export interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
}

export interface TemplateEntry {
  name: string;
  folder: 'root' | 'Global';
  path: string;
  content: string;
}

export interface BuildTemplatesFolderStats {
  folder: string;
  count: number;
  bytes: number;
}

export interface BuildTemplatesStats {
  perFolder: BuildTemplatesFolderStats[];
  totalCount: number;
  totalBytes: number;
}

export interface BuildTemplatesResult {
  templates: TemplateEntry[];
  stats: BuildTemplatesStats;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * True for a tree entry this tool bundles as a template: a real file (not a
 * symlink, `mode !== '120000'`) whose path is a `*.gitignore` file directly
 * in the repository root or directly under `Global/` -- never `community/`
 * (D-108) and never a nested `Global/` subdirectory (the upstream repository
 * has none today, but the check keeps this generator honest if one appears).
 */
function isBundledTemplate(entry: TreeEntry): entry is TreeEntry & { path: string } {
  if (entry.type !== 'blob' || entry.mode === '120000') return false;
  if (!entry.path.endsWith('.gitignore')) return false;
  const segments = entry.path.split('/');
  if (segments.length === 1) return true;
  return segments.length === 2 && segments[0] === 'Global';
}

/**
 * Builds the bundled template list from the vendored fixture tree:
 * every `*.gitignore` file directly in the root or in `Global/`, name
 * without the extension, content read as exact UTF-8 bytes (no newline
 * normalisation, so a `\r` upstream keeps its `\r`), sorted by folder
 * (root before Global) then name. Also computes per-folder and total counts
 * and byte totals for the executor to record in `testNotes` and the
 * SUMMARY (D-108).
 */
export function buildTemplates(sourceDir: string, tree: TreeEntry[]): BuildTemplatesResult {
  const templates: TemplateEntry[] = [];

  for (const entry of tree) {
    if (!isBundledTemplate(entry)) continue;
    const segments = entry.path.split('/');
    const folder: 'root' | 'Global' = segments.length === 1 ? 'root' : 'Global';
    const fileName = segments[segments.length - 1]!;
    const name = fileName.slice(0, -'.gitignore'.length);
    const content = readFileSync(join(sourceDir, ...segments), 'utf8');
    templates.push({ name, folder, path: entry.path, content });
  }

  templates.sort((a, b) => {
    if (a.folder !== b.folder) return a.folder === 'root' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const perFolderMap = new Map<string, { count: number; bytes: number }>();
  for (const t of templates) {
    const current = perFolderMap.get(t.folder) ?? { count: 0, bytes: 0 };
    current.count += 1;
    current.bytes += byteLength(t.content);
    perFolderMap.set(t.folder, current);
  }
  const perFolder = Array.from(perFolderMap.entries()).map(([folder, v]) => ({
    folder,
    count: v.count,
    bytes: v.bytes,
  }));
  const totalCount = templates.length;
  const totalBytes = perFolder.reduce((sum, f) => sum + f.bytes, 0);

  return { templates, stats: { perFolder, totalCount, totalBytes } };
}

/** Renders `src/gitignore-templates.ts`'s exact source text from a built result. */
export function renderGitignoreTemplatesModule(result: BuildTemplatesResult): string {
  return [
    '/**',
    ' * github/gitignore templates (CC0-1.0), bundled from the repository root',
    ' * and `Global/` folder at the pinned commit below -- `community/` is not',
    ' * bundled (D-108). Vendored byte for byte at',
    ' * test/fixtures/github-gitignore/; this module is a generated copy with an',
    ' * explicit wide type so the compiler never infers a literal type for it.',
    ' * See test/build-templates.ts for the generator this module must equal,',
    ' * and src/gitignore-templates-NOTICE.txt for the full attribution notice.',
    ' */',
    '',
    `export const GITIGNORE_COMMIT = ${JSON.stringify(GITIGNORE_COMMIT)};`,
    '',
    `export const GITIGNORE_TEMPLATES: Readonly<{ name: string; folder: string; path: string; content: string }[]> = ${JSON.stringify(result.templates, null, 2)} as const;`,
    '',
  ].join('\n');
}

if (process.env.FODT_REGENERATE === '1') {
  const tree = JSON.parse(readFileSync(join(FIXTURES_DIR, 'tree.json'), 'utf8')).tree as TreeEntry[];
  const result = buildTemplates(FIXTURES_DIR, tree);
  writeFileSync(OUTPUT_PATH, renderGitignoreTemplatesModule(result));
}
