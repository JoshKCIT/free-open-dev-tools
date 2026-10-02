import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as libxml2 from 'libxml2-wasm';
import {
  checkInputSizes,
  MAX_INSTANCE_BYTES,
  MAX_LISTED_ISSUES,
  MAX_SCHEMA_BYTES,
  meta as toolMeta,
  validateXml,
  xmlParseOptions,
  XsdValidatorError,
  type Libxml2Engine,
} from '../src/index';
import { DOCTYPE_REFUSAL_MESSAGE } from '../src/xml-doctype';
import {
  PO_MISSING_PARTNUM,
  PO_QUANTITY_100,
  PO_UNEXPECTED_ELEMENT,
  PO_XML,
  PO_XML_AS_PRINTED,
  PO_XSD,
} from './fixtures/w3c-xmlschema-primer/golden';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Printing is never part of this package: a spy on every console method asserts it stays silent.
 */
let spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  spies = (['log', 'warn', 'error'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
});
afterEach(() => {
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

const NOTE_SCHEMA =
  '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="note" type="xs:string"/></xs:schema>';

// The schema and document below are the ones the research ran through lxml 6.1.1 on libxml2 2.11.9 (a second,
// independent binding of libxml2); the three messages and their lines are quoted from that run. The same inputs are
// run through lxml again in the second task of this plan, from a scratch virtual environment.
const ORDER_SCHEMA = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="qty" type="xs:positiveInteger"/>
        <xs:element name="sku" type="xs:string"/>
      </xs:sequence>
      <xs:attribute name="id" type="xs:int" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

const ORDER_BAD = `<order>
  <qty>-1</qty>
  <sku>A</sku>
  <extra/>
</order>`;

it('a document that matches a one-element schema is valid with no issues', () => {
  const result = validateXml(libxml2, NOTE_SCHEMA, '<note>a short note</note>', { showWarnings: false });
  expect(result).toEqual({ valid: true, issues: [], total: 0, notLoaded: [] });
});

it('three schema errors come back on lines 1, 2 and 4 in libxml2 wording', () => {
  const result = validateXml(libxml2, ORDER_SCHEMA, ORDER_BAD, { showWarnings: false });
  expect(result).not.toBeNull();
  expect(result!.valid).toBe(false);
  expect(result!.total).toBe(3);
  expect(result!.issues).toEqual([
    {
      level: 'error',
      message: "Element 'order': The attribute 'id' is required but missing.",
      line: 1,
      part: 'document',
    },
    {
      level: 'error',
      message: "Element 'qty': '-1' is not a valid value of the atomic type 'xs:positiveInteger'.",
      line: 2,
      part: 'document',
    },
    { level: 'error', message: "Element 'extra': This element is not expected.", line: 4, part: 'document' },
  ]);
});

it('meta pins libxml2-wasm exactly and declares the libxml2 notice', () => {
  expect(toolMeta.dependencies).toEqual({ 'libxml2-wasm': '0.7.2' });
  const notices = toolMeta.bundledData as { name: string; noticeFile: string; attribution: string }[];
  const libxml = notices.find((entry) => entry.name === 'libxml2');
  expect(libxml).toBeDefined();
  expect(libxml!.attribution).toContain('libxml2-wasm 0.7.2');
  const file = join(here, '..', libxml!.noticeFile);
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8').trim().length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------------------------------------------------
// The W3C XML Schema Primer's purchase order (po.xsd and po.xml, W3C Document License, see
// test/fixtures/w3c-xmlschema-primer/UPSTREAM.md) and three edited copies, one mistake each. Expected values below are
// quoted from Python lxml 6.1.1 on libxml2 2.11.9 (xmlschema.error_log of etree.XMLSchema(po.xsd).validate(...)), a
// second, independent binding of libxml2 that was run on these same five documents; the engine under test is
// libxml2 2.15.1 inside libxml2-wasm 0.7.2, so the two agree across a libxml2 version gap.
// ---------------------------------------------------------------------------------------------------------------------

it('the XML Schema Primer purchase order validates against its schema', () => {
  // lxml 6.1.1 / libxml2 2.11.9: schema.validate(po.xml) is True and error_log is empty.
  const result = validateXml(libxml2, PO_XSD, PO_XML, { showWarnings: true });
  expect(result).toEqual({ valid: true, issues: [], total: 0, notLoaded: [] });
});

it('three edited purchase orders give the errors and lines lxml gives for the same files', () => {
  // lxml 6.1.1 / libxml2 2.11.9, one error each (line, message):
  //   partNum removed from the first item   19  Element 'item': The attribute 'partNum' is required but missing.
  //   quantity 100 where maxExclusive is 100 21  Element 'quantity': [facet 'maxExclusive'] The value '100' must be less than '100'.
  //   an unexpected element after USPrice   23  Element 'giftWrap': This element is not expected. Expected is one of ( comment, shipDate ).
  const missing = validateXml(libxml2, PO_XSD, PO_MISSING_PARTNUM, { showWarnings: false });
  expect(missing!.issues).toEqual([
    {
      level: 'error',
      message: "Element 'item': The attribute 'partNum' is required but missing.",
      line: 19,
      part: 'document',
    },
  ]);
  const hundred = validateXml(libxml2, PO_XSD, PO_QUANTITY_100, { showWarnings: false });
  expect(hundred!.issues).toEqual([
    {
      level: 'error',
      message: "Element 'quantity': [facet 'maxExclusive'] The value '100' must be less than '100'.",
      line: 21,
      part: 'document',
    },
  ]);
  const unexpected = validateXml(libxml2, PO_XSD, PO_UNEXPECTED_ELEMENT, { showWarnings: false });
  expect(unexpected!.issues).toEqual([
    {
      level: 'error',
      message: "Element 'giftWrap': This element is not expected. Expected is one of ( comment, shipDate ).",
      line: 23,
      part: 'document',
    },
  ]);
  for (const result of [missing, hundred, unexpected]) {
    expect(result!.valid).toBe(false);
    expect(result!.total).toBe(1);
  }
  // The primer prints po.xml with '<!/comment>' where '</comment>' belongs. lxml 6.1.1 refuses it as not well formed
  // ("StartTag: invalid element name", line 17, column 42), and so does libxml2 2.15.1: a well-formedness error
  // carries a column, a validation error does not.
  let refused: unknown;
  try {
    validateXml(libxml2, PO_XSD, PO_XML_AS_PRINTED, { showWarnings: false });
  } catch (err) {
    refused = err;
  }
  expect(refused).toBeInstanceOf(XsdValidatorError);
  const typo = refused as XsdValidatorError;
  expect(typo.part).toBe('document');
  expect(typo.message).toBe('StartTag: invalid element name');
  expect([typo.line, typo.column]).toEqual([17, 42]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Line numbers: the line is counted in the pasted text, so the expected value is arithmetic on the text itself.
// ---------------------------------------------------------------------------------------------------------------------

const LIST_SCHEMA =
  '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r"><xs:complexType><xs:sequence><xs:element name="i" type="xs:positiveInteger" maxOccurs="unbounded"/></xs:sequence></xs:complexType></xs:element></xs:schema>';

it('an error at line 500003 reports that line, so big line numbers stay exact', () => {
  // Line 1 is <r>, lines 2 to 500002 are 500001 elements, line 500003 holds the unexpected element and the document
  // has 500005 lines. Without big-lines parsing libxml2 would report a wrong line past 65535.
  const doc = '<r>\n' + '<i>1</i>\n'.repeat(500001) + '<bad>t</bad>\n<i>1</i>\n</r>';
  expect(doc.split('\n').length).toBe(500005);
  expect(doc.slice(0, doc.indexOf('<bad>')).split('\n').length).toBe(500003);
  const result = validateXml(libxml2, LIST_SCHEMA, doc, { showWarnings: false });
  expect(result!.issues).toHaveLength(1);
  expect(result!.issues[0]!.line).toBe(500003);
  expect(result!.issues[0]!.message).toBe("Element 'bad': This element is not expected. Expected is ( i ).");
  // A value error on an element with text, past line 65535, is exact too.
  const value = '<r>\n' + '<i>1</i>\n'.repeat(70000) + '<i>-1</i>\n</r>';
  expect(validateXml(libxml2, LIST_SCHEMA, value, { showWarnings: false })!.issues.map((issue) => issue.line)).toEqual([
    70002,
  ]);
});

it('an empty element past line 65535 is reported on the next line, as libxml2 reports it', () => {
  // libxml2 stores a line number above 65535 in the first child text node, and an empty element followed by a newline
  // takes the line of that newline. lxml 6.1.1 on libxml2 2.11.9 reports the same: 70003 for an element on line 70002.
  // The tool shows the line libxml2 gives (its limits say so); this test pins that behaviour so a change is noticed.
  const doc = '<r>\n' + '<i>1</i>\n'.repeat(70000) + '<bad/>\n<i>1</i>\n</r>';
  expect(doc.slice(0, doc.indexOf('<bad/>')).split('\n').length).toBe(70002);
  const result = validateXml(libxml2, LIST_SCHEMA, doc, { showWarnings: false });
  expect(result!.issues.map((issue) => issue.line)).toEqual([70003]);
});

// ---------------------------------------------------------------------------------------------------------------------
// DOCTYPE, entities, external locations: nothing a pasted text names is ever read.
// ---------------------------------------------------------------------------------------------------------------------

function refusal(run: () => unknown): XsdValidatorError {
  try {
    run();
  } catch (err) {
    if (err instanceof XsdValidatorError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

it('a DOCTYPE in the schema or the document is refused before parsing', () => {
  const schemaWithDoctype = '<?xml version="1.0"?>\n<!DOCTYPE xs:schema []>\n' + NOTE_SCHEMA;
  const inSchema = refusal(() => validateXml(libxml2, schemaWithDoctype, '<note>x</note>', { showWarnings: false }));
  expect(inSchema.message).toBe(DOCTYPE_REFUSAL_MESSAGE);
  expect([inSchema.part, inSchema.line, inSchema.column]).toEqual(['schema', 2, 1]);

  const inDocument = refusal(() =>
    validateXml(libxml2, NOTE_SCHEMA, '<note>x</note>\n  <!doctype note>', { showWarnings: false }),
  );
  expect(inDocument.message).toBe(DOCTYPE_REFUSAL_MESSAGE);
  expect([inDocument.part, inDocument.line, inDocument.column]).toEqual(['document', 2, 3]);

  // Refused before any parsing: an engine that fails on first use is never touched.
  const untouched = new Proxy(
    {},
    {
      get() {
        throw new Error('the engine was used');
      },
    },
  ) as unknown as Libxml2Engine;
  expect(() => validateXml(untouched, schemaWithDoctype, '<note>x</note>', { showWarnings: false })).toThrow(
    DOCTYPE_REFUSAL_MESSAGE,
  );
});

/**
 * Runs `run` with the address of a local HTTP server that records every request, then waits a moment for any stray
 * request to land, and returns what the server saw.
 */
async function withRecordingServer(run: (address: string) => void): Promise<string[]> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.end('<x/>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    run(`http://127.0.0.1:${port}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return requests;
}

it('import, include, redefine and override locations are listed as not loaded and a local server receives no request', async () => {
  const requests = await withRecordingServer((address) => {
    const schema = [
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:o="urn:o">',
      `  <xs:import namespace="urn:o" schemaLocation="${address}/import.xsd"/>`,
      `  <xs:include schemaLocation="${address}/include.xsd"/>`,
      `  <xs:redefine schemaLocation="${address}/redefine.xsd"/>`,
      `  <xs:override schemaLocation="${address}/override.xsd"/>`,
      '  <xs:element name="a" type="xs:string"/>',
      '</xs:schema>',
    ].join('\n');
    // The include cannot be used, so the schema stops with an error; the four locations are listed on the error.
    const stopped = refusal(() => validateXml(libxml2, schema, '<a>x</a>', { showWarnings: true }));
    expect(stopped.part).toBe('schema');
    expect(stopped.notLoaded).toEqual([
      { kind: 'import', location: `${address}/import.xsd`, line: 2 },
      { kind: 'include', location: `${address}/include.xsd`, line: 3 },
      { kind: 'redefine', location: `${address}/redefine.xsd`, line: 4 },
      { kind: 'override', location: `${address}/override.xsd`, line: 5 },
    ]);

    // An import alone is listed on a normal result, and validation goes on.
    const importOnly = [
      '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">',
      `  <xs:import namespace="urn:o" schemaLocation="${address}/import.xsd"/>`,
      '  <xs:element name="a" type="xs:string"/>',
      '</xs:schema>',
    ].join('\n');
    const listed = validateXml(libxml2, importOnly, '<a>x</a>', { showWarnings: false });
    expect(listed!.valid).toBe(true);
    expect(listed!.notLoaded).toEqual([{ kind: 'import', location: `${address}/import.xsd`, line: 2 }]);

    // The engine's own defence, with the parse options this package uses and no DOCTYPE guard in front of it: an
    // external entity naming the server, and a schema location in the document, load nothing.
    const entity = `<?xml version="1.0"?>\n<!DOCTYPE a [ <!ENTITY x SYSTEM "${address}/entity"> ]>\n<a>&x;</a>`;
    const options = xmlParseOptions(libxml2);
    for (const option of [options, options | libxml2.ParseOption.XML_PARSE_NOENT]) {
      try {
        libxml2.XmlDocument.fromString(entity, { option }).dispose();
      } catch {
        // A refusal is fine: this asserts only what was requested.
      }
    }
  });
  expect(requests).toEqual([]);
});

it('a missing include stops the schema with a plain message and a missing import is a warning', async () => {
  const include = [
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">',
    '  <xs:include schemaLocation="parts/address.xsd"/>',
    '  <xs:element name="a" type="xs:string"/>',
    '</xs:schema>',
  ].join('\n');
  const stopped = refusal(() => validateXml(libxml2, include, '<a>x</a>', { showWarnings: false }));
  expect(stopped.message).toBe(
    'This schema includes parts/address.xsd, which is not loaded. Paste the included declarations into the schema to use them.',
  );
  expect([stopped.part, stopped.line]).toEqual(['schema', 2]);
  expect(stopped.notLoaded).toEqual([{ kind: 'include', location: 'parts/address.xsd', line: 2 }]);

  const redefine = include.replace('xs:include', 'xs:redefine');
  expect(refusal(() => validateXml(libxml2, redefine, '<a>x</a>', { showWarnings: false })).message).toBe(
    'This schema redefines declarations from parts/address.xsd, which is not loaded. Paste the redefined declarations into the schema to use them.',
  );
  const override = include.replace('xs:include', 'xs:override');
  expect(refusal(() => validateXml(libxml2, override, '<a>x</a>', { showWarnings: false })).message).toBe(
    'This schema overrides declarations from parts/address.xsd, which is not loaded and which libxml2 does not read (xs:override is XML Schema 1.1). Paste the overridden declarations into the schema to use them.',
  );

  // A missing import is only a warning: a schema that does not use the imported namespace still validates.
  const unusedImport = [
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">',
    '  <xs:import namespace="urn:o" schemaLocation="o.xsd"/>',
    '  <xs:element name="a" type="xs:string"/>',
    '</xs:schema>',
  ].join('\n');
  const ok = validateXml(libxml2, unusedImport, '<a>x</a>', { showWarnings: true });
  expect(ok).toEqual({
    valid: true,
    issues: [],
    total: 0,
    notLoaded: [{ kind: 'import', location: 'o.xsd', line: 2 }],
  });

  // A schema that does use it fails to compile, and libxml2's two warnings about the import come with the error.
  const usedImport = [
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:o="urn:o">',
    '  <xs:import namespace="urn:o" schemaLocation="o.xsd"/>',
    '  <xs:element name="a" type="o:T"/>',
    '</xs:schema>',
  ].join('\n');
  const failed = refusal(() => validateXml(libxml2, usedImport, '<a>x</a>', { showWarnings: true }));
  expect(failed.part).toBe('schema');
  expect(failed.line).toBe(3);
  expect(failed.message).toBe(
    "element decl. 'a', attribute 'type': The QName value '{urn:o}T' does not resolve to a(n) type definition.",
  );
  const levels = failed.issues.map((issue) => [issue.level, issue.line]);
  expect(levels).toEqual([
    ['warning', undefined],
    ['warning', 2],
    ['error', 3],
  ]);
  expect(failed.issues[1]!.message).toContain('Skipping the import');
});

it('a billion laughs document is refused and an external entity to a file address loads nothing', () => {
  // Refused outright, before any entity is read.
  const entities = ['<!ENTITY a "aaaaaaaaaa">'];
  for (let n = 1; n <= 8; n++) {
    const prev = String.fromCharCode(96 + n);
    entities.push(`<!ENTITY ${String.fromCharCode(97 + n)} "${`&${prev};`.repeat(10)}">`);
  }
  const laugh = `<?xml version="1.0"?><!DOCTYPE l [${entities.join('')}]><l>&i;</l>`;
  const refused = refusal(() => validateXml(libxml2, NOTE_SCHEMA, laugh, { showWarnings: false }));
  expect(refused.message).toBe(DOCTYPE_REFUSAL_MESSAGE);
  expect(refused.part).toBe('document');

  // The engine's own defence with this package's parse options: a file named by an external entity is not read, even
  // when the parser is told to substitute entities.
  const dir = mkdtempSync(join(tmpdir(), 'xsd-validator-'));
  try {
    const secret = join(dir, 'secret.txt');
    writeFileSync(secret, 'FODT-SECRET-CONTENTS');
    const address = pathToFileURL(secret).href;
    const doc = `<?xml version="1.0"?>\n<!DOCTYPE a [ <!ENTITY x SYSTEM "${address}"> ]>\n<a>&x;</a>`;
    const options = xmlParseOptions(libxml2);
    for (const option of [options, options | libxml2.ParseOption.XML_PARSE_NOENT]) {
      let text = '';
      try {
        const parsed = libxml2.XmlDocument.fromString(doc, { option });
        text = parsed.toString();
        parsed.dispose();
      } catch {
        // A refusal is fine: this asserts only that the file's contents never appear.
      }
      expect(text).not.toContain('FODT-SECRET-CONTENTS');
    }
    // Through the package, the same document is refused outright.
    expect(refusal(() => validateXml(libxml2, NOTE_SCHEMA, doc, { showWarnings: false })).message).toBe(
      DOCTYPE_REFUSAL_MESSAGE,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('xsi:schemaLocation in the document is ignored', async () => {
  const requests = await withRecordingServer((address) => {
    // A document that names a schema is validated against the pasted schema only, and the named address is never asked.
    const named = `<note xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="${address}/other.xsd">a short note</note>`;
    expect(validateXml(libxml2, NOTE_SCHEMA, named, { showWarnings: true })).toEqual({
      valid: true,
      issues: [],
      total: 0,
      notLoaded: [],
    });
    // The named schema does not rescue a document the pasted schema rejects.
    const other = `<other xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:x ${address}/other.xsd"/>`;
    const result = validateXml(libxml2, NOTE_SCHEMA, other, { showWarnings: true });
    expect(result!.valid).toBe(false);
    expect(result!.issues.map((issue) => issue.message)).toEqual([
      "Element 'other': No matching global declaration available for the validation root.",
    ]);
  });
  expect(requests).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Counts, sizes, order.
// ---------------------------------------------------------------------------------------------------------------------

it('only the first 200 errors are listed with the total counted', () => {
  // lxml 6.1.1 on libxml2 2.11.9: 250 errors for this schema and document, the first on line 2 and the last on line 251,
  // each "Element 'i': '-1' is not a valid value of the atomic type 'xs:positiveInteger'."
  const doc = '<r>\n' + '<i>-1</i>\n'.repeat(250) + '</r>';
  const result = validateXml(libxml2, LIST_SCHEMA, doc, { showWarnings: false })!;
  expect(MAX_LISTED_ISSUES).toBe(200);
  expect(result.valid).toBe(false);
  expect(result.total).toBe(250);
  expect(result.issues).toHaveLength(200);
  // Document order, and identical messages on different lines are all kept.
  expect(result.issues.map((issue) => issue.line)).toEqual(Array.from({ length: 200 }, (_, n) => n + 2));
  expect(new Set(result.issues.map((issue) => issue.message))).toEqual(
    new Set(["Element 'i': '-1' is not a valid value of the atomic type 'xs:positiveInteger'."]),
  );
  // Exactly 200 errors are all listed.
  const exact = validateXml(libxml2, LIST_SCHEMA, '<r>\n' + '<i>-1</i>\n'.repeat(200) + '</r>', {
    showWarnings: false,
  })!;
  expect([exact.total, exact.issues.length]).toEqual([200, 200]);
});

/** A valid document of exactly `bytes` bytes: a root, many small elements, and spaces to land on the size. */
function documentOfBytes(bytes: number): string {
  const line = '<i>x</i>\n';
  const count = Math.floor((bytes - 7) / line.length);
  const pad = bytes - 7 - count * line.length;
  return '<r>' + line.repeat(count) + ' '.repeat(pad) + '</r>';
}

it('an instance over 10 MiB or a schema over 2 MiB is refused before parsing and exactly the limits are accepted', () => {
  expect([MAX_INSTANCE_BYTES, MAX_SCHEMA_BYTES]).toEqual([10485760, 2097152]);
  const untouched = new Proxy(
    {},
    {
      get() {
        throw new Error('the engine was used');
      },
    },
  ) as unknown as Libxml2Engine;

  const tooBigDocument = '<note>' + 'a'.repeat(10485761 - 13) + '</note>';
  expect(new TextEncoder().encode(tooBigDocument).length).toBe(10485761);
  const bigDocument = refusal(() => validateXml(untouched, NOTE_SCHEMA, tooBigDocument, { showWarnings: false }));
  expect(bigDocument.part).toBe('document');
  expect(bigDocument.message).toBe(
    'This document is 10,485,761 bytes. The limit is 10 MiB (10,485,760 bytes) because the whole document is held in memory while it is checked.',
  );
  // Bytes are counted, not characters: 3495254 euro signs are 10485762 bytes.
  const euros = '<note>' + '€'.repeat(3495254) + '</note>';
  expect(refusal(() => validateXml(untouched, NOTE_SCHEMA, euros, { showWarnings: false })).part).toBe('document');

  const tooBigSchema = NOTE_SCHEMA + '<!--' + 'a'.repeat(2097153 - NOTE_SCHEMA.length - 7) + '-->';
  expect(new TextEncoder().encode(tooBigSchema).length).toBe(2097153);
  const bigSchema = refusal(() => validateXml(untouched, tooBigSchema, '<note>x</note>', { showWarnings: false }));
  expect(bigSchema.part).toBe('schema');
  expect(bigSchema.message).toBe(
    'This schema is 2,097,153 bytes. The limit is 2 MiB (2,097,152 bytes) because the whole schema is held in memory while it is compiled.',
  );
  expect(() => checkInputSizes(tooBigSchema, '<note>x</note>')).toThrow(XsdValidatorError);

  // Exactly the limits are accepted by the real engine.
  const exactDocument = documentOfBytes(10485760);
  expect(new TextEncoder().encode(exactDocument).length).toBe(10485760);
  const rSchema =
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="r"><xs:complexType><xs:sequence><xs:element name="i" type="xs:string" minOccurs="0" maxOccurs="unbounded"/></xs:sequence></xs:complexType></xs:element></xs:schema>';
  expect(validateXml(libxml2, rSchema, exactDocument, { showWarnings: false })).toEqual({
    valid: true,
    issues: [],
    total: 0,
    notLoaded: [],
  });
  const exactSchema = NOTE_SCHEMA + '<!--' + 'a'.repeat(2097152 - NOTE_SCHEMA.length - 7) + '-->';
  expect(new TextEncoder().encode(exactSchema).length).toBe(2097152);
  expect(validateXml(libxml2, exactSchema, '<note>x</note>', { showWarnings: false })!.valid).toBe(true);
});

it('two errors on one line are both listed in the order libxml2 reports them', () => {
  // lxml 6.1.1 on libxml2 2.11.9, for this same schema and this one-line document: three errors, all on line 1, in
  // this order.
  const result = validateXml(libxml2, ORDER_SCHEMA, '<order><qty>-1</qty><sku>A</sku><extra/></order>', {
    showWarnings: false,
  })!;
  expect(result.issues.map((issue) => [issue.line, issue.message])).toEqual([
    [1, "Element 'order': The attribute 'id' is required but missing."],
    [1, "Element 'qty': '-1' is not a valid value of the atomic type 'xs:positiveInteger'."],
    [1, "Element 'extra': This element is not expected."],
  ]);
  expect(result.issues.every((issue) => issue.column === undefined)).toBe(true);
});

it('a schema with no global element reports the no matching global declaration error for the root', () => {
  // lxml 6.1.1 on libxml2 2.11.9: line 1, "Element 'root': No matching global declaration available for the validation root."
  const schema = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:complexType name="t"/></xs:schema>';
  const result = validateXml(libxml2, schema, '<root/>', { showWarnings: false })!;
  expect(result.valid).toBe(false);
  expect(result.issues).toEqual([
    {
      level: 'error',
      message: "Element 'root': No matching global declaration available for the validation root.",
      line: 1,
      part: 'document',
    },
  ]);
});

it('a blank schema or a blank document gives nothing and never touches the engine', () => {
  const untouched = new Proxy(
    {},
    {
      get() {
        throw new Error('the engine was used');
      },
    },
  ) as unknown as Libxml2Engine;
  expect(validateXml(untouched, '  \n ', '<a/>', { showWarnings: false })).toBeNull();
  expect(validateXml(untouched, NOTE_SCHEMA, '\t', { showWarnings: false })).toBeNull();
  expect(validateXml(untouched, '', '', { showWarnings: true })).toBeNull();
});

it('warnings are listed only when asked for and never change the verdict', () => {
  // libxml2 reads an XML 1.1 declaration as 1.0 and says so as a warning, with a column because it comes from parsing.
  const schema =
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="a" type="xs:anyType"/></xs:schema>';
  const doc = '<?xml version="1.1"?><a/>';
  expect(validateXml(libxml2, schema, doc, { showWarnings: false })).toEqual({
    valid: true,
    issues: [],
    total: 0,
    notLoaded: [],
  });
  expect(validateXml(libxml2, schema, doc, { showWarnings: true })).toEqual({
    valid: true,
    issues: [{ level: 'warning', message: "Unsupported version '1.1'", line: 1, column: 20, part: 'document' }],
    total: 1,
    notLoaded: [],
  });
});
