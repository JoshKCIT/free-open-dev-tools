import meta from './meta.json';
import { DOMParser } from '@xmldom/xmldom';
import { DOCTYPE_REFUSAL_MESSAGE, findDoctype } from './xml-doctype';
import {
  NS_HTTP_BINDING,
  NS_SOAP11_BINDING,
  NS_SOAP12_BINDING,
  NS_WSDL,
  NS_XML,
  WsdlExplorerError,
  XSD_NAMESPACES,
  findComplexType,
  findElement,
  findMessage,
  findPortType,
  findSimpleType,
  isBuiltInType,
  type AttributeDecl,
  type ComplexDef,
  type ElementDecl,
  type MessageBinding,
  type NotFound,
  type NotLoaded,
  type PortTypeOperation,
  type QNameRef,
  type SchemaInfo,
  type SimpleDef,
  type WsdlBinding,
  type WsdlMessage,
  type WsdlModel,
  type WsdlPortType,
  type WsdlService,
} from './model';

export { meta };
export * from './model';
export { sampleRequest } from './sample-request';
export type { SampleOptions, SampleResult } from './sample-request';

/** The largest document read: 2 MiB. */
export const MAX_INPUT_BYTES = 2097152;

/** The WSDL 2.0 description namespace, to tell it apart from 1.1. */
const NS_WSDL20 = 'http://www.w3.org/ns/wsdl';

// ---------------------------------------------------------------------------------------------------------------------
// Reading the XML

/** What this reader uses of an xmldom node. */
interface XNode {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  namespaceURI?: string | null;
  parentNode: XNode | null;
  attributes?: ArrayLike<{ name: string; value: string }>;
  childNodes: ArrayLike<XNode>;
  lineNumber?: number;
  getAttribute?(name: string): string;
  hasAttribute?(name: string): boolean;
  textContent?: string | null;
}

const ELEMENT_NODE = 1;

function checkSize(text: string): void {
  if (text.length * 3 <= MAX_INPUT_BYTES) return;
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_INPUT_BYTES) {
    throw new WsdlExplorerError(
      `This document is ${bytes.toLocaleString('en-US')} bytes. The limit is 2 MiB (${MAX_INPUT_BYTES.toLocaleString('en-US')} bytes) because the whole document is held in the page while it is read.`,
    );
  }
}

/** The child elements of a node, in document order. */
function elementsOf(node: XNode): XNode[] {
  const found: XNode[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]!;
    if (child.nodeType === ELEMENT_NODE) found.push(child);
  }
  return found;
}

/** The child elements with a local name in a namespace (or in one of several). */
function childrenOf(node: XNode, namespaces: string | readonly string[], local: string): XNode[] {
  const wanted = typeof namespaces === 'string' ? [namespaces] : namespaces;
  return elementsOf(node).filter((child) => child.localName === local && wanted.includes(child.namespaceURI ?? ''));
}

function attr(node: XNode, name: string): string {
  if (!node.hasAttribute?.(name)) return '';
  return (node.getAttribute?.(name) ?? '').trim();
}

function lineOf(node: XNode): number | undefined {
  return typeof node.lineNumber === 'number' ? node.lineNumber : undefined;
}

/** The namespace a prefix stands for at an element, from the `xmlns` declarations in scope; undefined when none. */
function lookupNamespace(node: XNode, prefix: string): string | undefined {
  if (prefix === 'xml') return NS_XML;
  const wanted = prefix === '' ? 'xmlns' : `xmlns:${prefix}`;
  for (let current: XNode | null = node; current && current.nodeType === ELEMENT_NODE; current = current.parentNode) {
    const attributes = current.attributes;
    if (!attributes) continue;
    for (let i = 0; i < attributes.length; i++) {
      if (attributes[i]!.name === wanted) return attributes[i]!.value;
    }
  }
  return undefined;
}

/**
 * Resolves a qualified name written in an attribute value through the declarations in scope at that element, never
 * by comparing prefix text. A name without a prefix takes the default namespace in scope, as XML Schema's rule does.
 */
function resolveQName(node: XNode, text: string): QNameRef {
  const written = text.trim();
  const colon = written.indexOf(':');
  const prefix = colon < 0 ? '' : written.slice(0, colon);
  const local = colon < 0 ? written : written.slice(colon + 1);
  const found = lookupNamespace(node, prefix);
  return { text: written, namespace: found ?? '', local, declared: found !== undefined || prefix === '' };
}

function optionalQName(node: XNode, name: string): QNameRef | undefined {
  const written = attr(node, name);
  return written === '' ? undefined : resolveQName(node, written);
}

function protocolOf(namespace: string | null | undefined): 'SOAP 1.1' | 'SOAP 1.2' | 'HTTP' | '' {
  if (namespace === NS_SOAP11_BINDING) return 'SOAP 1.1';
  if (namespace === NS_SOAP12_BINDING) return 'SOAP 1.2';
  if (namespace === NS_HTTP_BINDING) return 'HTTP';
  return '';
}

const SOAP_BINDING_NAMESPACES = [NS_SOAP11_BINDING, NS_SOAP12_BINDING] as const;

/** The first child element of a binding extension namespace (SOAP 1.1 or 1.2) with a local name. */
function soapChild(node: XNode, local: string): XNode | undefined {
  return childrenOf(node, SOAP_BINDING_NAMESPACES, local)[0];
}

// ---------------------------------------------------------------------------------------------------------------------
// Schemas

/** A Map, not an object: a name such as constructor or toString must not find a member of Object.prototype. */
const SCHEMA_REFERENCE_KINDS = new Map<string, NotLoaded['kind']>([
  ['import', 'xsd:import'],
  ['include', 'xsd:include'],
  ['redefine', 'xsd:redefine'],
  ['override', 'xsd:override'],
]);

/** Parses the particles of a compositor: an element is kept, a nested compositor is walked, a choice keeps its first. */
function parseParticles(
  node: XNode,
  schema: XNode,
  qualified: boolean,
  targetNamespace: string,
  into: ElementDecl[],
): void {
  for (const child of elementsOf(node)) {
    if (!XSD_NAMESPACES.includes(child.namespaceURI ?? '')) continue;
    if (child.localName === 'element') {
      into.push(parseElement(child, schema, qualified, targetNamespace, false));
    } else if (child.localName === 'sequence' || child.localName === 'all') {
      parseParticles(child, schema, qualified, targetNamespace, into);
    } else if (child.localName === 'choice') {
      const first: ElementDecl[] = [];
      parseParticles(child, schema, qualified, targetNamespace, first);
      if (first.length > 0) into.push(first[0]!);
    }
  }
}

function parseSimpleType(node: XNode, name: string): SimpleDef {
  const restriction = childrenOf(node, XSD_NAMESPACES, 'restriction')[0];
  const enumeration = restriction
    ? childrenOf(restriction, XSD_NAMESPACES, 'enumeration').map((item) => attr(item, 'value'))
    : [];
  return { name, base: restriction ? optionalQName(restriction, 'base') : undefined, enumeration, line: lineOf(node) };
}

function parseAttributes(node: XNode): AttributeDecl[] {
  return childrenOf(node, XSD_NAMESPACES, 'attribute')
    .filter((item) => attr(item, 'name') !== '')
    .map((item) => ({ name: attr(item, 'name'), type: optionalQName(item, 'type') }));
}

function parseComplexType(
  node: XNode,
  name: string,
  schema: XNode,
  qualified: boolean,
  targetNamespace: string,
): ComplexDef {
  const def: ComplexDef = { name, elements: [], attributes: [], line: lineOf(node) };
  parseParticles(node, schema, qualified, targetNamespace, def.elements);
  def.attributes.push(...parseAttributes(node));
  for (const kind of ['complexContent', 'simpleContent'] as const) {
    const content = childrenOf(node, XSD_NAMESPACES, kind)[0];
    if (!content) continue;
    for (const derivation of ['extension', 'restriction'] as const) {
      const step = childrenOf(content, XSD_NAMESPACES, derivation)[0];
      if (!step) continue;
      const base = optionalQName(step, 'base');
      if (derivation === 'extension') {
        def.base = base;
        if (kind === 'simpleContent') def.textType = base;
      } else if (kind === 'simpleContent') {
        def.textType = base;
      } else {
        def.restricts = base;
      }
      parseParticles(step, schema, qualified, targetNamespace, def.elements);
      def.attributes.push(...parseAttributes(step));
    }
  }
  return def;
}

function parseElement(
  node: XNode,
  schema: XNode,
  qualified: boolean,
  targetNamespace: string,
  global: boolean,
): ElementDecl {
  const form = attr(node, 'form');
  const written = global || form === 'qualified' || (form === '' && qualified);
  const decl: ElementDecl = {
    name: attr(node, 'name'),
    ref: optionalQName(node, 'ref'),
    type: optionalQName(node, 'type'),
    namespace: written ? targetNamespace : '',
    line: lineOf(node),
  };
  const complex = childrenOf(node, XSD_NAMESPACES, 'complexType')[0];
  const simple = childrenOf(node, XSD_NAMESPACES, 'simpleType')[0];
  if (complex) decl.complex = parseComplexType(complex, '', schema, qualified, targetNamespace);
  if (simple) decl.simple = parseSimpleType(simple, '');
  return decl;
}

function parseSchema(schema: XNode, notLoaded: NotLoaded[]): SchemaInfo {
  const targetNamespace = attr(schema, 'targetNamespace');
  const qualified = attr(schema, 'elementFormDefault') === 'qualified';
  const info: SchemaInfo = { targetNamespace, elements: [], complexTypes: [], simpleTypes: [] };
  for (const child of elementsOf(schema)) {
    if (!XSD_NAMESPACES.includes(child.namespaceURI ?? '')) continue;
    const kind = SCHEMA_REFERENCE_KINDS.get(child.localName ?? '');
    if (kind !== undefined) {
      const location = attr(child, 'schemaLocation');
      if (location !== '') notLoaded.push({ kind, namespace: attr(child, 'namespace'), location, line: lineOf(child) });
      continue;
    }
    if (child.localName === 'element') {
      info.elements.push(parseElement(child, schema, qualified, targetNamespace, true));
    } else if (child.localName === 'complexType') {
      info.complexTypes.push(parseComplexType(child, attr(child, 'name'), schema, qualified, targetNamespace));
    } else if (child.localName === 'simpleType') {
      info.simpleTypes.push(parseSimpleType(child, attr(child, 'name')));
    }
  }
  return info;
}

// ---------------------------------------------------------------------------------------------------------------------
// WSDL

function parseMessageBinding(node: XNode | undefined): MessageBinding | undefined {
  if (!node) return undefined;
  const result: MessageBinding = { headers: [] };
  const body = soapChild(node, 'body');
  if (body) {
    const parts = attr(body, 'parts');
    result.body = {
      use: attr(body, 'use'),
      namespace: attr(body, 'namespace'),
      encodingStyle: attr(body, 'encodingStyle'),
      parts: parts === '' ? null : parts.split(/\s+/),
    };
  }
  for (const header of childrenOf(node, SOAP_BINDING_NAMESPACES, 'header')) {
    result.headers.push({
      message: resolveQName(header, attr(header, 'message')),
      part: attr(header, 'part'),
      use: attr(header, 'use'),
      namespace: attr(header, 'namespace'),
    });
  }
  return result;
}

function parseBinding(node: XNode): WsdlBinding {
  const soap = soapChild(node, 'binding');
  const http = childrenOf(node, NS_HTTP_BINDING, 'binding')[0];
  const style = attr(soap ?? node, 'style') === 'rpc' ? 'rpc' : 'document';
  const binding: WsdlBinding = {
    name: attr(node, 'name'),
    type: resolveQName(node, attr(node, 'type')),
    protocol: soap ? protocolOf(soap.namespaceURI) : http ? 'HTTP' : '',
    style,
    transport: soap ? attr(soap, 'transport') : '',
    operations: [],
    line: lineOf(node),
  };
  for (const operation of childrenOf(node, NS_WSDL, 'operation')) {
    const soapOperation = soapChild(operation, 'operation');
    const operationStyle = soapOperation ? attr(soapOperation, 'style') : '';
    binding.operations.push({
      name: attr(operation, 'name'),
      soapAction: soapOperation ? attr(soapOperation, 'soapAction') : '',
      style: operationStyle === 'rpc' || operationStyle === 'document' ? operationStyle : '',
      input: parseMessageBinding(childrenOf(operation, NS_WSDL, 'input')[0]),
      output: parseMessageBinding(childrenOf(operation, NS_WSDL, 'output')[0]),
      line: lineOf(operation),
    });
  }
  return binding;
}

function parsePortType(node: XNode): WsdlPortType {
  const portType: WsdlPortType = { name: attr(node, 'name'), operations: [], line: lineOf(node) };
  for (const operation of childrenOf(node, NS_WSDL, 'operation')) {
    const input = childrenOf(operation, NS_WSDL, 'input')[0];
    const output = childrenOf(operation, NS_WSDL, 'output')[0];
    portType.operations.push({
      name: attr(operation, 'name'),
      input: input ? optionalQName(input, 'message') : undefined,
      output: output ? optionalQName(output, 'message') : undefined,
      faults: childrenOf(operation, NS_WSDL, 'fault').map((fault) => ({
        name: attr(fault, 'name'),
        message: resolveQName(fault, attr(fault, 'message')),
      })),
      parameterOrder: attr(operation, 'parameterOrder') === '' ? [] : attr(operation, 'parameterOrder').split(/\s+/),
      line: lineOf(operation),
    });
  }
  return portType;
}

function parseService(node: XNode): WsdlService {
  const documentation = childrenOf(node, NS_WSDL, 'documentation')[0];
  const service: WsdlService = {
    name: attr(node, 'name'),
    documentation: (documentation?.textContent ?? '').trim(),
    ports: [],
    line: lineOf(node),
  };
  for (const port of childrenOf(node, NS_WSDL, 'port')) {
    const address = elementsOf(port).find(
      (child) => child.localName === 'address' && protocolOf(child.namespaceURI) !== '',
    );
    service.ports.push({
      name: attr(port, 'name'),
      binding: resolveQName(port, attr(port, 'binding')),
      address: address ? attr(address, 'location') : '',
      protocol: address ? protocolOf(address.namespaceURI) : '',
      line: lineOf(port),
    });
  }
  return service;
}

// ---------------------------------------------------------------------------------------------------------------------
// References

/** The most declared names a "not found" reason lists; a document with more says how many it left out. */
const MAX_DECLARED_LISTED = 50;

/** Why a name is not found: an undeclared prefix, a namespace the document imports and does not load, or a plain miss. */
function missReason(ref: QNameRef, model: WsdlModel, noun: string, declared: string[]): string {
  if (!ref.declared) return `its prefix is not declared in the document, so the name cannot be resolved`;
  const imported = model.notLoaded.find((item) => item.namespace !== '' && item.namespace === ref.namespace);
  if (imported) return `its namespace is imported from ${imported.location}, which is not loaded`;
  const shown = declared.length > MAX_DECLARED_LISTED ? declared.slice(0, MAX_DECLARED_LISTED) : declared;
  const more = declared.length - shown.length;
  const listed =
    declared.length === 0
      ? `the document declares no ${noun}`
      : `declared: ${shown.join(', ')}${more > 0 ? `, and ${more.toLocaleString('en-US')} more` : ''}`;
  return `no ${noun} with this name is declared in this document (${listed})`;
}

function checkReferences(model: WsdlModel): void {
  const miss = (entry: NotFound) => model.notFound.push(entry);
  const declared = (names: string[]) => names.filter((name) => name !== '');
  // Every lookup below is by name in a table built once, and the lists of declared names are built once, on first use:
  // a scan per reference made the check take the square of the size of the document.
  const once = <T>(make: () => T): (() => T) => {
    let value: T | undefined;
    return () => (value ??= make());
  };
  const declaredBindings = once(() => declared(model.bindings.map((b) => b.name)));
  const declaredPortTypes = once(() => declared(model.portTypes.map((p) => p.name)));
  const declaredMessages = once(() => declared(model.messages.map((m) => m.name)));
  const declaredElements = once(() => declared(model.types.flatMap((s) => s.elements.map((e) => e.name))));
  const bindingNames = new Set(model.bindings.map((binding) => binding.name));
  const operationTables = new Map<WsdlPortType, Map<string, PortTypeOperation>>();
  const portOperation = (portType: WsdlPortType, name: string): PortTypeOperation | undefined => {
    let table = operationTables.get(portType);
    if (table === undefined) {
      table = new Map();
      for (const item of portType.operations) if (!table.has(item.name)) table.set(item.name, item);
      operationTables.set(portType, table);
    }
    return table.get(name);
  };
  const partTables = new Map<WsdlMessage, Set<string>>();
  const hasPart = (message: WsdlMessage, name: string): boolean => {
    let table = partTables.get(message);
    if (table === undefined) {
      table = new Set(message.parts.map((part) => part.name));
      partTables.set(message, table);
    }
    return table.has(name);
  };

  for (const service of model.services) {
    for (const port of service.ports) {
      const found = port.binding.namespace === model.targetNamespace && bindingNames.has(port.binding.local);
      if (!found) {
        miss({
          kind: 'binding',
          reference: port.binding.text,
          where: `port ${port.name} of service ${service.name}`,
          reason: missReason(port.binding, model, 'binding', declaredBindings()),
          line: port.line,
        });
      }
    }
  }
  for (const binding of model.bindings) {
    const portType = findPortType(model, binding.type);
    if (!portType) {
      miss({
        kind: 'portType',
        reference: binding.type.text,
        where: `binding ${binding.name}`,
        reason: missReason(binding.type, model, 'port type', declaredPortTypes()),
        line: binding.line,
      });
    }
    for (const operation of binding.operations) {
      if (portType && portOperation(portType, operation.name) === undefined) {
        miss({
          kind: 'operation',
          reference: operation.name,
          where: `binding ${binding.name}`,
          reason: `port type ${portType.name} has no operation with this name (declared: ${declared(portType.operations.map((o) => o.name)).join(', ') || 'none'})`,
          line: operation.line,
        });
      }
      for (const direction of ['input', 'output'] as const) {
        const side = operation[direction];
        if (!side) continue;
        const message = portType ? portOperation(portType, operation.name)?.[direction] : undefined;
        const known = message ? findMessage(model, message) : undefined;
        for (const header of side.headers) {
          const target = findMessage(model, header.message);
          if (!target) {
            miss({
              kind: 'message',
              reference: header.message.text,
              where: `a ${direction} header of operation ${operation.name} in binding ${binding.name}`,
              reason: missReason(header.message, model, 'message', declaredMessages()),
              line: operation.line,
            });
          } else if (!hasPart(target, header.part)) {
            miss({
              kind: 'part',
              reference: header.part,
              where: `a ${direction} header of operation ${operation.name} in binding ${binding.name}`,
              reason: `message ${target.name} has no part with this name`,
              line: operation.line,
            });
          }
        }
        for (const name of side.body?.parts ?? []) {
          if (known && !hasPart(known, name)) {
            miss({
              kind: 'part',
              reference: name,
              where: `the ${direction} body of operation ${operation.name} in binding ${binding.name}`,
              reason: `message ${known.name} has no part with this name`,
              line: operation.line,
            });
          }
        }
      }
    }
  }
  for (const portType of model.portTypes) {
    for (const operation of portType.operations) {
      const refs: [string, QNameRef | undefined][] = [
        ['input', operation.input],
        ['output', operation.output],
        ...operation.faults.map((fault): [string, QNameRef] => [`fault ${fault.name}`, fault.message]),
      ];
      for (const [role, ref] of refs) {
        if (ref && !findMessage(model, ref)) {
          miss({
            kind: 'message',
            reference: ref.text,
            where: `the ${role} of operation ${operation.name} in port type ${portType.name}`,
            reason: missReason(ref, model, 'message', declaredMessages()),
            line: operation.line,
          });
        }
      }
    }
  }
  for (const message of model.messages) {
    for (const part of message.parts) {
      if (part.element && !findElement(model, part.element)) {
        const builtIn = isBuiltInType(part.element);
        miss({
          kind: 'element',
          reference: part.element.text,
          where: `part ${part.name} of message ${message.name}`,
          reason: builtIn
            ? 'it names a type of XML Schema where an element is expected'
            : missReason(part.element, model, 'element', declaredElements()),
          line: message.line,
        });
      }
      if (
        part.type &&
        !isBuiltInType(part.type) &&
        !findComplexType(model, part.type) &&
        !findSimpleType(model, part.type)
      ) {
        miss({
          kind: 'type',
          reference: part.type.text,
          where: `part ${part.name} of message ${message.name}`,
          reason: missReason(part.type, model, 'type', []),
          line: message.line,
        });
      }
    }
  }
  const checkType = (ref: QNameRef | undefined, where: string, line: number | undefined) => {
    if (!ref || isBuiltInType(ref) || findComplexType(model, ref) || findSimpleType(model, ref)) return;
    miss({ kind: 'type', reference: ref.text, where, reason: missReason(ref, model, 'type', []), line });
  };
  const checkElementDecl = (decl: ElementDecl, where: string) => {
    if (decl.ref && !findElement(model, decl.ref)) {
      miss({
        kind: 'element',
        reference: decl.ref.text,
        where,
        reason: missReason(decl.ref, model, 'element', []),
        line: decl.line,
      });
    }
    checkType(decl.type, where, decl.line);
    if (decl.complex) checkComplex(decl.complex, where);
    if (decl.simple) checkType(decl.simple.base, where, decl.simple.line);
  };
  const checkComplex = (def: ComplexDef, where: string) => {
    checkType(def.base, where, def.line);
    checkType(def.restricts, where, def.line);
    checkType(def.textType, where, def.line);
    for (const attribute of def.attributes) checkType(attribute.type, where, def.line);
    for (const child of def.elements) checkElementDecl(child, where);
  };
  for (const schema of model.types) {
    for (const decl of schema.elements)
      checkElementDecl(decl, `element ${decl.name} of the schema for ${schema.targetNamespace}`);
    for (const def of schema.complexTypes) checkComplex(def, `complex type ${def.name}`);
    for (const def of schema.simpleTypes) checkType(def.base, `simple type ${def.name}`, def.line);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading a document

/** Parses the document with xmldom, refusing a DOCTYPE first, and returns its root element. */
function parseRoot(text: string): XNode {
  const doctype = findDoctype(text);
  if (doctype) throw new WsdlExplorerError(DOCTYPE_REFUSAL_MESSAGE, doctype);

  let blocking: { message: string; line?: number; column?: number } | null = null;
  const parser = new DOMParser({
    locator: true,
    onError: (level, message, context) => {
      if (level === 'warning' || blocking) return;
      const locator = (context as { locator?: { lineNumber?: number; columnNumber?: number } } | undefined)?.locator;
      blocking = { message, line: locator?.lineNumber, column: locator?.columnNumber };
    },
  });
  let doc: { documentElement?: XNode | null };
  try {
    doc = parser.parseFromString(text, 'text/xml') as unknown as { documentElement?: XNode | null };
  } catch (err) {
    const failure = err as {
      message?: string;
      locator?: { lineNumber?: number; columnNumber?: number };
      cause?: { name?: string };
    };
    const undeclared = failure.cause?.name === 'NamespaceError';
    const noRoot = failure.message === 'missing root element';
    throw new WsdlExplorerError(
      undeclared
        ? 'A name uses a namespace prefix that no declaration defines.'
        : noRoot
          ? 'The document has no root element.'
          : (failure.message ?? 'The document is not well-formed XML.'),
      // A position of 0 means the parser has none to give (there was no element to be at).
      { line: failure.locator?.lineNumber || undefined, column: failure.locator?.columnNumber || undefined },
    );
  }
  if (blocking) {
    const issue: { message: string; line?: number; column?: number } = blocking;
    throw new WsdlExplorerError(issue.message, { line: issue.line, column: issue.column });
  }
  const root = doc.documentElement;
  if (!root) throw new WsdlExplorerError('The document has no root element.');
  return root;
}

/** Elements nest at most this deep: a crafted document could otherwise exhaust the stack of the walks below. */
const MAX_NESTING = 200;

/** Refuses a document whose elements nest deeper than `MAX_NESTING`, counted without recursion. */
function checkNesting(root: XNode): void {
  const stack: { node: XNode; depth: number }[] = [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const { node: current, depth } = stack.pop()!;
    if (depth > MAX_NESTING) {
      throw new WsdlExplorerError(`The document nests elements more than ${MAX_NESTING} levels deep.`, {
        line: lineOf(current),
      });
    }
    for (const child of elementsOf(current)) stack.push({ node: child, depth: depth + 1 });
  }
}

/**
 * Explains a pasted WSDL 1.1 document: its services, ports, bindings, operations, messages and inline schemas. A
 * reference is resolved through the document's own namespace declarations, by namespace URI and local name, and one
 * that does not resolve is listed as not found. Import locations are listed as not loaded and never read. Returns
 * null for blank input.
 */
export function explainWsdl(text: string): WsdlModel | null {
  if (text.trim() === '') return null;
  checkSize(text);
  const root = parseRoot(text);
  if (root.localName !== 'definitions' || root.namespaceURI !== NS_WSDL) {
    const named = `"${root.localName ?? root.nodeName}" in ${root.namespaceURI ? `the namespace "${root.namespaceURI}"` : 'no namespace'}`;
    const twoPointZero =
      root.namespaceURI === NS_WSDL20 ? ' This is a WSDL 2.0 description, which this page does not read.' : '';
    throw new WsdlExplorerError(
      `The root element is ${named}, not a WSDL 1.1 "definitions" element in "${NS_WSDL}".${twoPointZero} Only WSDL 1.1 is read.`,
      { line: lineOf(root), column: 1 },
    );
  }

  checkNesting(root);
  const model: WsdlModel = {
    name: attr(root, 'name'),
    targetNamespace: attr(root, 'targetNamespace'),
    services: [],
    bindings: [],
    portTypes: [],
    messages: [],
    types: [],
    notLoaded: [],
    notFound: [],
  };
  for (const child of elementsOf(root)) {
    if (child.namespaceURI !== NS_WSDL) continue;
    switch (child.localName) {
      case 'import':
        if (attr(child, 'location') !== '') {
          model.notLoaded.push({
            kind: 'wsdl:import',
            namespace: attr(child, 'namespace'),
            location: attr(child, 'location'),
            line: lineOf(child),
          });
        }
        break;
      case 'types':
        for (const schema of childrenOf(child, XSD_NAMESPACES, 'schema')) {
          model.types.push(parseSchema(schema, model.notLoaded));
        }
        break;
      case 'message':
        model.messages.push({
          name: attr(child, 'name'),
          parts: childrenOf(child, NS_WSDL, 'part').map((part) => ({
            name: attr(part, 'name'),
            element: optionalQName(part, 'element'),
            type: optionalQName(part, 'type'),
          })),
          line: lineOf(child),
        });
        break;
      case 'portType':
        model.portTypes.push(parsePortType(child));
        break;
      case 'binding':
        model.bindings.push(parseBinding(child));
        break;
      case 'service':
        model.services.push(parseService(child));
        break;
      default:
        break;
    }
  }
  checkReferences(model);
  return model;
}
