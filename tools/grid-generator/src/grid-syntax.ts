export class GridSyntaxError extends Error {
  line: number;
  column: number;
  override name: string;
  constructor(message: string, line: number, column: number, name: string) {
    super(message);
    this.line = line;
    this.column = column;
    this.name = name;
  }
}

export interface ParsedTrackList {
  text: string;
  trackCount: number;
}

export function parseTrackList(_text: string): ParsedTrackList {
  throw new Error('not implemented');
}

export interface GridArea {
  name: string;
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
}

export interface ParsedTemplateAreas {
  rows: (string | null)[][];
  areas: GridArea[];
}

export function parseTemplateAreas(_text: string): ParsedTemplateAreas {
  throw new Error('not implemented');
}
