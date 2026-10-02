import { expect, it } from 'vitest';
import { explainWsdl } from '../src/index';

/*
 * An element in a schema is told from xs:import, xs:include, xs:redefine and xs:override by its name. A name that is
 * also a member of Object.prototype (constructor, toString, hasOwnProperty, valueOf, __proto__) is an ordinary unknown
 * element and must not be taken for one of the four (found by the phase 13 review). The four names and what XML Schema
 * 1.1 Part 1 (https://www.w3.org/TR/xmlschema11-1/, section 4.2.3 and 4.2.5 for xs:include, xs:redefine, xs:override
 * and 4.2.6 for xs:import) says each does are the whole list.
 */

const NS = 'xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t" xmlns:xs="http://www.w3.org/2001/XMLSchema"';

it('a schema element named like a member of Object.prototype is not a reference to another schema', () => {
  const names = [
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    'isPrototypeOf',
    '__proto__',
    '__defineGetter__',
  ];
  const unknown = names
    .map((name) => `<xs:${name} schemaLocation="http://evil.example/${name}.xsd" namespace="urn:q"/>`)
    .join('');
  const doc = `<definitions name="x" targetNamespace="urn:t" ${NS}><types><xs:schema targetNamespace="urn:t">${unknown}<xs:import schemaLocation="http://ok.example/z.xsd" namespace="urn:z"/></xs:schema></types></definitions>`;
  const model = explainWsdl(doc);
  expect(model).not.toBeNull();
  // Only the real import is listed, with its own kind.
  expect(model!.notLoaded.map((item) => [item.kind, item.location])).toEqual([
    ['xsd:import', 'http://ok.example/z.xsd'],
  ]);
});

it('the four schema references are each listed with their own kind', () => {
  const doc = `<definitions name="x" targetNamespace="urn:t" ${NS}><types><xs:schema targetNamespace="urn:t"><xs:import schemaLocation="a.xsd" namespace="urn:a"/><xs:include schemaLocation="b.xsd"/><xs:redefine schemaLocation="c.xsd"/><xs:override schemaLocation="d.xsd"/></xs:schema></types></definitions>`;
  const model = explainWsdl(doc)!;
  expect(model.notLoaded.map((item) => [item.kind, item.location])).toEqual([
    ['xsd:import', 'a.xsd'],
    ['xsd:include', 'b.xsd'],
    ['xsd:redefine', 'c.xsd'],
    ['xsd:override', 'd.xsd'],
  ]);
});
