import {
  NS_SOAP11_ENVELOPE,
  NS_SOAP12_ENVELOPE,
  WsdlExplorerError,
  XSD_NAMESPACES,
  findComplexType,
  findElement,
  findMessage,
  findPortType,
  findSimpleType,
  isBuiltInType,
  operationNames,
  type BindingOperation,
  type ComplexDef,
  type ElementDecl,
  type MessagePart,
  type QNameRef,
  type SimpleDef,
  type WsdlBinding,
  type WsdlModel,
} from './model';

export interface SampleOptions {
  soap: '1.1' | '1.2';
  /** Write an example value in every element and attribute; false leaves them empty. */
  fill: boolean;
}

export interface SampleResult {
  envelope: string;
  /** The SOAPAction of the operation, as the binding gives it ('' when it gives none). */
  soapAction: string;
  contentType: string;
  warnings: string[];
}

/** Complex types are expanded this many levels; deeper content is left out and marked with a comment. */
const MAX_DEPTH = 4;

/** A node of the envelope before it is written as text. */
interface XmlNode {
  namespace: string;
  local: string;
  attributes: { namespace: string; local: string; value: string }[];
  children: XmlNode[];
  text?: string;
  comment?: string;
}

interface Context {
  model: WsdlModel;
  fill: boolean;
  warnings: string[];
}

function warn(context: Context, message: string): void {
  if (!context.warnings.includes(message)) context.warnings.push(message);
}

/** The five characters that XML text and attribute values write as entities. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const NC_NAME = /^[\p{L}_][\p{L}\p{N}_.-]*$/u;

/** A name that is safe to write as an element or attribute name; anything else is replaced and reported. */
function safeName(context: Context, name: string): string {
  if (NC_NAME.test(name)) return name;
  warn(
    context,
    `A name in the document is not a valid XML name (${JSON.stringify(name.slice(0, 40))}) and is written as "invalid-name".`,
  );
  return 'invalid-name';
}

function node(namespace: string, local: string): XmlNode {
  return { namespace, local, attributes: [], children: [] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Example values

/** The example value of a built-in type, by its local name in any of the XML Schema namespaces. */
function builtInValue(local: string): string {
  switch (local) {
    case 'boolean':
      return 'false';
    case 'int':
    case 'integer':
    case 'long':
    case 'short':
    case 'byte':
    case 'decimal':
    case 'float':
    case 'double':
    case 'nonNegativeInteger':
    case 'nonPositiveInteger':
    case 'unsignedInt':
    case 'unsignedLong':
    case 'unsignedShort':
    case 'unsignedByte':
      return '0';
    case 'positiveInteger':
      return '1';
    case 'negativeInteger':
      return '-1';
    case 'date':
      return '2000-01-01';
    case 'dateTime':
    case 'timeInstant':
      return '2000-01-01T00:00:00';
    case 'time':
      return '00:00:00';
    case 'duration':
    case 'timeDuration':
      return 'P1D';
    case 'gYear':
      return '2000';
    case 'gYearMonth':
      return '2000-01';
    case 'hexBinary':
      return '00';
    case 'base64Binary':
      return 'AA==';
    case 'anyURI':
    case 'uriReference':
      return 'http://example.com/';
    default:
      return 'string';
  }
}

function simpleValue(context: Context, def: SimpleDef, depth: number): string {
  if (def.enumeration.length > 0) return def.enumeration[0]!;
  if (!def.base || depth > MAX_DEPTH + 4) return 'string';
  if (isBuiltInType(def.base)) return builtInValue(def.base.local);
  const next = findSimpleType(context.model, def.base);
  return next ? simpleValue(context, next, depth + 1) : 'string';
}

/** The example text of a type: a built-in one by its name, a simple type by its first value or its base. */
function typeValue(context: Context, type: QNameRef): string {
  if (isBuiltInType(type)) return builtInValue(type.local);
  const simple = findSimpleType(context.model, type);
  return simple ? simpleValue(context, simple, 0) : 'string';
}

// ---------------------------------------------------------------------------------------------------------------------
// Elements and types

/** Writes the content a type gives an element: text for a simple type, attributes and children for a complex one. */
function typeContent(context: Context, type: QNameRef, target: XmlNode, depth: number, seen: string[]): void {
  if (isBuiltInType(type)) {
    if (context.fill) target.text = builtInValue(type.local);
    return;
  }
  const complex = findComplexType(context.model, type);
  if (complex) {
    const key = `${type.namespace}#${type.local}`;
    if (seen.includes(key)) {
      warn(context, `The type ${type.local} contains itself, so it is expanded once.`);
      return;
    }
    complexContent(context, complex, target, depth, [...seen, key]);
    return;
  }
  const simple = findSimpleType(context.model, type);
  if (context.fill) target.text = simple ? simpleValue(context, simple, 0) : 'string';
}

function complexContent(context: Context, def: ComplexDef, target: XmlNode, depth: number, seen: string[]): void {
  if (def.restricts) {
    warn(
      context,
      `The type ${def.name || 'of an element'} restricts ${def.restricts.text} (an array type of the SOAP encoding), so its content is not expanded.`,
    );
    return;
  }
  if (def.base) {
    // A type that extends another has the content of the other first.
    const baseKey = `${def.base.namespace}#${def.base.local}`;
    if (!isBuiltInType(def.base) && !seen.includes(baseKey)) {
      const base = findComplexType(context.model, def.base);
      if (base) complexContent(context, base, target, depth, [...seen, baseKey]);
    }
  }
  for (const attribute of def.attributes) {
    target.attributes.push({
      namespace: '',
      local: safeName(context, attribute.name),
      value: context.fill ? (attribute.type ? typeValue(context, attribute.type) : 'string') : '',
    });
  }
  if (def.textType && context.fill) target.text = typeValue(context, def.textType);
  if (def.elements.length === 0) return;
  if (depth > MAX_DEPTH) {
    const left = node('', '');
    left.comment = '...';
    target.children.push(left);
    warn(context, `Elements nested more than ${MAX_DEPTH} levels deep are left out and marked with a comment.`);
    return;
  }
  for (const child of def.elements) target.children.push(elementNode(context, child, depth + 1, seen));
}

/** The node an element declaration is written as, with its content expanded from `depth`. */
function elementNode(context: Context, decl: ElementDecl, depth: number, seen: string[]): XmlNode {
  let declaration = decl;
  if (decl.ref) {
    const target = findElement(context.model, decl.ref);
    if (!target) {
      warn(context, `The element ${decl.ref.text} is not in the document, so it is written empty.`);
      return node(decl.ref.namespace, safeName(context, decl.ref.local));
    }
    declaration = target;
  }
  const result = node(declaration.namespace, safeName(context, declaration.name));
  if (declaration.type) typeContent(context, declaration.type, result, depth, seen);
  else if (declaration.complex) complexContent(context, declaration.complex, result, depth, seen);
  else if (declaration.simple) {
    if (context.fill) result.text = simpleValue(context, declaration.simple, 0);
  } else if (context.fill) result.text = 'string';
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// The body

/** Where an element reference of a part points: a declaration, a built-in type used as an element, or nothing. */
function partElement(context: Context, part: MessagePart, element: QNameRef): XmlNode {
  const decl = findElement(context.model, element);
  if (decl) return elementNode(context, decl, 1, []);
  if (XSD_NAMESPACES.includes(element.namespace)) {
    // A type name written where an element belongs (the note's own RPC example does this): the part is the element.
    const accessor = node('', safeName(context, part.name));
    if (context.fill) accessor.text = builtInValue(element.local);
    return accessor;
  }
  warn(context, `The element ${element.text} of part ${part.name} is not in the document, so it is written empty.`);
  return node(element.namespace, safeName(context, element.local));
}

/** The nodes a message part is written as in a document style Body or in a header. */
function documentPart(context: Context, part: MessagePart): XmlNode {
  if (part.element) return partElement(context, part, part.element);
  const accessor = node('', safeName(context, part.name));
  if (part.type) {
    typeContent(context, part.type, accessor, 1, []);
    warn(context, `Part ${part.name} has a type and no element, so its element is named after the part.`);
  } else if (context.fill) accessor.text = 'string';
  return accessor;
}

/** The accessor element of a message part in an RPC style Body: named after the part. */
function rpcPart(context: Context, part: MessagePart): XmlNode {
  const accessor = node('', safeName(context, part.name));
  if (part.type) {
    typeContent(context, part.type, accessor, 1, []);
  } else if (part.element) {
    const decl = findElement(context.model, part.element);
    if (decl) accessor.children.push(elementNode(context, decl, 2, []));
    else if (XSD_NAMESPACES.includes(part.element.namespace)) {
      if (context.fill) accessor.text = builtInValue(part.element.local);
    } else {
      warn(
        context,
        `The element ${part.element.text} of part ${part.name} is not in the document, so it is written empty.`,
      );
      accessor.children.push(node(part.element.namespace, safeName(context, part.element.local)));
    }
  } else if (context.fill) accessor.text = 'string';
  return accessor;
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing the envelope

interface Prefixes {
  of(namespace: string): string;
  declarations(): string[];
}

function collectNamespaces(nodes: XmlNode[], into: Set<string>): void {
  for (const item of nodes) {
    if (item.namespace !== '') into.add(item.namespace);
    for (const attribute of item.attributes) if (attribute.namespace !== '') into.add(attribute.namespace);
    collectNamespaces(item.children, into);
  }
}

/**
 * A prefix for each namespace the envelope uses: the one the document itself writes for it when there is one, else
 * ns1, ns2 and so on. The envelope namespace has its own prefix.
 */
function prefixesFor(
  envelopePrefix: string,
  envelopeNamespace: string,
  namespaces: Set<string>,
  preferred: Map<string, string>,
): Prefixes {
  const taken = new Set<string>([envelopePrefix, 'xml', 'xmlns']);
  const map = new Map<string, string>([[envelopeNamespace, envelopePrefix]]);
  let counter = 0;
  for (const namespace of namespaces) {
    if (map.has(namespace)) continue;
    let prefix = preferred.get(namespace);
    if (prefix === undefined || taken.has(prefix) || !NC_NAME.test(prefix)) {
      do counter++;
      while (taken.has(`ns${counter}`));
      prefix = `ns${counter}`;
    }
    taken.add(prefix);
    map.set(namespace, prefix);
  }
  return {
    of: (namespace) => map.get(namespace) ?? 'ns0',
    declarations: () => [...map].map(([namespace, prefix]) => `xmlns:${prefix}="${escapeXml(namespace)}"`),
  };
}

function writeNode(item: XmlNode, prefixes: Prefixes, indent: string, lines: string[]): void {
  if (item.comment !== undefined) {
    lines.push(`${indent}<!-- ${item.comment} -->`);
    return;
  }
  const name = `${item.namespace === '' ? '' : `${prefixes.of(item.namespace)}:`}${item.local}`;
  const attributes = item.attributes
    .map(
      (attribute) =>
        ` ${attribute.namespace === '' ? '' : `${prefixes.of(attribute.namespace)}:`}${attribute.local}="${escapeXml(attribute.value)}"`,
    )
    .join('');
  if (item.children.length === 0) {
    lines.push(
      item.text === undefined || item.text === ''
        ? `${indent}<${name}${attributes}/>`
        : `${indent}<${name}${attributes}>${escapeXml(item.text)}</${name}>`,
    );
    return;
  }
  lines.push(`${indent}<${name}${attributes}>`);
  for (const child of item.children) writeNode(child, prefixes, `${indent}  `, lines);
  lines.push(`${indent}</${name}>`);
}

// ---------------------------------------------------------------------------------------------------------------------
// The request

/** The prefixes the document itself writes for a namespace, learned from the names it uses for parts and types. */
function preferredPrefixes(model: WsdlModel): Map<string, string> {
  const map = new Map<string, string>();
  const learn = (ref: QNameRef | undefined) => {
    const colon = ref?.text.indexOf(':') ?? -1;
    if (ref && colon > 0 && ref.namespace !== '' && !map.has(ref.namespace))
      map.set(ref.namespace, ref.text.slice(0, colon));
  };
  for (const message of model.messages) {
    for (const part of message.parts) {
      learn(part.element);
      learn(part.type);
    }
  }
  return map;
}

function pickBinding(model: WsdlModel, operation: string, soap: '1.1' | '1.2'): WsdlBinding | undefined {
  const candidates = model.bindings.filter((binding) => binding.operations.some((item) => item.name === operation));
  const wanted = soap === '1.2' ? 'SOAP 1.2' : 'SOAP 1.1';
  return (
    candidates.find((binding) => binding.protocol === wanted) ??
    candidates.find((binding) => binding.protocol.startsWith('SOAP')) ??
    candidates[0]
  );
}

/**
 * Builds a sample request for one operation: a SOAP 1.1 or 1.2 envelope whose Body follows the binding's style (WSDL
 * 1.1 section 3.5: in document style the parts appear directly under the Body, in RPC style they appear under a
 * wrapper named after the operation in the binding's namespace), the SOAPAction of the binding, and the content type
 * of the protocol. A blank operation means the first one. Nothing the document names is loaded.
 */
export function sampleRequest(model: WsdlModel, operation: string, options: SampleOptions): SampleResult {
  const names = operationNames(model);
  if (names.length === 0) throw new WsdlExplorerError('The document has no operation to build a request for.');
  const wanted = operation.trim() === '' ? names[0]! : operation.trim();
  if (!names.includes(wanted)) {
    throw new WsdlExplorerError(
      `The document has no operation named ${wanted}. Its operations are ${names.join(', ')}.`,
    );
  }
  const context: Context = { model, fill: options.fill, warnings: [] };
  const soap12 = options.soap === '1.2';
  const envelopeNamespace = soap12 ? NS_SOAP12_ENVELOPE : NS_SOAP11_ENVELOPE;
  const envelopePrefix = soap12 ? 'env' : 'soapenv';

  const binding = pickBinding(model, wanted, options.soap);
  const bound: BindingOperation | undefined = binding?.operations.find((item) => item.name === wanted);
  let style: 'rpc' | 'document' = 'document';
  if (binding && bound) {
    style = bound.style === '' ? binding.style : bound.style;
    if (binding.protocol === '' || binding.protocol === 'HTTP') {
      warn(
        context,
        `The binding ${binding.name} is not a SOAP binding, so the envelope is only a guide to its messages.`,
      );
    } else if (binding.protocol !== (soap12 ? 'SOAP 1.2' : 'SOAP 1.1')) {
      warn(
        context,
        `The binding ${binding.name} is for ${binding.protocol}; the envelope is written as SOAP ${options.soap}.`,
      );
    }
  } else {
    warn(
      context,
      `No binding in this document describes ${wanted}, so it is written in document style with no SOAPAction.`,
    );
  }

  // The message the operation takes.
  const portType = binding ? findPortType(model, binding.type) : undefined;
  const portTypeOperation =
    portType?.operations.find((item) => item.name === wanted) ??
    (binding ? undefined : model.portTypes.flatMap((item) => item.operations).find((item) => item.name === wanted));
  const message = portTypeOperation?.input ? findMessage(model, portTypeOperation.input) : undefined;
  if (!message) {
    warn(
      context,
      portTypeOperation?.input
        ? `The message ${portTypeOperation.input.text} is not in the document, so the Body is empty.`
        : portTypeOperation
          ? `The operation ${wanted} has no input message, so the Body is empty.`
          : `The port type of ${wanted} is not in the document, so the Body is empty.`,
    );
  }

  const body = bound?.input?.body;
  const inBody = (message?.parts ?? []).filter((part) => body?.parts == null || body.parts.includes(part.name));
  const bodyNodes: XmlNode[] = [];
  if (style === 'rpc') {
    const wrapper = node(body?.namespace ?? '', safeName(context, wanted));
    if (!body?.namespace)
      warn(context, 'The binding gives no namespace for the wrapper element, so it is written with none.');
    for (const part of inBody) wrapper.children.push(rpcPart(context, part));
    bodyNodes.push(wrapper);
  } else {
    for (const part of inBody) bodyNodes.push(documentPart(context, part));
  }
  if (body?.use === 'encoded') {
    warn(
      context,
      'The binding uses encoded parts: they are shown without the xsi:type attributes that a SOAP encoded body also carries.',
    );
    if (body.encodingStyle !== '') {
      for (const item of bodyNodes) {
        item.attributes.push({ namespace: envelopeNamespace, local: 'encodingStyle', value: body.encodingStyle });
      }
    }
  }

  const headerNodes: XmlNode[] = [];
  for (const header of bound?.input?.headers ?? []) {
    const target = findMessage(model, header.message);
    const part = target?.parts.find((item) => item.name === header.part);
    if (part) headerNodes.push(documentPart(context, part));
    else
      warn(
        context,
        `The header part ${header.part} of ${header.message.text} is not in the document, so it is left out.`,
      );
  }

  const namespaces = new Set<string>();
  collectNamespaces([...headerNodes, ...bodyNodes], namespaces);
  const prefixes = prefixesFor(envelopePrefix, envelopeNamespace, namespaces, preferredPrefixes(model));
  const lines: string[] = [`<${envelopePrefix}:Envelope ${prefixes.declarations().join(' ')}>`];
  const sections: [string, XmlNode[]][] = [
    ['Header', headerNodes],
    ['Body', bodyNodes],
  ];
  for (const [name, nodes] of sections) {
    if (nodes.length === 0 && name === 'Header') continue;
    if (nodes.length === 0) {
      lines.push(`  <${envelopePrefix}:${name}/>`);
      continue;
    }
    lines.push(`  <${envelopePrefix}:${name}>`);
    for (const item of nodes) writeNode(item, prefixes, '    ', lines);
    lines.push(`  </${envelopePrefix}:${name}>`);
  }
  lines.push(`</${envelopePrefix}:Envelope>`);

  const soapAction = bound?.soapAction ?? '';
  const quoted = soapAction.replace(/["\\]/g, (character) => `\\${character}`);
  const contentType = soap12
    ? `application/soap+xml; charset=utf-8${soapAction === '' ? '' : `; action="${quoted}"`}`
    : 'text/xml; charset=utf-8';
  return { envelope: lines.join('\n'), soapAction, contentType, warnings: context.warnings };
}
