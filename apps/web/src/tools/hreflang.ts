import { meta, buildHreflang, REGISTRY_FILE_DATE, checkLanguageTag, HreflangError } from '@fodt/hreflang';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
}

export default defineTool({
  id: 'hreflang',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'alternates',
      label: 'Language tags and URLs',
      type: 'textarea',
      rows: 6,
      mono: true,
      placeholder: 'en https://www.example.com/en/\nde https://www.example.com/de/',
      help: 'One "tag URL" pair per line. Nothing leaves your browser.',
    },
    {
      name: 'xDefault',
      label: 'x-default URL (optional)',
      type: 'text',
      mono: true,
      help: 'The fallback page for visitors whose language does not match any tag above.',
    },
  ],
  examples: [
    {
      label: "Google Search Central's own three-language example",
      values: {
        alternates:
          'en https://www.example.com/english/page.html\nde https://www.example.de/deutsch/page.html\nde-CH https://www.example.de/schweiz-deutsch/page.html',
      },
    },
  ],
  run(values): ToolResult {
    const alternates = str(values, 'alternates');
    const xDefault = str(values, 'xDefault');
    if (!alternates.trim()) return { outputs: [] };

    try {
      const result = buildHreflang(alternates, { xDefault: xDefault || undefined });
      const lines = splitLines(alternates);

      const tagRows = lines.map((line, i) => {
        const match = line.match(/^(\S+)/);
        const tag = match ? match[1]! : line;
        const check = checkLanguageTag(tag);
        const lineProblem = result.problems.find((p) => p.line === i + 1);
        const verdict = lineProblem
          ? 'Problem'
          : check.valid
            ? 'Valid'
            : check.wellFormed
              ? 'Not registered'
              : 'Not well-formed';
        const notes = lineProblem
          ? lineProblem.message
          : check.warnings.join(' ') || (check.valid ? '' : check.problems.join(' '));
        return [String(i + 1), tag, verdict, notes];
      });

      const outputs: OutputBlock[] = [
        {
          kind: 'table',
          label: 'Language tags',
          table: { headers: ['Line', 'Tag', 'Verdict', 'Notes'], rows: tagRows },
        },
        {
          kind: 'code',
          label: 'HTML link elements',
          language: 'html',
          value: result.html,
          download: 'hreflang.html',
        },
        {
          kind: 'code',
          label: 'HTTP Link header',
          language: 'text',
          value: result.linkHeader,
          download: 'hreflang-link-header.txt',
        },
        {
          kind: 'code',
          label: 'Sitemap entries',
          language: 'xml',
          value: result.sitemapXml,
          download: 'hreflang-sitemap.xml',
        },
        {
          kind: 'note',
          label: 'Registry',
          tone: 'info',
          value: `Checked against the IANA Language Subtag Registry snapshot dated ${REGISTRY_FILE_DATE}.`,
        },
      ];

      if (result.warnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Warnings', tone: 'warn', value: result.warnings.join('\n') });
      }

      const errors = result.problems.map((p) => ({ message: p.message, line: p.line || undefined }));

      return { outputs, errors: errors.length > 0 ? errors : undefined };
    } catch (err) {
      if (err instanceof HreflangError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
