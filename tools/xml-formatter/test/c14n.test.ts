import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import * as libxml2 from 'libxml2-wasm';
import { canonicalizeXml, meta as toolMeta } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));

// Canonical XML Version 1.0, W3C Recommendation 15 March 2001, https://www.w3.org/TR/2001/REC-xml-c14n-20010315
// Section 2.3 (start tags: attributes in lexicographic order, values in double quotes) and section 3.3 (an empty
// element becomes a start and end tag pair).
it('Canonical XML sorts attributes, uses double quotes and writes empty elements as start and end tags', () => {
  const input = `<doc  b='2'   a="1"   >\n  <e   />\n  <f x = 'one'   w="two"   ></f>\n</doc>`;
  const expected = `<doc a="1" b="2">\n  <e></e>\n  <f w="two" x="one"></f>\n</doc>`;
  expect(canonicalizeXml(libxml2, input, { mode: '1.0', withComments: false })).toBe(expected);
});

// Section 3.2 (Whitespace in Document Content): "In this example, the input document and canonical form are
// identical." Every space and line break inside the document element is kept.
it('Canonical XML 1.0 section 3.2 whitespace in document content gives the printed output', () => {
  const printed = [
    '<doc>',
    '   <clean>   </clean>',
    '   <dirty>   A   B   </dirty>',
    '   <mixed>',
    '      A',
    '      <clean>   </clean>',
    '      B',
    '      <dirty>   A   B   </dirty>',
    '      C',
    '   </mixed>',
    '</doc>',
  ].join('\n');
  expect(canonicalizeXml(libxml2, printed, { mode: '1.0', withComments: false })).toBe(printed);
});

it('meta keeps fast-xml-parser, pins libxml2-wasm and declares the libxml2 notice', () => {
  expect(toolMeta.dependencies).toMatchObject({ 'fast-xml-parser': '5.11.1', 'libxml2-wasm': '0.7.2' });
  const bundled = (toolMeta as { bundledData?: { name: string; noticeFile: string }[] }).bundledData ?? [];
  const notice = bundled.find((entry) => entry.name === 'libxml2');
  expect(notice).toBeDefined();
  const file = join(here, '..', notice?.noticeFile ?? 'missing');
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain('libxml2');
  // The notice is the licence file the installed package ships.
  const packageNotice = join(here, '..', 'node_modules', 'libxml2-wasm', 'LICENSE.libxml2');
  expect(readFileSync(file, 'utf8')).toBe(readFileSync(packageNotice, 'utf8'));
});
