import {
  HarViewerError,
  MAX_ENTRIES,
  PAGE_SIZE,
  checkFileSize,
  listRequests,
  meta,
  readHar,
  type Har,
  type ListOptions,
} from '@fodt/har-viewer';
import {
  bool,
  defineTool,
  files,
  str,
  type Field,
  type OutputBlock,
  type ToolExample,
  type ToolResult,
  type Values,
} from '../lib/tool-ui';

/** A request as the HAR 1.2 specification lists its fields, for the examples. */
function exampleEntry(
  started: string,
  method: string,
  url: string,
  status: number,
  statusText: string,
  headers: { name: string; value: string }[],
  size: number,
  timings: Record<string, number>,
): unknown {
  return {
    startedDateTime: started,
    time: Object.values(timings)
      .filter((t) => t !== -1)
      .reduce((sum, t) => sum + t, 0),
    request: {
      method,
      url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers,
      queryString: [],
      headersSize: -1,
      bodySize: 0,
    },
    response: {
      status,
      statusText,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      content: { size, mimeType: 'text/html' },
      redirectURL: '',
      headersSize: -1,
      bodySize: size,
    },
    cache: {},
    timings,
  };
}

function exampleRecording(entries: unknown[]): string {
  return JSON.stringify(
    { log: { version: '1.2', creator: { name: 'Example recorder', version: '1' }, entries } },
    null,
    2,
  );
}

const examples: ToolExample[] = [
  {
    label: 'Two requests with a cookie',
    values: {
      pasted: exampleRecording([
        exampleEntry(
          '2026-01-05T10:00:00.000Z',
          'GET',
          'https://example.com/',
          200,
          'OK',
          [
            { name: 'Host', value: 'example.com' },
            { name: 'Cookie', value: 'session=example-value-not-a-real-secret' },
          ],
          1256,
          { blocked: 1, dns: 8, connect: 22, send: 1, wait: 40, receive: 6 },
        ),
        exampleEntry(
          '2026-01-05T10:00:00.250Z',
          'GET',
          'https://example.com/app.js',
          200,
          'OK',
          [{ name: 'Host', value: 'example.com' }],
          48210,
          { blocked: 0, dns: -1, connect: -1, send: 1, wait: 30, receive: 14 },
        ),
      ]),
      filter: '',
      method: '',
      status: '',
      sort: 'start',
      reveal: false,
      bodies: false,
      row: 0,
      page: 1,
    },
  },
  {
    label: 'A failed request',
    values: {
      pasted: exampleRecording([
        exampleEntry(
          '2026-01-05T10:01:00.000Z',
          'GET',
          'https://example.com/missing',
          404,
          'Not Found',
          [{ name: 'Host', value: 'example.com' }],
          310,
          { send: 1, wait: 25, receive: 2 },
        ),
      ]),
      filter: '',
      method: '',
      status: '4xx',
      sort: 'start',
      reveal: false,
      bodies: false,
      row: 0,
      page: 1,
    },
  },
];

const fields: Field[] = [
  {
    name: 'file',
    label: 'Open a recording',
    type: 'file',
    accept: '.har,.json,application/json',
    help: 'A HAR file up to 50 MiB, read in your browser. Nothing in it is sent, replayed or opened.',
  },
  {
    name: 'pasted',
    label: 'Recording text',
    type: 'textarea',
    rows: 10,
    placeholder: 'Type or paste here. Nothing leaves your browser.',
    help: 'Used only when no file is attached above.',
  },
  { name: 'filter', label: 'URL contains', type: 'text', help: 'Part of the address, in any letter case.' },
  { name: 'method', label: 'Method', type: 'text', help: 'For example GET. Blank means any.' },
  {
    name: 'status',
    label: 'Status',
    type: 'text',
    help: 'For example 404, or 4xx for a whole class. Blank means any.',
  },
  {
    name: 'sort',
    label: 'Sort by',
    type: 'select',
    default: 'start',
    options: [
      { value: 'start', label: 'Recording order' },
      { value: 'time', label: 'Time, slowest first' },
      { value: 'size', label: 'Size, largest first' },
      { value: 'status', label: 'Status, lowest first' },
    ],
  },
  {
    name: 'reveal',
    label: 'Show sensitive values',
    type: 'checkbox',
    default: false,
    help: 'Off: cookies, tokens, keys and passwords show only their first four characters and their length.',
  },
  { name: 'bodies', label: 'Show bodies', type: 'checkbox', default: false },
  {
    name: 'row',
    label: 'Request to inspect',
    type: 'number',
    default: 0,
    min: 0,
    max: MAX_ENTRIES,
    help: 'The number in the first column of the list. 0 shows no request.',
  },
  { name: 'page', label: 'Page', type: 'number', default: 1, min: 1, max: MAX_ENTRIES / PAGE_SIZE },
];

/** The parsed recording of the open file, kept in page memory only; choosing another file replaces it. */
const readFiles = new WeakMap<File, Har>();
/** The parsed recording of the pasted text, one at a time. */
let pasted: { text: string; har: Har } | undefined;

/** The recording to show: the picked file, else the pasted text, else nothing. */
async function recordingOf(values: Values): Promise<Har | undefined> {
  const file = files(values, 'file')[0];
  if (file) {
    const known = readFiles.get(file);
    if (known) return known;
    checkFileSize(file.size);
    const har = readHar(await file.text());
    readFiles.set(file, har);
    return har;
  }
  const text = str(values, 'pasted');
  if (text.trim() === '') return undefined;
  if (pasted && pasted.text === text) return pasted.har;
  const har = readHar(text);
  pasted = { text, har };
  return har;
}

/** A whole number field, refused with its label and range when it is outside them. */
function wholeNumber(values: Values, name: string, label: string, fallback: number, min: number, max: number): number {
  const raw = values[name];
  const value = raw === undefined || raw === null || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HarViewerError(`${label} must be a whole number from ${min} to ${max.toLocaleString('en-US')}.`);
  }
  return value;
}

function count(n: number): string {
  return n.toLocaleString('en-US');
}

export default defineTool({
  id: 'har-viewer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields,
  examples,
  async run(values, ctx): Promise<ToolResult> {
    try {
      const page = wholeNumber(values, 'page', 'Page', 1, 1, MAX_ENTRIES / PAGE_SIZE);
      wholeNumber(values, 'row', 'Request to inspect', 0, 0, MAX_ENTRIES);
      const har = await recordingOf(values);
      if (har === undefined) return { outputs: [] };

      const options: ListOptions = {
        filter: str(values, 'filter'),
        method: str(values, 'method'),
        status: str(values, 'status'),
        sort: str(values, 'sort', 'start') as ListOptions['sort'],
        reveal: bool(values, 'reveal', false),
        page,
      };
      const result = listRequests(har, options);
      const outputs: OutputBlock[] = [];
      if (har.truncated) {
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value: `The recording holds ${count(har.total)} requests. The first ${count(MAX_ENTRIES)} are listed.`,
        });
      }
      if (har.entries.length === 0) {
        outputs.push({ kind: 'note', tone: 'info', value: 'No requests in this recording.' });
      } else if (result.rows.length === 0) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value:
            result.total === 0
              ? 'No request matches the filters.'
              : `Page ${page} has no requests: there ${Math.ceil(result.total / PAGE_SIZE) === 1 ? 'is 1 page' : `are ${Math.ceil(result.total / PAGE_SIZE)} pages`}.`,
        });
      } else {
        outputs.push({
          kind: 'table',
          label: 'Requests',
          table: {
            headers: ['#', 'Method', 'URL', 'Status', 'Size', 'Time (ms)', 'Flags'],
            rows: result.rows.map((row) => [
              row.index,
              row.method,
              row.url,
              row.status,
              row.size,
              row.time,
              row.flags > 0 ? `Sensitive (${row.flags})` : '',
            ]),
            mono: [1, 2],
          },
        });
      }
      return {
        outputs,
        stats: [
          ['Requests in the recording', count(har.total)],
          ['Matching', count(result.total)],
          ['HAR version', har.version],
          ...(har.creator === '' ? [] : ([['Written by', har.creator]] as [string, string][])),
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof HarViewerError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column, path: err.path }] };
      }
      const message = err instanceof Error ? err.message : 'Could not read that recording.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
