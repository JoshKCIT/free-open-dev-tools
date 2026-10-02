import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { convertData, DataConvertError, type DataFormat } from '../src/index';

// One reference record, written once in each of the six formats by hand from each format's own rules:
// RFC 8259 (JSON), YAML 1.2.2, TOML 1.1.0, XML 1.0, RFC 4180 (CSV) and the IANA text/tab-separated-values registration.
// The record is {id: "7", name: "Ada"}, with both values text so that no format has to guess a type.
//
// What a source reads as depends only on the source:
//   JSON, YAML and TOML read it as the object itself;
//   XML reads it as an object with one key, the root element, holding the record;
//   CSV and TSV read it as a list holding one record (the first line is the header).
// What a target writes then follows from that shape and the rules of the target. The expected texts below are those
// rules applied by hand to each shape, never this converter's own output.

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

const FORMATS: DataFormat[] = ['json', 'yaml', 'toml', 'xml', 'csv', 'tsv'];

const SOURCE: Record<DataFormat, string> = {
  json: '{"id":"7","name":"Ada"}',
  yaml: 'id: "7"\nname: Ada\n',
  toml: 'id = "7"\nname = "Ada"\n',
  xml: '<root><id>7</id><name>Ada</name></root>',
  csv: 'id,name\r\n7,Ada',
  tsv: 'id\tname\n7\tAda',
};

type Shape = 'record' | 'wrapped' | 'rows';

const SHAPE: Record<DataFormat, Shape> = {
  json: 'record',
  yaml: 'record',
  toml: 'record',
  xml: 'wrapped',
  csv: 'rows',
  tsv: 'rows',
};

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** What each target must write for each shape, by hand. `null` for TOML means the shape is refused. */
const EXPECTED: Record<DataFormat, Record<Shape, string | null>> = {
  json: {
    record: '{\n  "id": "7",\n  "name": "Ada"\n}',
    wrapped: '{\n  "root": {\n    "id": "7",\n    "name": "Ada"\n  }\n}',
    rows: '[\n  {\n    "id": "7",\n    "name": "Ada"\n  }\n]',
  },
  yaml: {
    record: 'id: "7"\nname: Ada\n',
    wrapped: 'root:\n  id: "7"\n  name: Ada\n',
    rows: '- id: "7"\n  name: Ada\n',
  },
  // TOML text is compared by what it parses to, since spacing and a final line break are not part of the data.
  toml: { record: null, wrapped: null, rows: null },
  xml: {
    // Two top-level keys are wrapped in root; one top-level key is the root; a list is root holding row elements.
    record: XML_DECLARATION + '<root>\n  <id>7</id>\n  <name>Ada</name>\n</root>',
    wrapped: XML_DECLARATION + '<root>\n  <id>7</id>\n  <name>Ada</name>\n</root>',
    rows: XML_DECLARATION + '<root>\n  <row>\n    <id>7</id>\n    <name>Ada</name>\n  </row>\n</root>',
  },
  csv: {
    record: 'id,name\r\n7,Ada',
    wrapped: 'root.id,root.name\r\n7,Ada',
    rows: 'id,name\r\n7,Ada',
  },
  tsv: {
    record: 'id\tname\n7\tAda',
    wrapped: 'root.id\troot.name\n7\tAda',
    rows: 'id\tname\n7\tAda',
  },
};

const TOML_VALUE: Record<Shape, unknown> = {
  record: { id: '7', name: 'Ada' },
  wrapped: { root: { id: '7', name: 'Ada' } },
  rows: null,
};

it('every ordered pair of the six formats converts a reference record or refuses it with the stated reason', () => {
  let pairs = 0;
  for (const from of FORMATS) {
    for (const to of FORMATS) {
      if (from === to) continue;
      pairs++;
      const shape = SHAPE[from];
      const label = `${from} to ${to}`;

      if (to === 'toml') {
        if (shape === 'rows') {
          // TOML has a table at its root and nothing else; a list of records has none.
          try {
            convertData(SOURCE[from], { from, to });
            expect.unreachable(label);
          } catch (err) {
            expect(err, label).toBeInstanceOf(DataConvertError);
            expect((err as DataConvertError).message, label).toContain('object at the root');
          }
        } else {
          expect(parseToml(convertData(SOURCE[from], { from, to }).output), label).toEqual(TOML_VALUE[shape]);
        }
        continue;
      }

      const result = convertData(SOURCE[from], { from, to });
      expect(result.output, label).toBe(EXPECTED[to][shape]);
      // Only wrapping two top-level keys in root is a loss to report here; nothing else in the record is.
      const wrapsInRoot = to === 'xml' && shape === 'record';
      expect(result.warnings.length, label).toBe(wrapsInRoot ? 1 : 0);
    }
  }
  expect(pairs).toBe(30);

  // A TOML source with a nested table, to XML and to CSV, follows the same rules as any object.
  const nested = 'title = "T"\n\n[owner]\nname = "Ada"\n';
  expect(convertData(nested, { from: 'toml', to: 'csv' }).output).toBe('title,owner.name\r\nT,Ada');
  expect(convertData(nested, { from: 'toml', to: 'xml' }).output).toBe(
    XML_DECLARATION + '<root>\n  <title>T</title>\n  <owner>\n    <name>Ada</name>\n  </owner>\n</root>',
  );

  // The refusals reach the converter's own error with a pointer into the source's own structure.
  try {
    convertData('{"a":[1]}', { from: 'json', to: 'csv' });
    expect.unreachable();
  } catch (err) {
    expect((err as DataConvertError).path).toBe('/a');
  }
  try {
    convertData('a\tb\n1', { from: 'tsv', to: 'json' });
    expect.unreachable();
  } catch (err) {
    expect((err as DataConvertError).line).toBe(2);
    expect((err as DataConvertError).message).toContain('Row 2');
  }

  // Round trips, as the limits state them. XML to JSON to XML gives the same XML back for the reference record.
  const viaJson = convertData(SOURCE.xml, { from: 'xml', to: 'json' }).output;
  expect(convertData(viaJson, { from: 'json', to: 'xml' }).output).toBe(EXPECTED.xml.wrapped);
  // JSON to CSV to JSON gives a list holding the record, every value text; typed values come back only with the option.
  const typed = '{"id":7,"ok":true}';
  const csv = convertData(typed, { from: 'json', to: 'csv' });
  expect(csv.output).toBe('id,ok\r\n7,true');
  expect(JSON.parse(convertData(csv.output, { from: 'csv', to: 'json' }).output)).toEqual([{ id: '7', ok: 'true' }]);
  expect(JSON.parse(convertData(csv.output, { from: 'csv', to: 'json', inferTypes: true }).output)).toEqual([
    { id: 7, ok: true },
  ]);
  // A dotted column name is never turned back into nesting.
  const flat = convertData('{"a":{"b":"1"}}', { from: 'json', to: 'csv' }).output;
  expect(JSON.parse(convertData(flat, { from: 'csv', to: 'json' }).output)).toEqual([{ 'a.b': '1' }]);
  // Without a header row the first line is data; the output is a list of lists.
  expect(JSON.parse(convertData('a,b\r\n1,2', { from: 'csv', to: 'json', headerRow: false }).output)).toEqual([
    ['a', 'b'],
    ['1', '2'],
  ]);
  // The default conversion is unchanged: JSON in, YAML out.
  expect(convertData(SOURCE.json, { from: 'json', to: 'yaml' }).output).toBe(EXPECTED.yaml.record);
});
