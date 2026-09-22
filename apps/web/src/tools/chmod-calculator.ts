import {
  meta,
  parseOctal,
  parseSymbolic,
  toMode,
  report,
  applyExpression,
  applyUmask,
  COMMON_MODES,
  ChmodError,
} from '@fodt/chmod-calculator';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'chmod-calculator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'inputKind',
      label: 'Start from',
      type: 'radio',
      default: 'octal',
      options: [
        { value: 'octal', label: 'Octal' },
        { value: 'symbolic', label: 'Symbolic' },
        { value: 'umask', label: 'A umask' },
      ],
    },
    {
      name: 'octal',
      label: 'Octal mode',
      type: 'text',
      mono: true,
      default: '644',
      placeholder: '755, or 4755 to include the special bits',
      visible: (v) => v.inputKind === 'octal',
    },
    {
      name: 'symbolic',
      label: 'Symbolic mode',
      type: 'text',
      mono: true,
      default: 'rw-r--r--',
      placeholder: 'rwxr-xr-x, or -rw-r--r-- as ls prints it',
      visible: (v) => v.inputKind === 'symbolic',
    },
    {
      name: 'umask',
      label: 'umask',
      type: 'text',
      mono: true,
      default: '022',
      placeholder: '022',
      visible: (v) => v.inputKind === 'umask',
    },
    {
      name: 'expression',
      label: 'Then apply a chmod expression (optional)',
      type: 'text',
      mono: true,
      placeholder: 'u+x,go-w',
      help: 'The same syntax chmod takes. + adds, - removes, = replaces the whole triad.',
      visible: (v) => v.inputKind !== 'umask',
    },
    { name: 'isDirectory', label: 'This is a directory', type: 'checkbox', default: false },
  ],
  examples: [
    { label: 'Private key', values: { inputKind: 'octal', octal: '600' } },
    { label: 'Script', values: { inputKind: 'octal', octal: '755' } },
    { label: '/tmp', values: { inputKind: 'octal', octal: '1777', isDirectory: true } },
    { label: 'Add execute', values: { inputKind: 'octal', octal: '644', expression: 'u+x' } },
  ],
  run(values): ToolResult {
    const isDirectory = bool(values, 'isDirectory');
    try {
      if (values.inputKind === 'umask') {
        const umask = parseOctal(str(values, 'umask', '022'));
        const fileMode = applyUmask(umask, false);
        const dirMode = applyUmask(umask, true);
        return {
          outputs: [
            {
              kind: 'keyvalue',
              label: `With umask ${umask.toString(8).padStart(3, '0')}`,
              pairs: [
                ['A new file gets', `${fileMode.toString(8).padStart(3, '0')}  ${report(fileMode).symbolic}`],
                ['A new directory gets', `${dirMode.toString(8).padStart(3, '0')}  ${report(dirMode, true).symbolic}`],
              ],
            },
            {
              kind: 'note',
              tone: 'info',
              value:
                'A umask removes permissions from the base mode, which is 666 for files and 777 for directories. A new file never gets execute permission from the system, whatever the umask says.',
            },
          ],
        };
      }

      let mode =
        values.inputKind === 'octal'
          ? parseOctal(str(values, 'octal', '644'))
          : toMode(parseSymbolic(str(values, 'symbolic', 'rw-r--r--')));

      const expression = str(values, 'expression').trim();
      if (expression) mode = applyExpression(mode, expression);

      const r = report(mode, isDirectory);
      const outputs: OutputBlock[] = [
        {
          kind: 'keyvalue',
          label: 'Mode',
          pairs: [
            ['Octal', r.octal],
            ['Octal with special bits', r.octalFull],
            ['Symbolic', r.symbolic],
            ['As ls prints it', r.lsStyle],
            ['Command', r.chmodCommand],
          ],
        },
        { kind: 'list', label: 'What this allows', items: r.description },
      ];

      for (const w of r.warnings) outputs.push({ kind: 'note', tone: 'warn', value: w });

      outputs.push({
        kind: 'table',
        label: 'Common modes',
        table: {
          headers: ['Mode', 'When it is used'],
          rows: COMMON_MODES.map((m) => [m.label, m.use]),
          mono: [0],
        },
      });

      return { outputs };
    } catch (err) {
      if (err instanceof ChmodError) return { outputs: [], errors: [{ message: err.message }] };
      throw err;
    }
  },
});
