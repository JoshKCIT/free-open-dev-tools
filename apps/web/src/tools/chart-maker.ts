import { ChartError, makeChart, meta, type ChartType } from '@fodt/chart-maker';
import { ChartPngError, chartSvgToPng, svgDataUrl } from '../lib/run-chart-maker-on-canvas';
import { bool, defineTool, formatBytes, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const PLACEHOLDER = 'Type or paste here. Nothing leaves your browser.';

const NOTHING_YET =
  'There is no chart yet. Type one row per line: a label, a comma or a tab, then a number. ' +
  'Tick Header row when the first row names the columns.';

const PALETTE_NAMES = ['default', 'colour-blind', 'grayscale', 'high-contrast'];

function chartType(value: string): ChartType {
  return value === 'line' || value === 'pie' ? value : 'bar';
}

export default defineTool({
  id: 'chart-maker',
  // Each change redraws the chart; the picture is small and the work is a few milliseconds.
  autoRun: true,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'data',
      label: 'Data',
      type: 'textarea',
      rows: 8,
      placeholder: PLACEHOLDER,
      help: 'One row per line: a label, then one or more numbers, separated by commas or tabs. Up to 64 KiB, 200 rows and 8 number columns.',
    },
    {
      name: 'type',
      label: 'Chart',
      type: 'radio',
      default: 'bar',
      options: [
        { value: 'bar', label: 'Bar' },
        { value: 'line', label: 'Line' },
        { value: 'pie', label: 'Pie' },
      ],
      help: 'A pie chart draws the first number column only.',
    },
    {
      name: 'format',
      label: 'Format',
      type: 'radio',
      default: 'svg',
      options: [
        { value: 'svg', label: 'SVG' },
        { value: 'png', label: 'PNG' },
      ],
      help: 'The SVG is always shown. PNG adds a picture file drawn from it at twice the size.',
    },
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      default: '',
      help: 'Up to 60 characters. It names the chart for screen readers too.',
    },
    {
      name: 'xLabel',
      label: 'X axis',
      type: 'text',
      default: '',
      visible: (values) => str(values, 'type', 'bar') !== 'pie',
      help: 'Up to 40 characters.',
    },
    {
      name: 'yLabel',
      label: 'Y axis',
      type: 'text',
      default: '',
      visible: (values) => str(values, 'type', 'bar') !== 'pie',
      help: 'Up to 40 characters.',
    },
    {
      name: 'header',
      label: 'Header row',
      type: 'checkbox',
      default: true,
      help: 'The first row names the label column and each series.',
    },
    {
      name: 'legend',
      label: 'Legend',
      type: 'checkbox',
      default: true,
      help: 'Drawn for a pie, and for a chart with more than one series.',
    },
    {
      name: 'values',
      label: 'Values',
      type: 'checkbox',
      default: false,
      help: 'Write each value on its bar, point or slice.',
    },
    {
      name: 'palette',
      label: 'Palette',
      type: 'select',
      default: 'default',
      options: [
        { value: 'default', label: 'Default' },
        { value: 'colour-blind', label: 'Colour-blind safe' },
        { value: 'grayscale', label: 'Grayscale' },
        { value: 'high-contrast', label: 'High contrast' },
      ],
    },
  ],
  examples: [
    {
      label: 'Bar: sign-ups',
      values: {
        data: 'Month,Sign-ups\nJan,12\nFeb,19\nMar,3\nApr,25\nMay,17',
        type: 'bar',
        title: 'Monthly sign-ups',
        xLabel: 'Month',
        yLabel: 'Sign-ups',
      },
    },
    {
      label: 'Line: two series',
      values: {
        data: 'Day,Visits,Orders\nMon,120,12\nTue,150,18\nWed,90,9\nThu,170,22\nFri,140,15\nSat,60,5',
        type: 'line',
        title: 'Visits and orders',
        xLabel: 'Day',
        yLabel: 'Count',
      },
    },
    {
      label: 'Pie: shares',
      values: {
        data: 'Browser,Share\nChrome,63.5\nSafari,20.2\nEdge,5.3\nFirefox,2.9\nOther,8.1',
        type: 'pie',
        title: 'Share of visits',
        values: true,
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const text = str(values, 'data', '');
    const type = chartType(str(values, 'type', 'bar'));
    // Only the fields shown for the chosen chart are read: a hidden axis label never changes a pie.
    const asPie = type === 'pie';
    const paletteName = str(values, 'palette', 'default');

    try {
      const chart = makeChart(text, {
        type,
        title: str(values, 'title', ''),
        xLabel: asPie ? '' : str(values, 'xLabel', ''),
        yLabel: asPie ? '' : str(values, 'yLabel', ''),
        header: bool(values, 'header', true),
        legend: bool(values, 'legend', true),
        values: bool(values, 'values', false),
        palette: PALETTE_NAMES.includes(paletteName) ? paletteName : 'default',
      });
      if (chart === null) {
        if (text.trim() === '') return { outputs: [] };
        return { outputs: [{ kind: 'note', tone: 'info', value: NOTHING_YET }] };
      }

      const outputs: OutputBlock[] = [
        { kind: 'image', label: 'Chart', src: svgDataUrl(chart.svg), alt: chart.alt, width: 800, height: 480 },
      ];
      const stats: [string, string][] = [
        ['Points', String(chart.table.rows.length)],
        ['Series', String(type === 'pie' ? 1 : chart.table.headers.length - 1)],
        ['SVG size', formatBytes(new TextEncoder().encode(chart.svg).length)],
      ];
      if (str(values, 'format', 'svg') === 'png') {
        const png = await chartSvgToPng(chart.svg, 2);
        // A result that is ready after the form has moved on is not offered.
        if (ctx.signal.aborted) throw new ChartPngError('The run was cancelled.');
        outputs.push({
          kind: 'files',
          label: 'PNG',
          files: [{ name: 'chart.png', mime: 'image/png', content: png }],
        });
        stats.push(['PNG size', formatBytes(png.byteLength)]);
      }
      outputs.push({ kind: 'list', label: 'Description', items: chart.description });
      outputs.push({ kind: 'table', label: 'Data', table: chart.table });
      outputs.push({ kind: 'code', label: 'SVG', language: 'xml', value: chart.svg, download: 'chart.svg' });
      return { outputs, stats, warnings: chart.notes.length > 0 ? chart.notes : undefined };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner already owns the cancellation.
      if (ctx.signal.aborted) throw err;
      if (err instanceof ChartError || err instanceof ChartPngError) {
        return { outputs: [], errors: [{ message: err.message }] };
      }
      return { outputs: [], errors: [{ message: 'Could not draw this chart.' }] };
    }
  },
});
