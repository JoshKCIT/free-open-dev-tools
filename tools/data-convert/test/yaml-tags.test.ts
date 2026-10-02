import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertData, DataConvertError, type DataFormat } from '../src/index';
import { writeXmlValue, XmlWriteError } from '../src/xml-write';
import { writeTable } from '../src/table';

// YAML 1.2 (https://yaml.org/spec/1.2.2/) section 10.3.2 core schema and the YAML 1.1 type repository
// (https://yaml.org/type/): an explicit tag such as !!timestamp, !!binary, !!set or !!omap makes a value that is not
// text, a number, a boolean or null. This converter has to keep such a value as plain text or refuse it with its
// path; it may never turn it into an empty element, an empty cell or a column per byte.

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  expect(console.log).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

const TARGETS: DataFormat[] = ['json', 'xml', 'csv', 'tsv', 'toml'];

function refusal(text: string, to: DataFormat): DataConvertError {
  try {
    convertData(text, { from: 'yaml', to });
  } catch (err) {
    if (err instanceof DataConvertError) return err;
    throw err;
  }
  throw new Error(`expected a refusal for ${to}`);
}

it('a YAML timestamp is kept as its ISO 8601 text with a warning, in XML, CSV, TSV, JSON and TOML', () => {
  const source = 'a: !!timestamp 2001-01-01\n';
  const xml = convertData(source, { from: 'yaml', to: 'xml' });
  expect(xml.output).toContain('<a>2001-01-01T00:00:00.000Z</a>');
  expect(xml.warnings.join(' ')).toContain('timestamp');

  const csv = convertData(source, { from: 'yaml', to: 'csv' });
  expect(csv.output).toBe('a\r\n2001-01-01T00:00:00.000Z');
  expect(csv.warnings.join(' ')).toContain('timestamp');

  expect(convertData(source, { from: 'yaml', to: 'tsv' }).output).toBe('a\n2001-01-01T00:00:00.000Z');
  expect(JSON.parse(convertData(source, { from: 'yaml', to: 'json' }).output)).toEqual({
    a: '2001-01-01T00:00:00.000Z',
  });
  expect(convertData(source, { from: 'yaml', to: 'toml' }).output).toBe('a = "2001-01-01T00:00:00.000Z"\n');
});

it('a YAML timestamp inside a list is kept as text, and a document with none gets no timestamp warning', () => {
  const list = convertData('- !!timestamp 2002-12-14T21:59:43.10-05:00\n- plain\n', { from: 'yaml', to: 'json' });
  expect(JSON.parse(list.output)).toEqual(['2002-12-15T02:59:43.100Z', 'plain']);
  expect(list.warnings.join(' ')).toContain('timestamp');

  const none = convertData('a: 2001-01-01\n', { from: 'yaml', to: 'json' });
  expect(JSON.parse(none.output)).toEqual({ a: '2001-01-01' });
  expect(none.warnings.join(' ')).not.toContain('timestamp');
});

it('YAML binary, set and omap values are refused with their path in every target instead of being emptied or exploded', () => {
  for (const to of TARGETS) {
    const binary = refusal('a: !!binary aGVsbG8=\n', to);
    expect(binary.path, `binary to ${to}`).toBe('/a');
    expect(binary.message).toContain('binary');

    const set = refusal('a: !!set {x, y}\n', to);
    expect(set.path, `set to ${to}`).toBe('/a');
    expect(set.message).toContain('set');

    const omap = refusal('a:\n  b: !!omap\n    - x: 1\n', to);
    expect(omap.path, `omap to ${to}`).toBe('/a/b');
  }
});

it('YAML to YAML still keeps a timestamp or a binary value as written', () => {
  const source = 'a: !!timestamp 2001-01-01\nb: !!binary aGVsbG8=\n';
  expect(convertData(source, { from: 'yaml', to: 'yaml' }).output).toBe(source);
});

it('the XML writer and the table writer refuse a date, binary data, a set or a map instead of writing it as an empty object', () => {
  for (const odd of [new Date(0), new Uint8Array([1, 2]), new Set(['x']), new Map([['k', 'v']])]) {
    expect(() => writeXmlValue({ a: odd }), `xml ${Object.prototype.toString.call(odd)}`).toThrow(XmlWriteError);
    try {
      writeXmlValue({ a: odd });
    } catch (err) {
      expect((err as XmlWriteError).path).toBe('/a');
    }
    for (const format of ['csv', 'tsv'] as const) {
      let caught: unknown;
      try {
        writeTable([{ a: odd }], format);
      } catch (err) {
        caught = err;
      }
      expect(caught, `${format} ${Object.prototype.toString.call(odd)}`).toBeInstanceOf(DataConvertError);
      expect((caught as DataConvertError).path).toBe('/0/a');
    }
  }
});
