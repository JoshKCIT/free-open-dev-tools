import { meta, searchEmoji, formsOf } from '@fodt/emoji-picker';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'emoji-picker',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'query',
      label: 'Search',
      type: 'text',
      default: 'grinning',
      placeholder: 'A word or words from an emoji name, such as grinning face',
    },
  ],
  examples: [
    { label: 'A single word', values: { query: 'grinning' } },
    { label: 'A full name', values: { query: 'waving hand: light skin tone' } },
    { label: 'A multi-code-point sequence', values: { query: 'heart on fire' } },
  ],
  run(values): ToolResult {
    const query = str(values, 'query');
    if (!query.trim()) return { outputs: [] };

    const { results, totalMatches } = searchEmoji(query, 200);
    const outputs: OutputBlock[] = [];

    if (results.length === 0) {
      outputs.push({ kind: 'note', tone: 'warn', value: `No emoji name matches "${query}".` });
      return { outputs, stats: [['Results', '0']] };
    }

    const top = results[0]!;
    const topForms = formsOf(top);
    outputs.push({
      kind: 'keyvalue',
      label: `${top.name} (top match)`,
      pairs: [
        ['Character', topForms.character],
        ['Code points', topForms.codePoints],
        ['JavaScript escape', topForms.jsEscape],
        ['UTF-16 escape', topForms.utf16Escape],
        ['HTML entity', topForms.htmlEntity],
      ],
    });

    outputs.push({
      kind: 'table',
      label: totalMatches > results.length ? `Matches (showing ${results.length} of ${totalMatches})` : 'Matches',
      table: {
        headers: ['Emoji', 'Name', 'Code points', 'Group'],
        rows: results.map((e) => [e.character, e.name, formsOf(e).codePoints, `${e.group} / ${e.subgroup}`]),
        mono: [0, 2],
      },
    });

    if (totalMatches > results.length) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `${totalMatches} names matched; showing the first ${results.length}. Narrow your search to see more specific results.`,
      });
    }

    return { outputs, stats: [['Results', String(totalMatches)]] };
  },
});
