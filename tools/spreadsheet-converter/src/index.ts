import meta from './meta.json';
import { checkFileSize, readXlsx, resolveSheetIndex } from './reader';
import { sheetToText, sheetWidth } from './output';
import { parseTextTable } from './text-table';
import { writeXlsx } from './writer';
import { serialToIso } from './dates';
import { PREVIEW_COLUMNS, PREVIEW_ROWS, type ConvertJob, type ConvertResult, type Sheet, type Workbook } from './types';

export { meta };
export * from './types';
export { checkFileSize, readXlsx, sheetToText, parseTextTable, writeXlsx, serialToIso };

/** Chooses a sheet: blank is the first visible sheet, a whole number is a 1-based position, otherwise the exact name. */
export function pickSheet(workbook: Workbook, selector: string): Sheet {
  return workbook.sheets[resolveSheetIndex(workbook.sheets, selector)]!;
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
  const columns = sheetWidth(sheet);
  const previewColumns = Math.min(columns, PREVIEW_COLUMNS);
  return {
    direction: 'xlsx-to-text',
    text: converted.text,
    sheets: workbook.sheets.map(({ name, state }) => ({ name, state })),
    chosen: workbook.sheets.indexOf(sheet),
    rows: sheet.rows.length,
    columns,
    previewRows: sheet.rows
      .slice(0, PREVIEW_ROWS)
      .map((row) => Array.from({ length: previewColumns }, (_, c) => row[c]?.text ?? '')),
    previewColumns,
    warnings: [...workbook.warnings, ...converted.warnings],
  };
}
