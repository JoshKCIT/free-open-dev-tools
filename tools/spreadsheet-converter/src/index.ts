import meta from './meta.json';
import { readXlsx } from './reader';
import { sheetGrid, sheetToText, sheetWidth } from './output';
import { parseTextTable } from './text-table';
import { writeXlsx } from './writer';
import { serialToIso } from './dates';
import {
  MAX_FILE_BYTES,
  PREVIEW_COLUMNS,
  PREVIEW_ROWS,
  SpreadsheetConverterError,
  type ConvertJob,
  type ConvertResult,
  type Sheet,
  type Workbook,
} from './types';

export { meta };
export * from './types';
export { readXlsx, sheetToText, parseTextTable, writeXlsx, serialToIso };

/** The plain sentence for a file over the limit, thrown before a byte of it is read or unzipped. */
export function checkFileSize(byteLength: number): void {
  if (byteLength <= MAX_FILE_BYTES) return;
  throw new SpreadsheetConverterError(
    `This file is ${(byteLength / 1048576).toFixed(1)} MiB (${byteLength.toLocaleString('en-US')} bytes). The limit is 20 MiB because the whole workbook is unpacked in memory.`,
  );
}

/** Chooses a sheet: blank is the first visible sheet, a whole number is a 1-based position, otherwise the exact name. */
export function pickSheet(workbook: Workbook, selector: string): Sheet {
  const wanted = selector.trim();
  const first = workbook.sheets.find((sheet) => sheet.state === 'visible') ?? workbook.sheets[0];
  if (wanted === '') return first!;
  const named = workbook.sheets.find((sheet) => sheet.name === wanted);
  if (named) return named;
  throw new SpreadsheetConverterError(`Sheet (name or number): there is no sheet named "${wanted}".`);
}

/** Both directions in one call: the single entry the background worker runs. */
export function convertSpreadsheet(job: ConvertJob): ConvertResult {
  if (job.direction === 'text-to-xlsx') {
    const parsed = parseTextTable(job.text, job.inputFormat);
    const written = writeXlsx(parsed.rows, { sheetName: job.sheetName, detectTypes: job.detectTypes });
    return { direction: 'text-to-xlsx', ...written, warnings: [...parsed.warnings, ...written.warnings] };
  }

  const workbook = readXlsx(job.bytes, { datesAsSerials: job.datesAsSerials, sheet: job.sheet });
  const sheet = pickSheet(workbook, job.sheet);
  const converted = sheetToText(sheet, job.output, { header: job.header, keepTypes: job.keepTypes });
  const grid = sheetGrid(sheet);
  const columns = sheetWidth(sheet);
  const previewColumns = Math.min(columns, PREVIEW_COLUMNS);
  return {
    direction: 'xlsx-to-text',
    text: converted.text,
    sheets: workbook.sheets.map(({ name, state }) => ({ name, state })),
    chosen: workbook.sheets.indexOf(sheet),
    rows: sheet.rows.length,
    columns,
    previewRows: grid.slice(0, PREVIEW_ROWS).map((row) => row.slice(0, previewColumns)),
    previewColumns,
    warnings: [...workbook.warnings, ...converted.warnings],
  };
}
