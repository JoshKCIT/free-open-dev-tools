import { HashIdentifierError, identifyText, meta, type Candidate } from '@fodt/hash-identifier';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

/** The kind column: how strong the evidence behind a candidate is. */
function kindOf(tier: Candidate['tier']): string {
  if (tier === 1) return 'Marker';
  if (tier === 2) return 'Shape';
  return 'Length only';
}

export default defineTool({
  id: 'hash-identifier',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'input',
      label: 'Hash strings, one per line',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Paste one hash or password hash string per line. The page lists the formats each one fits; it does not test or crack anything.',
    },
  ],
  examples: [
    {
      label: 'A bcrypt string and an MD5 hex digest',
      values: {
        input: '$2b$12$/vy7ZxGf2E2ffCTmkTnBvuDt80597OVIwFjbo1fXcIr3u/A2b22tC\n5f4dcc3b5aa765d61d8327deb882cf99',
      },
    },
  ],
  run(values, ctx): ToolResult {
    const input = str(values, 'input');
    // An empty paste shows nothing.
    if (input === '') return { outputs: [] };
    try {
      const result = identifyText(input);
      const stats: [string, string][] = [
        ['Lines read', String(result.read)],
        ['Recognised', String(result.recognised)],
        ['Not recognised', String(result.notRecognised)],
        ['Blank', String(result.blank)],
      ];
      if (result.read === 0) return { outputs: [], stats };
      const rows: (string | number)[][] = [];
      for (const line of result.lines) {
        if (line.candidates.length === 0) {
          rows.push([line.number, line.preview, 'Not recognised', 'None', line.message]);
          continue;
        }
        for (const c of line.candidates) {
          rows.push([line.number, line.preview, c.name, kindOf(c.tier), `${c.reason} Source: ${c.source}.`]);
        }
      }
      const outputs: OutputBlock[] = [
        {
          kind: 'table',
          label: 'Candidates',
          table: { headers: ['Line', 'Starts with', 'Candidate', 'Kind', 'Reason'], rows, mono: [0, 1] },
        },
        {
          kind: 'note',
          tone: 'info',
          value:
            'These are the formats each line fits, best evidence first. They are not a finding of which algorithm made a string, and nothing here tests, cracks or looks up a password.',
        },
      ];
      for (const note of result.notes) outputs.push({ kind: 'note', tone: 'info', value: note });
      return { outputs, warnings: result.warnings, stats };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (err instanceof HashIdentifierError) return { outputs: [], errors: [{ message: err.message }] };
      return { outputs: [], errors: [{ message: 'These strings could not be read.' }] };
    }
  },
});
