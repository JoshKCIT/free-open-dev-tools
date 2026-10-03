import { expect, it } from 'vitest';
import { explainWsdl, sampleRequest } from '../src/index';

/*
 * The size of a sample request, and an attribute written once (found by the phase 13 review). The rules are those of the
 * XML Schema Part 1 Structures: an attribute declaration of a complex type is an attribute of every element of that
 * type (section 3.4), a type that extends another has the attributes of both (section 3.4.2), and an element has at
 * most one attribute of a given name (XML 1.0 section 3.1, well-formedness: attribute names are unique per element).
 */

const NS =
  'xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"';

function wsdl(schema: string): string {
  return `<definitions name="x" targetNamespace="urn:t" ${NS}><types><xs:schema targetNamespace="urn:t">${schema}</xs:schema></types><message name="M"><part name="p" element="tns:Req"/></message><portType name="P"><operation name="Op"><input message="tns:M"/></operation></portType></definitions>`;
}

const attributes = (count: number, prefix = 'a') =>
  Array.from({ length: count }, (_, i) => `<xs:attribute name="${prefix}${i}" type="xs:string"/>`).join('');

it('a type with thousands of attributes used by thousands of elements is cut at 50,000 elements and attributes, with one warning', () => {
  // 5,000 attributes in one type used by 1,000 elements would write 5,000,000 attributes (over 100 MB of text).
  const elements = Array.from({ length: 1000 }, (_, i) => `<xs:element name="e${i}" type="tns:T"/>`).join('');
  const doc = wsdl(
    `<xs:complexType name="T">${attributes(5000)}</xs:complexType><xs:element name="Req"><xs:complexType><xs:sequence>${elements}</xs:sequence></xs:complexType></xs:element>`,
  );
  expect(doc.length).toBeLessThan(2097152);
  const model = explainWsdl(doc)!;
  const started = performance.now();
  const request = sampleRequest(model, 'Op', { soap: '1.1', fill: true });
  const elapsed = performance.now() - started;
  // At most 50,000 nodes of about 20 characters each, plus the lines around them.
  expect(request.envelope.length).toBeLessThan(3_000_000);
  expect(request.envelope.length).toBeGreaterThan(100_000);
  const warnings = request.warnings.filter((text) => text.includes('50,000'));
  expect(warnings).toEqual(['The sample request is cut at 50,000 elements and attributes.']);
  expect(request.envelope).toContain('<!-- ... -->');
  expect(elapsed).toBeLessThan(5000);
}, 60_000);

it('the attributes of a type that extends another count against the same limit', () => {
  const elements = Array.from({ length: 200 }, (_, i) => `<xs:element name="e${i}" type="tns:D"/>`).join('');
  const doc = wsdl(
    `<xs:complexType name="B">${attributes(3000, 'b')}</xs:complexType>` +
      `<xs:complexType name="D"><xs:complexContent><xs:extension base="tns:B">${attributes(3000, 'd')}</xs:extension></xs:complexContent></xs:complexType>` +
      `<xs:element name="Req"><xs:complexType><xs:sequence>${elements}</xs:sequence></xs:complexType></xs:element>`,
  );
  const request = sampleRequest(explainWsdl(doc)!, 'Op', { soap: '1.1', fill: true });
  expect(request.envelope.length).toBeLessThan(3_000_000);
  expect(request.warnings).toContain('The sample request is cut at 50,000 elements and attributes.');
});

it('a document under the limit is written whole, with no warning about it', () => {
  const doc = wsdl(
    `<xs:complexType name="T">${attributes(10)}</xs:complexType><xs:element name="Req"><xs:complexType><xs:sequence><xs:element name="a" type="tns:T"/><xs:element name="b" type="tns:T"/></xs:sequence></xs:complexType></xs:element>`,
  );
  const request = sampleRequest(explainWsdl(doc)!, 'Op', { soap: '1.1', fill: true });
  expect(request.warnings.filter((text) => text.includes('cut at'))).toEqual([]);
  expect(request.envelope.match(/ a9="string"/g)).toHaveLength(2);
  expect(request.envelope).not.toContain('<!-- ... -->');
});

it('an attribute declared twice (in a type and the type it extends, or twice in one type) is written once on an element', () => {
  const doc = wsdl(
    `<xs:complexType name="B"><xs:attribute name="id" type="xs:int"/><xs:attribute name="kind" type="xs:string"/></xs:complexType>` +
      `<xs:complexType name="D"><xs:complexContent><xs:extension base="tns:B"><xs:attribute name="id" type="xs:string"/><xs:attribute name="extra" type="xs:string"/><xs:attribute name="extra" type="xs:string"/></xs:extension></xs:complexContent></xs:complexType>` +
      `<xs:element name="Req" type="tns:D"/>`,
  );
  const request = sampleRequest(explainWsdl(doc)!, 'Op', { soap: '1.1', fill: true });
  // The first declaration of a name is kept: the base type's id is an int, so its example is 0.
  expect(request.envelope).toContain('<tns:Req id="0" kind="string" extra="string"/>');
  expect(request.envelope.match(/ id="/g)).toHaveLength(1);
  expect(request.envelope.match(/ extra="/g)).toHaveLength(1);
});
