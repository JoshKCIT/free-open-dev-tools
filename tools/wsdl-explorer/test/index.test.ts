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
  nodeType: number;
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

/** An element as its namespace, name, text and children, with the prefixes it was written with left out. */
function shape(element: XmlElement): unknown {
  const children = childElements(element);
  return {
    namespace: element.namespaceURI,
    name: element.localName,
    text: children.length === 0 ? element.textContent : undefined,
    children: children.map(shape),
  };
}

/** The text of a model with the parts that depend on how a document was written (names as written, lines) left out. */
function essence(model: WsdlModel): unknown {
  return JSON.parse(
    JSON.stringify(model, (key, value: unknown) =>
      key === 'text' || key === 'line' || key === 'reference' ? undefined : value,
    ),
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
  // The envelope is the same in everything but the prefixes it takes from the document.
  expect(shape(parseXml(sampleRequest(other, '', { soap: '1.1', fill: true }).envelope))).toEqual(
    shape(parseXml(sampleRequest(original, '', { soap: '1.1', fill: true }).envelope)),
  );

  // 2. Two prefixes swapped: tns now stands for the schema namespace and xsd1 for the namespace of the document.
  const swapped = EXAMPLE_1_STOCK_QUOTE.replace(/\btns\b/g, '__A__')
    .replace(/\bxsd1\b/g, '__B__')
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
  // xmldom reports the element that was left open: the position is on line 2, where <message> starts, and not past it.
  expect(mismatch.line).toBe(2);
  expect(mismatch.column).toBeGreaterThan(0);
  expect(mismatch.column).toBeLessThanOrEqual('  <message name="m">'.length + 1);
  expect(mismatch.message).toContain('definitions');
  // Text that is not XML at all, and a document that stops early.
  const words = refusal(() => explainWsdl('just some words'));
  expect(words.message).toBe('The document has no root element.');
  expect(words.line).toBeUndefined();
  const early = refusal(() => explainWsdl('<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">\n<message'));
  expect(early.message).toContain('message');
  expect(early.line).toBe(2);
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
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:t">',
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

/** A document that uses the parts of WSDL 1.1 the Note's examples do not: faults, headers, an HTTP binding and others. */
const ALL_PARTS = [
  '<definitions name="all" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t"',
  '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:http="http://schemas.xmlsoap.org/wsdl/http/"',
  '    xmlns:x="urn:foreign" xmlns:xs="http://www.w3.org/2001/XMLSchema">',
  '  <import namespace="urn:no-location"/>',
  '  <x:message name="ForeignMessage"/>',
  '  <message name="M"><part name="a" type="xs:string"/><part name="b" element="tns:E"/></message>',
  '  <message name="Fault"><part name="why" type="xs:string"/></message>',
  '  <portType name="P">',
  '    <operation name="Op" parameterOrder="a b">',
  '      <input message="tns:M"/><output message="tns:M"/><fault name="Oops" message="tns:Fault"/>',
  '    </operation>',
  '  </portType>',
  '  <binding name="H" type="tns:P"><http:binding verb="POST"/><operation name="Op"/></binding>',
  '  <binding name="S" type="tns:P">',
  '    <soap:binding transport="http://schemas.xmlsoap.org/soap/http"/>',
  '    <operation name="Op">',
  '      <soap:operation soapAction="urn:op" style="rpc"/>',
  '      <input><soap:body use="literal" parts="a',
  '         b"/><soap:header message="tns:M" part="a" use="encoded" namespace="urn:h"/></input>',
  '    </operation>',
  '  </binding>',
  '  <binding name="R" type="tns:P"><soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>',
  '    <operation name="Op"><soap:operation style="weird"/></operation></binding>',
  '  <binding name="W" type="tns:P"><soap:binding style="weird"/><operation name="Op"/></binding>',
  '  <service name="Sv"><documentation>',
  '     Some words',
  '  </documentation>',
  '    <port name="HP" binding="tns:H"><http:address location="http://example.com/h"/></port>',
  '    <port name="XP" binding="tns:S"><x:address location="urn:ignored"/></port>',
  '  </service>',
  '</definitions>',
].join('\n');

it('the parts of a document that the note examples do not use are read, and elements of other namespaces are ignored', () => {
  const model = explain(ALL_PARTS);
  // An import with no location has nothing to load, so it is not listed; a foreign element called message is not a message.
  expect(model.notLoaded).toEqual([]);
  expect(model.messages.map((message) => message.name)).toEqual(['M', 'Fault']);
  expect(model.messages[0]!.parts).toMatchObject([
    { name: 'a', type: { local: 'string' } },
    { name: 'b', element: { namespace: 'urn:t', local: 'E' } },
  ]);
  // The operation of the port type: its parameter order, input, output and fault.
  expect(model.portTypes[0]!.operations).toMatchObject([
    {
      name: 'Op',
      parameterOrder: ['a', 'b'],
      input: { local: 'M' },
      output: { local: 'M' },
      faults: [{ name: 'Oops', message: { local: 'Fault' } }],
    },
  ]);
  const [http, soap, rpc, weird] = model.bindings;
  // An HTTP binding is read as that and has no style or transport; a binding with no style is document style.
  expect(http).toMatchObject({ name: 'H', protocol: 'HTTP', style: 'document', transport: '' });
  expect(soap).toMatchObject({ name: 'S', protocol: 'SOAP 1.1', style: 'document' });
  expect(rpc).toMatchObject({ name: 'R', style: 'rpc' });
  expect(weird).toMatchObject({ name: 'W', style: 'document' });
  // The soap binding's operation: its own style, the parts of the Body split on any white space, the header.
  expect(soap!.operations[0]).toMatchObject({
    name: 'Op',
    soapAction: 'urn:op',
    style: 'rpc',
    input: {
      body: { use: 'literal', parts: ['a', 'b'] },
      headers: [{ part: 'a', use: 'encoded', namespace: 'urn:h', message: { local: 'M' } }],
    },
  });
  // An operation style the Note does not allow is no style, and a binding with no soap:operation has no action.
  expect(rpc!.operations[0]).toMatchObject({ style: '', soapAction: '' });
  expect(http!.operations[0]).toMatchObject({ style: '', soapAction: '', input: undefined, output: undefined });
  // Services: the documentation is trimmed; an HTTP address is read; an address of another namespace is not one.
  expect(model.services[0]!.documentation).toBe('Some words');
  expect(model.services[0]!.ports).toMatchObject([
    { name: 'HP', address: 'http://example.com/h', protocol: 'HTTP' },
    { name: 'XP', address: '', protocol: '' },
  ]);

  // The style of the operation wins over the style of the binding: the operation is RPC here, in a document binding.
  const request = sampleRequest(model, 'Op', { soap: '1.1', fill: true });
  expect(request.envelope).toContain('    <Op>');
  expect(request.envelope).toContain('<a>string</a>');
  expect(request.soapAction).toBe('urn:op');
});

it('a root that is in the namespace of WSDL 1.1 but is not definitions is refused, and parser warnings do not stop a document', () => {
  const wrongRoot = refusal(() => explainWsdl('<description xmlns="http://schemas.xmlsoap.org/wsdl/"/>'));
  expect(wrongRoot.message).toContain('"description"');
  expect(wrongRoot.message).toContain('"http://schemas.xmlsoap.org/wsdl/"');
  expect(wrongRoot.message).not.toContain('WSDL 2.0 description');
  // An attribute value with no quotes is a warning in the parser, and the document is read.
  expect(explain('<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" name=loose/>').name).toBe('loose');
  // An undefined entity is an error, with the message of the parser and the line.
  const entity = refusal(() =>
    explainWsdl('<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">&nope;</definitions>'),
  );
  expect(entity.message).toContain('entity not found');
  expect(entity.line).toBe(1);
  expect(entity.column).toBeGreaterThan(0);
});

/** The element names an envelope shows, in order, for a document with the given elements in one schema. */
function sampledChildren(elements: string, fill = true): { name: string; text: string }[] {
  const schema = [
    '<xs:element name="Root"><xs:complexType><xs:sequence>',
    elements,
    '</xs:sequence></xs:complexType></xs:element>',
  ].join('\n');
  const request = sampleRequest(explain(withSchema(schema, ' xmlns:z="http://www.w3.org/2000/10/XMLSchema"')), 'Op', {
    soap: '1.1',
    fill,
  });
  const root = childElements(childElements(parseXml(request.envelope))[0]!)[0]!;
  return childElements(root).map((item) => ({ name: item.localName, text: item.textContent ?? '' }));
}

it('the example value of every built-in type, in the 2001 namespace and in the draft namespace of the note', () => {
  const values: [string, string][] = [
    ['string', 'string'],
    ['normalizedString', 'string'],
    ['token', 'string'],
    ['int', '0'],
    ['integer', '0'],
    ['long', '0'],
    ['short', '0'],
    ['byte', '0'],
    ['decimal', '0'],
    ['float', '0'],
    ['double', '0'],
    ['nonNegativeInteger', '0'],
    ['nonPositiveInteger', '0'],
    ['unsignedInt', '0'],
    ['unsignedLong', '0'],
    ['unsignedShort', '0'],
    ['unsignedByte', '0'],
    ['positiveInteger', '1'],
    ['negativeInteger', '-1'],
    ['boolean', 'false'],
    ['date', '2000-01-01'],
    ['dateTime', '2000-01-01T00:00:00'],
    ['time', '00:00:00'],
    ['duration', 'P1D'],
    ['gYear', '2000'],
    ['gYearMonth', '2000-01'],
    ['hexBinary', '00'],
    ['base64Binary', 'AA=='],
    ['anyURI', 'http://example.com/'],
  ];
  const elements = values.map(([type]) => `<xs:element name="e_${type}" type="xs:${type}"/>`).join('\n');
  expect(sampledChildren(elements).map((item) => [item.name, item.text])).toEqual(
    values.map(([type, value]) => [`e_${type}`, value]),
  );
  // The draft namespace of the Note has timeInstant, timeDuration and uriReference.
  const draft: [string, string][] = [
    ['timeInstant', '2000-01-01T00:00:00'],
    ['timeDuration', 'P1D'],
    ['uriReference', 'http://example.com/'],
    ['string', 'string'],
    ['float', '0'],
  ];
  const draftElements = draft.map(([type]) => `<xs:element name="d_${type}" type="z:${type}"/>`).join('\n');
  expect(sampledChildren(draftElements).map((item) => [item.name, item.text])).toEqual(
    draft.map(([type, value]) => [`d_${type}`, value]),
  );
  // Without example values every one of them is empty.
  expect(sampledChildren(elements, false).every((item) => item.text === '')).toBe(true);
});

it('an element name must be a valid XML name to be written, or it is replaced and reported', () => {
  const accented = String.fromCodePoint(0xe9);
  const good = ['a1', 'a.b', 'a-b', '_a', `${accented}a`, 'A_1.2-3'];
  const bad = ['1a', 'a b', 'a:b', '-a', '.a', 'a<b', 'a&b', 'a"b', 'a/b', 'a>b'];
  const written = sampledChildren(
    [...good, ...bad]
      .map(
        (name) =>
          `<xs:element name="${name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}" type="xs:string"/>`,
      )
      .join('\n'),
  );
  expect(written.map((item) => item.name)).toEqual([...good, ...bad.map(() => 'invalid-name')]);
});

it('namespace prefixes in an envelope come from the document when they can, and are made up when they cannot', () => {
  const parts = (declarations: string, list: string[]) =>
    [
      `<definitions name="p" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t" ${declarations}`,
      '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">',
      `  <message name="In">${list.join('')}</message>`,
      '  <portType name="P"><operation name="Op"><input message="tns:In"/></operation></portType>',
      '  <binding name="B" type="tns:P"><soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>',
      '    <operation name="Op"><input><soap:body use="literal"/></input></operation></binding>',
      '</definitions>',
    ].join('\n');
  const root = (text: string) =>
    sampleRequest(explain(text), 'Op', { soap: '1.1', fill: true }).envelope.split('\n')[0];

  // The prefixes of the document are used.
  expect(
    root(
      parts('xmlns:one="urn:one" xmlns:two="urn:two"', [
        '<part name="a" element="one:X"/>',
        '<part name="b" element="two:Y"/>',
      ]),
    ),
  ).toBe(
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:one="urn:one" xmlns:two="urn:two">',
  );
  // The same prefix for two namespaces (the second declared further in): the second gets a made-up prefix.
  expect(
    root(
      parts('xmlns:a="urn:one"', [
        '<part name="a" element="a:X"/>',
        '<part name="b" xmlns:a="urn:two" element="a:Y"/>',
      ]),
    ),
  ).toBe(
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a="urn:one" xmlns:ns1="urn:two">',
  );
  // A prefix the envelope already uses for itself, or that XML reserves, is not taken again.
  expect(root(parts('xmlns:soapenv="urn:one"', ['<part name="a" element="soapenv:X"/>']))).toBe(
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:one">',
  );
  // The XML namespace is only ever bound to the prefix xml, which needs no declaration.
  const xmlRequest = sampleRequest(explain(parts('', ['<part name="a" element="xml:X"/>'])), 'Op', {
    soap: '1.1',
    fill: true,
  });
  expect(xmlRequest.envelope).toBe(
    [
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">',
      '  <soapenv:Body>',
      '    <xml:X/>',
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n'),
  );
  // Namespaces with no prefix in the document are numbered from 1, each once.
  // (the third part is written with a prefix, so that the default namespace can be another one for its name)
  const bare = parts('xmlns:w="http://schemas.xmlsoap.org/wsdl/"', [
    '<part name="a" element="tns:A"/>',
    '<part name="b" xmlns:q="urn:q" element="q:B"/>',
    '<w:part name="c" xmlns="urn:default" element="C"/>',
  ]);
  expect(root(bare)).toBe(
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="urn:t" xmlns:q="urn:q" xmlns:ns1="urn:default">',
  );
  // Two prefixes for one namespace: the first one the document writes is used, whether it names a type or an element.
  expect(
    root(parts('xmlns:p="urn:p" xmlns:x="urn:p"', ['<part name="a" type="p:T"/>', '<part name="b" element="x:E"/>'])),
  ).toBe('<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:p="urn:p">');
  expect(
    root(parts('xmlns:p="urn:p" xmlns:x="urn:p"', ['<part name="a" element="x:E"/>', '<part name="b" type="p:T"/>'])),
  ).toBe('<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:x="urn:p">');
  // A part with a type only has no namespace to learn a prefix from; a part with neither is written empty.
  expect(root(parts('', ['<part name="a" type="tns:T"/>', '<part name="b"/>']))).toBe(
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">',
  );
});

it('a sample request is cut at 2,000 elements, and a document nested too deeply is refused', () => {
  // Twenty elements of one type that holds twenty of the next, five levels deep: 3.2 million elements if all are written.
  const types = ['T1', 'T2', 'T3', 'T4', 'T5'];
  const schema = [
    '<xs:element name="Root" type="tns:T1"/>',
    ...types.map((name, index) => {
      const next = types[index + 1];
      const children = Array.from(
        { length: 20 },
        (_, i) => `<xs:element name="c${i}" type="${next ? `tns:${next}` : 'xs:string'}"/>`,
      );
      return `<xs:complexType name="${name}"><xs:sequence>${children.join('')}</xs:sequence></xs:complexType>`;
    }),
  ].join('\n');
  const request = sampleRequest(explain(withSchema(schema)), 'Op', { soap: '1.1', fill: true });
  // Every element written is the root or one of the c elements: exactly 2,000 of them.
  expect((request.envelope.match(/<(?:tns:Root|c\d+)[ >/]/g) ?? []).length).toBe(2000);
  expect(request.warnings).toContain('The sample request is cut at 2,000 elements.');

  // Nesting of 300 levels is refused with its line (a crafted document could otherwise exhaust the stack).
  const open = '<xs:sequence>'.repeat(300);
  const close = '</xs:sequence>'.repeat(300);
  const deep = withSchema(`<xs:element name="Root"><xs:complexType>${open}${close}</xs:complexType></xs:element>`);
  const refused = refusal(() => explainWsdl(deep));
  expect(refused.message).toBe('The document nests elements more than 200 levels deep.');
  expect(refused.line).toBeGreaterThan(0);
  // 100 levels is read.
  const fine = withSchema(
    `<xs:element name="Root"><xs:complexType>${'<xs:sequence>'.repeat(100)}${'</xs:sequence>'.repeat(100)}</xs:complexType></xs:element>`,
  );
  expect(explain(fine).types[0]!.elements[0]!.name).toBe('Root');
});

/** A document with one operation, to say what is missing from it; each argument is the XML that goes in its place. */
function sparse(options: {
  messages?: string;
  operation?: string;
  style?: string;
  bodyParts?: string;
  header?: string;
  schema?: string;
}): string {
  return [
    '<definitions name="s" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t"',
    '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xs="http://www.w3.org/2001/XMLSchema"',
    '    xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/">',
    `  <types><xs:schema targetNamespace="urn:t">${options.schema ?? '<xs:element name="E" type="xs:string"/>'}</xs:schema></types>`,
    options.messages ?? '  <message name="In"><part name="a" element="tns:E"/></message>',
    `  <portType name="P"><operation name="Op">${options.operation ?? '<input message="tns:In"/>'}</operation></portType>`,
    `  <binding name="B" type="tns:P"><soap:binding style="${options.style ?? 'document'}" transport="http://schemas.xmlsoap.org/soap/http"/>`,
    `    <operation name="Op"><input><soap:body use="literal" namespace="urn:t"${options.bodyParts ?? ''}/>${options.header ?? ''}</input></operation></binding>`,
    '</definitions>',
  ].join('\n');
}

it('what a document leaves out is said in the warnings of the request', () => {
  const warningsOf = (text: string) => sampleRequest(explain(text), 'Op', { soap: '1.1', fill: true });
  // The message of the operation is not in the document, or the operation has no input at all.
  expect(warningsOf(sparse({ operation: '<input message="tns:Gone"/>' }))).toMatchObject({
    warnings: ['The message tns:Gone is not in the document, so the Body is empty.'],
  });
  expect(warningsOf(sparse({ operation: '<output message="tns:In"/>' }))).toMatchObject({
    warnings: ['The operation Op has no input message, so the Body is empty.'],
  });
  // An element a part names is not in the document: written empty, in document style and in RPC style.
  const missingElement = warningsOf(
    sparse({ messages: '<message name="In"><part name="a" element="tns:Nope"/></message>' }),
  );
  expect(missingElement.warnings).toEqual([
    'The element tns:Nope of part a is not in the document, so it is written empty.',
  ]);
  expect(missingElement.envelope).toContain('<tns:Nope/>');
  const missingRpc = warningsOf(
    sparse({ style: 'rpc', messages: '<message name="In"><part name="a" element="tns:Nope"/></message>' }),
  );
  expect(missingRpc.warnings).toEqual([
    'The element tns:Nope of part a is not in the document, so it is written empty.',
  ]);
  expect(missingRpc.envelope).toContain('      <a>\n        <tns:Nope/>\n      </a>');
  // A part with a type and no element, in document style, and a part with neither.
  const typed = warningsOf(
    sparse({ messages: '<message name="In"><part name="a" type="xs:int"/><part name="b"/></message>' }),
  );
  expect(typed.warnings).toEqual(['Part a has a type and no element, so its element is named after the part.']);
  expect(typed.envelope).toContain('    <a>0</a>\n    <b>string</b>');
  const typedRpc = warningsOf(
    sparse({ style: 'rpc', messages: '<message name="In"><part name="a" type="xs:int"/><part name="b"/></message>' }),
  );
  expect(typedRpc.warnings).toEqual([]);
  expect(typedRpc.envelope).toContain('      <a>0</a>\n      <b>string</b>');
  // A header part that is not in the document, or whose message is not.
  const header = (message: string, part: string) => `<soap:header message="${message}" part="${part}" use="literal"/>`;
  expect(warningsOf(sparse({ header: header('tns:In', 'zz') })).warnings).toEqual([
    'The header part zz of tns:In is not in the document, so it is left out.',
  ]);
  expect(warningsOf(sparse({ header: header('tns:Gone', 'a') })).warnings).toEqual([
    'The header part a of tns:Gone is not in the document, so it is left out.',
  ]);
  // A type that restricts an array type of the SOAP encoding is not expanded, and an element reference that is missing.
  const array = warningsOf(
    sparse({
      messages: '<message name="In"><part name="a" element="tns:Holder"/></message>',
      schema:
        '<xs:element name="Holder" type="tns:Arr"/><xs:complexType name="Arr"><xs:complexContent><xs:restriction base="soapenc:Array"><xs:sequence><xs:element name="x" type="xs:string"/></xs:sequence></xs:restriction></xs:complexContent></xs:complexType>',
    }),
  );
  expect(array.warnings).toEqual([
    'The type Arr restricts soapenc:Array (an array type of the SOAP encoding), so its content is not expanded.',
  ]);
  expect(array.envelope).not.toContain('<x>');
  const ref = warningsOf(
    sparse({
      messages: '<message name="In"><part name="a" element="tns:Holder"/></message>',
      schema:
        '<xs:element name="Holder"><xs:complexType><xs:sequence><xs:element ref="tns:Nope"/></xs:sequence></xs:complexType></xs:element>',
    }),
  );
  expect(ref.warnings).toEqual(['The element tns:Nope is not in the document, so it is written empty.']);
  expect(ref.envelope).toContain('<tns:Nope/>');
  // The references of the schema that do not resolve are listed as not found, with where they are written.
  const notFound = explain(
    sparse({
      messages: '<message name="In"><part name="a" element="tns:Holder"/></message>',
      schema:
        '<xs:element name="Holder" type="tns:NoType"><xs:annotation/></xs:element><xs:element name="Two"><xs:complexType><xs:complexContent><xs:extension base="tns:NoBase"><xs:attribute name="at" type="tns:NoAttr"/></xs:extension></xs:complexContent></xs:complexType></xs:element><xs:simpleType name="S"><xs:restriction base="tns:NoSimple"/></xs:simpleType>',
    }),
  ).notFound;
  expect(notFound.map((item) => [item.kind, item.reference])).toEqual([
    ['type', 'tns:NoType'],
    ['type', 'tns:NoBase'],
    ['type', 'tns:NoAttr'],
    ['type', 'tns:NoSimple'],
  ]);
  expect(notFound[0]!.where).toBe('element Holder of the schema for urn:t');
  expect(notFound[3]!.where).toBe('simple type S');
});

it('operation names are listed once each, in document order, from the bindings first and from the port types when there are none', () => {
  const head =
    '<definitions targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">';
  const portType = '<portType name="P"><operation name="Z"/><operation name="A"/><operation/></portType>';
  const bindings = [
    '<binding name="B1" type="tns:P"><soap:binding/><operation name="B"/><operation name="A"/><operation/></binding>',
    '<binding name="B2" type="tns:P"><soap:binding/><operation name="B"/><operation name="C"/></binding>',
  ].join('');
  expect(operationNames(explain(`${head}${portType}${bindings}</definitions>`))).toEqual(['B', 'A', 'C']);
  expect(operationNames(explain(`${head}${portType}</definitions>`))).toEqual(['Z', 'A']);
  // The first of the names is the operation a blank name means.
  const model = explain(`${head}${portType}${bindings}</definitions>`);
  expect(sampleRequest(model, '', { soap: '1.1', fill: true }).warnings[0]).toContain('The port type');
  expect(refusal(() => sampleRequest(model, 'Z', { soap: '1.1', fill: true })).message).toBe(
    'The document has no operation named Z. Its operations are B, A, C.',
  );
});

it('names are split at the first colon, a name with no prefix and no default namespace has none, and attribute values are trimmed', () => {
  const doc = [
    '<w:definitions targetNamespace="urn:t" xmlns:w="http://schemas.xmlsoap.org/wsdl/" xmlns:x="urn:x">',
    '  <w:message name=" M ">',
    '    <w:part name="a" element="x:y:z"/>',
    '    <w:part name="b" element="E"/>',
    '    <w:part name=" c " type="  x:T  "/>',
    '  </w:message>',
    '</w:definitions>',
  ].join('\n');
  const [message] = explain(doc).messages;
  expect(message!.name).toBe('M');
  expect(message!.parts[0]).toMatchObject({ name: 'a', element: { namespace: 'urn:x', local: 'y:z', declared: true } });
  // No prefix and no default namespace in scope: no namespace, and nothing is undeclared.
  expect(message!.parts[1]).toMatchObject({ element: { text: 'E', namespace: '', local: 'E', declared: true } });
  expect(message!.parts[2]).toMatchObject({ name: 'c', type: { text: 'x:T', namespace: 'urn:x', local: 'T' } });
  // The line of a message is the line of its start tag.
  expect(message!.line).toBe(2);
  expect(explain(EXAMPLE_1_STOCK_QUOTE).messages.map((item) => item.line)).toEqual([
    lineHolding(EXAMPLE_1_STOCK_QUOTE, '<message name="GetLastTradePriceInput"'),
    lineHolding(EXAMPLE_1_STOCK_QUOTE, '<message name="GetLastTradePriceOutput"'),
  ]);
});

it('elements of other namespaces inside WSDL elements are ignored, and schema imports without a location are not listed', () => {
  const doc = [
    '<definitions targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:x="urn:x" xmlns:tns="urn:t"',
    '    xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">',
    '  <types>',
    '    <x:schema targetNamespace="urn:ignored"/>',
    '    <xs:schema targetNamespace="urn:t">',
    '      <xs:import namespace="urn:no-location"/>',
    '      <xs:import namespace="urn:o" schemaLocation="http://example.com/o.xsd"/>',
    '      <x:element name="Foreign"/>',
    '      <x:complexType name="ForeignType"/>',
    '      <xs:element name="Own" type="xs:string"/>',
    '    </xs:schema>',
    '  </types>',
    '  <message name="M"><x:part name="zz"/><part name="a" element="tns:Own"/></message>',
    '  <portType name="P">',
    '    <x:operation name="Foreign"/>',
    '    <operation name="Op"><x:input message="tns:M"/><input message="tns:M"/><x:output message="tns:M"/></operation>',
    '  </portType>',
    '  <binding name="B" type="tns:P"><x:binding style="rpc"/><soap:binding style="document"/>',
    '    <x:operation name="Foreign"/><operation name="Op"><x:input><soap:body use="encoded"/></x:input><input><soap:body use="literal"/></input></operation>',
    '  </binding>',
    '  <x:service name="Foreign"/>',
    '  <service name="S"><x:port name="foreign"/><port name="P" binding="tns:B"><soap:address location="urn:a"/></port></service>',
    '</definitions>',
  ].join('\n');
  const model = explain(doc);
  expect(model.types).toHaveLength(1);
  expect(model.types[0]!.elements.map((item) => item.name)).toEqual(['Own']);
  expect(model.types[0]!.complexTypes).toEqual([]);
  expect(model.notLoaded).toEqual([
    { kind: 'xsd:import', namespace: 'urn:o', location: 'http://example.com/o.xsd', line: lineHolding(doc, 'urn:o') },
  ]);
  expect(model.messages[0]!.parts.map((part) => part.name)).toEqual(['a']);
  expect(
    model.portTypes[0]!.operations.map((operation) => [operation.name, operation.input?.local, operation.output]),
  ).toEqual([['Op', 'M', undefined]]);
  expect(model.bindings[0]).toMatchObject({ style: 'document', protocol: 'SOAP 1.1' });
  expect(model.bindings[0]!.operations.map((operation) => [operation.name, operation.input?.body?.use])).toEqual([
    ['Op', 'literal'],
  ]);
  expect(model.services.map((service) => [service.name, service.ports.map((port) => port.name)])).toEqual([
    ['S', ['P']],
  ]);
});

it('a local element is in the namespace of its schema when the schema says so or the element does, and not otherwise', () => {
  const schema = [
    '<xs:element name="Root"><xs:complexType><xs:sequence>',
    '<xs:element name="plain" type="xs:string"/>',
    '<xs:element name="asked" form="qualified" type="xs:string"/>',
    '<xs:element name="refused" form="unqualified" type="xs:string"/>',
    '</xs:sequence></xs:complexType></xs:element>',
  ].join('\n');
  const namespaces = (extra: string) => {
    const request = sampleRequest(explain(withSchema(schema, extra)), 'Op', { soap: '1.1', fill: true });
    const root = childElements(childElements(parseXml(request.envelope))[0]!)[0]!;
    return childElements(root).map((item) => [item.localName, item.namespaceURI ?? '']);
  };
  expect(namespaces('')).toEqual([
    ['plain', ''],
    ['asked', 'urn:t'],
    ['refused', ''],
  ]);
  expect(namespaces(' elementFormDefault="qualified"')).toEqual([
    ['plain', 'urn:t'],
    ['asked', 'urn:t'],
    ['refused', ''],
  ]);
  expect(namespaces(' elementFormDefault="unqualified"')).toEqual([
    ['plain', ''],
    ['asked', 'urn:t'],
    ['refused', ''],
  ]);
});

it('a document with several parser errors is refused with the first of them', () => {
  const doc = '<definitions xmlns="http://schemas.xmlsoap.org/wsdl/">&nope1;&nope2;</definitions>';
  expect(refusal(() => explainWsdl(doc)).message).toContain('&nope1;');
});

const REFERENCES = [
  '<definitions name="refs" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t" xmlns:other="urn:other"',
  '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xs="http://www.w3.org/2001/XMLSchema"',
  '    xmlns:soapenc="http://schemas.xmlsoap.org/soap/encoding/" xmlns:x="urn:x">',
  '  <types>',
  '    <xs:schema targetNamespace="urn:t">',
  '      <xs:element name="Known" type="xs:string"/>',
  '      <xs:complexType name="Cx"><xs:sequence><xs:element name="c" type="tns:NoChild"/><x:element name="ignored"/></xs:sequence>',
  '        <xs:attribute ref="tns:ra"/><xs:attribute name="n" type="xs:int"/></xs:complexType>',
  '      <xs:complexType name="Price"><xs:simpleContent><xs:extension base="xs:decimal"><xs:attribute name="currency" type="xs:string"/></xs:extension></xs:simpleContent></xs:complexType>',
  '      <xs:complexType name="Cnt"><xs:simpleContent><xs:restriction base="xs:int"/></xs:simpleContent></xs:complexType>',
  '    </xs:schema>',
  '  </types>',
  '  <message name="M"><part name="a" element="xs:string"/><part name="b" type="tns:NoSuchType"/><part name="c" type="xs:int"/><part name="d" type="soapenc:Array"/></message>',
  '  <portType name="P">',
  '    <operation name="Op"><input message="tns:M"/><output message="tns:GoneOut"/><fault name="F" message="tns:GoneFault"/></operation>',
  '  </portType>',
  '  <binding name="B" type="tns:P"><soap:binding/>',
  '    <operation name="Missing"/>',
  '    <operation name="Op"><input><soap:body parts="a nope" use="literal"/><soap:header message="tns:M" part="zz" use="literal"/></input></operation>',
  '  </binding>',
  '  <binding name="Lost" type="other:Gone"><soap:binding/><operation name="Op"><input><soap:body parts="a" use="literal"/></input></operation></binding>',
  '  <service name="S"><port name="p1" binding="other:B"/></service>',
  '</definitions>',
].join('\n');

it('every kind of reference that does not resolve is listed as not found, with what it is, where it is written and why', () => {
  const model = explain(REFERENCES);
  expect(model.notFound.map((item) => [item.kind, item.reference, item.where])).toEqual([
    ['binding', 'other:B', 'port p1 of service S'],
    ['operation', 'Missing', 'binding B'],
    ['part', 'zz', 'a input header of operation Op in binding B'],
    ['part', 'nope', 'the input body of operation Op in binding B'],
    ['portType', 'other:Gone', 'binding Lost'],
    ['message', 'tns:GoneOut', 'the output of operation Op in port type P'],
    ['message', 'tns:GoneFault', 'the fault F of operation Op in port type P'],
    ['element', 'xs:string', 'part a of message M'],
    ['type', 'tns:NoSuchType', 'part b of message M'],
    ['type', 'tns:NoChild', 'complex type Cx'],
  ]);
  const reasons = model.notFound.map((item) => item.reason);
  // A name in another namespace is not the binding of the same name in this one.
  expect(reasons[0]).toBe('no binding with this name is declared in this document (declared: B, Lost)');
  expect(reasons[1]).toBe('port type P has no operation with this name (declared: Op)');
  expect(reasons[2]).toBe('message M has no part with this name');
  expect(reasons[3]).toBe('message M has no part with this name');
  expect(reasons[4]).toBe('no port type with this name is declared in this document (declared: P)');
  expect(reasons[5]).toBe('no message with this name is declared in this document (declared: M)');
  expect(reasons[7]).toBe('it names a type of XML Schema where an element is expected');
  expect(reasons[8]).toBe('no type with this name is declared in this document (the document declares no type)');
  // The lines are those of the elements that hold the references.
  expect(model.notFound[0]!.line).toBe(lineHolding(REFERENCES, '<port name="p1"'));
  expect(model.notFound[1]!.line).toBe(lineHolding(REFERENCES, '<operation name="Missing"'));
  expect(model.notFound[5]!.line).toBe(lineHolding(REFERENCES, '<operation name="Op"><input message="tns:M"/>'));
  expect(model.notFound[7]!.line).toBe(lineHolding(REFERENCES, '<message name="M"'));

  // What is read from the schema around those references.
  const [schema] = model.types;
  const cx = schema!.complexTypes.find((def) => def.name === 'Cx')!;
  expect(cx.elements.map((item) => item.name)).toEqual(['c']);
  expect(cx.attributes).toEqual([{ name: 'n', type: expect.objectContaining({ local: 'int' }) }]);
  const price = schema!.complexTypes.find((def) => def.name === 'Price')!;
  expect(price).toMatchObject({
    base: { local: 'decimal' },
    textType: { local: 'decimal' },
    attributes: [{ name: 'currency', type: { local: 'string' } }],
  });
  expect(schema!.complexTypes.find((def) => def.name === 'Cnt')).toMatchObject({ textType: { local: 'int' } });
  expect(schema!.complexTypes.find((def) => def.name === 'Cnt')!.base).toBeUndefined();

  // A request for a type with simple content has its attributes and its text.
  const typed = withSchema(
    [
      '<xs:element name="Root"><xs:complexType><xs:sequence>',
      '<xs:element name="price" type="tns:Price"/><xs:element name="count" type="tns:Cnt"/>',
      '</xs:sequence></xs:complexType></xs:element>',
      '<xs:complexType name="Price"><xs:simpleContent><xs:extension base="xs:decimal"><xs:attribute name="currency" type="xs:string"/></xs:extension></xs:simpleContent></xs:complexType>',
      '<xs:complexType name="Cnt"><xs:simpleContent><xs:restriction base="xs:int"/></xs:simpleContent></xs:complexType>',
    ].join('\n'),
  );
  const filled = sampleRequest(explain(typed), 'Op', { soap: '1.1', fill: true });
  expect(filled.envelope).toContain('      <price currency="string">0</price>\n      <count>0</count>');
  const empty = sampleRequest(explain(typed), 'Op', { soap: '1.1', fill: false });
  expect(empty.envelope).toContain('      <price currency=""/>\n      <count/>');
});

it('references inside a schema are checked at every depth: element references, bases, restrictions and nested types', () => {
  const doc = withSchema(
    [
      '<xs:element name="Root" type="xs:string"/>',
      '<xs:element name="Out"><xs:complexType><xs:sequence><xs:element name="in" type="tns:NoIn"/><xs:element ref="tns:NoRef"/></xs:sequence></xs:complexType></xs:element>',
      '<xs:element name="Inline"><xs:simpleType><xs:restriction base="tns:NoSimple"/></xs:simpleType></xs:element>',
      '<xs:complexType name="R"><xs:complexContent><xs:restriction base="tns:NoRestriction"/></xs:complexContent></xs:complexType>',
      '<xs:complexType name="T"><xs:simpleContent><xs:restriction base="tns:NoText"/></xs:simpleContent></xs:complexType>',
      '<xs:complexType name="E"><xs:complexContent><xs:extension base="tns:NoBase"/></xs:complexContent></xs:complexType>',
    ].join('\n'),
  );
  const found = explain(doc).notFound.map((item) => [item.kind, item.reference, item.where]);
  expect(found).toEqual([
    ['type', 'tns:NoIn', 'element Out of the schema for urn:t'],
    ['element', 'tns:NoRef', 'element Out of the schema for urn:t'],
    ['type', 'tns:NoSimple', 'element Inline of the schema for urn:t'],
    ['type', 'tns:NoRestriction', 'complex type R'],
    ['type', 'tns:NoText', 'complex type T'],
    ['type', 'tns:NoBase', 'complex type E'],
  ]);
});

it('a reference is not found when its namespace is not the one of the document, and the reason says why', () => {
  const head = [
    '<definitions targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t" xmlns:other="urn:other"',
    '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xs="http://www.w3.org/2001/XMLSchema">',
  ].join('\n');
  // The names exist, in another namespace than the references use.
  const wrong = explain(
    [
      head,
      '<types><xs:schema targetNamespace="urn:t"><xs:element name="Known" type="xs:string"/></xs:schema></types>',
      '<message name="M"><part name="a" element="other:Known"/></message>',
      '<portType name="P"><operation name="Op"><input message="other:M"/></operation></portType>',
      '<binding name="B" type="other:P"><soap:binding/><operation name="Op"/></binding>',
      '</definitions>',
    ].join('\n'),
  );
  expect(wrong.notFound.map((item) => [item.kind, item.reference])).toEqual([
    ['portType', 'other:P'],
    ['message', 'other:M'],
    ['element', 'other:Known'],
  ]);

  // An import with no namespace does not explain a name that has none; one with a namespace explains its names.
  // (written with a prefix for WSDL, so that a name with no prefix has no namespace)
  const imports = explain(
    [
      '<w:definitions targetNamespace="urn:t" xmlns:w="http://schemas.xmlsoap.org/wsdl/" xmlns:other="urn:other">',
      '<w:import location="http://example.com/a.wsdl"/>',
      '<w:import namespace="urn:other" location="http://example.com/b.wsdl"/>',
      '<w:message name="M"><w:part name="a" element="E"/><w:part name="b" element="other:F"/></w:message>',
      '</w:definitions>',
    ].join('\n'),
  );
  expect(imports.notFound.map((item) => item.reason)).toEqual([
    'no element with this name is declared in this document (the document declares no element)',
    'its namespace is imported from http://example.com/b.wsdl, which is not loaded',
  ]);

  // When nothing of a kind is declared the reason says so; a declared thing with no name is not listed.
  const none = explain(
    [
      head,
      '<portType name="P"><operation name="Op"><input message="tns:M"/></operation></portType>',
      '</definitions>',
    ].join('\n'),
  );
  expect(none.notFound[0]!.reason).toBe(
    'no message with this name is declared in this document (the document declares no message)',
  );
  const unnamed = explain(
    [
      head,
      '<binding type="tns:P"><soap:binding/></binding><binding name="Real" type="tns:P"><soap:binding/></binding>',
      '<service name="S"><port name="p" binding="tns:Gone"/></service>',
      '</definitions>',
    ].join('\n'),
  );
  expect(unnamed.notFound.find((item) => item.kind === 'binding')!.reason).toBe(
    'no binding with this name is declared in this document (declared: Real)',
  );
});

it('the binding for a request is the one that has the operation, for the version asked, and a request needs the port type of that binding', () => {
  const head = [
    '<definitions targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t"',
    '    xmlns:s11="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:s12="http://schemas.xmlsoap.org/wsdl/soap12/"',
    '    xmlns:http="http://schemas.xmlsoap.org/wsdl/http/">',
    '<message name="In"/>',
    '<portType name="P"><operation name="A"><input message="tns:In"/></operation><operation name="B"><input message="tns:In"/></operation></portType>',
  ].join('\n');
  // Only the binding that has the operation is used, and a SOAP binding of the other version is used before an HTTP one.
  const model = explain(
    [
      head,
      '<binding name="First" type="tns:P"><s11:binding/><operation name="A"><s11:operation soapAction="urn:first-a"/></operation></binding>',
      '<binding name="Web" type="tns:P"><http:binding verb="GET"/><operation name="B"/></binding>',
      '<binding name="Second" type="tns:P"><s12:binding/><operation name="B"><s12:operation soapAction="urn:second-b"/></operation></binding>',
      '</definitions>',
    ].join('\n'),
  );
  expect(sampleRequest(model, 'B', { soap: '1.1', fill: true })).toMatchObject({
    soapAction: 'urn:second-b',
    warnings: ['The binding Second is for SOAP 1.2; the envelope is written as SOAP 1.1.'],
  });
  expect(sampleRequest(model, 'A', { soap: '1.2', fill: true })).toMatchObject({ soapAction: 'urn:first-a' });
  // A document with an HTTP binding only: the request is a guide, and says so.
  const web = explain(
    [
      head,
      '<binding name="Web" type="tns:P"><http:binding verb="GET"/><operation name="A"/></binding>',
      '</definitions>',
    ].join('\n'),
  );
  expect(sampleRequest(web, 'A', { soap: '1.1', fill: true }).warnings).toEqual([
    'The binding Web is not a SOAP binding, so the envelope is only a guide to its messages.',
  ]);
  // The operation name is trimmed.
  expect(sampleRequest(model, '  A  ', { soap: '1.1', fill: true }).soapAction).toBe('urn:first-a');

  // A binding whose port type is not in the document gets an empty Body, even when another port type has the operation.
  const lost = explain(
    [
      head,
      '<binding name="Lost" type="tns:Gone"><s11:binding/><operation name="A"><s11:operation soapAction="urn:lost"/></operation></binding>',
      '</definitions>',
    ].join('\n'),
  );
  const request = sampleRequest(lost, 'A', { soap: '1.1', fill: true });
  expect(request.soapAction).toBe('urn:lost');
  expect(request.warnings).toEqual(['The port type of A is not in the document, so the Body is empty.']);
  // With no binding at all the operation comes from the port types.
  const nothing = sampleRequest(explain(`${head}</definitions>`), 'B', { soap: '1.1', fill: true });
  expect(nothing.warnings).toEqual([
    'No binding in this document describes B, so it is written in document style with no SOAPAction.',
  ]);
});

it('an envelope is escaped in its attributes and declarations, declares the namespaces of nested elements, and does not repeat a prefix', () => {
  const head = (declarations: string) =>
    `<definitions name="e" targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" ${declarations}>`;
  const tail = (body: string) =>
    [
      '<portType name="P"><operation name="Op"><input message="tns:In"/></operation></portType>',
      `<binding name="B" type="tns:P"><soap:binding style="rpc"/><operation name="Op"><input>${body}</input></operation></binding>`,
      '</definitions>',
    ].join('\n');

  // An attribute value with the five characters, from an enumeration, and an empty enumeration value.
  const schema = [
    '<types><xs:schema targetNamespace="urn:t">',
    '<xs:simpleType name="Odd"><xs:restriction base="xs:string"><xs:enumeration value="a&lt;b&amp;&quot;c&apos;&gt;"/></xs:restriction></xs:simpleType>',
    '<xs:simpleType name="Empty"><xs:restriction base="xs:string"><xs:enumeration value=""/></xs:restriction></xs:simpleType>',
    '<xs:complexType name="C"><xs:sequence><xs:element name="blank" type="tns:Empty"/></xs:sequence><xs:attribute name="at" type="tns:Odd"/></xs:complexType>',
    '</xs:schema></types>',
    '<message name="In"><part name="p" type="tns:C"/></message>',
  ].join('\n');
  const escaped = sampleRequest(
    explain([head(''), schema, tail('<soap:body use="literal" namespace="urn:a&amp;b"/>')].join('\n')),
    'Op',
    {
      soap: '1.1',
      fill: true,
    },
  );
  expect(escaped.envelope).toBe(
    [
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:a&amp;b">',
      '  <soapenv:Body>',
      '    <ns1:Op>',
      '      <p at="a&lt;b&amp;&quot;c&apos;&gt;">',
      '        <blank/>',
      '      </p>',
      '    </ns1:Op>',
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n'),
  );
  // The envelope reads back as well-formed XML with the namespace and the attribute as they were.
  const back = parseXml(escaped.envelope);
  const wrapper = childElements(childElements(back)[0]!)[0]!;
  expect(wrapper.namespaceURI).toBe('urn:a&b');
  expect(childElements(wrapper)[0]!.attributes[0]!.value).toBe('a<b&"c\'>');

  // Encoded use with no encoding style writes no attribute for it.
  const bare = sampleRequest(
    explain([head(''), schema, tail('<soap:body use="encoded" namespace="urn:n"/>')].join('\n')),
    'Op',
    { soap: '1.1', fill: true },
  );
  expect(bare.envelope).not.toContain('encodingStyle');
  expect(bare.warnings).toContain(
    'The binding uses encoded parts: they are shown without the xsi:type attributes that a SOAP encoded body also carries.',
  );

  // A child in another namespace than its parent is declared, and a prefix the document uses is not taken twice
  // by a made-up one.
  const two = [
    head('xmlns:ns1="urn:one"'),
    '<types>',
    '<xs:schema targetNamespace="urn:one"><xs:element name="Other" type="xs:string"/></xs:schema>',
    '<xs:schema targetNamespace="urn:t"><xs:element name="Root"><xs:complexType><xs:sequence><xs:element ref="ns1:Other"/></xs:sequence></xs:complexType></xs:element></xs:schema>',
    '</types>',
    '<message name="In"><part name="p" element="tns:Root"/></message>',
    '<portType name="P"><operation name="Op"><input message="tns:In"/></operation></portType>',
    '<binding name="B" type="tns:P"><soap:binding/><operation name="Op"><input><soap:body use="literal"/></input></operation></binding>',
    '</definitions>',
  ].join('\n');
  const nested = sampleRequest(explain(two), 'Op', { soap: '1.1', fill: true });
  // urn:t has the prefix tns from the part and urn:one gets a made-up one: the nested element is declared too.
  expect(nested.envelope.split('\n')[0]).toBe(
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="urn:t" xmlns:ns1="urn:one">',
  );
  expect(nested.envelope).toContain('<ns1:Other>string</ns1:Other>');
  // A made-up prefix steps over the ones the document uses: here ns1 is taken, so the next namespace gets ns2.
  const steps = [
    '<w:definitions targetNamespace="urn:t" xmlns:w="http://schemas.xmlsoap.org/wsdl/" xmlns:ns1="urn:one" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">',
    '<w:message name="In"><w:part name="a" element="ns1:A"/><w:part name="b" xmlns="urn:default" element="B"/></w:message>',
    '<w:portType name="P"><w:operation name="Op"><w:input message="In"/></w:operation></w:portType>',
    '<w:binding name="Bd" type="P"><soap:binding/><w:operation name="Op"/></w:binding>',
    '</w:definitions>',
  ].join('\n');
  const stepped = sampleRequest(explain(steps.replace('targetNamespace="urn:t"', 'targetNamespace=""')), 'Op', {
    soap: '1.1',
    fill: true,
  });
  expect(stepped.envelope.split('\n')[0]).toBe(
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:one" xmlns:ns2="urn:default">',
  );
});

it('the same warning is given once however many times the cause comes up', () => {
  const doc = [
    '<definitions targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t">',
    '<message name="In"><part name="a" element="tns:Nope"/><part name="b" element="tns:Nope"/><part name="c" element="tns:Other"/></message>',
    '<portType name="P"><operation name="Op"><input message="tns:In"/></operation></portType>',
    '</definitions>',
  ].join('\n');
  const request = sampleRequest(explain(doc), 'Op', { soap: '1.1', fill: true });
  expect(request.warnings).toEqual([
    'No binding in this document describes Op, so it is written in document style with no SOAPAction.',
    'The element tns:Nope of part a is not in the document, so it is written empty.',
    'The element tns:Nope of part b is not in the document, so it is written empty.',
    'The element tns:Other of part c is not in the document, so it is written empty.',
  ]);
  // Two parts of one kind with the same name of element give the same text only when the part names match.
  const same = doc.replace('part name="b"', 'part name="a"');
  expect(sampleRequest(explain(same), 'Op', { soap: '1.1', fill: true }).warnings).toHaveLength(3);
});

it('a chain of types that extend each other is followed 50 levels and no further', () => {
  // 8,000 types, each extending the next: followed all the way, this would exhaust the stack.
  const count = 8000;
  const types = Array.from(
    { length: count },
    (_, i) =>
      `<xs:complexType name="T${i}"><xs:complexContent><xs:extension base="tns:T${i + 1}"><xs:sequence><xs:element name="e${i}" type="xs:string"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType>`,
  );
  const doc = withSchema(
    `<xs:element name="Root" type="tns:T0"/>${types.join('')}<xs:complexType name="T${count}"><xs:sequence><xs:element name="last" type="xs:string"/></xs:sequence></xs:complexType>`,
  );
  const request = sampleRequest(explain(doc), 'Op', { soap: '1.1', fill: true });
  expect(request.warnings).toEqual(['Types that extend other types are followed 50 levels, no further.']);
  // The content of the base comes first: e50 down to e0, and nothing of T51 or beyond.
  const root = childElements(childElements(parseXml(request.envelope))[0]!)[0]!;
  expect(childElements(root).map((item) => item.localName)).toEqual(Array.from({ length: 51 }, (_, i) => `e${50 - i}`));
  // A chain of exactly the limit is followed whole, without a warning.
  const short = withSchema(
    `<xs:element name="Root" type="tns:T0"/>${types.slice(0, 50).join('')}<xs:complexType name="T50"><xs:sequence><xs:element name="last" type="xs:string"/></xs:sequence></xs:complexType>`,
  );
  const whole = sampleRequest(explain(short), 'Op', { soap: '1.1', fill: true });
  expect(whole.warnings).toEqual([]);
  expect(whole.envelope).toContain('<last>string</last>');
});

it('simple types follow their bases for a value, a chain of them stops far down and a loop of them does not run away', () => {
  const chain = (length: number, last: string) =>
    Array.from(
      { length },
      (_, i) =>
        `<xs:simpleType name="S${i}"><xs:restriction base="${i + 1 < length ? `tns:S${i + 1}` : last}"/></xs:simpleType>`,
    ).join('');
  const valueOf = (types: string) => {
    const root =
      '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="v" type="tns:S0"/></xs:sequence></xs:complexType></xs:element>';
    const request = sampleRequest(explain(withSchema(`${root}${types}`)), 'Op', { soap: '1.1', fill: true });
    return childElements(childElements(childElements(parseXml(request.envelope))[0]!)[0]!)[0]!.textContent;
  };
  // Through three simple types to a number, and to an enumeration in the last one.
  expect(valueOf(chain(3, 'xs:int'))).toBe('0');
  expect(valueOf(chain(3, 'xs:boolean'))).toBe('false');
  const enumerated = `${chain(2, 'tns:E')}<xs:simpleType name="E"><xs:restriction base="xs:string"><xs:enumeration value="first"/></xs:restriction></xs:simpleType>`;
  expect(valueOf(enumerated)).toBe('first');
  // Eight steps are followed; a chain of twenty is cut and gives the text string, as does a loop.
  expect(valueOf(chain(9, 'xs:int'))).toBe('0');
  expect(valueOf(chain(20, 'xs:int'))).toBe('string');
  expect(valueOf('<xs:simpleType name="S0"><xs:restriction base="tns:S0"/></xs:simpleType>')).toBe('string');
});

it('a type of the same name in two namespaces is not a loop, a loop of extensions stops, and a missing type gives text', () => {
  // T of urn:t holds an element of the type T of urn:o: the same local name, another type.
  const twoNamespaces = [
    '<w:definitions targetNamespace="urn:t" xmlns:w="http://schemas.xmlsoap.org/wsdl/" xmlns:t="urn:t" xmlns:o="urn:o"',
    '    xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">',
    '<w:types>',
    '<xs:schema targetNamespace="urn:o"><xs:complexType name="T"><xs:sequence><xs:element name="leaf" type="xs:string"/></xs:sequence></xs:complexType></xs:schema>',
    '<xs:schema targetNamespace="urn:t"><xs:element name="Root" type="t:T"/>',
    '<xs:complexType name="T"><xs:sequence><xs:element name="c" type="o:T"/></xs:sequence></xs:complexType></xs:schema>',
    '</w:types>',
    '<w:message name="In"><w:part name="p" element="t:Root"/></w:message>',
    '<w:portType name="P"><w:operation name="Op"><w:input message="t:In"/></w:operation></w:portType>',
    '<w:binding name="B" type="t:P"><soap:binding/><w:operation name="Op"/></w:binding>',
    '</w:definitions>',
  ].join('\n');
  const nested = sampleRequest(explain(twoNamespaces), 'Op', { soap: '1.1', fill: true });
  expect(nested.warnings).toEqual([]);
  expect(nested.envelope).toContain('<c>\n        <leaf>string</leaf>\n      </c>');

  // A extends B and B extends A: each is expanded once, the base first.
  const loop = withSchema(
    [
      '<xs:element name="Root" type="tns:A"/>',
      '<xs:complexType name="A"><xs:complexContent><xs:extension base="tns:B"><xs:sequence><xs:element name="a" type="xs:string"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType>',
      '<xs:complexType name="B"><xs:complexContent><xs:extension base="tns:A"><xs:sequence><xs:element name="b" type="xs:string"/></xs:sequence></xs:extension></xs:complexContent></xs:complexType>',
    ].join('\n'),
  );
  const looped = sampleRequest(explain(loop), 'Op', { soap: '1.1', fill: true });
  const root = childElements(childElements(parseXml(looped.envelope))[0]!)[0]!;
  expect(childElements(root).map((item) => item.localName)).toEqual(['b', 'a']);

  // An element of a type that is not in the document has the text string, and nothing when values are off.
  const missing = withSchema(
    '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="m" type="tns:Missing"/></xs:sequence></xs:complexType></xs:element>',
  );
  expect(sampleRequest(explain(missing), 'Op', { soap: '1.1', fill: true }).envelope).toContain('<m>string</m>');
  expect(sampleRequest(explain(missing), 'Op', { soap: '1.1', fill: false }).envelope).toContain('<m/>');
});

it('elements nest 200 levels and no deeper in a document', () => {
  const nested = (sequences: number) =>
    withSchema(
      `<xs:element name="Root"><xs:complexType>${'<xs:sequence>'.repeat(sequences)}${'</xs:sequence>'.repeat(sequences)}</xs:complexType></xs:element>`,
    );
  // definitions, types, schema, element and complexType are five levels, so 195 sequences reach level 200.
  expect(explain(nested(195)).types[0]!.elements[0]!.name).toBe('Root');
  const refused = refusal(() => explainWsdl(nested(196)));
  expect(refused.message).toBe('The document nests elements more than 200 levels deep.');
  // The line is that of the element that is too deep.
  expect(refused.line).toBe(lineHolding(nested(196), '<xs:element name="Root">'));
});

it('what a sample does with attributes that have no type, parts that name a type of XML Schema as an element, and empty types', () => {
  // An attribute with no type has the text string; with values off it is empty.
  const attribute = withSchema(
    '<xs:element name="Root"><xs:complexType><xs:sequence/><xs:attribute name="plain"/><xs:attribute name="typed" type="xs:int"/></xs:complexType></xs:element>',
  );
  expect(sampleRequest(explain(attribute), 'Op', { soap: '1.1', fill: true }).envelope).toContain(
    '<tns:Root plain="string" typed="0"/>',
  );
  expect(sampleRequest(explain(attribute), 'Op', { soap: '1.1', fill: false }).envelope).toContain(
    '<tns:Root plain="" typed=""/>',
  );

  // A part that names xs:string or xs:int as its element (the note's own RPC example does) is written as an element
  // named after the part, with the value of the type; with values off it is empty.
  const builtIn = [
    '<definitions targetNamespace="urn:t" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="urn:t" xmlns:xs="http://www.w3.org/2001/XMLSchema"',
    '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">',
    '<message name="In"><part name="first" element="xs:string"/><part name="second" element="xs:int"/></message>',
    '<portType name="P"><operation name="Op"><input message="tns:In"/></operation></portType>',
    '<binding name="B" type="tns:P"><soap:binding/><operation name="Op"/></binding>',
    '</definitions>',
  ].join('\n');
  const typed = sampleRequest(explain(builtIn), 'Op', { soap: '1.1', fill: true });
  expect(typed.warnings).toEqual([]);
  expect(typed.envelope).toContain('    <first>string</first>\n    <second>0</second>');
  expect(sampleRequest(explain(builtIn), 'Op', { soap: '1.1', fill: false }).envelope).toContain(
    '    <first/>\n    <second/>',
  );
  // The same in RPC style, where the accessor is named after the part as well.
  const rpc = builtIn.replace('<soap:binding/>', '<soap:binding style="rpc"/>');
  expect(sampleRequest(explain(rpc), 'Op', { soap: '1.1', fill: true }).envelope).toContain(
    '      <first>string</first>\n      <second>0</second>',
  );

  // A type with attributes and no elements, five levels down, is not cut and does not warn.
  const levels = withSchema(
    [
      '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="l2" type="tns:T2"/></xs:sequence></xs:complexType></xs:element>',
      '<xs:complexType name="T2"><xs:sequence><xs:element name="l3" type="tns:T3"/></xs:sequence></xs:complexType>',
      '<xs:complexType name="T3"><xs:sequence><xs:element name="l4" type="tns:T4"/></xs:sequence></xs:complexType>',
      '<xs:complexType name="T4"><xs:sequence><xs:element name="l5" type="tns:T5"/></xs:sequence></xs:complexType>',
      '<xs:complexType name="T5"><xs:attribute name="only" type="xs:int"/></xs:complexType>',
    ].join('\n'),
  );
  const flat = sampleRequest(explain(levels), 'Op', { soap: '1.1', fill: true });
  expect(flat.warnings).toEqual([]);
  expect(flat.envelope).toContain('<l5 only="0"/>');
  expect(flat.envelope).not.toContain('<!--');

  // In RPC style a part with an element holds that element, expanded from the second level: three levels below it
  // are written whole.
  const rpcElement = withSchema(
    [
      '<xs:element name="Root"><xs:complexType><xs:sequence><xs:element name="c1" type="tns:T1"/></xs:sequence></xs:complexType></xs:element>',
      '<xs:complexType name="T1"><xs:sequence><xs:element name="c2" type="tns:T2"/></xs:sequence></xs:complexType>',
      '<xs:complexType name="T2"><xs:sequence><xs:element name="c3" type="xs:string"/></xs:sequence></xs:complexType>',
    ].join('\n'),
  ).replace('<soap:binding style="document"', '<soap:binding style="rpc"');
  const held = sampleRequest(explain(rpcElement), 'Op', { soap: '1.1', fill: true });
  expect(held.warnings).toEqual([
    'The binding gives no namespace for the wrapper element, so it is written with none.',
  ]);
  expect(held.envelope).toContain('<c3>string</c3>');
  expect(held.envelope).toContain('<body>\n        <tns:Root>');
});
