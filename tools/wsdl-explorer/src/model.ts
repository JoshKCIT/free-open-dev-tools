/**
 * What a WSDL 1.1 document is read into, and the lookups over it. The names here are the ones of the WSDL 1.1 note
 * (https://www.w3.org/TR/2001/NOTE-wsdl-20010315): definitions, types, message, portType, binding, service and port.
 */

export class WsdlExplorerError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'WsdlExplorerError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

/** WSDL 1.1 and its SOAP and HTTP binding extensions (section 1.2 of the note lists these namespaces). */
export const NS_WSDL = 'http://schemas.xmlsoap.org/wsdl/';
export const NS_SOAP11_BINDING = 'http://schemas.xmlsoap.org/wsdl/soap/';
export const NS_SOAP12_BINDING = 'http://schemas.xmlsoap.org/wsdl/soap12/';
export const NS_HTTP_BINDING = 'http://schemas.xmlsoap.org/wsdl/http/';
/** The XML Schema namespaces: the 2001 recommendation and the drafts that the note's own examples are written in. */
export const XSD_NAMESPACES: readonly string[] = [
  'http://www.w3.org/2001/XMLSchema',
  'http://www.w3.org/2000/10/XMLSchema',
  'http://www.w3.org/1999/XMLSchema',
];
/** The namespace of the xml prefix, which is never declared and never bound to another prefix. */
export const NS_XML = 'http://www.w3.org/XML/1998/namespace';
/** The SOAP 1.1 encoding namespace; its types (Array and the others) are not defined in the document. */
export const NS_SOAP_ENCODING = 'http://schemas.xmlsoap.org/soap/encoding/';
/** The SOAP 1.1 envelope namespace and the SOAP 1.2 one. */
export const NS_SOAP11_ENVELOPE = 'http://schemas.xmlsoap.org/soap/envelope/';
export const NS_SOAP12_ENVELOPE = 'http://www.w3.org/2003/05/soap-envelope';

/** A qualified name as a document writes it, and what it resolves to through the document's own declarations. */
export interface QNameRef {
  /** The name as written, such as `tns:StockQuoteBinding`. */
  text: string;
  /** The namespace URI the prefix stands for ('' when the name has none). */
  namespace: string;
  local: string;
  /** False when the name has a prefix that no declaration in scope defines. */
  declared: boolean;
}

export type Protocol = 'SOAP 1.1' | 'SOAP 1.2' | 'HTTP' | '';

export interface WsdlPort {
  name: string;
  binding: QNameRef;
  /** The address the port names, shown as text and never requested. */
  address: string;
  protocol: Protocol;
  line?: number;
}

export interface WsdlService {
  name: string;
  documentation: string;
  ports: WsdlPort[];
  line?: number;
}

export interface BodyBinding {
  use: string;
  namespace: string;
  encodingStyle: string;
  /** The parts that appear in the Body (`parts` attribute), or null for all of them. */
  parts: string[] | null;
}

export interface HeaderBinding {
  message: QNameRef;
  part: string;
  use: string;
  namespace: string;
}

export interface MessageBinding {
  body?: BodyBinding;
  headers: HeaderBinding[];
}

export interface BindingOperation {
  name: string;
  soapAction: string;
  /** The operation's own style, or '' to use the binding's. */
  style: 'rpc' | 'document' | '';
  input?: MessageBinding;
  output?: MessageBinding;
  line?: number;
}

export interface WsdlBinding {
  name: string;
  type: QNameRef;
  protocol: Protocol;
  /** The binding's default style: document when the document gives none. */
  style: 'rpc' | 'document';
  transport: string;
  operations: BindingOperation[];
  line?: number;
}

export interface PortTypeOperation {
  name: string;
  input?: QNameRef;
  output?: QNameRef;
  faults: { name: string; message: QNameRef }[];
  parameterOrder: string[];
  line?: number;
}

export interface WsdlPortType {
  name: string;
  operations: PortTypeOperation[];
  line?: number;
}

export interface MessagePart {
  name: string;
  element?: QNameRef;
  type?: QNameRef;
}

export interface WsdlMessage {
  name: string;
  parts: MessagePart[];
  line?: number;
}

export interface ElementDecl {
  name: string;
  /** An element reference (`ref`), in place of a name and a type. */
  ref?: QNameRef;
  type?: QNameRef;
  complex?: ComplexDef;
  simple?: SimpleDef;
  /** The namespace the element is written in: its schema's for a global or qualified element, else none. */
  namespace: string;
  line?: number;
}

export interface AttributeDecl {
  name: string;
  type?: QNameRef;
}

export interface ComplexDef {
  name: string;
  /** The elements of its sequence, all or choice (a choice keeps its first alternative). */
  elements: ElementDecl[];
  attributes: AttributeDecl[];
  /** The type it extends. */
  base?: QNameRef;
  /** The simple type its text content has, for a type with simple content. */
  textType?: QNameRef;
  /** The type it restricts (an array type of the SOAP encoding); a restriction is not expanded. */
  restricts?: QNameRef;
  line?: number;
}

export interface SimpleDef {
  name: string;
  base?: QNameRef;
  enumeration: string[];
  line?: number;
}

export interface SchemaInfo {
  targetNamespace: string;
  elements: ElementDecl[];
  complexTypes: ComplexDef[];
  simpleTypes: SimpleDef[];
}

/** A location the document names and this page does not load. */
export interface NotLoaded {
  kind: 'wsdl:import' | 'xsd:import' | 'xsd:include' | 'xsd:redefine' | 'xsd:override';
  namespace: string;
  location: string;
  line?: number;
}

/** A reference that does not resolve to anything in this document. */
export interface NotFound {
  kind: 'binding' | 'portType' | 'operation' | 'message' | 'part' | 'element' | 'type';
  /** The name as written. */
  reference: string;
  /** Where it is written, such as `port StockQuotePort of service StockQuoteService`. */
  where: string;
  reason: string;
  line?: number;
}

export interface WsdlModel {
  name: string;
  targetNamespace: string;
  services: WsdlService[];
  bindings: WsdlBinding[];
  portTypes: WsdlPortType[];
  messages: WsdlMessage[];
  types: SchemaInfo[];
  notLoaded: NotLoaded[];
  notFound: NotFound[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Lookups, by namespace URI and local name

/**
 * Name tables over a model, built once and used for every lookup, so a lookup costs the same in a document of 24,000
 * messages as in a document of two. A name is looked up in a Map (never an object: a name such as constructor must not
 * find a member of Object.prototype), and the first declaration of a name wins, as the plain scan did. The tables are
 * rebuilt when a list of the model changes length, so a model built by hand and changed later is looked up from its
 * current content; the content of a schema is fixed once the document has been read.
 */
interface NameTables {
  signature: string;
  messages: Map<string, WsdlMessage>;
  portTypes: Map<string, WsdlPortType>;
  elements: Map<string, Map<string, ElementDecl>>;
  complexTypes: Map<string, Map<string, ComplexDef>>;
  simpleTypes: Map<string, Map<string, SimpleDef>>;
}

const TABLES = new WeakMap<WsdlModel, NameTables>();

function firstByName<T extends { name: string }>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) if (!map.has(item.name)) map.set(item.name, item);
  return map;
}

/** Adds the declarations of a schema to the table of its namespace, keeping the first of a name. */
function addByNamespace<T extends { name: string }>(
  table: Map<string, Map<string, T>>,
  namespace: string,
  items: readonly T[],
): void {
  let names = table.get(namespace);
  if (names === undefined) {
    names = new Map<string, T>();
    table.set(namespace, names);
  }
  for (const item of items) if (!names.has(item.name)) names.set(item.name, item);
}

function tablesOf(model: WsdlModel): NameTables {
  const signature = `${model.messages.length}/${model.portTypes.length}/${model.types.length}`;
  const known = TABLES.get(model);
  if (known !== undefined && known.signature === signature) return known;
  const tables: NameTables = {
    signature,
    messages: firstByName(model.messages),
    portTypes: firstByName(model.portTypes),
    elements: new Map(),
    complexTypes: new Map(),
    simpleTypes: new Map(),
  };
  for (const schema of model.types) {
    addByNamespace(tables.elements, schema.targetNamespace, schema.elements);
    addByNamespace(tables.complexTypes, schema.targetNamespace, schema.complexTypes);
    addByNamespace(tables.simpleTypes, schema.targetNamespace, schema.simpleTypes);
  }
  TABLES.set(model, tables);
  return tables;
}

export function findMessage(model: WsdlModel, ref: QNameRef): WsdlMessage | undefined {
  if (ref.namespace !== model.targetNamespace) return undefined;
  return tablesOf(model).messages.get(ref.local);
}

export function findPortType(model: WsdlModel, ref: QNameRef): WsdlPortType | undefined {
  if (ref.namespace !== model.targetNamespace) return undefined;
  return tablesOf(model).portTypes.get(ref.local);
}

export function findElement(model: WsdlModel, ref: QNameRef): ElementDecl | undefined {
  return tablesOf(model).elements.get(ref.namespace)?.get(ref.local);
}

export function findComplexType(model: WsdlModel, ref: QNameRef): ComplexDef | undefined {
  return tablesOf(model).complexTypes.get(ref.namespace)?.get(ref.local);
}

export function findSimpleType(model: WsdlModel, ref: QNameRef): SimpleDef | undefined {
  return tablesOf(model).simpleTypes.get(ref.namespace)?.get(ref.local);
}

/** Whether a type name is in a namespace this page does not define types for (XML Schema, the SOAP encoding). */
export function isBuiltInType(ref: QNameRef): boolean {
  return XSD_NAMESPACES.includes(ref.namespace) || ref.namespace === NS_SOAP_ENCODING;
}

/**
 * The names of the operations a request can be built for: those of the bindings, in document order, else those of
 * the port types.
 */
export function operationNames(model: WsdlModel): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    if (name !== '' && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };
  for (const binding of model.bindings) for (const operation of binding.operations) add(operation.name);
  if (names.length === 0)
    for (const portType of model.portTypes) for (const operation of portType.operations) add(operation.name);
  return names;
}
