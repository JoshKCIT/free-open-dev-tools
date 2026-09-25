/**
 * Collects and renders data files bundled *into* a tool package rather than
 * installed as an npm dependency -- for example a wordlist shipped as a
 * `.ts` source file. `scripts/check-licenses.mjs` only ever reads each
 * tool's `package.json`, so a data file under an attribution licence never
 * reaches it. A tool declares one of these under its own `src/meta.json`'s
 * optional `bundledData` array; this module reads that declaration, checks
 * the notice file it names actually exists and carries real text, and
 * returns records the licence gate can fold into its own document and its
 * own exit code.
 *
 * Pure functions, no `process.exit` here and nothing printed directly --
 * problems are returned, not printed, the same register
 * `scripts/lib/provenance.mjs` uses. That is what makes this testable
 * without running the whole gate.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every field a `bundledData` entry must declare. */
const REQUIRED_FIELDS = ['name', 'source', 'licence', 'licenceUrl', 'attribution', 'noticeFile'];

/**
 * Walks every directory under `toolsDir`, reads each tool's `src/meta.json`
 * (skipping any tool that has none, or one that fails to parse -- that is
 * `scripts/check-catalog.mjs`'s problem to report, not this module's), and
 * collects the entries under its optional `bundledData` array.
 *
 * Returns `{ entries, problems }`:
 * - `entries` are sorted by tool id, then by data name, so a second
 *   collection over the same tree can never reorder the rendered output.
 * - `problems` names every entry missing a required field, every entry
 *   whose `noticeFile` does not exist, and every entry whose `noticeFile`
 *   exists but is empty or contains only whitespace. Rejecting only a
 *   missing file would let an empty notice produce attribution metadata
 *   with no actual notice text behind it -- the licence obligation unmet
 *   while every other check passes.
 */
export function collectBundledData(toolsDir) {
  const entries = [];
  const problems = [];

  if (!existsSync(toolsDir)) return { entries, problems };

  const ids = readdirSync(toolsDir).filter((d) => statSync(join(toolsDir, d)).isDirectory());

  for (const id of ids) {
    const metaPath = join(toolsDir, id, 'src', 'meta.json');
    if (!existsSync(metaPath)) continue;

    let meta;
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      continue;
    }

    const bundled = Array.isArray(meta.bundledData) ? meta.bundledData : [];

    for (const entry of bundled) {
      const missingFields = REQUIRED_FIELDS.filter((field) => !entry?.[field]);
      if (missingFields.length > 0) {
        const label = entry?.name ? `"${entry.name}"` : '(unnamed entry)';
        problems.push(
          `${id}: bundled data entry ${label} is missing ${missingFields.map((f) => `"${f}"`).join(', ')}.`,
        );
        continue;
      }

      const noticePath = join(toolsDir, id, entry.noticeFile);
      if (!existsSync(noticePath)) {
        problems.push(
          `${id}: bundled data "${entry.name}" names a notice file that does not exist: ${entry.noticeFile}`,
        );
        continue;
      }

      // Normalized the same way scripts/check-licenses.mjs normalizes an
      // installed package's LICENSE text: this project's .gitattributes
      // commits every text file as LF, so embedding a raw CRLF byte here
      // (however this file arrived) would make a fresh regeneration of
      // docs/THIRD-PARTY.md differ from the committed one on every run.
      const noticeText = readFileSync(noticePath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (noticeText.trim().length === 0) {
        problems.push(`${id}: bundled data "${entry.name}"'s notice file is empty: ${entry.noticeFile}`);
        continue;
      }

      entries.push({
        toolId: id,
        name: entry.name,
        source: entry.source,
        licence: entry.licence,
        licenceUrl: entry.licenceUrl,
        attribution: entry.attribution,
        noticeText,
      });
    }
  }

  entries.sort((a, b) => a.toolId.localeCompare(b.toolId) || a.name.localeCompare(b.name));

  return { entries, problems };
}

/**
 * Renders the collected entries into the same document register
 * `scripts/check-licenses.mjs` already builds for installed dependencies: a
 * heading, a one-line explanation of what bundled data means, a summary
 * table (name, licence, the tool it is bundled into, and a link to its
 * source), and then the full notice text per entry in a fenced block.
 *
 * Returns an empty string for an empty list, so a repository where no tool
 * declares bundled data produces exactly the notices file it produces
 * today. Sorts defensively by tool id then data name, so calling this
 * directly with an unsorted list (as a unit test might) still produces
 * stable, reorder-proof output.
 */
export function renderBundledDataSection(entries) {
  if (!entries || entries.length === 0) return '';

  const sorted = [...entries].sort((a, b) => a.toolId.localeCompare(b.toolId) || a.name.localeCompare(b.name));

  const lines = [];
  lines.push('## Bundled data');
  lines.push('');
  lines.push(
    'Data files bundled directly into a tool folder rather than installed as an npm dependency -- for example a wordlist shipped as source. Listed separately from the packages above because they never appear in any `package.json`, and would otherwise be invisible to this generator.',
  );
  lines.push('');
  lines.push('| Data | Licence | Bundled into | Source |');
  lines.push('| --- | --- | --- | --- |');
  for (const e of sorted) {
    lines.push(`| ${e.name} | ${e.licence} | \`tools/${e.toolId}\` | [source](${e.source}) |`);
  }
  lines.push('');
  for (const e of sorted) {
    lines.push(`### ${e.name} (bundled into \`tools/${e.toolId}\`)`);
    lines.push('');
    lines.push(`Licence: ${e.licence} ([full text](${e.licenceUrl}))`);
    lines.push('');
    lines.push(`Attribution: ${e.attribution}`);
    lines.push('');
    lines.push('```text');
    lines.push(e.noticeText.trim());
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}
