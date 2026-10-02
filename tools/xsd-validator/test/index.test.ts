import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as libxml2 from 'libxml2-wasm';
import { meta as toolMeta, validateXml } from '../src/index';

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
