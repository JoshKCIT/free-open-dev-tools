import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DOMParser } from '@xmldom/xmldom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_INPUT_BYTES, WsdlExplorerError, explainWsdl, operationNames, sampleRequest } from '../src/index';
import type { WsdlModel } from '../src/index';
import {
  EXAMPLE_1_STOCK_QUOTE,
  EXAMPLE_2_DEFINITIONS,
  EXAMPLE_2_SERVICE,
  EXAMPLE_3_SMTP_HEADER,
  EXAMPLE_4_RPC_ENCODED,
  EXAMPLE_5_RPC_ARRAYS,
} from './fixtures/w3c-wsdl11-note/golden';

/*
 * Grounding (D-179, P13-08).
 *
 * The documents are the XML examples of the WSDL 1.1 Note (https://www.w3.org/TR/2001/NOTE-wsdl-20010315, fetched
 * 2026-10-02) copied into test/fixtures/w3c-wsdl11-note/ with their address, date and licence in UPSTREAM.md. Every
 * expected name, address and SOAPAction below is a word of that Note: the service StockQuoteService with the
 * documentation "My first service", the port StockQuotePort at http://example.com/stockquote, the binding
 * StockQuoteSoapBinding in document style over http://schemas.xmlsoap.org/soap/http, the port type StockQuotePortType,
 * the operation GetLastTradePrice with soapAction http://example.com/GetLastTradePrice, the messages
 * GetLastTradePriceInput and GetLastTradePriceOutput, and the schema for http://example.com/stockquote.xsd.
 *
 * The shape of a request comes from the Note's section 3.5 (soap:body): in document style "the message parts appear
 * directly under the SOAP Body element"; in RPC style each part "appears under the wrapper, represented by an accessor
 * named identically to the corresponding parameter", and "the wrapper element is named identically to the operation
 * name and its namespace is the value of the namespace attribute". Section 3.4: the soapAction attribute "specifies the
 * value of the SOAPAction header". The SOAP 1.1 Note gives the envelope namespace
 * http://schemas.xmlsoap.org/soap/envelope/ and the content type text/xml (section 6.1.1: SOAPAction: "URI"); SOAP 1.2
 * Part 1 gives http://www.w3.org/2003/05/soap-envelope; RFC 3902 section 2 registers application/soap+xml with the
 * optional parameters charset and action, where "The value of the action parameter ... MUST be non-empty".
 * The WSDL 2.0 specification (https://www.w3.org/TR/wsdl20/, section 2.1.2 and its namespace table) has the root
 * element description in the namespace http://www.w3.org/ns/wsdl.
 *
 * Python is not involved: the envelopes are parsed here with the xmldom parser, which the package also uses, only to
 * read their structure; each exact text is written out by hand from the rules above.
 *
 * Where the Note disagrees with itself, the explorer reports it and these tests say so: the port of Example 1 refers to
 * tns:StockQuoteBinding while the binding is declared StockQuoteSoapBinding (a reference that does not resolve);
 * Example 5 writes wsdl:arrayType without declaring wsdl (not well-formed with respect to namespaces); the parts of
 * Example 4 name xsd:string where an element belongs. None of these is corrected.
 */

const NS_WSDL = 'http://schemas.xmlsoap.org/wsdl/';
const NS_XSD_2000 = 'http://www.w3.org/2000/10/XMLSchema';
const NS_ENVELOPE_11 = 'http://schemas.xmlsoap.org/soap/envelope/';
const NS_ENVELOPE_12 = 'http://www.w3.org/2003/05/soap-envelope';

const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});

afterEach(() => {
  // The package prints nothing, whatever it is given.
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

function explain(text: string): WsdlModel {
  const model = explainWsdl(text);
  if (model === null) throw new Error('expected a model');
  return model;
}

function refusal(run: () => unknown): WsdlExplorerError {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(WsdlExplorerError);
    return err as WsdlExplorerError;
  }
  throw new Error('expected a WsdlExplorerError');
}

/** The 1-based line of the first line of a text that holds a piece of text, counted here and not by the package. */
function lineHolding(text: string, piece: string): number {
  return text.split('\n').findIndex((line) => line.includes(piece)) + 1;
}

interface XmlElement {
  localName: string;
  namespaceURI: string | null;
  nodeName: string;
  childNodes: ArrayLike<{ nodeType: number }>;
  attributes: ArrayLike<{ name: string; value: string; namespaceURI: string | null; localName: string }>;
  textContent: string | null;
}

/** An envelope parsed with xmldom, with its child elements as a list, to read its structure. */
function parseXml(text: string): XmlElement {
  const doc = new DOMParser().parseFromString(text, 'text/xml') as unknown as { documentElement: XmlElement };
  return doc.documentElement;
}

function childElements(element: XmlElement): XmlElement[] {
  const found: XmlElement[] = [];
  for (let i = 0; i < element.childNodes.length; i++) {
    const child = element.childNodes[i] as unknown as XmlElement;
    if (child.nodeType === 1) found.push(child);
  }
  return found;
}

/** The text of a model with the parts that depend on how a document was written (names as written, lines) left out. */
function essence(model: WsdlModel): unknown {
  return JSON.parse(
    JSON.stringify(model, (key, value: unknown) => (key === 'text' || key === 'line' ? undefined : value)),
  );
}

it('the WSDL 1.1 note Example 1 lists its service, port, binding, port type and operation', () => {
  const model = explain(EXAMPLE_1_STOCK_QUOTE);
  expect(model.name).toBe('StockQuote');
  expect(model.targetNamespace).toBe('http://example.com/stockquote.wsdl');

  expect(model.services).toHaveLength(1);
  const service = model.services[0]!;
  expect(service.name).toBe('StockQuoteService');
  expect(service.documentation).toBe('My first service');
  expect(service.ports).toHaveLength(1);
  expect(service.ports[0]).toMatchObject({
    name: 'StockQuotePort',
    address: 'http://example.com/stockquote',
    protocol: 'SOAP 1.1',
    binding: {
      text: 'tns:StockQuoteBinding',
      namespace: 'http://example.com/stockquote.wsdl',
      local: 'StockQuoteBinding',
      declared: true,
    },
  });

  expect(model.bindings).toHaveLength(1);
  expect(model.bindings[0]).toMatchObject({
    name: 'StockQuoteSoapBinding',
    protocol: 'SOAP 1.1',
    style: 'document',
    transport: 'http://schemas.xmlsoap.org/soap/http',
    type: { namespace: 'http://example.com/stockquote.wsdl', local: 'StockQuotePortType' },
  });
  expect(model.bindings[0]!.operations).toHaveLength(1);
  expect(model.bindings[0]!.operations[0]).toMatchObject({
    name: 'GetLastTradePrice',
    soapAction: 'http://example.com/GetLastTradePrice',
    style: '',
    input: { body: { use: 'literal' }, headers: [] },
    output: { body: { use: 'literal' }, headers: [] },
  });

  expect(model.portTypes).toHaveLength(1);
  expect(model.portTypes[0]!.name).toBe('StockQuotePortType');
  expect(model.portTypes[0]!.operations).toHaveLength(1);
  expect(model.portTypes[0]!.operations[0]).toMatchObject({
    name: 'GetLastTradePrice',
    input: { namespace: 'http://example.com/stockquote.wsdl', local: 'GetLastTradePriceInput' },
    output: { namespace: 'http://example.com/stockquote.wsdl', local: 'GetLastTradePriceOutput' },
  });

  expect(model.messages.map((message) => message.name)).toEqual(['GetLastTradePriceInput', 'GetLastTradePriceOutput']);
  expect(model.messages[0]!.parts).toEqual([
    {
      name: 'body',
      element: {
        text: 'xsd1:TradePriceRequest',
        namespace: 'http://example.com/stockquote.xsd',
        local: 'TradePriceRequest',
        declared: true,
      },
    },
  ]);

  expect(model.types).toHaveLength(1);
  expect(model.types[0]!.targetNamespace).toBe('http://example.com/stockquote.xsd');
  expect(model.types[0]!.elements.map((element) => element.name)).toEqual(['TradePriceRequest', 'TradePrice']);
  // The schema is written in the draft namespace of the Note, with the types as unprefixed names under the default.
  expect(model.types[0]!.elements[0]!.complex!.elements).toMatchObject([
    { name: 'tickerSymbol', type: { namespace: NS_XSD_2000, local: 'string' } },
  ]);
  expect(model.types[0]!.elements[1]!.complex!.elements).toMatchObject([
    { name: 'price', type: { namespace: NS_XSD_2000, local: 'float' } },
  ]);
  expect(model.notLoaded).toEqual([]);
  expect(operationNames(model)).toEqual(['GetLastTradePrice']);
});

it('the note reference tns:StockQuoteBinding is listed as not found instead of failing', () => {
  const model = explain(EXAMPLE_1_STOCK_QUOTE);
  expect(model.notFound).toHaveLength(1);
  expect(model.notFound[0]).toMatchObject({
    kind: 'binding',
    reference: 'tns:StockQuoteBinding',
    where: 'port StockQuotePort of service StockQuoteService',
    line: lineHolding(EXAMPLE_1_STOCK_QUOTE, '<port name="StockQuotePort"'),
  });
  // The reason names what the document does declare.
  expect(model.notFound[0]!.reason).toContain('StockQuoteSoapBinding');
  // The same defect is in the Note's other examples, and each is listed and none fails.
  expect(explain(EXAMPLE_4_RPC_ENCODED).notFound.map((item) => item.reference)).toContain('tns:StockQuoteBinding');
  expect(explain(EXAMPLE_3_SMTP_HEADER).notFound).toEqual([]);
});

it('the document style sample request puts the part element in the Body with the SOAPAction from the binding', () => {
  const model = explain(EXAMPLE_1_STOCK_QUOTE);
  const request = sampleRequest(model, 'GetLastTradePrice', { soap: '1.1', fill: true });
  expect(request.envelope).toBe(
    [
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd1="http://example.com/stockquote.xsd">',
      '  <soapenv:Body>',
      '    <xsd1:TradePriceRequest>',
      '      <tickerSymbol>string</tickerSymbol>',
      '    </xsd1:TradePriceRequest>',
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n'),
  );
  expect(request.soapAction).toBe('http://example.com/GetLastTradePrice');
  expect(request.contentType).toBe('text/xml; charset=utf-8');
  expect(request.warnings).toEqual([]);

  // The structure, read by a parser: the part's element is the only child of the Body, in the namespace of the
  // schema, and its own child is not in any namespace (the schema has no elementFormDefault).
  const envelope = parseXml(request.envelope);
  expect([envelope.namespaceURI, envelope.localName]).toEqual([NS_ENVELOPE_11, 'Envelope']);
  const [body] = childElements(envelope);
  expect([body!.namespaceURI, body!.localName]).toEqual([NS_ENVELOPE_11, 'Body']);
  const [part] = childElements(body!);
  expect([part!.namespaceURI, part!.localName]).toEqual(['http://example.com/stockquote.xsd', 'TradePriceRequest']);
  const [ticker] = childElements(part!);
  expect(ticker!.localName).toBe('tickerSymbol');
  expect(ticker!.namespaceURI ?? '').toBe('');
  expect(ticker!.textContent).toBe('string');

  // A blank operation means the first one; without example values the elements are empty.
  expect(sampleRequest(model, '', { soap: '1.1', fill: true })).toEqual(request);
  expect(sampleRequest(model, '  ', { soap: '1.1', fill: false }).envelope).toContain('      <tickerSymbol/>');
  // The part of the response message is not in a request.
  expect(request.envelope).not.toContain('TradePrice>');

  // The header part of Example 3 goes in a Header, the Body part in the Body, and the binding gives no SOAPAction.
  const subscribe = sampleRequest(explain(EXAMPLE_3_SMTP_HEADER), '', { soap: '1.1', fill: true });
  expect(subscribe.envelope).toBe(
    [
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd1="http://example.com/stockquote.xsd">',
      '  <soapenv:Header>',
      '    <xsd1:SubscriptionHeader>http://example.com/</xsd1:SubscriptionHeader>',
      '  </soapenv:Header>',
      '  <soapenv:Body>',
      '    <xsd1:SubscribeToQuotes>',
      '      <tickerSymbol>string</tickerSymbol>',
      '    </xsd1:SubscribeToQuotes>',
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n'),
  );
  expect(subscribe.soapAction).toBe('');
  expect(subscribe.warnings).toEqual([]);
});

it('the RPC example wraps parts in an element named after the operation in the binding namespace', () => {
  const model = explain(EXAMPLE_4_RPC_ENCODED);
  const request = sampleRequest(model, 'GetTradePrice', { soap: '1.1', fill: true });
  expect(request.envelope).toBe(
    [
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://example.com/stockquote">',
      '  <soapenv:Body>',
      '    <ns1:GetTradePrice soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">',
      '      <tickerSymbol>string</tickerSymbol>',
      '      <time>2000-01-01T00:00:00</time>',
      '    </ns1:GetTradePrice>',
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n'),
  );
  expect(request.soapAction).toBe('http://example.com/GetTradePrice');
  // The structure: the wrapper is in the namespace of soap:body, and the accessors are named after the parts, in order.
  const [body] = childElements(parseXml(request.envelope));
  const [wrapper] = childElements(body!);
  expect([wrapper!.namespaceURI, wrapper!.localName]).toEqual(['http://example.com/stockquote', 'GetTradePrice']);
  expect(childElements(wrapper!).map((accessor) => accessor.localName)).toEqual(['tickerSymbol', 'time']);
  expect(wrapper!.attributes[0]).toMatchObject({
    localName: 'encodingStyle',
    namespaceURI: NS_ENVELOPE_11,
    value: 'http://schemas.xmlsoap.org/soap/encoding/',
  });
  expect(request.warnings).toEqual([
    'The binding uses encoded parts: they are shown without the xsi:type attributes that a SOAP encoded body also carries.',
  ]);
  // The model keeps the type names the Note writes where elements belong, and lists them as not found.
  expect(model.notFound.filter((item) => item.kind === 'element').map((item) => item.reference)).toEqual([
    'xsd:string',
    'xsd:timeInstant',
  ]);
});

it('SOAP 1.1 and 1.2 envelopes use their own namespaces and content types', () => {
  const model = explain(EXAMPLE_1_STOCK_QUOTE);
  const soap11 = sampleRequest(model, 'GetLastTradePrice', { soap: '1.1', fill: true });
  const soap12 = sampleRequest(model, 'GetLastTradePrice', { soap: '1.2', fill: true });
  expect(parseXml(soap11.envelope).namespaceURI).toBe(NS_ENVELOPE_11);
  expect(parseXml(soap12.envelope).namespaceURI).toBe(NS_ENVELOPE_12);
  expect(soap12.envelope.startsWith('<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"')).toBe(true);
  expect(soap11.contentType).toBe('text/xml; charset=utf-8');
  expect(soap12.contentType).toBe('application/soap+xml; charset=utf-8; action="http://example.com/GetLastTradePrice"');
  // The binding of the Note is a SOAP 1.1 binding, and the page says so when the envelope is 1.2.
  expect(soap12.warnings).toEqual([
    'The binding StockQuoteSoapBinding is for SOAP 1.1; the envelope is written as SOAP 1.2.',
  ]);
  // The action parameter must be non-empty (RFC 3902), so it is left out when the binding gives no action.
  const noAction = sampleRequest(explain(EXAMPLE_3_SMTP_HEADER), '', { soap: '1.2', fill: true });
  expect(noAction.contentType).toBe('application/soap+xml; charset=utf-8');
  // A quote in an action is escaped in the parameter.
  const quoted = EXAMPLE_1_STOCK_QUOTE.replace('http://example.com/GetLastTradePrice"/>', 'urn:a&quot;b&#92;c"/>');
  expect(sampleRequest(explain(quoted), '', { soap: '1.2', fill: true }).contentType).toBe(
    'application/soap+xml; charset=utf-8; action="urn:a\\"b\\\\c"',
  );

  // Two bindings for one operation: the one for the chosen version is used.
  const both = [
    '<definitions name="both" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t"',
    '    xmlns:s11="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:s12="http://schemas.xmlsoap.org/wsdl/soap12/">',
    '  <message name="In"/>',
    '  <portType name="P"><operation name="Ping"><input message="tns:In"/></operation></portType>',
    '  <binding name="B11" type="tns:P"><s11:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>',
    '    <operation name="Ping"><s11:operation soapAction="urn:one-one"/></operation></binding>',
    '  <binding name="B12" type="tns:P"><s12:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>',
    '    <operation name="Ping"><s12:operation soapAction="urn:one-two"/></operation></binding>',
    '</definitions>',
  ].join('\n');
  const model2 = explain(both);
  expect(model2.bindings.map((binding) => binding.protocol)).toEqual(['SOAP 1.1', 'SOAP 1.2']);
  expect(sampleRequest(model2, 'Ping', { soap: '1.1', fill: true }).soapAction).toBe('urn:one-one');
  expect(sampleRequest(model2, 'Ping', { soap: '1.2', fill: true })).toMatchObject({
    soapAction: 'urn:one-two',
    warnings: [],
  });
});

it('wsdl:import and xsd:import locations are listed as not loaded and never read', async () => {
  // The imports of the Note's own Example 2: two documents that import the others by address.
  const definitions = explain(EXAMPLE_2_DEFINITIONS);
  expect(definitions.notLoaded).toEqual([
    {
      kind: 'wsdl:import',
      namespace: 'http://example.com/stockquote/schemas',
      location: 'http://example.com/stockquote/stockquote.xsd',
      line: lineHolding(EXAMPLE_2_DEFINITIONS, '<import'),
    },
  ]);
  // The elements of that import are not found, and the reason says the import is not loaded.
  const elements = definitions.notFound.filter((item) => item.kind === 'element');
  expect(elements.map((item) => item.reference)).toEqual(['xsd1:TradePriceRequest', 'xsd1:TradePrice']);
  for (const item of elements) {
    expect(item.reason).toBe(
      'its namespace is imported from http://example.com/stockquote/stockquote.xsd, which is not loaded',
    );
  }
  const service = explain(EXAMPLE_2_SERVICE);
  expect(service.notLoaded).toEqual([
    {
      kind: 'wsdl:import',
      namespace: 'http://example.com/stockquote/definitions',
      location: 'http://example.com/stockquote/stockquote.wsdl',
      line: lineHolding(EXAMPLE_2_SERVICE, '<import'),
    },
  ]);
  expect(service.notFound.map((item) => [item.kind, item.reference])).toEqual([
    ['binding', 'tns:StockQuoteBinding'],
    ['portType', 'defs:StockQuotePortType'],
  ]);
  expect(service.notFound[1]!.reason).toBe(
    'its namespace is imported from http://example.com/stockquote/stockquote.wsdl, which is not loaded',
  );
  // No port type is loaded, so there is no message to build a request from, and the page says so.
  const empty = sampleRequest(service, 'GetLastTradePrice', { soap: '1.1', fill: true });
  expect(empty.envelope).toBe(
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n  <soapenv:Body/>\n</soapenv:Envelope>',
  );
  expect(empty.warnings).toEqual(['The port type of GetLastTradePrice is not in the document, so the Body is empty.']);

  // Every kind of location, and an address in a service, an action and some text, all naming a local server that
  // records every request. Explaining and building a request, twice each, must reach it never.
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const address = `http://127.0.0.1:${port}`;
  try {
    const text = [
      '<definitions name="t" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t"',
      '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xs="http://www.w3.org/2001/XMLSchema">',
      `  <import namespace="urn:other" location="${address}/other.wsdl"/>`,
      '  <documentation>See ' + address + '/docs</documentation>',
      '  <types>',
      '    <xs:schema targetNamespace="urn:t">',
      `      <xs:import namespace="urn:o" schemaLocation="${address}/import.xsd"/>`,
      `      <xs:include schemaLocation="${address}/include.xsd"/>`,
      `      <xs:redefine schemaLocation="${address}/redefine.xsd"/>`,
      `      <xs:override schemaLocation="${address}/override.xsd"/>`,
      '      <xs:element name="Ping" type="xs:string"/>',
      '    </xs:schema>',
      '  </types>',
      '  <message name="PingIn"><part name="p" element="tns:Ping"/></message>',
      '  <portType name="Pt"><operation name="Ping"><input message="tns:PingIn"/></operation></portType>',
      '  <binding name="B" type="tns:Pt"><soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>',
      `    <operation name="Ping"><soap:operation soapAction="${address}/action"/><input><soap:body use="literal"/></input></operation></binding>`,
      `  <service name="S"><port name="P" binding="tns:B"><soap:address location="${address}/service"/></port></service>`,
      '</definitions>',
    ].join('\n');
    const first = explain(text);
    const second = explain(text);
    expect(second).toEqual(first);
    expect(first.notLoaded.map((item) => [item.kind, item.location, item.line])).toEqual([
      ['wsdl:import', `${address}/other.wsdl`, lineHolding(text, '<import')],
      ['xsd:import', `${address}/import.xsd`, lineHolding(text, '<xs:import')],
      ['xsd:include', `${address}/include.xsd`, lineHolding(text, '<xs:include')],
      ['xsd:redefine', `${address}/redefine.xsd`, lineHolding(text, '<xs:redefine')],
      ['xsd:override', `${address}/override.xsd`, lineHolding(text, '<xs:override')],
    ]);
    // The address of the port is text in the model.
    expect(first.services[0]!.ports[0]!.address).toBe(`${address}/service`);
    const one = sampleRequest(first, 'Ping', { soap: '1.1', fill: true });
    const two = sampleRequest(first, 'Ping', { soap: '1.1', fill: true });
    expect(two).toEqual(one);
    expect(one.soapAction).toBe(`${address}/action`);
    expect(first.notFound).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  expect(seen).toEqual([]);
});

it('references compare by namespace and local name, so other prefixes give the same model', () => {
  const original = explain(EXAMPLE_1_STOCK_QUOTE);
  // 1. Every prefix renamed, and the WSDL elements written with a prefix instead of as the default namespace.
  const renamed = EXAMPLE_1_STOCK_QUOTE.replace(/xmlns:tns=/g, 'xmlns:a=')
    .replace(/\btns:/g, 'a:')
    .replace(/xmlns:xsd1=/g, 'xmlns:b=')
    .replace(/\bxsd1:/g, 'b:')
    .replace(/xmlns:soap=/g, 'xmlns:s=')
    .replace(/<soap:/g, '<s:')
    .replace(/<\/soap:/g, '</s:')
    .replace(/xmlns="http:\/\/schemas\.xmlsoap\.org\/wsdl\/"/, 'xmlns:w="http://schemas.xmlsoap.org/wsdl/"')
    .replace(
      /<(\/?)(definitions|types|message|part|portType|operation|input|output|binding|service|documentation|port)\b/g,
      '<$1w:$2',
    );
  expect(renamed).not.toContain('tns');
  expect(renamed).toContain('<w:definitions');
  const other = explain(renamed);
  expect(essence(other)).toEqual(essence(original));
  // The names as written are the only thing that differs.
  expect(other.services[0]!.ports[0]!.binding.text).toBe('a:StockQuoteBinding');
  expect(other.messages[0]!.parts[0]!.element!.text).toBe('b:TradePriceRequest');
  expect(sampleRequest(other, '', { soap: '1.1', fill: true }).envelope).toBe(
    sampleRequest(original, '', { soap: '1.1', fill: true }).envelope,
  );

  // 2. Two prefixes swapped: tns now stands for the schema namespace and xsd1 for the namespace of the document.
  const swapped = EXAMPLE_1_STOCK_QUOTE.replace(/tns/g, '__A__')
    .replace(/xsd1/g, '__B__')
    .replace(/__A__/g, 'xsd1')
    .replace(/__B__/g, 'tns');
  expect(swapped).toContain('xmlns:tns="http://example.com/stockquote.xsd"');
  expect(essence(explain(swapped))).toEqual(essence(original));

  // 3. A prefix that is declared again further in changes what it means there: the part below is in the namespace
  // the inner declaration gives, not the one the outer prefix had.
  const inner = [
    '<definitions targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:x="urn:outer">',
    '  <message name="M"><part name="p" xmlns:x="urn:inner" element="x:E"/></message>',
    '  <message name="N"><part name="p" element="x:E"/></message>',
    '</definitions>',
  ].join('\n');
  const parts = explain(inner).messages.map((message) => message.parts[0]!.element);
  expect(parts.map((ref) => [ref!.namespace, ref!.local])).toEqual([
    ['urn:inner', 'E'],
    ['urn:outer', 'E'],
  ]);
  // A prefix nothing declares is reported as that, not guessed.
  const undeclared = explain(
    '<definitions targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/"><message name="M"><part name="p" element="nope:E"/></message></definitions>',
  );
  expect(undeclared.messages[0]!.parts[0]!.element).toMatchObject({ declared: false, namespace: '', local: 'E' });
  expect(undeclared.notFound[0]!.reason).toBe(
    'its prefix is not declared in the document, so the name cannot be resolved',
  );
});

it('a WSDL 2.0 description and a DOCTYPE are refused before anything is explained', async () => {
  // The root element of WSDL 2.0 is description, in the namespace http://www.w3.org/ns/wsdl (WSDL 2.0 section 2.1.2).
  const twoPointZero = refusal(() =>
    explainWsdl('<description xmlns="http://www.w3.org/ns/wsdl" targetNamespace="http://example.com/hello"/>'),
  );
  expect(twoPointZero.message).toContain('"description"');
  expect(twoPointZero.message).toContain('"http://www.w3.org/ns/wsdl"');
  expect(twoPointZero.message).toContain('WSDL 2.0');
  expect(twoPointZero.line).toBe(1);
  // Other roots are named with their namespace, or with none.
  const html = refusal(() => explainWsdl('<html xmlns="http://www.w3.org/1999/xhtml"/>'));
  expect(html.message).toContain('"html"');
  expect(html.message).toContain('"http://www.w3.org/1999/xhtml"');
  expect(html.message).not.toContain('WSDL 2.0');
  expect(refusal(() => explainWsdl('<a/>')).message).toContain('no namespace');
  // definitions in a namespace that is not the one of WSDL 1.1 (no closing slash).
  const close = refusal(() => explainWsdl('<definitions xmlns="http://schemas.xmlsoap.org/wsdl"/>'));
  expect(close.message).toContain('"http://schemas.xmlsoap.org/wsdl"');
  expect(close.message).toContain('not a WSDL 1.1');
  // definitions with no namespace at all.
  expect(refusal(() => explainWsdl('<definitions/>')).message).toContain('no namespace');

  // A DOCTYPE in any letter case is refused before the document is parsed, with its position, and the entity it
  // declares names a local server that must see no request.
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    for (const word of ['DOCTYPE', 'doctype', 'DocType']) {
      const text = `<?xml version="1.0"?>\n<!${word} definitions [ <!ENTITY x SYSTEM "http://127.0.0.1:${port}/entity"> ]>\n<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">&x;</definitions>`;
      const refused = refusal(() => explainWsdl(text));
      expect(refused.message).toBe(
        'Documents with a DOCTYPE are refused: this page never reads DTDs or entity declarations.',
      );
      expect(refused.line).toBe(2);
      expect(refused.column).toBe(1);
    }
    // A billion-laughs document is refused the same way and expands nothing.
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><definitions xmlns="http://schemas.xmlsoap.org/wsdl/">&b;</definitions>`;
    expect(refusal(() => explainWsdl(laughs)).message).toContain('DOCTYPE');
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  expect(seen).toEqual([]);
});

it('a definitions element with no service still lists its port types and messages', () => {
  const model = explain(EXAMPLE_2_DEFINITIONS);
  expect(model.services).toEqual([]);
  expect(model.bindings).toEqual([]);
  expect(
    model.portTypes.map((portType) => [portType.name, portType.operations.map((operation) => operation.name)]),
  ).toEqual([['StockQuotePortType', ['GetLastTradePrice']]]);
  expect(model.messages.map((message) => message.name)).toEqual(['GetLastTradePriceInput', 'GetLastTradePriceOutput']);
  // Without a binding the operation is still listed, and a request can be built from its port type in document style.
  expect(operationNames(model)).toEqual(['GetLastTradePrice']);
  const request = sampleRequest(model, '', { soap: '1.1', fill: true });
  expect(request.soapAction).toBe('');
  expect(request.warnings).toContain(
    'No binding in this document describes GetLastTradePrice, so it is written in document style with no SOAPAction.',
  );

  // A definitions element with nothing in it, and blank input.
  const bare = explain('<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" name="minimal"/>');
  expect(bare).toEqual({
    name: 'minimal',
    targetNamespace: '',
    services: [],
    bindings: [],
    portTypes: [],
    messages: [],
    types: [],
    notLoaded: [],
    notFound: [],
  });
  expect(operationNames(bare)).toEqual([]);
  expect(refusal(() => sampleRequest(bare, '', { soap: '1.1', fill: true })).message).toBe(
    'The document has no operation to build a request for.',
  );
  expect(explainWsdl('')).toBeNull();
  expect(explainWsdl('  \n\t ')).toBeNull();
});

/** A document with one operation whose input message is one part, `element`, and the given schema. */
function withSchema(schema: string, extra = '', element = 'tns:Root'): string {
  return [
    '<definitions name="t" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t"',
    '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xs="http://www.w3.org/2001/XMLSchema">',
    '  <types>',
    `    <xs:schema targetNamespace="urn:t"${extra}>`,
    schema,
    '    </xs:schema>',
    '  </types>',
    `  <message name="In"><part name="body" element="${element}"/></message>`,
    '  <portType name="P"><operation name="Op"><input message="tns:In"/></operation></portType>',
    '  <binding name="B" type="tns:P"><soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>',
    '    <operation name="Op"><soap:operation soapAction="urn:op"/><input><soap:body use="literal"/></input></operation></binding>',
    '</definitions>',
  ].join('\n');
}

it('example values follow the simple type and complex types expand four levels with a note beyond', () => {
  // One value per kind of simple type: strings, numbers, booleans, dates and an enumeration, by the type name.
  const kinds = withSchema(
    [
      '<xs:element name="Root"><xs:complexType><xs:sequence>',
      '<xs:element name="s" type="xs:string"/><xs:element name="i" type="xs:int"/><xs:element name="d" type="xs:decimal"/>',
      '<xs:element name="p" type="xs:positiveInteger"/><xs:element name="n" type="xs:negativeInteger"/>',
      '<xs:element name="b" type="xs:boolean"/><xs:element name="date" type="xs:date"/>',
      '<xs:element name="when" type="xs:dateTime"/><xs:element name="t" type="xs:time"/><xs:element name="u" type="xs:anyURI"/>',
      '<xs:element name="e" type="tns:Color"/><xs:element name="inline"><xs:simpleType><xs:restriction base="xs:int"/></xs:simpleType></xs:element>',
      '<xs:element name="derived" type="tns:Small"/><xs:element name="noType"/>',
      '</xs:sequence></xs:complexType></xs:element>',
      '<xs:simpleType name="Color"><xs:restriction base="xs:string"><xs:enumeration value="red"/><xs:enumeration value="blue"/></xs:restriction></xs:simpleType>',
      '<xs:simpleType name="Small"><xs:restriction base="xs:short"/></xs:simpleType>',
    ].join('\n'),
  );
  const text = sampleRequest(explain(kinds), 'Op', { soap: '1.1', fill: true });
  const root = childElements(childElements(parseXml(text.envelope))[0]!)[0]!;
  const values = Object.fromEntries(childElements(root).map((item) => [item.localName, item.textContent]));
  expect(values).toEqual({
    s: 'string',
    i: '0',
    d: '0',
    p: '1',
    n: '-1',
    b: 'false',
    date: '2000-01-01',
    when: '2000-01-01T00:00:00',
    t: '00:00:00',
    u: 'http://example.com/',
    e: 'red',
    inline: '0',
    derived: '0',
    noType: 'string',
  });
  // Without example values every element is empty.
  const empty = sampleRequest(explain(kinds), 'Op', { soap: '1.1', fill: false });
  expect(
    childElements(childElements(childElements(parseXml(empty.envelope))[0]!)[0]!).every(
      (item) => (item.textContent ?? '') === '',
    ),
  ).toBe(true);

  // Attributes, extension (the base first), a choice (its first alternative), a reference to an element, text escaped,
  // qualified local elements and an element name that is not a valid XML name.
  const rich = withSchema(
    [
      '<xs:element name="Root" type="tns:Derived"/>',
      '<xs:element name="Shared" type="xs:string"/>',
      '<xs:complexType name="Base"><xs:sequence><xs:element name="first" type="xs:string"/></xs:sequence><xs:attribute name="code" type="xs:int"/></xs:complexType>',
      '<xs:complexType name="Derived"><xs:complexContent><xs:extension base="tns:Base"><xs:sequence>',
      '<xs:element name="second" type="xs:boolean"/><xs:choice><xs:element name="left" type="xs:string"/><xs:element name="right" type="xs:string"/></xs:choice>',
      '<xs:element ref="tns:Shared"/><xs:element name="esc" type="tns:Odd"/><xs:element name="x y" type="xs:string"/>',
      '</xs:sequence></xs:extension></xs:complexContent></xs:complexType>',
      '<xs:simpleType name="Odd"><xs:restriction base="xs:string"><xs:enumeration value="a&lt;b&amp;&quot;c&apos;&gt;"/></xs:restriction></xs:simpleType>',
    ].join('\n'),
    ' elementFormDefault="qualified"',
  );
  const richRequest = sampleRequest(explain(rich), 'Op', { soap: '1.1', fill: true });
  expect(richRequest.envelope).toBe(
    [
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="urn:t">',
      '  <soapenv:Body>',
      '    <tns:Root code="0">',
      '      <tns:first>string</tns:first>',
      '      <tns:second>false</tns:second>',
      '      <tns:left>string</tns:left>',
      '      <tns:Shared>string</tns:Shared>',
      '      <tns:esc>a&lt;b&amp;&quot;c&apos;&gt;</tns:esc>',
      '      <tns:invalid-name>string</tns:invalid-name>',
      '    </tns:Root>',
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n'),
  );
  expect(richRequest.warnings).toEqual([
    'A name in the document is not a valid XML name ("x y") and is written as "invalid-name".',
  ]);
  // The five entities are the whole of the escaping, and the envelope is well-formed XML that reads back to the text.
  const back = childElements(childElements(childElements(parseXml(richRequest.envelope))[0]!)[0]!).find(
    (item) => item.localName === 'esc',
  );
  expect(back!.textContent).toBe('a<b&"c\'>');

  // Six levels of nesting: four are expanded, the fifth level is marked with a comment, the sixth is not written.
  const levels = withSchema(
    [
      '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="L2" type="tns:T2"/></xs:sequence></xs:complexType></xs:element>',
      '<xs:complexType name="T2"><xs:sequence><xs:element name="L3" type="tns:T3"/></xs:sequence></xs:complexType>',
      '<xs:complexType name="T3"><xs:sequence><xs:element name="L4" type="tns:T4"/></xs:sequence></xs:complexType>',
      '<xs:complexType name="T4"><xs:sequence><xs:element name="L5" type="tns:T5"/></xs:sequence></xs:complexType>',
      '<xs:complexType name="T5"><xs:sequence><xs:element name="L6" type="tns:T6"/></xs:sequence></xs:complexType>',
      '<xs:complexType name="T6"><xs:sequence><xs:element name="L7" type="xs:string"/></xs:sequence></xs:complexType>',
    ].join('\n'),
  );
  const deep = sampleRequest(explain(levels), 'Op', { soap: '1.1', fill: true });
  expect(deep.envelope).toContain('<L5>');
  expect(deep.envelope).toContain('<!-- ... -->');
  expect(deep.envelope).not.toContain('L6');
  expect(deep.envelope).not.toContain('L7');
  expect(deep.warnings).toEqual(['Elements nested more than 4 levels deep are left out and marked with a comment.']);
  // A type that contains itself stops at the same depth and does not run away.
  const loop = withSchema(
    '<xs:element name="Root" type="tns:Loop"/><xs:complexType name="Loop"><xs:sequence><xs:element name="again" type="tns:Loop"/></xs:sequence></xs:complexType>',
  );
  const looped = sampleRequest(explain(loop), 'Op', { soap: '1.1', fill: true });
  expect(looped.envelope.split('\n').length).toBeLessThan(30);
  expect(looped.warnings).toEqual(['The type Loop contains itself, so it is expanded once.']);
});

it('input over 2 MiB is refused and invalid XML names its line and column', () => {
  expect(MAX_INPUT_BYTES).toBe(2097152);
  const small = '<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" name="padded"/>';
  // Exactly 2 MiB is read; one byte more is refused before any of it is parsed.
  const exact = small + ' '.repeat(MAX_INPUT_BYTES - small.length);
  expect(exact.length).toBe(MAX_INPUT_BYTES);
  expect(explain(exact).name).toBe('padded');
  const over = refusal(() => explainWsdl(exact + ' '));
  expect(over.message).toContain('2,097,153 bytes');
  expect(over.message).toContain('2 MiB');
  expect(over.line).toBeUndefined();
  // Bytes are counted, not characters: 699,051 characters of three bytes are 2,097,153 bytes.
  const wide = `<!-- ${'\u{20ac}'.repeat(699051)} -->`;
  expect(refusal(() => explainWsdl(wide)).message).toContain('2 MiB');

  // Example 5 of the Note writes wsdl:arrayType with no declaration of the prefix wsdl: refused, naming the line.
  const arrayLine = lineHolding(EXAMPLE_5_RPC_ARRAYS, 'wsdl:arrayType');
  expect(arrayLine).toBeGreaterThan(1);
  const undeclared = refusal(() => explainWsdl(EXAMPLE_5_RPC_ARRAYS));
  expect(undeclared.line).toBe(arrayLine);
  expect(undeclared.column).toBeGreaterThan(0);
  expect(undeclared.message).toBe('A name uses a namespace prefix that no declaration defines.');
  // An end tag that does not match, on the line where it is.
  const mismatch = refusal(() =>
    explainWsdl('<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">\n  <message name="m">\n</definitions>'),
  );
  expect(mismatch.line).toBe(3);
  expect(mismatch.column).toBeGreaterThan(0);
  expect(mismatch.message).toContain('definitions');
  // Text that is not XML at all, and a document that stops early.
  expect(refusal(() => explainWsdl('just some words')).line).toBeGreaterThan(0);
  expect(
    refusal(() => explainWsdl('<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">\n<message')).line,
  ).toBeGreaterThan(0);
});

it('an operation that is not in the document is refused naming the operations it has, and a binding picks its parts', () => {
  const model = explain(EXAMPLE_1_STOCK_QUOTE);
  const refused = refusal(() => sampleRequest(model, 'Nope', { soap: '1.1', fill: true }));
  expect(refused.message).toBe('The document has no operation named Nope. Its operations are GetLastTradePrice.');

  // soap:body parts names the parts that are in the Body; a message part that is not in it is left out, and a part
  // the message does not have is listed as not found.
  const text = [
    '<definitions name="t" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t"',
    '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xs="http://www.w3.org/2001/XMLSchema">',
    '  <message name="In"><part name="a" type="xs:string"/><part name="b" type="xs:int"/><part name="c" type="xs:boolean"/></message>',
    '  <portType name="P"><operation name="Op"><input message="tns:In"/></operation></portType>',
    '  <binding name="B" type="tns:P"><soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>',
    '    <operation name="Op"><soap:operation soapAction="urn:op"/>',
    '      <input><soap:body parts="a c missing" use="literal" namespace="urn:t"/></input></operation></binding>',
    '</definitions>',
  ].join('\n');
  const parts = explain(text);
  expect(parts.notFound).toMatchObject([{ kind: 'part', reference: 'missing' }]);
  const request = sampleRequest(parts, 'Op', { soap: '1.1', fill: true });
  expect(request.envelope).toBe(
    [
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="urn:t">',
      '  <soapenv:Body>',
      '    <ns1:Op>',
      '      <a>string</a>',
      '      <c>false</c>',
      '    </ns1:Op>',
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n'),
  );
  // An RPC binding without a namespace for the wrapper says so, and an operation in no binding is document style.
  const noNamespace = sampleRequest(explain(text.replace(' namespace="urn:t"', '')), 'Op', { soap: '1.1', fill: true });
  expect(noNamespace.envelope).toContain('    <Op>');
  expect(noNamespace.warnings).toContain(
    'The binding gives no namespace for the wrapper element, so it is written with none.',
  );
  // A binding that is not a SOAP binding is only a guide.
  const http = text.replace('<soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>', '');
  expect(sampleRequest(explain(http), 'Op', { soap: '1.1', fill: true }).warnings).toContain(
    'The binding B is not a SOAP binding, so the envelope is only a guide to its messages.',
  );
});
