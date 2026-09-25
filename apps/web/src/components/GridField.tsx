import type { ClipboardEvent } from 'react';
import type { Field } from '../lib/tool-ui';

const DEFAULT_MAX_ROWS = 50;
const DEFAULT_MAX_COLUMNS = 20;

/** A rectangular copy of string[][], or a single blank cell for anything malformed. */
function normaliseGrid(value: unknown): string[][] {
  if (!Array.isArray(value) || value.length === 0) return [['']];
  const rows: string[][] = value.map((row) =>
    Array.isArray(row) ? row.map((cell) => (typeof cell === 'string' ? cell : '')) : [''],
  );
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    const padded = row.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded;
  });
}

/**
 * An editable grid: type into a cell, add or remove a row or column, or
 * paste a block of cells copied from a spreadsheet. Every update replaces
 * the whole grid with a new array -- the value passed in is never mutated
 * in place, so Reset can hand the same default grid back unharmed.
 */
export default function GridField({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const gridValue = normaliseGrid(value);
  const rowCount = gridValue.length;
  const columnCount = gridValue[0]?.length ?? 1;
  const maxRows = field.maxRows ?? DEFAULT_MAX_ROWS;
  const maxColumns = field.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const id = `f-${field.name}`;
  const labelId = `${id}-label`;
  const describedBy = field.help ? `${id}-help` : undefined;

  const setCell = (r: number, c: number, text: string): void => {
    const next = gridValue.map((row) => row.slice());
    next[r]![c] = text;
    onChange(next);
  };

  const addRow = (): void => {
    if (rowCount >= maxRows) return;
    onChange([...gridValue.map((row) => row.slice()), new Array<string>(columnCount).fill('')]);
  };

  const addColumn = (): void => {
    if (columnCount >= maxColumns) return;
    onChange(gridValue.map((row) => [...row, '']));
  };

  const removeRow = (): void => {
    if (rowCount <= 1) return;
    onChange(gridValue.slice(0, -1).map((row) => row.slice()));
  };

  const removeColumn = (): void => {
    if (columnCount <= 1) return;
    onChange(gridValue.map((row) => row.slice(0, -1)));
  };

  /**
   * A paste that carries a tab or a line break came from a spreadsheet-style
   * block, so it is split into rows (on a line break, ignoring one trailing
   * break) and cells within a row (on a tab), written from the pasted-into
   * cell, growing the grid within maxRows/maxColumns as needed. A paste with
   * neither is a single value and is left to the browser's own paste.
   */
  const handlePaste = (r: number, c: number, event: ClipboardEvent<HTMLInputElement>): void => {
    const text = event.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n') && !text.includes('\r')) return;
    event.preventDefault();

    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

    const wantedRows = Math.min(r + lines.length, maxRows);
    const wantedColumns = Math.min(
      lines.reduce((max, line) => Math.max(max, c + line.split('\t').length), columnCount),
      maxColumns,
    );

    let next = gridValue.map((row) => row.slice());
    while (next.length < wantedRows) next.push(new Array<string>(next[0]?.length ?? columnCount).fill(''));
    if ((next[0]?.length ?? 0) < wantedColumns) {
      next = next.map((row) => {
        const grown = row.slice();
        while (grown.length < wantedColumns) grown.push('');
        return grown;
      });
    }

    lines.forEach((line, li) => {
      const targetRow = r + li;
      if (targetRow >= next.length) return;
      line.split('\t').forEach((cellText, ci) => {
        const targetColumn = c + ci;
        if (targetColumn >= next[targetRow]!.length) return;
        next[targetRow]![targetColumn] = cellText;
      });
    });

    onChange(next);
  };

  return (
    <div className="field grid-field" role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
      <span className="field-label" id={labelId}>
        {field.label}
      </span>
      <div className="grid-scroll">
        <table>
          <tbody>
            {gridValue.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>
                    <input
                      type="text"
                      id={`${id}-r${r}-c${c}`}
                      value={cell}
                      aria-label={`Row ${r + 1}, column ${c + 1}`}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      onChange={(e) => setCell(r, c, e.target.value)}
                      onPaste={(e) => handlePaste(r, c, e)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar toolbar-small">
        <button type="button" className="button" onClick={addRow} disabled={rowCount >= maxRows}>
          Add row
        </button>
        <button type="button" className="button" onClick={addColumn} disabled={columnCount >= maxColumns}>
          Add column
        </button>
        <button type="button" className="button" onClick={removeRow} disabled={rowCount <= 1}>
          Remove last row
        </button>
        <button type="button" className="button" onClick={removeColumn} disabled={columnCount <= 1}>
          Remove last column
        </button>
      </div>
      {field.help ? (
        <p className="field-help" id={`${id}-help`}>
          {field.help}
        </p>
      ) : null}
    </div>
  );
}
