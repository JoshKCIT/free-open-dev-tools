import {
  meta,
  solveAspect,
  formatAspectRatioCss,
  AspectRatioError,
  COMMON_RATIOS,
  COMMON_RESOLUTIONS,
  COMMON_SIZES_SOURCE,
  type SolveFor,
} from '@fodt/aspect-ratio';
import { defineTool, num, str, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'aspect-ratio',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'solveFor',
      label: 'Solve for',
      type: 'radio',
      default: 'height',
      options: [
        { value: 'height', label: 'Height' },
        { value: 'width', label: 'Width' },
        { value: 'ratio', label: 'Ratio' },
      ],
    },
    {
      name: 'width',
      label: 'Width (px)',
      type: 'number',
      default: 1920,
      min: 1,
      max: 100000,
      visible: (v) => v.solveFor === 'height' || v.solveFor === 'ratio',
    },
    {
      name: 'height',
      label: 'Height (px)',
      type: 'number',
      default: 1080,
      min: 1,
      max: 100000,
      visible: (v) => v.solveFor === 'width' || v.solveFor === 'ratio',
    },
    {
      name: 'ratioW',
      label: 'Ratio width',
      type: 'number',
      default: 16,
      min: 0.01,
      max: 1000,
      step: 0.01,
      visible: (v) => v.solveFor === 'height' || v.solveFor === 'width',
    },
    {
      name: 'ratioH',
      label: 'Ratio height',
      type: 'number',
      default: 9,
      min: 0.01,
      max: 1000,
      step: 0.01,
      visible: (v) => v.solveFor === 'height' || v.solveFor === 'width',
    },
    {
      name: 'filterRatio',
      label: 'Filter common ratios',
      type: 'select',
      default: 'all',
      options: [{ value: 'all', label: 'All' }, ...COMMON_RATIOS.map((r) => ({ value: r.name, label: r.name }))],
    },
  ],
  examples: [
    { label: '1920x1080 (16:9)', values: { solveFor: 'height', width: 1920, ratioW: 16, ratioH: 9 } },
    { label: 'Find the ratio of 1920x1080', values: { solveFor: 'ratio', width: 1920, height: 1080 } },
    {
      label: '2.39:1 cinemascope width from a 1080px height',
      values: { solveFor: 'width', height: 1080, ratioW: 2.39, ratioH: 1 },
    },
  ],
  run(values): ToolResult {
    const solveFor = str(values, 'solveFor', 'height') as SolveFor;
    const filterRatio = str(values, 'filterRatio', 'all');

    let result;
    try {
      result = solveAspect({
        solveFor,
        width: solveFor !== 'width' ? num(values, 'width', 1920) : undefined,
        height: solveFor !== 'height' ? num(values, 'height', 1080) : undefined,
        ratio: solveFor !== 'ratio' ? { w: num(values, 'ratioW', 16), h: num(values, 'ratioH', 9) } : undefined,
      });
    } catch (err) {
      if (err instanceof AspectRatioError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      throw err;
    }

    const filteredRatios = filterRatio === 'all' ? COMMON_RATIOS : COMMON_RATIOS.filter((r) => r.name === filterRatio);

    const resultPairs: [string, string][] = [
      ['Width', `${result.width}px`],
      ['Height', `${result.height}px`],
      ['Ratio', `${result.ratio.w} : ${result.ratio.h}`],
    ];
    if (result.roundingError !== undefined) {
      resultPairs.push(['Rounding error', result.roundingError.toFixed(4)]);
    }

    return {
      outputs: [
        { kind: 'keyvalue', label: 'Result', pairs: resultPairs },
        { kind: 'code', label: 'CSS', language: 'css', value: formatAspectRatioCss(result.ratio) },
        {
          kind: 'table',
          label: 'Common resolutions',
          table: {
            headers: ['Name', 'Width', 'Height', 'Ratio'],
            rows: COMMON_RESOLUTIONS.map((r) => [
              r.name,
              `${r.width}px`,
              `${r.height}px`,
              `${r.ratio.w} : ${r.ratio.h}`,
            ]),
            mono: [1, 2, 3],
          },
        },
        {
          kind: 'table',
          label: 'Common ratios',
          table: {
            headers: ['Ratio', 'Common uses'],
            rows: filteredRatios.map((r) => [r.name, r.commonUses]),
          },
        },
        {
          kind: 'note',
          tone: 'info',
          value: `Common ratios and resolutions above are cited to: ${COMMON_SIZES_SOURCE.map((c) => c.label).join('; ')}.`,
        },
      ],
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    };
  },
});
