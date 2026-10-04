// Written by make-fixtures.py with Python 3.14.3 (csv module) on 2026-10-04.
// Each case is the pasted text and the rows Python's csv module read from it (blank lines dropped).
export interface CsvCase {
  name: string;
  text: string;
  delimiter: string;
  rows: string[][];
}

export const CSV_CASES: CsvCase[] = [
  {
    name: "simple rows",
    text: "a,b,c\n1,2,3\n",
    delimiter: ",",
    rows: [["a", "b", "c"], ["1", "2", "3"]],
  },
  {
    name: "a comma inside quotes",
    text: "x,\"a, b\",3\n",
    delimiter: ",",
    rows: [["x", "a, b", "3"]],
  },
  {
    name: "a doubled quote inside quotes",
    text: "x,\"say \"\"hi\"\"\",3\n",
    delimiter: ",",
    rows: [["x", "say \"hi\"", "3"]],
  },
  {
    name: "a line break inside quotes",
    text: "x,\"line1\nline2\",3\ny,z,4\n",
    delimiter: ",",
    rows: [["x", "line1\nline2", "3"], ["y", "z", "4"]],
  },
  {
    name: "a trailing empty value on every row",
    text: "a,b,\nc,d,\n",
    delimiter: ",",
    rows: [["a", "b", ""], ["c", "d", ""]],
  },
  {
    name: "a leading empty value",
    text: ",b\n,d\n",
    delimiter: ",",
    rows: [["", "b"], ["", "d"]],
  },
  {
    name: "carriage return and line feed",
    text: "a,b\r\nc,d\r\n",
    delimiter: ",",
    rows: [["a", "b"], ["c", "d"]],
  },
  {
    name: "no final line break",
    text: "a,b\nc,d",
    delimiter: ",",
    rows: [["a", "b"], ["c", "d"]],
  },
  {
    name: "an empty value in quotes",
    text: "a,\"\",c\n",
    delimiter: ",",
    rows: [["a", "", "c"]],
  },
  {
    name: "tabs with a trailing empty value",
    text: "a\tb\tc\n1\t2\t\n",
    delimiter: "\t",
    rows: [["a", "b", "c"], ["1", "2", ""]],
  },
  {
    name: "a quote in the middle of a value",
    text: "a,b\"c,d\n",
    delimiter: ",",
    rows: [["a", "b\"c", "d"]],
  },
  {
    name: "a space before a quote",
    text: "a, \"b\"\n",
    delimiter: ",",
    rows: [["a", " \"b\""]],
  },
  {
    name: "accented and astral characters",
    text: "\u00e9,\ud83d\ude00\n",
    delimiter: ",",
    rows: [["\u00e9", "\ud83d\ude00"]],
  },
  {
    name: "one column",
    text: "a\nb\n",
    delimiter: ",",
    rows: [["a"], ["b"]],
  },
  {
    name: "a trailing empty value at the end of the text",
    text: "a,b,",
    delimiter: ",",
    rows: [["a", "b", ""]],
  },
  {
    name: "a lone carriage return between rows",
    text: "a,b\rc,d\r",
    delimiter: ",",
    rows: [["a", "b"], ["c", "d"]],
  },
  {
    name: "a comma inside quotes in a tab file",
    text: "a\t\"b,c\"\td\n",
    delimiter: "\t",
    rows: [["a", "b,c", "d"]],
  },
];
