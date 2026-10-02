import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertData } from '../src/index';
import { readXmlValue } from '../src/xml-read';

// Extensible Markup Language (XML) 1.0, Fifth Edition: https://www.w3.org/TR/xml/ section 2.3: any Name is a valid
// element name, so constructor, prototype, __proto__, toString and valueOf are ordinary names. A key with such a name
// has to survive every conversion as an ordinary key (the tool states this in its supports list).

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

it('an element named constructor, prototype, __proto__, toString, valueOf or hasOwnProperty is an ordinary key', () => {
  const xml =
    '<a><constructor>1</constructor><prototype x="1">2</prototype><__proto__>3</__proto__>' +
    '<toString>4</toString><valueOf>5</valueOf><hasOwnProperty>6</hasOwnProperty></a>';
  const value = readXmlValue(xml, {}).value as { a: Record<string, unknown> };
  expect(Object.keys(value.a)).toEqual([
    'constructor',
    'prototype',
    '__proto__',
    'toString',
    'valueOf',
    'hasOwnProperty',
  ]);
  expect(Object.getOwnPropertyDescriptor(value.a, '__proto__')?.value).toBe('3');
  expect(Object.getPrototypeOf(value.a)).toBe(Object.prototype);
  expect(value.a['prototype']).toEqual({ '#text': '2', '@_x': '1' });
  expect(value.a['toString']).toBe('4');
});

it('JSON to XML to JSON keeps keys named like Object.prototype members', () => {
  const json = '{"a":{"toString":"x","constructor":"y","valueOf":"z"}}';
  const xml = convertData(json, { from: 'json', to: 'xml' }).output;
  const back = convertData(xml, { from: 'xml', to: 'json' }).output;
  expect(JSON.parse(back)).toEqual(JSON.parse(json));
});
