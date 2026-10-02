import { checkInputSizes, meta, XsdValidatorError, type NotLoadedReference, type XsdIssue } from '@fodt/xsd-validator';
import { xsdValidatorInWorker, XsdValidatorRunError } from '../lib/run-xsd-validator-in-worker';
import { defineTool, bool, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

const ORDER_SCHEMA = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="qty" type="xs:positiveInteger"/>
        <xs:element name="sku" type="xs:string"/>
      </xs:sequence>
      <xs:attribute name="id" type="xs:int" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

const ORDER_WITH_MISTAKES = `<order>
  <qty>-1</qty>
  <sku>A</sku>
  <extra/>
</order>`;

const NOTE_SCHEMA = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="note" type="xs:string"/>
</xs:schema>`;

/** Which pasted text a problem is in, as the heading of its message. */
function partLabel(part: 'schema' | 'document' | undefined): string {
  if (part === 'schema') return 'Schema: ';
  if (part === 'document') return 'Document: ';
  return '';
}

/** The locations a schema names, listed as text and marked not loaded. */
function notLoadedBlocks(references: NotLoadedReference[]): OutputBlock[] {
  if (references.length === 0) return [];
  return [
    {
      kind: 'list',
      label: 'Not loaded',
      items: references.map((ref) => `${ref.kind} ${ref.location} (line ${ref.line}): not loaded`),
    },
  ];
}

function issueRow(issue: XsdIssue): (string | number)[] {
  return [issue.line ?? '', issue.level, issue.message];
}

export default defineTool({
  id: 'xsd-validator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  // Validating is real background work, so this waits for a deliberate Run press and offers Cancel while it runs.
  // Every run goes through a new worker with a 20 second limit (see run-xsd-validator-in-worker.ts's own comment):
  // the engine may be stuck inside one synchronous call, so the page, not the engine, decides when it has taken too
  // long.
  autoRun: false,
  cancellable: true,
  fields: [
    {
      name: 'schema',
      label: 'XML Schema',
      type: 'textarea',
      rows: 10,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'An XML Schema 1.0 document. Imports and includes it names are listed, never loaded.',
    },
    {
      name: 'xml',
      label: 'XML document',
      type: 'textarea',
      rows: 10,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
    },
    { name: 'showWarnings', label: 'Show warnings', type: 'checkbox', default: false },
  ],
  examples: [
    { label: 'Purchase order with three mistakes', values: { schema: ORDER_SCHEMA, xml: ORDER_WITH_MISTAKES } },
    { label: 'Valid note', values: { schema: NOTE_SCHEMA, xml: '<note>a short note</note>' } },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const schema = str(values, 'schema');
    const xml = str(values, 'xml');
    if (!schema.trim() || !xml.trim()) return { outputs: [] };
    const showWarnings = bool(values, 'showWarnings');

    try {
      // Refused before any worker starts, so an oversize text never reaches the engine.
      checkInputSizes(schema, xml);
      const result = await xsdValidatorInWorker({ type: 'xsd-validator-job', schema, xml, showWarnings }, ctx);
      if (!result) return { outputs: [] };

      const outputs: OutputBlock[] = [];
      if (result.valid) {
        outputs.push({ kind: 'note', tone: 'success', value: 'Valid against the schema.' });
      } else {
        const noun = showWarnings ? 'message' : 'error';
        outputs.push({
          kind: 'note',
          tone: 'warn',
          value: `Not valid: ${result.total} ${result.total === 1 ? noun : `${noun}s`}.`,
        });
      }
      if (result.issues.length > 0) {
        outputs.push({
          kind: 'table',
          label: showWarnings ? 'Errors and warnings' : 'Errors',
          table: { headers: ['Line', 'Level', 'Message'], rows: result.issues.map(issueRow), mono: [0] },
        });
      }
      if (result.total > result.issues.length) {
        outputs.push({
          kind: 'note',
          tone: 'info',
          value: `Showing ${result.issues.length} of ${result.total}.`,
        });
      }
      outputs.push(...notLoadedBlocks(result.notLoaded));
      return { outputs };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note already owns
      // that message.
      if (ctx.signal.aborted) throw err;
      if (err instanceof XsdValidatorError || err instanceof XsdValidatorRunError) {
        // Every error libxml2 gave for the problem, each in its own place; the first one speaks for the problem when
        // libxml2 gave only one.
        const real = err.issues.filter((issue) => issue.level !== 'warning');
        const problems: ToolIssue[] =
          real.length > 1
            ? real.map((issue) => ({
                message: `${partLabel(issue.part)}${issue.message}`,
                line: issue.line,
                column: issue.column,
              }))
            : [{ message: `${partLabel(err.part)}${err.message}`, line: err.line, column: err.column }];
        const warnings = showWarnings ? err.issues.filter((issue) => issue.level === 'warning') : [];
        return {
          outputs: notLoadedBlocks(err.notLoaded),
          errors: problems,
          ...(warnings.length > 0
            ? { warnings: warnings.map((issue) => `${partLabel(issue.part)}${issue.message}`) }
            : {}),
        };
      }
      return {
        outputs: [],
        errors: [{ message: err instanceof Error ? err.message : 'Could not validate that input.' }],
      };
    }
  },
});
