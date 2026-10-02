import {
  meta,
  checkFileSize,
  SpreadsheetConverterError,
  type TextFormat,
  type ToTextResult,
} from '@fodt/spreadsheet-converter';
import { spreadsheetConverterInWorker, SpreadsheetConverterRunError } from '../lib/run-spreadsheet-converter-in-worker';
import { defineTool, bool, files, str, type OutputBlock, type ToolResult, type Values } from '../lib/tool-ui';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Text up to this many characters is shown whole; longer text is shown cut, with the whole of it as a download. */
const SHOWN_CHARACTERS = 2000000;

const TEXT_FILES: Record<TextFormat, { name: string; mime: string; language?: string }> = {
  csv: { name: 'sheet.csv', mime: 'text/csv' },
  tsv: { name: 'sheet.tsv', mime: 'text/tab-separated-values' },
  json: { name: 'sheet.json', mime: 'application/json', language: 'json' },
  xml: { name: 'sheet.xml', mime: 'application/xml', language: 'xml' },
};

function isToText(values: Values): boolean {
  return str(values, 'mode', 'xlsx-to-text') === 'xlsx-to-text';
}

function textFormatOf(values: Values): TextFormat {
  const choice = str(values, 'output', 'csv');
  return choice === 'tsv' || choice === 'json' || choice === 'xml' ? choice : 'csv';
}

/** Column letters for a 0-based column number: 0 is A, 26 is AA. */
function columnLetters(col: number): string {
  let n = col + 1;
  let letters = '';
  while (n > 0) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** The converted sheet as page blocks: the sheets list, the text with its download, and a preview table. */
function textOutputs(result: ToTextResult, format: TextFormat): OutputBlock[] {
  const outputs: OutputBlock[] = [];
  outputs.push({
    kind: 'list',
    label: 'Sheets',
    items: result.sheets.map(
      (sheet, index) =>
        `${index + 1}. ${sheet.name} (${sheet.state}${index === result.chosen ? ', converted here' : ''})`,
    ),
  });

  const target = TEXT_FILES[format];
  if (result.text.length <= SHOWN_CHARACTERS) {
    outputs.push({
      kind: 'code',
      label: target.name,
      ...(target.language ? { language: target.language } : {}),
      value: result.text,
      download: target.name,
    });
  } else {
    // Cut on a whole character: a cut between the two halves of a surrogate pair would show a broken one.
    let shown = result.text.slice(0, SHOWN_CHARACTERS);
    if (/[\uD800-\uDBFF]$/.test(shown)) shown = shown.slice(0, -1);
    outputs.push({
      kind: 'code',
      label: `${target.name} (first ${shown.length.toLocaleString('en-US')} characters)`,
      ...(target.language ? { language: target.language } : {}),
      value: shown,
    });
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: `The text is ${result.text.length.toLocaleString('en-US')} characters, so only the first ${shown.length.toLocaleString('en-US')} are shown. The download holds all of it.`,
    });
    outputs.push({
      kind: 'files',
      label: 'Download',
      files: [{ name: target.name, mime: target.mime, content: result.text }],
    });
  }

  if (result.previewRows.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Preview',
      table: {
        headers: Array.from({ length: result.previewColumns }, (_, i) => columnLetters(i)),
        rows: result.previewRows,
        mono: Array.from({ length: result.previewColumns }, (_, i) => i),
      },
    });
    if (result.previewRows.length < result.rows) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `Showing ${result.previewRows.length} of ${result.rows} rows.`,
      });
    }
    if (result.previewColumns < result.columns) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `Showing ${result.previewColumns} of ${result.columns} columns in the preview; the text above has them all.`,
      });
    }
  }
  return outputs;
}

export default defineTool({
  id: 'spreadsheet-converter',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Unpacking a workbook and building a sheet from it is real background work, so this waits for a deliberate Run
  // press and offers Cancel while it runs. Every run goes through a new worker with a 30 second limit (see
  // run-spreadsheet-converter-in-worker.ts's own comment): a package can be built to take very long, so the page, not
  // the code doing the work, decides when a run has taken too long.
  autoRun: false,
  cancellable: true,
  fields: [
    {
      name: 'mode',
      label: 'Mode',
      type: 'radio',
      default: 'xlsx-to-text',
      options: [
        { value: 'xlsx-to-text', label: 'Spreadsheet to text' },
        { value: 'text-to-xlsx', label: 'Text to spreadsheet' },
      ],
    },
    {
      name: 'file',
      label: 'Spreadsheet file',
      type: 'file',
      accept: `.xlsx,${XLSX_MIME}`,
      help: 'An .xlsx file. It is read in your browser and never uploaded or changed.',
      visible: (v) => isToText(v),
    },
    {
      name: 'sheet',
      label: 'Sheet (name or number)',
      type: 'text',
      default: '',
      help: 'Leave it empty for the first visible sheet. A whole number picks that position, counting hidden sheets.',
      visible: (v) => isToText(v),
    },
    {
      name: 'output',
      label: 'Output',
      type: 'select',
      default: 'csv',
      options: [
        { value: 'csv', label: 'CSV' },
        { value: 'tsv', label: 'TSV' },
        { value: 'json', label: 'JSON' },
        { value: 'xml', label: 'XML' },
      ],
      visible: (v) => isToText(v),
    },
    {
      name: 'header',
      label: 'First row is a header',
      type: 'checkbox',
      default: true,
      help: 'JSON only: each later row becomes an object keyed by the first row.',
      visible: (v) => isToText(v) && str(v, 'output', 'csv') === 'json',
    },
    {
      name: 'keepTypes',
      label: 'Keep types',
      type: 'checkbox',
      default: false,
      help: 'JSON only: numbers and booleans stay numbers and booleans, and empty cells become null.',
      visible: (v) => isToText(v) && str(v, 'output', 'csv') === 'json',
    },
    {
      name: 'datesAsSerials',
      label: 'Show dates as serial numbers',
      type: 'checkbox',
      default: false,
      help: 'Show the number a date is stored as, and interpret nothing.',
      visible: (v) => isToText(v),
    },
    {
      name: 'input',
      label: 'Text',
      type: 'textarea',
      rows: 8,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'CSV, TSV or JSON (an array of objects or an array of arrays).',
      visible: (v) => !isToText(v),
    },
    {
      name: 'inputFormat',
      label: 'Input format',
      type: 'select',
      default: 'csv',
      options: [
        { value: 'csv', label: 'CSV' },
        { value: 'tsv', label: 'TSV' },
        { value: 'json', label: 'JSON' },
      ],
      visible: (v) => !isToText(v),
    },
    {
      name: 'detectTypes',
      label: 'Detect numbers and booleans',
      type: 'checkbox',
      default: true,
      help: 'Off: every cell is text. On: plain numbers and TRUE or FALSE are stored as such; a digit string with a leading zero or more than 15 digits stays text.',
      visible: (v) => !isToText(v),
    },
    {
      name: 'sheetName',
      label: 'Sheet name',
      type: 'text',
      default: 'Sheet1',
      help: 'Up to 31 characters, none of [ ] : * ? / \\',
      visible: (v) => !isToText(v),
    },
  ],
  examples: [
    {
      label: 'CSV with a leading zero to xlsx',
      values: {
        mode: 'text-to-xlsx',
        inputFormat: 'csv',
        input: 'id,code,price\n1,00123,9.5\n2,00456,12\n3,00789,7.25',
        detectTypes: true,
        sheetName: 'Sheet1',
      },
    },
    {
      label: 'JSON records to xlsx',
      values: {
        mode: 'text-to-xlsx',
        inputFormat: 'json',
        input: '[{"name":"Ada","age":36,"member":true},{"name":"Bo","age":41,"member":false,"tags":["a","b"]}]',
        detectTypes: true,
        sheetName: 'People',
      },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    try {
      if (!isToText(values)) {
        const text = str(values, 'input');
        if (!text.trim()) return { outputs: [] };
        const inputChoice = str(values, 'inputFormat', 'csv');
        const result = await spreadsheetConverterInWorker(
          {
            type: 'spreadsheet-converter-job',
            job: {
              direction: 'text-to-xlsx',
              text,
              inputFormat: inputChoice === 'tsv' || inputChoice === 'json' ? inputChoice : 'csv',
              detectTypes: bool(values, 'detectTypes', true),
              sheetName: str(values, 'sheetName', 'Sheet1'),
            },
          },
          ctx,
        );
        if (result.direction !== 'text-to-xlsx') return { outputs: [] };
        const outputs: OutputBlock[] = [
          {
            kind: 'files',
            label: 'Download',
            files: [{ name: 'converted.xlsx', mime: XLSX_MIME, content: result.bytes }],
          },
          {
            kind: 'table',
            label: 'Cells written',
            table: {
              headers: ['Cell', 'Value', 'Stored as'],
              rows: result.preview.map((cell) => [cell.ref, cell.value, cell.type]),
              mono: [0, 1, 2],
            },
          },
        ];
        if (result.preview.length < result.cellCount) {
          outputs.push({
            kind: 'note',
            tone: 'info',
            value: `Showing ${result.preview.length} of ${result.cellCount} cells.`,
          });
        }
        return {
          outputs,
          ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
          stats: [
            ['Rows', String(result.rowCount)],
            ['Columns', String(result.columnCount)],
            ['Cells written', String(result.cellCount)],
          ],
        };
      }

      const file = files(values, 'file')[0];
      if (!file) return { outputs: [] };
      // Refused before any byte of the file is read.
      checkFileSize(file.size);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = textFormatOf(values);
      const result = await spreadsheetConverterInWorker(
        {
          type: 'spreadsheet-converter-job',
          job: {
            direction: 'xlsx-to-text',
            bytes,
            sheet: str(values, 'sheet'),
            output: format,
            header: bool(values, 'header', true),
            keepTypes: bool(values, 'keepTypes'),
            datesAsSerials: bool(values, 'datesAsSerials'),
          },
        },
        ctx,
      );
      if (result.direction !== 'xlsx-to-text') return { outputs: [] };
      return {
        outputs: textOutputs(result, format),
        ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        stats: [
          ['Sheet', result.sheets[result.chosen]?.name ?? ''],
          ['Rows', String(result.rows)],
          ['Columns', String(result.columns)],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note already owns that
      // message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof SpreadsheetConverterError || err instanceof SpreadsheetConverterRunError) {
        return {
          outputs: [],
          errors: [
            {
              message: err.message,
              ...(err.line !== undefined ? { line: err.line } : {}),
              ...(err.column !== undefined ? { column: err.column } : {}),
            },
          ],
        };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
