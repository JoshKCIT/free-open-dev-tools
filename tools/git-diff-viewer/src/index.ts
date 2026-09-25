import meta from './meta.json';

export { meta };

/**
 * Hand-written parser for unified diff and git diff output. Never runs or
 * fetches anything: the entire input is treated as inert text.
 *
 * git diff documentation, "Generating patch text with -p" (fetched
 * 2026-09-25, https://git-scm.com/docs/git-diff): a file's extended
 * header is "one or more" of `old mode`, `new mode`, `deleted file mode`,
 * `new file mode`, `copy from`, `copy to`, `rename from`, `rename to`,
 * `similarity index`, `dissimilarity index` and `index <hash>..<hash>
 * <mode>`; "Path names in extended headers do not include the a/ and b/
 * prefixes"; "Pathnames with 'unusual' characters are quoted as explained
 * for the configuration variable core.quotePath". The same page's
 * "Combined diff format" section describes `diff --combined`/`diff --cc`
 * output, whose chunk headers use `@@@ ... @@@` -- refused here rather
 * than parsed, since it describes more than two versions of a file at
 * once.
 *
 * GNU diffutils manual, "Detailed Description of Unified Format" (fetched
 * 2026-09-25): "If a hunk contains just one line, only its start line
 * number appears. Otherwise its line numbers look like `start,count`."
 */

export type DiffLineType = 'add' | 'del' | 'ctx' | 'meta';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  section: string;
  lines: DiffLine[];
}

export type DiffFileStatus = 'added' | 'deleted' | 'renamed' | 'copied' | 'mode-changed' | 'modified';

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  status: DiffFileStatus;
  oldMode?: string;
  newMode?: string;
  similarity?: number;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface ParseDiffResult {
  files: DiffFile[];
  warnings: string[];
}

export class GitDiffError extends Error {
  readonly line?: number;

  constructor(message: string, detail: { line?: number } = {}) {
    super(message);
    this.name = 'GitDiffError';
    this.line = detail.line;
  }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Decodes a C-style quoted path (git's core.quotePath rendering): octal-escaped bytes are collected and decoded as UTF-8, so a multi-byte character written as consecutive `\NNN` escapes comes back as one character. */
function decodeQuotedPath(raw: string): string {
  if (!(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)) return raw;
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === '\\') {
      const next = inner[i + 1];
      if (next === '\\') {
        bytes.push(0x5c);
        i++;
      } else if (next === '"') {
        bytes.push(0x22);
        i++;
      } else if (next === 't') {
        bytes.push(0x09);
        i++;
      } else if (next === 'n') {
        bytes.push(0x0a);
        i++;
      } else if (next !== undefined && next >= '0' && next <= '7') {
        const oct = inner.slice(i + 1, i + 4);
        bytes.push(parseInt(oct, 8) & 0xff);
        i += 3;
      } else {
        bytes.push(c.charCodeAt(0));
      }
    } else {
      bytes.push(c.charCodeAt(0));
    }
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

/** Reads a C-quoted string starting at `s[start]` (which must be `"`), returning its decoded text and the index just past the closing quote. */
function readQuotedString(s: string, start: number): { text: string; endIndex: number } | undefined {
  if (s[start] !== '"') return undefined;
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === '"') {
      i++;
      return { text: decodeQuotedPath(s.slice(start, i)), endIndex: i };
    }
    i++;
  }
  return undefined;
}

function stripAbPrefix(path: string): string {
  if (path === '/dev/null') return path;
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2);
  return path;
}

/** Best-effort path extraction from a `diff --git a/X b/Y` line's remainder, used only as a fallback when no more specific header (rename/copy/---/+++) gives the paths. */
function parseGitHeaderPaths(remainder: string): { a: string; b: string } | undefined {
  if (remainder[0] === '"') {
    const first = readQuotedString(remainder, 0);
    if (!first) return undefined;
    let rest = remainder.slice(first.endIndex);
    if (!rest.startsWith(' ')) return undefined;
    rest = rest.slice(1);
    if (rest[0] === '"') {
      const second = readQuotedString(rest, 0);
      if (!second) return undefined;
      return { a: stripAbPrefix(first.text), b: stripAbPrefix(second.text) };
    }
    return { a: stripAbPrefix(first.text), b: stripAbPrefix(rest) };
  }
  if (!remainder.startsWith('a/')) return undefined;
  // Old and new paths are equal for every case where this fallback is the
  // only source (a mode-only or binary change never renames a file), so
  // the first split that makes both halves equal is correct.
  for (let i = 2; i < remainder.length; i++) {
    if (remainder.startsWith(' b/', i)) {
      const p1 = remainder.slice(2, i);
      const p2 = remainder.slice(i + 3);
      if (p1 === p2) return { a: p1, b: p2 };
    }
  }
  const lastIdx = remainder.lastIndexOf(' b/');
  if (lastIdx > 0) {
    return { a: remainder.slice(2, lastIdx), b: remainder.slice(lastIdx + 3) };
  }
  return undefined;
}

/** Parses a `--- ` or `+++ ` header line's path: strips a trailing tab (git appends one when the path contains a space), the a/ or b/ prefix, and decodes quoting. `/dev/null` becomes null. */
function parseFromToPath(line: string): string | null {
  let remainder = line.slice(4);
  const tabIdx = remainder.indexOf('\t');
  if (tabIdx !== -1) remainder = remainder.slice(0, tabIdx);
  if (remainder === '/dev/null') return null;
  if (remainder.startsWith('"')) {
    const quoted = readQuotedString(remainder, 0);
    if (quoted) return stripAbPrefix(quoted.text);
  }
  return stripAbPrefix(remainder);
}

function isFileStartLine(lines: string[], i: number): boolean {
  const line = lines[i]!;
  if (line.startsWith('diff --git ') || line.startsWith('diff --cc ') || line.startsWith('diff --combined '))
    return true;
  return line.startsWith('--- ') && i + 1 < lines.length && (lines[i + 1] ?? '').startsWith('+++ ');
}

function isCombinedStartLine(line: string): boolean {
  return line.startsWith('diff --cc ') || line.startsWith('diff --combined ');
}

interface ParsedHunkOutcome {
  hunk: DiffHunk;
  next: number;
}

/** Consumes one hunk starting at `lines[i]` (a `@@ ... @@` header), reading body lines until the header's declared old/new line counts are both satisfied. Throws `GitDiffError` naming the input line if the body ends first. */
function parseHunk(lines: string[], i: number): ParsedHunkOutcome {
  const headerLine = lines[i]!;
  if (headerLine.startsWith('@@@')) {
    throw new GitDiffError('Combined diffs from a merge are not supported.', { line: i + 1 });
  }
  const match = HUNK_HEADER.exec(headerLine);
  if (!match) {
    throw new GitDiffError('This hunk header could not be read.', { line: i + 1 });
  }
  const oldStart = Number(match[1]);
  const oldLines = match[2] !== undefined ? Number(match[2]) : 1;
  const newStart = Number(match[3]);
  const newLines = match[4] !== undefined ? Number(match[4]) : 1;
  const section = (match[5] ?? '').trim();

  const body: DiffLine[] = [];
  let oldSeen = 0;
  let newSeen = 0;
  let j = i + 1;

  while (oldSeen < oldLines || newSeen < newLines) {
    // An empty array entry only ever comes from the trailing newline
    // `split('\n')` leaves at the very end of the input (or a genuinely
    // blank line where a hunk body line is expected) -- a real content
    // line always carries at least its one-character marker, so this is
    // never a legitimate context line and always means the hunk ran out.
    const raw = j < lines.length && lines[j] !== '' ? lines[j] : undefined;
    if (raw === undefined) {
      // Nothing more to read (real end of input, or a blank array entry
      // from the trailing newline split): name the last real line this
      // hunk did consume, since there is no line at `j` to point at.
      throw new GitDiffError(
        `This hunk ended before its declared line count (expected ${oldLines} old and ${newLines} new lines).`,
        { line: j },
      );
    }
    if (!' +-\\'.includes(raw[0] ?? '')) {
      throw new GitDiffError(
        `This hunk ended before its declared line count (expected ${oldLines} old and ${newLines} new lines).`,
        { line: j + 1 },
      );
    }
    if (raw.startsWith('\\')) {
      body.push({ type: 'meta', text: raw });
      j++;
      continue;
    }
    const marker = raw[0]!;
    const text = raw.slice(1);
    if (marker === ' ') {
      if (oldSeen >= oldLines || newSeen >= newLines) {
        throw new GitDiffError('This hunk has more lines than its header declared.', { line: j + 1 });
      }
      body.push({ type: 'ctx', text });
      oldSeen++;
      newSeen++;
    } else if (marker === '+') {
      if (newSeen >= newLines) {
        throw new GitDiffError('This hunk has more added lines than its header declared.', { line: j + 1 });
      }
      body.push({ type: 'add', text });
      newSeen++;
    } else if (marker === '-') {
      if (oldSeen >= oldLines) {
        throw new GitDiffError('This hunk has more removed lines than its header declared.', { line: j + 1 });
      }
      body.push({ type: 'del', text });
      oldSeen++;
    } else {
      throw new GitDiffError(
        `This hunk ended before its declared line count (expected ${oldLines} old and ${newLines} new lines).`,
        { line: j + 1 },
      );
    }
    j++;
  }

  // A "\ No newline at end of file" marker for the LAST content line in
  // the hunk arrives after the header's declared counts are already
  // satisfied (it counts toward neither side), so it is consumed here
  // rather than by the counting loop above.
  while (j < lines.length && (lines[j] ?? '').startsWith('\\')) {
    body.push({ type: 'meta', text: lines[j]! });
    j++;
  }

  return { hunk: { header: headerLine, oldStart, oldLines, newStart, newLines, section, lines: body }, next: j };
}

interface ParsedFileOutcome {
  file: DiffFile;
  next: number;
}

const EXTENDED_HEADER_PREFIXES = [
  'old mode ',
  'new mode ',
  'deleted file mode ',
  'new file mode ',
  'copy from ',
  'copy to ',
  'rename from ',
  'rename to ',
  'similarity index ',
  'dissimilarity index ',
  'index ',
  'Binary files ',
];

function isExtendedHeaderLine(line: string): boolean {
  return EXTENDED_HEADER_PREFIXES.some((p) => line.startsWith(p)) || line === 'GIT binary patch';
}

/** Parses one file section starting at `lines[i]`. */
function parseFile(lines: string[], i: number): ParsedFileOutcome {
  let j = i;
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let oldMode: string | undefined;
  let newMode: string | undefined;
  let similarity: number | undefined;
  let binary = false;
  let sawRename = false;
  let sawCopy = false;
  let sawNewFile = false;
  let sawDeletedFile = false;

  if (lines[j]!.startsWith('diff --git ')) {
    const fallback = parseGitHeaderPaths(lines[j]!.slice('diff --git '.length));
    if (fallback) {
      oldPath = fallback.a;
      newPath = fallback.b;
    }
    j++;
  }

  while (j < lines.length && isExtendedHeaderLine(lines[j]!)) {
    const line = lines[j]!;
    if (line.startsWith('old mode ')) {
      oldMode = line.slice('old mode '.length).trim();
    } else if (line.startsWith('new mode ')) {
      newMode = line.slice('new mode '.length).trim();
    } else if (line.startsWith('deleted file mode ')) {
      oldMode = line.slice('deleted file mode '.length).trim();
      sawDeletedFile = true;
    } else if (line.startsWith('new file mode ')) {
      newMode = line.slice('new file mode '.length).trim();
      sawNewFile = true;
    } else if (line.startsWith('copy from ')) {
      oldPath = line.slice('copy from '.length);
      sawCopy = true;
    } else if (line.startsWith('copy to ')) {
      newPath = line.slice('copy to '.length);
      sawCopy = true;
    } else if (line.startsWith('rename from ')) {
      oldPath = line.slice('rename from '.length);
      sawRename = true;
    } else if (line.startsWith('rename to ')) {
      newPath = line.slice('rename to '.length);
      sawRename = true;
    } else if (line.startsWith('similarity index ')) {
      similarity = Number(line.slice('similarity index '.length).replace('%', ''));
    } else if (line.startsWith('dissimilarity index ')) {
      // Recorded as the same field; dissimilarity is simply 100 - similarity conceptually, but
      // git never emits both for the same file, so keeping one field is enough.
      similarity = 100 - Number(line.slice('dissimilarity index '.length).replace('%', ''));
    } else if (line.startsWith('Binary files ')) {
      binary = true;
      const rest = line.slice(
        'Binary files '.length,
        line.endsWith(' differ') ? line.length - ' differ'.length : line.length,
      );
      const andIdx = rest.indexOf(' and ');
      if (andIdx !== -1) {
        const a = rest.slice(0, andIdx);
        const b = rest.slice(andIdx + ' and '.length);
        if (a !== '/dev/null') oldPath = stripAbPrefix(a.startsWith('"') ? decodeQuotedPath(a) : a);
        if (b !== '/dev/null') newPath = stripAbPrefix(b.startsWith('"') ? decodeQuotedPath(b) : b);
        if (a === '/dev/null') oldPath = null;
        if (b === '/dev/null') newPath = null;
      }
    } else if (line === 'GIT binary patch') {
      binary = true;
      j++;
      // Skip the literal/delta base85 blocks entirely: their content is
      // never read, only that this file is binary is recorded.
      while (j < lines.length && !isFileStartLine(lines, j)) j++;
      continue;
    }
    // 'index <hash>..<hash> <mode>' carries no information this tool reports.
    j++;
  }

  if (j < lines.length && (lines[j] ?? '').startsWith('--- ')) {
    const fromPath = parseFromToPath(lines[j]!);
    j++;
    const toPath = j < lines.length ? parseFromToPath(lines[j]!) : null;
    j++;
    oldPath = fromPath;
    newPath = toPath;
  }

  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  while (j < lines.length && (lines[j] ?? '').startsWith('@@')) {
    const { hunk, next } = parseHunk(lines, j);
    hunks.push(hunk);
    for (const l of hunk.lines) {
      if (l.type === 'add') additions++;
      else if (l.type === 'del') deletions++;
    }
    j = next;
  }

  let status: DiffFileStatus;
  if (sawRename) status = 'renamed';
  else if (sawCopy) status = 'copied';
  else if (sawNewFile || oldPath === null) status = 'added';
  else if (sawDeletedFile || newPath === null) status = 'deleted';
  else if (oldMode !== undefined && newMode !== undefined && oldMode !== newMode && hunks.length === 0 && !binary)
    status = 'mode-changed';
  else status = 'modified';

  return {
    file: { oldPath, newPath, status, oldMode, newMode, similarity, binary, additions, deletions, hunks },
    next: j,
  };
}

/**
 * Parses unified diff or git diff text into files, each with its extended
 * header information and hunks. Text before the first recognised header
 * (an email header or commit message from `git format-patch`) and text
 * after the last hunk (a `git format-patch` signature) are ignored, each
 * reported once as a warning. Refuses a combined diff (`diff --cc` /
 * `diff --combined`) with a plain message, and a hunk whose body does not
 * match its header's declared line counts, naming the input line.
 */
export function parseDiff(text: string): ParseDiffResult {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const warnings: string[] = [];
  const files: DiffFile[] = [];

  let i = 0;
  let sawLeadingContent = false;
  while (i < lines.length && !isFileStartLine(lines, i)) {
    if ((lines[i] ?? '').trim() !== '') sawLeadingContent = true;
    i++;
  }
  if (sawLeadingContent) {
    warnings.push('Text before the first diff header was ignored.');
  }

  while (i < lines.length) {
    if (isCombinedStartLine(lines[i]!)) {
      throw new GitDiffError('Combined diffs from a merge are not supported.', { line: i + 1 });
    }
    if (!isFileStartLine(lines, i)) {
      const rest = lines.slice(i);
      if (rest.some((l) => l.trim() !== '')) {
        warnings.push('Text after the last diff hunk was ignored.');
      }
      break;
    }
    const { file, next } = parseFile(lines, i);
    files.push(file);
    i = next;
  }

  return { files, warnings };
}
