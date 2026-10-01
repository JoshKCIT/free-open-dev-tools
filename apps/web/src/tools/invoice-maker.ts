import { meta, calculateInvoice, MoneyInputError, formatMoney, D } from '@fodt/invoice-maker';
import { defineTool, str, formatBytes, type OutputBlock, type ToolResult } from '../lib/tool-ui';

export default defineTool({
  id: 'invoice-maker',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'kind',
      label: 'Document',
      type: 'select',
      default: 'invoice',
      options: [
        { value: 'invoice', label: 'Invoice' },
        { value: 'quote', label: 'Quote' },
      ],
    },
    {
      name: 'number',
      label: 'Invoice or quote number',
      type: 'text',
      placeholder: '2026-001',
      help: 'Up to 40 characters. It goes in the heading and the file name (letters, digits, dots, dashes and underscores).',
    },
    {
      name: 'issueDate',
      label: 'Issue date (YYYY-MM-DD)',
      type: 'text',
      placeholder: '2026-10-01',
      help: 'The date written on the document, as year-month-day. Nothing is filled in for you.',
    },
    {
      name: 'dueDate',
      label: 'Due date or valid until (optional, YYYY-MM-DD)',
      type: 'text',
      placeholder: '2026-10-31',
      help: 'Left out of the PDF when blank. An invoice shows it as the due date, a quote as the valid-until date.',
    },
    {
      name: 'seller',
      label: 'Your name and address, one line each',
      type: 'textarea',
      rows: 4,
      placeholder: 'Example Studio\n1 High Street\nExample Town',
      help: 'Up to 20 lines and 2,000 characters. Each line is written as typed.',
    },
    {
      name: 'buyer',
      label: 'Customer name and address, one line each',
      type: 'textarea',
      rows: 4,
      placeholder: 'Example Client\n2 Low Road\nExample City',
      help: 'Up to 20 lines and 2,000 characters. Each line is written as typed.',
    },
    {
      name: 'items',
      label: 'Line items, one per line: description | quantity | unit price',
      type: 'textarea',
      rows: 6,
      placeholder: 'Widget | 2 | 19.99\nSetup | 1 | 5.00',
      help: 'One item per line: a description, a quantity above 0 (up to 4 decimal places) and a unit price, separated by a vertical bar. Up to 200 lines. Items stay in the order typed.',
    },
    {
      name: 'discount',
      label: 'Discount on the subtotal (percent, optional)',
      type: 'text',
      placeholder: '10',
      help: 'From 0 to 100. Left out of the document when blank.',
    },
    {
      name: 'taxRate',
      label: 'Tax rate (percent, optional)',
      type: 'text',
      placeholder: '20',
      help: 'From 0 to 100, typed by you: no rate is filled in. Left out of the document when blank.',
    },
    {
      name: 'taxLabel',
      label: 'Tax name, for example VAT or GST (optional)',
      type: 'text',
      placeholder: 'VAT',
      help: 'Up to 30 characters. A blank name is written as Tax.',
    },
    {
      name: 'rounding',
      label: 'Tax rounding',
      type: 'select',
      default: 'total',
      options: [
        { value: 'total', label: 'Round tax on the total (default)' },
        { value: 'line', label: 'Round tax on each line' },
      ],
    },
    {
      name: 'notes',
      label: 'Notes (optional)',
      type: 'textarea',
      rows: 3,
      placeholder: 'Payment details, terms or a thank-you line',
      help: 'Up to 20 lines and 2,000 characters. Left out of the PDF when blank.',
    },
    {
      name: 'currency',
      label: 'Currency (ISO 4217 code)',
      type: 'text',
      default: 'USD',
      help: 'A three-letter code such as USD, EUR, GBP or JPY. It sets the decimal places of the amounts and is written in the PDF as a code.',
    },
    {
      name: 'pageSize',
      label: 'Paper size',
      type: 'select',
      default: 'A4',
      options: [
        { value: 'A4', label: 'A4' },
        { value: 'Letter', label: 'US Letter' },
      ],
    },
  ],
  examples: [
    {
      label: 'Two items with 10 percent off and 20 percent tax: a total of 48.58',
      values: {
        kind: 'invoice',
        number: '2026-001',
        issueDate: '2026-10-01',
        dueDate: '2026-10-31',
        seller: 'Example Studio\n1 High Street\nExample Town',
        buyer: 'Example Client\n2 Low Road\nExample City',
        items: 'Widget | 2 | 19.99\nSetup | 1 | 5.00',
        discount: '10',
        taxRate: '20',
        taxLabel: 'VAT',
        rounding: 'total',
        notes: 'Thank you for your business.',
        currency: 'USD',
        pageSize: 'A4',
      },
    },
    {
      label: 'A quote in euros with accents, tax rounded on each line',
      values: {
        kind: 'quote',
        number: 'Q-17',
        issueDate: '2026-10-01',
        dueDate: '2026-10-15',
        seller: 'Café Müller\nRue de la Paix 4',
        buyer: 'Société Dupont',
        items: 'Conseil | 3.5 | 120.00\nDéplacement | 1 | 45.50',
        taxRate: '19',
        taxLabel: 'TVA',
        rounding: 'line',
        currency: 'EUR',
        pageSize: 'A4',
      },
    },
  ],
  async run(values): Promise<ToolResult> {
    try {
      const result = await calculateInvoice({
        kind: str(values, 'kind', 'invoice'),
        number: str(values, 'number'),
        issueDate: str(values, 'issueDate'),
        dueDate: str(values, 'dueDate'),
        seller: str(values, 'seller'),
        buyer: str(values, 'buyer'),
        items: str(values, 'items'),
        discount: str(values, 'discount'),
        taxRate: str(values, 'taxRate'),
        taxLabel: str(values, 'taxLabel'),
        rounding: str(values, 'rounding', 'total'),
        notes: str(values, 'notes'),
        currency: str(values, 'currency', 'USD'),
        pageSize: str(values, 'pageSize', 'A4'),
      });
      if (result === null) return { outputs: [] };
      const { totals } = result;
      const money = (value: string) => formatMoney(new D(value), totals.currency);

      const pairs: [string, string][] = [['Subtotal', money(totals.subtotal)]];
      if (totals.discount !== null)
        pairs.push([`Discount (${totals.discountPercent} %)`, `-${money(totals.discount)}`]);
      if (totals.tax !== null) pairs.push([`${totals.taxLabel} (${totals.taxPercent} %)`, money(totals.tax)]);
      pairs.push(['Total', money(totals.total)]);
      if (totals.tax !== null) {
        pairs.push(['Tax rounding', totals.rounding === 'total' ? 'On the total, once' : 'On each line']);
      }

      const outputs: OutputBlock[] = [
        {
          kind: 'table',
          label: 'Lines',
          table: {
            headers: ['Line', 'Description', 'Quantity', 'Unit price', 'Amount'],
            rows: result.rows.map((row) => [
              row.line,
              row.description,
              row.quantity,
              money(row.unitPrice),
              money(row.amount),
            ]),
            mono: [0, 2, 3, 4],
          },
        },
        { kind: 'keyvalue', label: 'Totals', pairs },
      ];
      for (const note of result.notes) outputs.push({ kind: 'note', tone: 'info', value: note });
      outputs.push(
        { kind: 'code', label: 'How this was worked out', value: result.working },
        {
          kind: 'files',
          label: 'Download',
          files: [{ name: result.fileName, mime: 'application/pdf', content: result.bytes }],
        },
      );
      return {
        outputs,
        stats: [
          ['Pages', String(result.pages)],
          ['Size', formatBytes(result.bytes.length)],
        ],
      };
    } catch (err) {
      if (err instanceof MoneyInputError) {
        return {
          outputs: [],
          errors: [{ message: `${err.field}: ${err.message}`, line: err.line, column: err.column }],
        };
      }
      throw err;
    }
  },
});
