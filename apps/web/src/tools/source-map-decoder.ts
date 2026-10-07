import { MAX_CONTEXT_LINES, SourceMapError, checkInput, meta, type DecodeReport } from '@fodt/source-map-decoder';
import {
  SOURCE_MAP_DECODER_NOT_STARTED_MESSAGE,
  SOURCE_MAP_DECODER_START_LIMIT_MESSAGE,
  SOURCE_MAP_DECODER_STOPPED_MESSAGE,
  SOURCE_MAP_DECODER_TIME_LIMIT_MESSAGE,
  SOURCE_MAP_DECODER_TIME_LIMIT_MS,
  SourceMapDecoderRunError,
  sourceMapDecoderInWorker,
} from '../lib/run-source-map-decoder-in-worker';
import {
  bool,
  defineTool,
  files,
  formatBytes,
  num,
  str,
  type OutputBlock,
  type ToolIssue,
  type ToolResult,
} from '../lib/tool-ui';

/** The fixed sentences the background helper can give, which are shown as they are. */
const FIXED_MESSAGES = new Set([
  SOURCE_MAP_DECODER_NOT_STARTED_MESSAGE,
  SOURCE_MAP_DECODER_START_LIMIT_MESSAGE,
  SOURCE_MAP_DECODER_STOPPED_MESSAGE,
  SOURCE_MAP_DECODER_TIME_LIMIT_MESSAGE,
]);

/** What the page says first: what it reads and what it never does. */
const FIRST_NOTE =
  'The trace and the maps are read on this page and nothing is uploaded or kept. No address in a map or a trace is requested: a sourceMappingURL comment or a sources entry is only text. Engines print different columns for the same throw, so a column a few characters off is expected.';

/** A small example: two TypeScript files bundled and minified, and the stack of an error thrown from the bundle. */
const EXAMPLE_TRACE = [
  'RangeError: value must be positive: -2',
  '    at e (https://example.test/assets/min.js:1:35)',
  '    at n.add (https://example.test/assets/min.js:1:128)',
  '    at u (https://example.test/assets/min.js:1:178)',
  '    at i (https://example.test/assets/min.js:1:220)',
  '    at https://example.test/assets/min.js:1:234',
].join('\n');
const EXAMPLE_MAP = JSON.stringify({
  version: 3,
  sources: ['src/math.ts', 'src/main.ts'],
  sourcesContent: [
    "export function checkPositive(value: number): number {\n  if (value <= 0) {\n    throw new RangeError('value must be positive: ' + value);\n  }\n  return value;\n}\n\nexport class Accumulator {\n  total = 0;\n  add(value: number): void {\n    this.total += checkPositive(value);\n  }\n}\n",
    "import { Accumulator } from './math';\n\nfunction sumAll(values: number[]): number {\n  const acc = new Accumulator();\n  for (const v of values) {\n    acc.add(v);\n  }\n  return acc.total;\n}\n\nexport function run(): number {\n  return sumAll([3, 5, -2, 7]);\n}\n\nrun();\n",
  ],
  mappings:
    'MAAO,SAASA,EAAcC,EAAuB,CACnD,GAAIA,GAAS,EACX,MAAM,IAAI,WAAW,2BAA6BA,CAAK,EAEzD,OAAOA,CACT,CAEO,IAAMC,EAAN,KAAkB,CACvB,MAAQ,EACR,IAAID,EAAqB,CACvB,KAAK,OAASD,EAAcC,CAAK,CACnC,CACF,ECVA,SAASE,EAAOC,EAA0B,CACxC,IAAMC,EAAM,IAAIC,EAChB,QAAWC,KAAKH,EACdC,EAAI,IAAIE,CAAC,EAEX,OAAOF,EAAI,KACb,CAEO,SAASG,GAAc,CAC5B,OAAOL,EAAO,CAAC,EAAG,EAAG,GAAI,CAAC,CAAC,CAC7B,CAEAK,EAAI',
  names: ['checkPositive', 'value', 'Accumulator', 'sumAll', 'values', 'acc', 'Accumulator', 'v', 'run'],
});

function framesBlock(report: DecodeReport): OutputBlock {
  return {
    kind: 'table',
    label: 'Frames',
    table: {
      headers: ['#', 'Generated', 'Original', 'Name here', 'Function', 'Note'],
      rows: report.rows.map((row) => [
        row.number,
        row.generated,
        row.original,
        row.name ?? '',
        row.functionName ?? row.traceFunction,
        row.note,
      ]),
      mono: [1, 2, 3, 4],
    },
  };
}

function mapsBlock(report: DecodeReport): OutputBlock {
  return {
    kind: 'table',
    label: 'Maps read',
    table: {
      headers: ['Map', 'Kind', 'Sources', 'Names', 'Mappings', 'Size', 'Findings'],
      rows: report.maps.map((info) => [
        info.label,
        !info.usable ? 'not readable' : info.kind === 'index map' ? `index map, ${info.sections} sections` : 'map',
        info.sources,
        info.names,
        info.usable ? `${info.segments} segments on ${info.generatedLines} lines` : '',
        formatBytes(info.bytes),
        info.errors + info.warnings === 0 ? 'none' : `${info.errors} errors, ${info.warnings} warnings`,
      ]),
      mono: [0],
    },
  };
}

function findingsBlock(report: DecodeReport): OutputBlock {
  const items = report.findings.map(
    (finding) => `Map ${finding.map}, ${finding.level === 'error' ? 'error' : 'warning'}: ${finding.message}`,
  );
  if (report.findingsLeftOut > 0) items.push(`and ${report.findingsLeftOut} more findings are not shown`);
  return { kind: 'list', label: 'Findings', items };
}

/** Lines of original source with their numbers, the frame's own line marked with an arrow. */
function excerptBlock(excerpt: DecodeReport['excerpts'][number]): OutputBlock {
  const width = String(excerpt.startLine + excerpt.lines.length - 1).length;
  const value = excerpt.lines
    .map((text, i) => `${i === excerpt.marker ? '>' : ' '} ${String(excerpt.startLine + i).padStart(width)}  ${text}`)
    .join('\n');
  return { kind: 'code', label: `Original source around frame ${excerpt.frame} (${excerpt.source})`, value };
}

function outputsOf(report: DecodeReport): OutputBlock[] {
  const outputs: OutputBlock[] = [{ kind: 'note', tone: 'info', value: FIRST_NOTE }];
  const decoded = report.rows.filter((row) => row.status === 'mapped').length;
  if (report.rows.length > 0) {
    outputs.push({
      kind: 'note',
      tone: decoded === report.rows.length ? 'success' : 'info',
      value: `${decoded} of ${report.rows.length} frames ${report.rows.length === 1 ? 'was' : 'were'} decoded.`,
    });
  }
  for (const note of report.notes) outputs.push({ kind: 'note', tone: note.tone, value: note.text });
  if (report.rows.length > 0) {
    outputs.push(framesBlock(report));
    outputs.push({ kind: 'code', label: 'Decoded trace', value: report.decoded });
  }
  if (report.maps.length > 0) outputs.push(mapsBlock(report));
  if (report.findings.length > 0) outputs.push(findingsBlock(report));
  for (const excerpt of report.excerpts) outputs.push(excerptBlock(excerpt));
  return outputs;
}

function failure(err: unknown): ToolResult {
  const issue = (message: string): ToolIssue => ({ message });
  if (err instanceof SourceMapError || err instanceof SourceMapDecoderRunError) {
    return { outputs: [], errors: [issue(err.message)] };
  }
  if (err instanceof Error && FIXED_MESSAGES.has(err.message)) return { outputs: [], errors: [issue(err.message)] };
  return { outputs: [], errors: [issue('Could not decode this trace.')] };
}

export default defineTool({
  id: 'source-map-decoder',
  // The decode runs in a new background task with a 20 second limit (see run-source-map-decoder-in-worker.ts's own
  // comment): the maps can be tens of megabytes, so the page, not the decoder, decides when a run has taken too long, and
  // Cancel stops it at once.
  autoRun: false,
  cancellable: true,
  runLimit: { ms: SOURCE_MAP_DECODER_TIME_LIMIT_MS },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'trace',
      label: 'Stack trace',
      type: 'textarea',
      rows: 10,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'A stack trace from V8 (Chrome, Node), SpiderMonkey (Firefox) or JavaScriptCore (Safari).',
    },
    {
      name: 'maps',
      label: 'Source maps',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'One or more maps, one after another, or a data: address that holds a map. Up to 20 maps of 50 MiB each.',
    },
    {
      name: 'mapFiles',
      label: 'Map files',
      type: 'file',
      accept: '.map,.json,application/json',
      multiple: true,
      help: 'Open .map files instead of pasting them. A file is matched to the frames of the script it is named after, so min.js.map goes with min.js.',
    },
    {
      name: 'context',
      label: 'Lines of context',
      type: 'number',
      default: 2,
      min: 0,
      max: MAX_CONTEXT_LINES,
      step: 1,
      help: 'Lines of original source shown either side of a frame, 0 to 5.',
    },
    {
      name: 'hideIgnored',
      label: 'Hide ignored frames',
      type: 'checkbox',
      default: false,
      help: "Hide frames whose source is on the map's ignore list, usually library code.",
    },
  ],
  examples: [
    {
      label: 'esbuild bundle, V8 stack',
      values: { trace: EXAMPLE_TRACE, maps: EXAMPLE_MAP },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const trace = str(values, 'trace');
    if (trace.trim() === '') return { outputs: [] };
    const maps = str(values, 'maps');
    const opened = files(values, 'mapFiles');
    const context = num(values, 'context', 2);
    // A number outside its range, or one that is not whole, is refused by name and never sizes anything.
    if (!Number.isInteger(context) || context < 0 || context > MAX_CONTEXT_LINES) {
      return {
        outputs: [],
        errors: [{ message: `Lines of context must be a whole number from 0 to ${MAX_CONTEXT_LINES}.` }],
      };
    }

    try {
      // Refused before any background task starts or any file is read: sizes come from the file objects alone.
      checkInput({ trace, maps, fileSizes: opened.map((file) => file.size) });
      const report = await sourceMapDecoderInWorker(
        {
          type: 'source-map-decoder-job',
          trace,
          maps,
          files: opened,
          context,
          hideIgnored: bool(values, 'hideIgnored'),
        },
        ctx,
      );
      return { outputs: outputsOf(report) };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note already owns that
      // message.
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
