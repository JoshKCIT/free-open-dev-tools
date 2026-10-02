# WSDL & SOAP Explorer

List a WSDL document's services, ports, operations and messages, and build a sample SOAP request for one.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Reads a pasted WSDL 1.1 document and lists its services and ports, bindings, operations, messages and inline schema types. It lists every reference that does not resolve as not found, and every import as not loaded, because nothing the document names is ever fetched. For one operation it builds a sample SOAP 1.1 or 1.2 request envelope, shaped by the binding's style and use, with the SOAPAction and content type to send it with. The service address is shown as text only. Nothing is uploaded.

## Supported

- WSDL 1.1 documents with SOAP 1.1 and SOAP 1.2 bindings, document and RPC styles, and literal and encoded use
- Services, ports and their addresses, bindings, port types, operations, messages and parts, each read through the document's own namespace declarations
- Inline XML Schema types: elements, complex types with sequence, all or choice, simple types with enumerations, attributes and extension, in the 2001 namespace and in the draft namespaces the WSDL note's own examples use
- A sample request envelope for any operation: the part elements in the Body for document style, a wrapper named after the operation in the binding's namespace for RPC style, and header parts from the binding
- The SOAPAction of the operation as the binding gives it, and the content type: text/xml for SOAP 1.1, application/soap+xml with the action parameter for SOAP 1.2
- References that do not resolve listed as not found with the reason, and wsdl:import, xsd:import, xsd:include, xsd:redefine and xsd:override locations listed as not loaded

## Limits

- Documents up to 2 MiB.
- WSDL 1.1 only; a WSDL 2.0 description is refused.
- Nothing the document names is loaded: wsdl:import and xsd:import locations are listed as not loaded, and the service address is shown as text.
- Sample values are placeholders chosen by type and are not validated against the schema; complex types expand four levels.
- Elements may nest at most 200 levels deep, and a sample request has at most 2,000 elements; a larger sample is cut with a comment and a warning.
- Only the schema types written inside the document are known. Types from an import that is not loaded are listed as not found, and the sample writes them as an empty element or the text string.

## Ambiguous cases, and what this does about them

- A reference is compared by namespace URI and local name, never by prefix text, so a document that uses other prefixes gives the same result. A name without a prefix takes the default namespace in scope, as XML Schema's rule does
- The WSDL 1.1 note's own StockQuote example has a port that refers to a binding named StockQuoteBinding while the binding is declared as StockQuoteSoapBinding; that reference is listed as not found and nothing fails
- When several bindings describe an operation, the one for the chosen SOAP version is used if there is one, and a warning says when the binding is for the other version
- A choice in a schema shows its first alternative only, and an element can be written once; minOccurs and maxOccurs are not used
- A part that names a type and no element, in document style, is written as an element named after the part
- Encoded use is shown without the xsi:type attributes that a SOAP encoded body also carries, and a warning says so
- In SOAP 1.2 the action travels in the content type, as RFC 3902 describes, and not in a SOAPAction header; it is left out when the binding gives none, because the parameter must be non-empty

## Defined by

- [Web Services Description Language (WSDL) 1.1](https://www.w3.org/TR/2001/NOTE-wsdl-20010315)
- [Simple Object Access Protocol (SOAP) 1.1](https://www.w3.org/TR/2000/NOTE-SOAP-20000508/)
- [SOAP Version 1.2 Part 1: Messaging Framework](https://www.w3.org/TR/soap12-part1/)
- [RFC 3902 The application/soap+xml media type](https://www.rfc-editor.org/rfc/rfc3902)

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/wsdl-explorer wsdl-explorer
cd wsdl-explorer
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/wsdl-explorer
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { explainWsdl, sampleRequest } from '@fodt/wsdl-explorer';

const model = explainWsdl(wsdlText);
if (model) {
  const request = sampleRequest(model, 'GetLastTradePrice', { soap: '1.1', fill: true });
  // request.envelope, request.soapAction, request.contentType, request.warnings
}
```

`explainWsdl(text)` returns null for blank input and otherwise a model with `services`, `bindings`, `portTypes`, `messages`, `types`, `notLoaded` and `notFound`; it throws `WsdlExplorerError` (with `line` and `column` for invalid XML) for a DOCTYPE, a document over `MAX_INPUT_BYTES`, invalid XML, or a root that is not a WSDL 1.1 definitions element. `sampleRequest(model, operation, { soap, fill })` takes a blank operation to mean the first one and throws `WsdlExplorerError` for a name the document does not have. Both are pure functions of their arguments and read nothing but the text they are given.

## Dependencies

- `@xmldom/xmldom` 0.9.12

## Tests

```sh
npm test
```

The examples of the WSDL 1.1 note are copied into the test folder with their address and fetch date, and every expected name, address and SOAPAction is a word of the note. Envelope namespaces and content types come from the SOAP 1.1 note, SOAP 1.2 Part 1 and RFC 3902. A local server named in a document (an import, an include and the service address) is shown to receive no request, and a DOCTYPE that names it is refused before anything is parsed.

## Licence

MIT. See [LICENSE](./LICENSE).
