import { SourceMapError, checkInput, meta, type DecodeReport } from '@fodt/source-map-decoder';
import {
  SOURCE_MAP_DECODER_NOT_STARTED_MESSAGE,
  SOURCE_MAP_DECODER_START_LIMIT_MESSAGE,
  SOURCE_MAP_DECODER_STOPPED_MESSAGE,
  SOURCE_MAP_DECODER_TIME_LIMIT_MESSAGE,
  SOURCE_MAP_DECODER_TIME_LIMIT_MS,
  SourceMapDecoderRunError,
  sourceMapDecoderInWorker,
} from '../lib/run-source-map-decoder-in-worker';
import { defineTool, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

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

function outputsOf(report: DecodeReport): OutputBlock[] {
  const outputs: OutputBlock[] = [{ kind: 'note', tone: 'info', value: FIRST_NOTE }];
  for (const note of report.notes) outputs.push({ kind: 'note', tone: note.tone, value: note.text });
  if (report.rows.length > 0) {
    outputs.push(framesBlock(report));
    outputs.push({ kind: 'code', label: 'Decoded trace', value: report.decoded });
  }
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
  ],
  async run(values, ctx): Promise<ToolResult> {
    const trace = str(values, 'trace');
    if (trace.trim() === '') return { outputs: [] };
    const maps = str(values, 'maps');

    try {
      // Refused before any background task starts, so an over-limit paste never reaches reading.
      checkInput({ trace, maps });
      const report = await sourceMapDecoderInWorker(
        { type: 'source-map-decoder-job', trace, maps, files: [], context: 2, hideIgnored: false },
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
