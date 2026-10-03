import { expect, it } from 'vitest';
import {
  explainWsdl,
  findComplexType,
  findElement,
  findMessage,
  findPortType,
  findSimpleType,
  operationNames,
  sampleRequest,
  type QNameRef,
  type WsdlModel,
} from '../src/index';

/*
 * Lookups and operation names must take time in proportion to the size of the document (found by the phase 13 review:
 * a 2 MB document with 24,000 messages and operations took about three seconds on every edit, because every lookup
 * scanned every message and operation). The expected values are plain: the first declaration of a name wins, as the
 * WSDL 1.1 Note's name resolution (section 2.1.1: names are unique per kind) and the old linear scan both give, and the
 * operation names come in document order, bindings first, each name once.
 */

const ref = (local: string, namespace = 'urn:t'): QNameRef => ({
  text: `t:${local}`,
  namespace,
  local,
  declared: true,
});

/** A model with `n` messages, `n` port type operations and `n` binding operations, built directly. */
function bigModel(n: number): WsdlModel {
  const messages = Array.from({ length: n }, (_, i) => ({ name: `m${i}`, parts: [] }));
  const portTypeOperations = Array.from({ length: n }, (_, i) => ({
    name: `o${i}`,
    input: ref(`m${i}`),
    faults: [],
    parameterOrder: [],
  }));
  const bindingOperations = Array.from({ length: n }, (_, i) => ({
    name: `o${i}`,
    soapAction: '',
    style: '' as const,
  }));
  return {
    name: 'x',
    targetNamespace: 'urn:t',
    services: [],
    bindings: [
      {
        name: 'B',
        type: ref('P'),
        protocol: 'SOAP 1.1',
        style: 'document',
        transport: '',
        operations: bindingOperations,
      },
    ],
    portTypes: [{ name: 'P', operations: portTypeOperations }],
    messages,
    types: [
      {
        targetNamespace: 'urn:t',
        elements: Array.from({ length: n }, (_, i) => ({ name: `e${i}`, namespace: 'urn:t' })),
        complexTypes: Array.from({ length: n }, (_, i) => ({ name: `c${i}`, elements: [], attributes: [] })),
        simpleTypes: Array.from({ length: n }, (_, i) => ({ name: `s${i}`, enumeration: [] })),
      },
    ],
    notLoaded: [],
    notFound: [],
  };
}

it('operation names and the lookups of 60,000 declarations take a fraction of a second, not the square of the count', () => {
  // Before the fix the 60,000 message lookups alone took several seconds (1.8 billion name comparisons).
  const n = 60000;
  const model = bigModel(n);
  const started = performance.now();
  const names = operationNames(model);
  for (let i = 0; i < n; i++) {
    expect(findMessage(model, ref(`m${i}`))?.name).toBe(`m${i}`);
  }
  for (let i = 0; i < n; i += 3) {
    expect(findElement(model, ref(`e${i}`))?.name).toBe(`e${i}`);
    expect(findComplexType(model, ref(`c${i}`))?.name).toBe(`c${i}`);
    expect(findSimpleType(model, ref(`s${i}`))?.name).toBe(`s${i}`);
  }
  expect(findPortType(model, ref('P'))?.operations).toHaveLength(n);
  const elapsed = performance.now() - started;
  expect(names).toHaveLength(n);
  expect(names[0]).toBe('o0');
  expect(names[n - 1]).toBe(`o${n - 1}`);
  // A generous limit that a loaded CI machine still meets.
  expect(elapsed).toBeLessThan(2000);
}, 60_000);

it('the lookups keep their rules: the first declaration of a name wins, a name in another namespace is not found', () => {
  const model = bigModel(3);
  model.messages.push({ name: 'm1', parts: [{ name: 'later' }] });
  expect(findMessage(model, ref('m1'))?.parts).toEqual([]);
  expect(findMessage(model, ref('m1', 'urn:other'))).toBeUndefined();
  expect(findMessage(model, ref('missing'))).toBeUndefined();
  expect(findPortType(model, ref('P', 'urn:other'))).toBeUndefined();
  expect(findElement(model, ref('e1', 'urn:other'))).toBeUndefined();
  // A name that is a member of Object.prototype is not found unless it is declared.
  expect(findMessage(model, ref('constructor'))).toBeUndefined();
  expect(findElement(model, ref('toString'))).toBeUndefined();
  expect(findComplexType(model, ref('__proto__'))).toBeUndefined();
  // Operation names: bindings first, each once, in document order; port types only when no binding has any.
  model.bindings[0]!.operations.push({ name: 'o1', soapAction: '', style: '' });
  expect(operationNames(model)).toEqual(['o0', 'o1', 'o2']);
  model.bindings[0]!.operations.length = 0;
  expect(operationNames(model)).toEqual(['o0', 'o1', 'o2']);
});

it('a model changed after a lookup is looked up again from its current content', () => {
  const model = bigModel(2);
  expect(findMessage(model, ref('m5'))).toBeUndefined();
  model.messages.push({ name: 'm5', parts: [] });
  expect(findMessage(model, ref('m5'))?.name).toBe('m5');
  model.types.push({
    targetNamespace: 'urn:u',
    elements: [{ name: 'late', namespace: 'urn:u' }],
    complexTypes: [],
    simpleTypes: [],
  });
  expect(findElement(model, ref('late', 'urn:u'))?.name).toBe('late');
});

it('a document of 24,000 operations is read, and a request is built for its last operation, without a pause', () => {
  const n = 24000;
  const messages = Array.from({ length: n }, (_, i) => `<message name="m${i}"/>`).join('');
  const operations = Array.from(
    { length: n },
    (_, i) => `<operation name="o${i}"><input message="t:m${i}"/></operation>`,
  ).join('');
  const doc = `<definitions name="x" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:t="urn:t">${messages}<portType name="P">${operations}</portType></definitions>`;
  expect(doc.length).toBeLessThan(2097152);
  const model = explainWsdl(doc)!;
  expect(model.notFound).toEqual([]);
  // Three requests in a row, as three edits of the page would make: before the fix each took about 0.85 s here.
  const started = performance.now();
  for (let i = 0; i < 3; i++) {
    const request = sampleRequest(model, `o${n - 1 - i}`, { soap: '1.1', fill: true });
    expect(request.envelope).toContain('Envelope');
  }
  expect(operationNames(model)).toHaveLength(n);
  expect(performance.now() - started).toBeLessThan(1200);
}, 60_000);

it('a "not found" reason lists at most 50 declared names and counts the rest', () => {
  const messages = Array.from({ length: 60 }, (_, i) => `<message name="m${i}"/>`).join('');
  const doc = `<definitions name="x" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:t="urn:t">${messages}<portType name="P"><operation name="o"><input message="t:nothere"/></operation></portType></definitions>`;
  const model = explainWsdl(doc)!;
  expect(model.notFound).toHaveLength(1);
  const reason = model.notFound[0]!.reason;
  expect(reason).toContain('declared: m0, m1, m2');
  expect(reason).toContain('m49, and 10 more');
  expect(reason).not.toContain('m50');
  // Up to 50 names are listed whole.
  const few = explainWsdl(
    `<definitions name="x" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:t="urn:t"><message name="a"/><message name="b"/><portType name="P"><operation name="o"><input message="t:nothere"/></operation></portType></definitions>`,
  )!;
  expect(few.notFound[0]!.reason).toContain('(declared: a, b)');
});
