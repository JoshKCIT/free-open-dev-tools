import { meta, parseDiff, GitDiffError, type DiffFile } from '@fodt/git-diff-viewer';
import { defineTool, str, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

function fileLabel(file: DiffFile): string {
  if (file.status === 'renamed' || file.status === 'copied') {
    return `${file.oldPath ?? '?'} → ${file.newPath ?? '?'}`;
  }
  return file.newPath ?? file.oldPath ?? '?';
}

function changeLabel(file: DiffFile): string {
  if (file.binary) return 'binary';
  switch (file.status) {
    case 'added':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    case 'copied':
      return 'copied';
    case 'mode-changed':
      return 'mode changed';
    default:
      return 'modified';
  }
}

export default defineTool({
  id: 'git-diff-viewer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Diff',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    { name: 'filter', label: 'Path filter', type: 'text', placeholder: 'Substring of a path' },
    { name: 'file', label: 'File (0 = all)', type: 'number', default: 0, min: 0 },
    { name: 'hunk', label: 'Hunk (0 = all)', type: 'number', default: 0, min: 0 },
  ],
  examples: [
    {
      label: 'git documentation rename example',
      values: {
        input: 'diff --git a/file1 b/file2\nsimilarity index 90%\nrename from file1\nrename to file2\n',
      },
    },
  ],
  run(values): ToolResult {
    const input = str(values, 'input');
    if (!input.trim()) return { outputs: [] };

    let requestedFile = num(values, 'file', 0);
    if (requestedFile < 0) requestedFile = 0;
    let requestedHunk = num(values, 'hunk', 0);
    if (requestedHunk < 0) requestedHunk = 0;
    const filterText = str(values, 'filter', '').toLowerCase();

    try {
      const result = parseDiff(input);

      const filtered = filterText
        ? result.files.filter(
            (f) =>
              (f.oldPath ?? '').toLowerCase().includes(filterText) ||
              (f.newPath ?? '').toLowerCase().includes(filterText),
          )
        : result.files;

      const outputs: OutputBlock[] = [];
      const warnings: string[] = [...result.warnings];

      outputs.push({
        kind: 'table',
        label: 'Files',
        table: {
          headers: ['#', 'Path', 'Change', '+', '-', 'Hunks'],
          rows: filtered.map((f, i) => [i + 1, fileLabel(f), changeLabel(f), f.additions, f.deletions, f.hunks.length]),
          mono: [1],
        },
      });

      let clampedFile = requestedFile;
      if (requestedFile > filtered.length) {
        clampedFile = filtered.length;
        if (filtered.length > 0) {
          warnings.push(`File ${requestedFile} does not exist; showing file ${clampedFile} instead.`);
        }
      }

      const selectedFiles = clampedFile === 0 ? filtered : filtered.slice(clampedFile - 1, clampedFile);

      for (const file of selectedFiles) {
        if (file.binary) {
          outputs.push({
            kind: 'note',
            tone: 'info',
            value: `${fileLabel(file)} is a binary file; its contents are not shown.`,
          });
          continue;
        }
        if (file.hunks.length === 0) {
          outputs.push({
            kind: 'note',
            tone: 'info',
            value: `${fileLabel(file)} has no content changes (mode changed from ${file.oldMode ?? '?'} to ${file.newMode ?? '?'}).`,
          });
          continue;
        }

        let clampedHunk = requestedHunk;
        if (requestedHunk > file.hunks.length) {
          clampedHunk = file.hunks.length;
          warnings.push(
            `Hunk ${requestedHunk} does not exist in ${fileLabel(file)}; showing hunk ${clampedHunk} instead.`,
          );
        }

        const selectedHunks = clampedHunk === 0 ? file.hunks : file.hunks.slice(clampedHunk - 1, clampedHunk);
        for (const hunk of selectedHunks) {
          const hunkNumber = file.hunks.indexOf(hunk) + 1;
          outputs.push({
            kind: 'diff',
            label: `${fileLabel(file)} — hunk ${hunkNumber} of ${file.hunks.length} — ${hunk.header}`,
            lines: hunk.lines.map((l) => ({ type: l.type, text: l.text })),
          });
        }
      }

      if (warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: warnings.join('\n') });
      }

      const additions = filtered.reduce((sum, f) => sum + f.additions, 0);
      const deletions = filtered.reduce((sum, f) => sum + f.deletions, 0);

      return {
        outputs,
        stats: [
          ['Files', String(filtered.length)],
          ['Additions', String(additions)],
          ['Deletions', String(deletions)],
        ],
      };
    } catch (err) {
      if (err instanceof GitDiffError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
