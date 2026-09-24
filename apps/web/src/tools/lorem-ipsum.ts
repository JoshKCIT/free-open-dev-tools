import { meta, generateLorem, LoremError, type LoremUnit } from '@fodt/lorem-ipsum';
import { defineTool, str, num, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'lorem-ipsum',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Seeded and deterministic: the same seed and settings always give the
  // same output, so there is no reason to wait for Run.
  fields: [
    {
      name: 'unit',
      label: 'Unit',
      type: 'select',
      default: 'paragraphs',
      options: [
        { value: 'words', label: 'Words' },
        { value: 'sentences', label: 'Sentences' },
        { value: 'paragraphs', label: 'Paragraphs' },
      ],
    },
    { name: 'count', label: 'How many', type: 'number', default: 3, min: 1, max: 1000 },
    {
      name: 'seed',
      label: 'Seed',
      type: 'text',
      default: 'lorem',
      help: 'Any text. The same seed and settings always give the same output.',
    },
    { name: 'classicOpening', label: 'Start with the classic opening', type: 'checkbox', default: true },
  ],
  examples: [
    { label: 'Three paragraphs', values: { unit: 'paragraphs', count: 3, seed: 'lorem' } },
    {
      label: 'Five words, no classic opening',
      values: { unit: 'words', count: 5, seed: 'demo', classicOpening: false },
    },
  ],
  run(values): ToolResult {
    const unit = str(values, 'unit', 'paragraphs') as LoremUnit;
    const count = num(values, 'count', 3);
    const seed = str(values, 'seed', 'lorem');
    const classicOpening = bool(values, 'classicOpening', true);

    let result;
    try {
      result = generateLorem({ unit, count, seed, classicOpening });
    } catch (err) {
      return {
        outputs: [],
        errors: [{ message: err instanceof LoremError ? err.message : 'Could not generate placeholder text.' }],
      };
    }

    const outputs: OutputBlock[] = [{ kind: 'text', label: 'Generated text', value: result.text }];

    return {
      outputs,
      stats: [
        ['Words', String(result.words)],
        ['Sentences', String(result.sentences)],
        ['Paragraphs', String(result.paragraphs)],
      ],
    };
  },
});
