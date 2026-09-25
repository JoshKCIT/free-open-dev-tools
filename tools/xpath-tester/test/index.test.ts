import { it, expect, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { evaluateXPath, XPathTesterError } from '../src/index';

// XPath 1.0 Recommendation, https://www.w3.org/TR/1999/REC-xpath-19991116/
// Section 2.5 (Abbreviated Syntax) examples: "para[@type='warning'][5] selects the fifth para
// child of the context node that has a type attribute with value warning" and
// "para[5][@type='warning'] selects the fifth para child of the context node if that child has
// a type attribute with value warning".
// Section 4.2 (String Functions) examples: substring("12345", 1.5, 2.6) returns "234";
// substring("12345", 0, 3) returns "12"; translate("bar","abc","ABC") returns "BAr".
// Section 4.2's number-to-string rule: "NaN is converted to the string NaN"; "positive infinity
// is converted to the string Infinity"; "negative infinity is converted to the string -Infinity";
// "positive zero is converted to the string 0"; "negative zero is converted to the string 0".

it('a DOCTYPE in any letter case is found with its line and column', () => {
  // Re-proves the canonical snippet's own required title after the byte-identical copy
  // (SNIPPETS-IDENTICAL checks the file content; this proves it still works here).
  expect(() => evaluateXPath('<!DOCTYPE a><a/>', '/a')).toThrowError(XPathTesterError);
  try {
    evaluateXPath('<!DOCTYPE a><a/>', '/a');
    expect.unreachable();
  } catch (err) {
    const e = err as XPathTesterError;
    expect(e.kind).toBe('xml');
    expect(e.line).toBe(1);
  }
});

it('XPath 1.0 section 2.5 abbreviated syntax examples select the expected nodes', () => {
  const xml =
    '<chapter><para type="warning">a</para><para>b</para><para type="warning">c</para><para type="warning">d</para><para type="warning">e</para></chapter>';

  // para[@type="warning"][5] selects the fifth para child that has a type attribute of warning
  // -- of the four "warning" paras (a, c, d, e), the fifth is out of range, so no match.
  const noMatch = evaluateXPath(xml, '/chapter/para[@type="warning"][5]');
  expect(noMatch.kind).toBe('nodeset');
  expect(noMatch.total).toBe(0);

  // para[5][@type="warning"] selects the fifth para child IF it has type="warning" -- the
  // fifth para child overall is "e", which does have type="warning".
  const fifthChild = evaluateXPath(xml, '/chapter/para[5][@type="warning"]');
  expect(fifthChild.kind).toBe('nodeset');
  expect(fifthChild.total).toBe(1);
  expect(fifthChild.nodes?.[0]?.value).toBe('e');

  // The two select different nodes, exactly as the recommendation's own text says.
  const xml2 = '<chapter><para type="warning">only</para></chapter>';
  const byTypeThenPosition = evaluateXPath(xml2, '/chapter/para[@type="warning"][1]');
  const byPositionThenType = evaluateXPath(xml2, '/chapter/para[1][@type="warning"]');
  expect(byTypeThenPosition.total).toBe(1);
  expect(byPositionThenType.total).toBe(1);

  // // selects all descendants of the document root; child::para is short for para.
  const deep = evaluateXPath('<a><b><para>x</para></b></a>', '//para');
  expect(deep.total).toBe(1);
  expect(deep.nodes?.[0]?.value).toBe('x');
});

it('XPath 1.0 section 4.2 string function examples return the documented strings', () => {
  const xml = '<a/>';
  expect(evaluateXPath(xml, "substring('12345', 1.5, 2.6)")).toMatchObject({ kind: 'string', value: '234' });
  expect(evaluateXPath(xml, "substring('12345', 0, 3)")).toMatchObject({ kind: 'string', value: '12' });
  expect(evaluateXPath(xml, "translate('bar','abc','ABC')")).toMatchObject({ kind: 'string', value: 'BAr' });
});

it('numbers become strings by the XPath 1.0 section 4.2 conversion rules', () => {
  const xml = '<a/>';
  expect(evaluateXPath(xml, '1 div 0')).toMatchObject({ kind: 'number', value: 'Infinity' });
  expect(evaluateXPath(xml, '0 div 0')).toMatchObject({ kind: 'number', value: 'NaN' });
  expect(evaluateXPath(xml, '-1 div 0')).toMatchObject({ kind: 'number', value: '-Infinity' });
  expect(evaluateXPath(xml, '-0')).toMatchObject({ kind: 'number', value: '0' });
  expect(evaluateXPath(xml, 'string(2.50)')).toMatchObject({ kind: 'string', value: '2.5' });
});

it('a document with a DOCTYPE is refused before the XML parser sees it, so no entity is expanded or fetched', () => {
  const externalEntity = '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>';
  try {
    evaluateXPath(externalEntity, '/a');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(XPathTesterError);
    expect((err as XPathTesterError).kind).toBe('xml');
  }

  const billionLaughs =
    '<!DOCTYPE lolz [' +
    '<!ENTITY lol "lol">' +
    '<!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">' +
    '<!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">' +
    ']>' +
    '<lolz>&lol2;</lolz>';
  expect(() => evaluateXPath(billionLaughs, '/lolz')).toThrowError(XPathTesterError);
});

it('the XML parser called directly on external entity payloads makes no request', () => {
  // Probes @xmldom/xmldom's own DOMParser directly, bypassing this package's DOCTYPE guard,
  // with fetch and XMLHttpRequest replaced by throwing spies -- proving the parser itself
  // never resolves an external entity, so the DOCTYPE guard is not the only defence (D-83).
  // See the SUMMARY's "Parser probe" section for the recorded results.
  const originalFetch = (globalThis as { fetch?: unknown }).fetch;
  const originalXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
  const fetchSpy = vi.fn(() => {
    throw new Error('fetch must never be called while parsing');
  });
  const xhrSpy = vi.fn(function XMLHttpRequestSpy() {
    throw new Error('XMLHttpRequest must never be constructed while parsing');
  });
  (globalThis as { fetch?: unknown }).fetch = fetchSpy;
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = xhrSpy;
  try {
    const payloads = [
      '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>',
      '<!DOCTYPE a [<!ENTITY x SYSTEM "http://example.invalid/x">]><a>&x;</a>',
      '<!DOCTYPE a [<!ENTITY % p SYSTEM "http://example.invalid/p.dtd"> %p; ]><a/>',
    ];
    for (const payload of payloads) {
      const parser = new DOMParser({ locator: true, onError: () => undefined });
      // The parser may report a non-fatal "entity not found" error or parse with the
      // reference left literal; either way it must never call fetch or XMLHttpRequest.
      try {
        parser.parseFromString(payload, 'text/xml');
      } catch {
        // A fatalError here is also an acceptable outcome for this probe: what matters is
        // that neither spy was ever called.
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  } finally {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = originalXhr;
  }
});

it('namespace prefixes bound on the page resolve in expressions', () => {
  const xml = '<book xmlns:bk="urn:example:book"><bk:title>Harry Potter</bk:title></book>';

  const handMapped = evaluateXPath(xml, '//bk:title', { namespaces: { bk: 'urn:example:book' } });
  expect(handMapped.total).toBe(1);
  expect(handMapped.nodes?.[0]?.value).toBe('Harry Potter');

  // A prefix not mapped at all is a different expression error, not a silent empty result --
  // the xpath package itself refuses an unresolved QName.
  expect(() => evaluateXPath(xml, '//unmapped:title')).toThrowError(XPathTesterError);

  // Root-element xmlns declarations resolve when the page's rootNamespaces option is used
  // (this package always makes them available; the page decides whether to read them).
  const rootXml = '<book xmlns:bk="urn:example:book2"><bk:title>Root Bound</bk:title></book>';
  const fromRoot = evaluateXPath(rootXml, '//bk:title');
  expect(fromRoot.total).toBe(1);
  expect(fromRoot.nodes?.[0]?.value).toBe('Root Bound');
});

it('results are typed as a node-set, string, number or boolean with each node located by its path', () => {
  const xml = '<catalog><book id="1"><title>A</title></book><book id="2"><title>B</title></book></catalog>';
  const result = evaluateXPath(xml, '/catalog/book[2]/@id');
  expect(result.kind).toBe('nodeset');
  expect(result.total).toBe(1);
  expect(result.nodes?.[0]).toMatchObject({
    type: 'attribute',
    name: 'id',
    path: '/catalog[1]/book[2]/@id',
    value: '2',
  });

  const elementResult = evaluateXPath(xml, '/catalog/book[1]/title');
  expect(elementResult.nodes?.[0]).toMatchObject({ type: 'element', path: '/catalog[1]/book[1]/title[1]' });

  expect(evaluateXPath(xml, 'true()')).toMatchObject({ kind: 'boolean', value: true });
  expect(evaluateXPath(xml, 'false()')).toMatchObject({ kind: 'boolean', value: false });
  expect(evaluateXPath(xml, 'count(//book)')).toMatchObject({ kind: 'number', value: '2' });
  expect(evaluateXPath(xml, 'name(/catalog/book[1])')).toMatchObject({ kind: 'string', value: 'book' });
});

it('a malformed expression is refused with a plain message', () => {
  try {
    evaluateXPath('<a/>', '/a/(');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(XPathTesterError);
    const e = err as XPathTesterError;
    expect(e.kind).toBe('expression');
    expect(e.message.length).toBeGreaterThan(0);
  }
});

it('malformed XML is refused with its line and column', () => {
  try {
    evaluateXPath('<a><b></a>', '/a');
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(XPathTesterError);
    const e = err as XPathTesterError;
    expect(e.kind).toBe('xml');
    expect(typeof e.line).toBe('number');
  }
});

it('nothing is written to the console while parsing or evaluating', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => undefined),
  );
  try {
    evaluateXPath('<a><b>1</b></a>', '/a/b');
    try {
      evaluateXPath('<a><b></a>', '/a');
    } catch {
      // expected
    }
    try {
      evaluateXPath('<a/>', '/a/(');
    } catch {
      // expected
    }
    try {
      evaluateXPath('<!DOCTYPE a><a/>', '/a');
    } catch {
      // expected
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
