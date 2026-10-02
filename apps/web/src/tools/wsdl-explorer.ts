import {
  WsdlExplorerError,
  explainWsdl,
  meta,
  operationNames,
  sampleRequest,
  type NotFound,
  type NotLoaded,
  type WsdlModel,
} from '@fodt/wsdl-explorer';
import {
  bool,
  defineTool,
  str,
  type Field,
  type OutputBlock,
  type ToolExample,
  type ToolIssue,
  type ToolResult,
} from '../lib/tool-ui';

/** A small document in document style: one operation whose request is an element of an inline schema. */
const GREETER = [
  '<definitions name="Greeter" targetNamespace="http://example.com/greeter.wsdl"',
  '    xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="http://example.com/greeter.wsdl"',
  '    xmlns:g="http://example.com/greeter.xsd" xmlns:xs="http://www.w3.org/2001/XMLSchema"',
  '    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">',
  '  <types>',
  '    <xs:schema targetNamespace="http://example.com/greeter.xsd">',
  '      <xs:element name="GreetRequest">',
  '        <xs:complexType>',
  '          <xs:sequence>',
  '            <xs:element name="name" type="xs:string"/>',
  '            <xs:element name="times" type="xs:int"/>',
  '          </xs:sequence>',
  '        </xs:complexType>',
  '      </xs:element>',
  '      <xs:element name="GreetResponse" type="xs:string"/>',
  '    </xs:schema>',
  '  </types>',
  '  <message name="GreetInput"><part name="body" element="g:GreetRequest"/></message>',
  '  <message name="GreetOutput"><part name="body" element="g:GreetResponse"/></message>',
  '  <portType name="GreeterPortType">',
  '    <operation name="Greet">',
  '      <input message="tns:GreetInput"/>',
  '      <output message="tns:GreetOutput"/>',
  '    </operation>',
  '  </portType>',
  '  <binding name="GreeterSoapBinding" type="tns:GreeterPortType">',
  '    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>',
  '    <operation name="Greet">',
  '      <soap:operation soapAction="http://example.com/Greet"/>',
  '      <input><soap:body use="literal"/></input>',
  '      <output><soap:body use="literal"/></output>',
  '    </operation>',
  '  </binding>',
  '  <service name="GreeterService">',
  '    <port name="GreeterPort" binding="tns:GreeterSoapBinding">',
  '      <soap:address location="http://example.com/greeter"/>',
  '    </port>',
  '  </service>',
  '</definitions>',
].join('\n');

/** The same kind of document in RPC style: the parts are the parameters of the call. */
const CALCULATOR = [
  '<definitions name="Calculator" targetNamespace="http://example.com/calculator.wsdl"',
  '    xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:tns="http://example.com/calculator.wsdl"',
  '    xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/">',
  '  <message name="AddInput">',
  '    <part name="a" type="xs:int"/>',
  '    <part name="b" type="xs:int"/>',
  '  </message>',
  '  <message name="AddOutput"><part name="sum" type="xs:int"/></message>',
  '  <portType name="CalculatorPortType">',
  '    <operation name="Add">',
  '      <input message="tns:AddInput"/>',
  '      <output message="tns:AddOutput"/>',
  '    </operation>',
  '  </portType>',
  '  <binding name="CalculatorSoapBinding" type="tns:CalculatorPortType">',
  '    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>',
  '    <operation name="Add">',
  '      <soap:operation soapAction="http://example.com/Add"/>',
  '      <input><soap:body use="literal" namespace="http://example.com/calculator"/></input>',
  '      <output><soap:body use="literal" namespace="http://example.com/calculator"/></output>',
  '    </operation>',
  '  </binding>',
  '  <service name="CalculatorService">',
  '    <port name="CalculatorPort" binding="tns:CalculatorSoapBinding">',
  '      <soap:address location="http://example.com/calculator"/>',
  '    </port>',
  '  </service>',
  '</definitions>',
].join('\n');

const examples: ToolExample[] = [
  { label: 'Greeter service', values: { wsdl: GREETER, operation: '', soap: '1.1', fill: true } },
  { label: 'RPC style', values: { wsdl: CALCULATOR, operation: '', soap: '1.2', fill: true } },
];

const fields: Field[] = [
  {
    name: 'wsdl',
    label: 'WSDL 1.1 document',
    type: 'textarea',
    rows: 14,
    placeholder: 'Type or paste here. Nothing leaves your browser.',
    help: 'Up to 2 MiB. Nothing the document names is loaded.',
  },
  {
    name: 'operation',
    label: 'Operation',
    type: 'text',
    help: 'The operation to build a request for. Blank means the first one.',
  },
  {
    name: 'soap',
    label: 'SOAP version',
    type: 'select',
    default: '1.1',
    options: [
      { value: '1.1', label: 'SOAP 1.1' },
      { value: '1.2', label: 'SOAP 1.2' },
    ],
  },
  { name: 'fill', label: 'Fill example values', type: 'checkbox', default: true },
];

/** The model of the last document read, kept in page memory so that editing another field does not read it again. */
let last: { text: string; model: WsdlModel } | undefined;

function modelOf(text: string): WsdlModel | null {
  if (last && last.text === text) return last.model;
  const model = explainWsdl(text);
  if (model !== null) last = { text, model };
  return model;
}

function count(n: number): string {
  return n.toLocaleString('en-US');
}

function at(line: number | undefined): string {
  return line === undefined ? '' : `, line ${line}`;
}

function describeNotFound(item: NotFound): string {
  return `${item.kind} ${item.reference}, written in ${item.where}${at(item.line)}: ${item.reason}.`;
}

function describeNotLoaded(item: NotLoaded): string {
  const namespace = item.namespace === '' ? '' : ` of ${item.namespace}`;
  return `${item.kind}${namespace} at ${item.location}${at(item.line)} (not loaded).`;
}

/** The tables of what the document holds. */
function tables(model: WsdlModel): OutputBlock[] {
  const out: OutputBlock[] = [];
  const ports = model.services.flatMap((service) =>
    service.ports.map((port) => [service.name, port.name, port.binding.text, port.address, port.protocol]),
  );
  if (ports.length > 0) {
    out.push({
      kind: 'table',
      label: 'Services and ports',
      table: { headers: ['Service', 'Port', 'Binding', 'Address', 'Protocol'], rows: ports, mono: [2, 3] },
    });
  }
  if (model.bindings.length > 0) {
    out.push({
      kind: 'table',
      label: 'Bindings',
      table: {
        headers: ['Binding', 'Port type', 'Protocol', 'Style', 'Transport', 'Operations'],
        rows: model.bindings.map((binding) => [
          binding.name,
          binding.type.text,
          binding.protocol,
          binding.style,
          binding.transport,
          binding.operations.map((operation) => operation.name).join(', '),
        ]),
        mono: [1, 4],
      },
    });
    const rows = model.bindings.flatMap((binding) =>
      binding.operations.map((operation) => [
        binding.name,
        operation.name,
        operation.soapAction,
        operation.style === '' ? binding.style : operation.style,
        operation.input?.body?.use ?? '',
      ]),
    );
    out.push({
      kind: 'table',
      label: 'Operations of the bindings',
      table: { headers: ['Binding', 'Operation', 'SOAPAction', 'Style', 'Use'], rows, mono: [2] },
    });
  }
  const operations = model.portTypes.flatMap((portType) =>
    portType.operations.map((operation) => [
      portType.name,
      operation.name,
      operation.input?.text ?? '',
      operation.output?.text ?? '',
    ]),
  );
  if (operations.length > 0) {
    out.push({
      kind: 'table',
      label: 'Operations of the port types',
      table: { headers: ['Port type', 'Operation', 'Input message', 'Output message'], rows: operations, mono: [2, 3] },
    });
  }
  const parts = model.messages.flatMap((message) =>
    message.parts.length === 0
      ? [[message.name, '', '', '']]
      : message.parts.map((part) => [
          message.name,
          part.name,
          part.element ? 'element' : part.type ? 'type' : '',
          (part.element ?? part.type)?.text ?? '',
        ]),
  );
  if (parts.length > 0) {
    out.push({
      kind: 'table',
      label: 'Messages',
      table: { headers: ['Message', 'Part', 'Kind', 'Reference'], rows: parts, mono: [3] },
    });
  }
  if (model.types.length > 0) {
    out.push({
      kind: 'table',
      label: 'Schema types',
      table: {
        headers: ['Namespace', 'Elements', 'Complex types', 'Simple types'],
        rows: model.types.map((schema) => [
          schema.targetNamespace,
          schema.elements.map((item) => item.name).join(', '),
          schema.complexTypes.map((item) => item.name).join(', '),
          schema.simpleTypes.map((item) => item.name).join(', '),
        ]),
        mono: [0],
      },
    });
  }
  return out;
}

export default defineTool({
  id: 'wsdl-explorer',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields,
  examples,
  run(values, ctx): ToolResult {
    try {
      const text = str(values, 'wsdl');
      if (text.trim() === '') return { outputs: [] };
      const model = modelOf(text);
      if (model === null) return { outputs: [] };

      const outputs: OutputBlock[] = [
        {
          kind: 'note',
          tone: 'info',
          value: 'Nothing this document names is loaded or opened. Addresses are shown as text only.',
        },
      ];
      if (model.services.length === 0) {
        outputs.push({ kind: 'note', tone: 'info', value: 'No services in this document.' });
      }
      outputs.push(...tables(model));
      if (model.notFound.length > 0) {
        outputs.push({
          kind: 'list',
          label: 'Not found in this document',
          items: model.notFound.map(describeNotFound),
        });
      }
      if (model.notLoaded.length > 0) {
        outputs.push({ kind: 'list', label: 'Not loaded', items: model.notLoaded.map(describeNotLoaded) });
      }

      const errors: ToolIssue[] = [];
      if (operationNames(model).length > 0) {
        try {
          const version = str(values, 'soap', '1.1') === '1.2' ? '1.2' : '1.1';
          const request = sampleRequest(model, str(values, 'operation'), {
            soap: version,
            fill: bool(values, 'fill', true),
          });
          outputs.push({
            kind: 'code',
            label: `Sample SOAP ${version} request`,
            language: 'xml',
            value: request.envelope,
            download: 'request.xml',
          });
          outputs.push({
            kind: 'keyvalue',
            label: 'Send it with',
            pairs: [
              version === '1.1'
                ? ['SOAPAction', request.soapAction === '' ? '(none)' : `"${request.soapAction}"`]
                : ['SOAPAction', '(not used in SOAP 1.2: the action is a parameter of the Content-Type)'],
              ['Content-Type', request.contentType],
            ],
          });
          for (const warning of request.warnings) outputs.push({ kind: 'note', tone: 'warn', value: warning });
        } catch (err) {
          if (!(err instanceof WsdlExplorerError)) throw err;
          errors.push({ message: err.message });
        }
      }

      return {
        outputs,
        errors: errors.length > 0 ? errors : undefined,
        stats: [
          ['Services', count(model.services.length)],
          ['Bindings', count(model.bindings.length)],
          ['Operations', count(operationNames(model).length)],
          ['Messages', count(model.messages.length)],
          ['Not found', count(model.notFound.length)],
          ['Not loaded', count(model.notLoaded.length)],
        ],
      };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note owns that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof WsdlExplorerError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line, column: err.column }] };
      }
      const message = err instanceof Error ? err.message : 'Could not read that document.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
