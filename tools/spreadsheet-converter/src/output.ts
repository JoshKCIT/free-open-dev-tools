/**
 * Writes one sheet as text: CSV (RFC 4180), TSV, JSON or a fixed XML layout. Nothing is trimmed, rounded or
 * reinterpreted: a cell's text goes out as the file stores it, and whatever a format cannot carry is refused or named.
 */
import { formatCsv } from './csv';
import { EMPTY_CELL } from './reader';
import { escapeAttribute, escapeNonXml, escapeText } from './xml';
import { SpreadsheetConverterError, type Cell, type Sheet, type TextFormat, type TextOptions } from './types';

/** Warnings listed in full; further ones are counted. */
const MAX_WARNINGS = 20;
/** A JSON reader that uses doubles keeps integers exactly only up to 2 to the 53. */
const MAX_SAFE_MAGNITUDE = 9007199254740992;
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/** The widest row of a sheet: every row is padded to this many cells on output. */
export function sheetWidth(sheet: Sheet): number {
  let width = 0;
  for (const row of sheet.rows) width = Math.max(width, row.length);
  return width;
}

/** The sheet as a rectangle of text. */
export function sheetGrid(sheet: Sheet): string[][] {
  const width = sheetWidth(sheet);
  return sheet.rows.map((row) => {
    const out: string[] = new Array<string>(width);
    for (let c = 0; c < width; c++) out[c] = row[c]?.text ?? '';
    return out;
  });
}

function warningsOf(shown: string[], extra: number): string[] {
  return extra > 0 ? [...shown, `${extra} more like these were not listed.`] : shown;
}

function toTsv(sheet: Sheet): string {
  const width = sheetWidth(sheet);
  const lines: string[] = [];
  for (const row of sheet.rows) {
    const fields: string[] = new Array<string>(width);
    for (let c = 0; c < width; c++) {
      const cell = row[c] ?? EMPTY_CELL;
      if (/[\t\r\n]/.test(cell.text)) {
        throw new SpreadsheetConverterError(
          `Cell ${cell.ref} holds a tab or line break, and a TSV file cannot carry either. Choose CSV, which quotes it.`,
          { cell: cell.ref },
        );
      }
      fields[c] = cell.text;
    }
    lines.push(fields.join('\t'));
  }
  return lines.join('\n');
}

function toXml(sheet: Sheet): { text: string; warnings: string[] } {
  let changed = 0;
  let first = '';
  const xmlText = (text: string, ref: string): string => {
    const safe = escapeNonXml(text);
    if (safe !== text) {
      if (changed++ === 0) first = ref;
    }
    return escapeText(safe);
  };
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<workbook>'];
  lines.push(`  <sheet name="${escapeAttribute(escapeNonXml(sheet.name))}">`);
  sheet.rows.forEach((row, rowIndex) => {
    const cells = row.filter((cell) => cell.kind !== 'empty');
    if (cells.length === 0) return;
    lines.push(`    <row n="${rowIndex + 1}">`);
    for (const cell of cells) {
      lines.push(`      <cell ref="${cell.ref}" type="${cell.kind}">${xmlText(cell.text, cell.ref)}</cell>`);
    }
    lines.push('    </row>');
  });
  lines.push('  </sheet>', '</workbook>', '');
  const warnings =
    changed > 0
      ? [
          `${changed} ${changed === 1 ? 'cell holds a character' : 'cells hold characters'} XML 1.0 cannot carry (the first is ${first}), so ${changed === 1 ? 'it was' : 'they were'} written as _xHHHH_ escapes, as a spreadsheet does.`,
        ]
      : [];
  return { text: lines.join('\n'), warnings };
}

/** The JSON text of one cell, and a warning when it cannot be carried as it is. */
function jsonValue(cell: Cell, keepTypes: boolean, warn: (message: string) => void): string {
  if (!keepTypes) return JSON.stringify(cell.text);
  switch (cell.kind) {
    case 'empty':
      return 'null';
    case 'boolean':
      return cell.text === 'TRUE' ? 'true' : 'false';
    case 'number': {
      if (!JSON_NUMBER.test(cell.text)) return JSON.stringify(cell.text);
      if (Math.abs(Number(cell.text)) > MAX_SAFE_MAGNITUDE) {
        warn(
          `Cell ${cell.ref} holds ${cell.text}, more than 2 to the 53, so it is written as a JSON string; a JSON reader would round it.`,
        );
        return JSON.stringify(cell.text);
      }
      // The digits exactly as the file stores them: JSON has no limit on a number's length.
      return cell.text;
    }
    default:
      return JSON.stringify(cell.text);
  }
}

function toJson(sheet: Sheet, options: TextOptions): { text: string; warnings: string[] } {
  const shown: string[] = [];
  let extra = 0;
  const warn = (message: string): void => {
    if (shown.length < MAX_WARNINGS) shown.push(message);
    else extra++;
  };
  const width = sheetWidth(sheet);
  const cellAt = (row: Cell[], c: number): Cell => row[c] ?? EMPTY_CELL;
  const rows = sheet.rows;
  if (rows.length === 0 || width === 0) return { text: '[]', warnings: [] };

  if (!options.header) {
    // The layout JSON.stringify gives with two spaces of indent: one value per line.
    const body = rows.map((row) => {
      const values = Array.from(
        { length: width },
        (_, c) => `    ${jsonValue(cellAt(row, c), options.keepTypes, warn)}`,
      );
      return `  [\n${values.join(',\n')}\n  ]`;
    });
    return { text: `[\n${body.join(',\n')}\n]`, warnings: warningsOf(shown, extra) };
  }

  // The first row names the columns: an empty name is called column_N, and a repeated one gets a number, with a warning.
  const names: string[] = [];
  const counts = new Map<string, number>();
  const headerRow = rows[0]!;
  for (let c = 0; c < width; c++) {
    let base = cellAt(headerRow, c).text;
    if (base === '') {
      base = `column_${c + 1}`;
      warn(`Column ${c + 1} has no header text, so it was named "${base}" in the JSON output.`);
    }
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    let name = base;
    if (count > 1) {
      name = `${base}_${count}`;
      warn(
        `Column ${c + 1}'s header "${base}" duplicates an earlier column, so it was renamed "${name}" in the JSON output.`,
      );
    }
    names.push(name);
  }
  const objects = rows.slice(1).map((row) => {
    const fields = names.map(
      (name, c) => `    ${JSON.stringify(name)}: ${jsonValue(cellAt(row, c), options.keepTypes, warn)}`,
    );
    return `  {\n${fields.join(',\n')}\n  }`;
  });
  return { text: objects.length === 0 ? '[]' : `[\n${objects.join(',\n')}\n]`, warnings: warningsOf(shown, extra) };
}

export function sheetToText(
  sheet: Sheet,
  format: TextFormat,
  options: TextOptions,
): { text: string; warnings: string[] } {
  switch (format) {
    case 'csv':
      return { text: formatCsv(sheetGrid(sheet)), warnings: [] };
    case 'tsv':
      return { text: toTsv(sheet), warnings: [] };
    case 'xml':
      return toXml(sheet);
    case 'json':
      return toJson(sheet, options);
  }
}
