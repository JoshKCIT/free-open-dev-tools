import { it, expect } from 'vitest';
import { csvToJson, jsonToCsv, CsvJsonError } from '../src/index';

it('CSV to JSON to CSV round trips a document with quotes, delimiters and line breaks unchanged', () => {
  const csv = 'name,quote\r\nAda,"Hello, ""world"""\r\nLin,"multi\r\nline"';
  const asJson = csvToJson(csv);
  const backToCsv = jsonToCsv(asJson.output);
  expect(csvToJson(backToCsv.output).output).toBe(asJson.output);
});

it('CRLF and LF record separators are both accepted', () => {
  const crlf = csvToJson('a,b\r\n1,2');
  const lf = csvToJson('a,b\n1,2');
  expect(crlf.output).toBe(lf.output);
  expect(JSON.parse(crlf.output)).toEqual([{ a: '1', b: '2' }]);
});

it('semicolon, tab and pipe delimiters are honoured when chosen', () => {
  expect(JSON.parse(csvToJson('a;b\r\n1;2', { delimiter: ';' }).output)).toEqual([{ a: '1', b: '2' }]);
  expect(JSON.parse(csvToJson('a\tb\r\n1\t2', { delimiter: '\t' }).output)).toEqual([{ a: '1', b: '2' }]);
  expect(JSON.parse(csvToJson('a|b\r\n1|2', { delimiter: '|' }).output)).toEqual([{ a: '1', b: '2' }]);
});

it('an unterminated quoted field is refused with its line and column', () => {
  let caught: unknown;
  try {
    csvToJson('a,b\r\n"unterminated,x');
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(CsvJsonError);
  expect((caught as CsvJsonError).line).toBe(2);
});

it('a header row becomes object keys and duplicate or empty headers are refused by name', () => {
  expect(JSON.parse(csvToJson('name,age\r\nAda,30').output)).toEqual([{ name: 'Ada', age: '30' }]);

  expect(() => csvToJson('name,name\r\na,b')).toThrow(/name/);
  expect(() => csvToJson('name,\r\na,b')).toThrow(CsvJsonError);

  let rowCaught: unknown;
  try {
    csvToJson('name,age\r\nAda,30,extra');
  } catch (err) {
    rowCaught = err;
  }
  expect(rowCaught).toBeInstanceOf(CsvJsonError);
  expect((rowCaught as CsvJsonError).message).toContain('Row 2');
});

it('a header named __proto__ becomes an own key and Object.prototype is never modified', () => {
  const result = csvToJson('__proto__,name\r\nx,Ada');
  const parsed = JSON.parse(result.output) as Record<string, unknown>[];
  expect(Object.hasOwn(parsed[0]!, '__proto__')).toBe(true);
  expect(parsed[0]!['__proto__']).toBe('x');
  expect((Object.prototype as unknown as Record<string, unknown>).x).toBeUndefined();
});

it('numbers and booleans stay strings unless type inference is switched on', () => {
  const noInfer = JSON.parse(csvToJson('n,b\r\n42,true').output);
  expect(noInfer).toEqual([{ n: '42', b: 'true' }]);

  const inferred = JSON.parse(csvToJson('n,b,x\r\n42,true,null', { inferTypes: true }).output);
  expect(inferred).toEqual([{ n: 42, b: true, x: null }]);
});

it('nested values in JSON input are written as JSON text in the cell', () => {
  const result = jsonToCsv('[{"name":"Ada","tags":["a","b"]}]');
  const back = JSON.parse(csvToJson(result.output).output) as Record<string, unknown>[];
  expect(back[0]!.tags).toBe('["a","b"]');
});
