import {
  meta,
  convertSize,
  convertSpeed,
  transferTime,
  speedNeeded,
  parseAmount,
  DataSizeError,
  UNITS,
  TIME_UNITS,
  type UnitId,
  type TimeUnitId,
} from '@fodt/data-size';
import { defineTool, str, type ToolResult } from '../lib/tool-ui';

const DIGIT_OPTIONS = [3, 4, 6, 8, 10, 12, 15, 20];

function unitOptions() {
  return UNITS.map((u) => ({ value: u.id, label: `${u.symbol} (${u.name})` }));
}

export default defineTool({
  id: 'data-size',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'size',
      options: [
        { value: 'size', label: 'Convert a size' },
        { value: 'speed', label: 'Convert a speed' },
        { value: 'time', label: 'Transfer time' },
        { value: 'needed', label: 'Speed needed' },
      ],
    },
    {
      name: 'size',
      label: 'Size',
      type: 'text',
      default: '1',
      visible: (v) => v.mode === 'size' || v.mode === 'time' || v.mode === 'needed',
    },
    {
      name: 'sizeUnit',
      label: 'Size unit',
      type: 'select',
      default: 'GB',
      options: unitOptions(),
      visible: (v) => v.mode === 'size' || v.mode === 'time' || v.mode === 'needed',
    },
    {
      name: 'speed',
      label: 'Speed',
      type: 'text',
      default: '100',
      visible: (v) => v.mode === 'speed' || v.mode === 'time',
    },
    {
      name: 'speedUnit',
      label: 'Speed unit',
      type: 'select',
      default: 'Mbit',
      options: unitOptions(),
      visible: (v) => v.mode === 'speed' || v.mode === 'time',
    },
    {
      name: 'time',
      label: 'Time',
      type: 'text',
      default: '60',
      visible: (v) => v.mode === 'needed',
    },
    {
      name: 'timeUnit',
      label: 'Time unit',
      type: 'select',
      default: 's',
      options: TIME_UNITS.map((u) => ({ value: u.id, label: `${u.symbol} (${u.name})` })),
      visible: (v) => v.mode === 'needed',
    },
    {
      name: 'digits',
      label: 'Significant digits',
      type: 'select',
      default: '6',
      options: DIGIT_OPTIONS.map((n) => ({ value: String(n), label: String(n) })),
    },
  ],
  examples: [
    { label: '1 GiB in every unit', values: { mode: 'size', size: '1', sizeUnit: 'GiB' } },
    {
      label: '1 GB at 100 Mbit/s',
      values: { mode: 'time', size: '1', sizeUnit: 'GB', speed: '100', speedUnit: 'Mbit' },
    },
    { label: '100 Mbit/s in every unit', values: { mode: 'speed', speed: '100', speedUnit: 'Mbit' } },
    {
      label: '4.7 GB in 10 minutes',
      values: { mode: 'needed', size: '4.7', sizeUnit: 'GB', time: '10', timeUnit: 'min' },
    },
  ],
  run(values): ToolResult {
    const mode = str(values, 'mode', 'size');
    const digits = Number(str(values, 'digits', '6'));

    try {
      if (mode === 'size') {
        const sizeText = str(values, 'size');
        if (!sizeText) return { outputs: [] };
        const amount = parseAmount(sizeText, 'size');
        const rows = convertSize(amount, str(values, 'sizeUnit', 'GB') as UnitId, { significantDigits: digits });
        return {
          outputs: [
            {
              kind: 'table',
              label: 'Conversions',
              table: {
                headers: ['Unit', 'Name', 'Value', 'Exact'],
                rows: rows.map((r) => [r.symbol, r.name, r.text, r.rounded ? 'rounded' : 'exact']),
                mono: [2],
              },
            },
            {
              kind: 'note',
              tone: 'info',
              value:
                '1024-based units are named only with the IEC i-prefixes (KiB, MiB, ...). Windows Explorer and JEDEC memory sizes use KB and MB for 1024-based amounts instead.',
            },
          ],
        };
      }

      if (mode === 'speed') {
        const speedText = str(values, 'speed');
        if (!speedText) return { outputs: [] };
        const amount = parseAmount(speedText, 'speed');
        const rows = convertSpeed(amount, str(values, 'speedUnit', 'Mbit') as UnitId, { significantDigits: digits });
        return {
          outputs: [
            {
              kind: 'table',
              label: 'Conversions',
              table: {
                headers: ['Unit', 'Name', 'Value', 'Exact'],
                rows: rows.map((r) => [r.symbol, r.name, r.text, r.rounded ? 'rounded' : 'exact']),
                mono: [2],
              },
            },
            {
              kind: 'note',
              tone: 'info',
              value:
                '1024-based units are named only with the IEC i-prefixes (KiB, MiB, ...). Windows Explorer and JEDEC memory sizes use KB and MB for 1024-based amounts instead.',
            },
          ],
        };
      }

      if (mode === 'time') {
        const sizeText = str(values, 'size');
        const speedText = str(values, 'speed');
        if (!sizeText || !speedText) return { outputs: [] };
        const size = parseAmount(sizeText, 'size');
        const speed = parseAmount(speedText, 'speed');
        const result = transferTime(
          size,
          str(values, 'sizeUnit', 'GB') as UnitId,
          speed,
          str(values, 'speedUnit', 'Mbit') as UnitId,
          {
            significantDigits: digits,
          },
        );
        return {
          outputs: [
            {
              kind: 'keyvalue',
              label: 'Transfer time',
              pairs: [
                ['Time', `${result.text}${result.totalSeconds.rounded || result.seconds.rounded ? ' (rounded)' : ''}`],
                ['Total seconds', `${result.totalSeconds.text}${result.totalSeconds.rounded ? ' (rounded)' : ''}`],
              ],
            },
            {
              kind: 'note',
              tone: 'info',
              value:
                'This ignores protocol overhead, latency and congestion: it is simply the size divided by the speed.',
            },
          ],
        };
      }

      // mode === 'needed'
      const sizeText = str(values, 'size');
      const timeText = str(values, 'time');
      if (!sizeText || !timeText) return { outputs: [] };
      const size = parseAmount(sizeText, 'size');
      const time = parseAmount(timeText, 'time');
      const rows = speedNeeded(
        size,
        str(values, 'sizeUnit', 'GB') as UnitId,
        time,
        str(values, 'timeUnit', 's') as TimeUnitId,
        {
          significantDigits: digits,
        },
      );
      return {
        outputs: [
          {
            kind: 'table',
            label: 'Speed needed',
            table: {
              headers: ['Unit', 'Name', 'Value', 'Exact'],
              rows: rows.map((r) => [r.symbol, r.name, r.text, r.rounded ? 'rounded' : 'exact']),
              mono: [2],
            },
          },
        ],
      };
    } catch (err) {
      if (err instanceof DataSizeError) {
        return { outputs: [], errors: [{ message: `${err.field}: ${err.message}` }] };
      }
      throw err;
    }
  },
});
