import { it, expect } from 'vitest';
import { calculateInvoice, invoiceTotals, parseItems, MAX_ITEMS, meta, type InvoiceTexts } from '../src/index';
import { D, MoneyInputError } from '../src/money';

/** Awaits `promise` and returns the MoneyInputError it rejects with, failing the test if it resolves or fails otherwise. */
async function refusedAsync(promise: Promise<unknown>): Promise<MoneyInputError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(MoneyInputError);
    return err as MoneyInputError;
  }
  throw new Error('expected a MoneyInputError but nothing was thrown');
}

/** Runs `fn` and returns the MoneyInputError it throws, failing the test if it throws anything else or nothing. */
function refused(fn: () => unknown): MoneyInputError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MoneyInputError);
    return err as MoneyInputError;
  }
  throw new Error('expected a MoneyInputError but nothing was thrown');
}

const BASE: InvoiceTexts = {
  kind: 'invoice',
  number: '2026-001',
  issueDate: '2026-10-01',
  seller: 'Example Studio',
  buyer: 'Example Client',
  items: 'Widget | 2 | 19.99\nSetup | 1 | 5.00',
  discount: '10',
  taxRate: '20',
};
const calc = async (texts: InvoiceTexts = {}) => {
  const result = await calculateInvoice({ ...BASE, ...texts });
  expect(result).not.toBeNull();
  return result!;
};

it('meta: id, name, pinned dependencies, the two required sentences in limits and the cited standard', () => {
  expect(meta.id).toBe('invoice-maker');
  expect(meta.name).toBe('Invoice & Quote Maker');
  expect(meta.dependencies['decimal.js']).toBe('10.6.0');
  expect(meta.dependencies['@cantoo/pdf-lib']).toBe('2.11.1');
  expect(meta.devDependencies['pdfjs-dist']).toBe('6.3.289');
  expect(meta.limits.length).toBeGreaterThanOrEqual(3);
  expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /Nothing is stored/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /refused naming the character/i.test(l))).toBe(true);
  expect(meta.standards).toHaveLength(1);
  expect(meta.standards[0]?.url).toBe(
    'https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf',
  );
  expect(MAX_ITEMS).toBe(200);
});

it('the usage example in meta.json shows what the code returns', async () => {
  const result = await calc();
  expect(result.totals.total).toBe('48.58');
  expect(result.fileName).toBe('invoice-2026-001.pdf');
  expect(result.bytes).toBeInstanceOf(Uint8Array);
  expect(meta.usage).toContain("// '48.58'");
  expect(meta.usage).toContain("// 'invoice-2026-001.pdf'");
});

// Derived by hand: 2 x 19.99 = 39.98 and 1 x 5.00 = 5.00, so the subtotal is 44.98. Ten percent off is
// 44.98 x 10 / 100 = 4.498, shown as 4.50. Tax at 20 percent on 44.98 - 4.50 = 40.48 is 8.096, shown as 8.10. The
// total is 44.98 - 4.50 + 8.10 = 48.58, and every figure shown is one of these rounded numbers.
it('line amounts, discount, tax and total add up exactly to the figures shown: 2 x 19.99 and 1 x 5.00 with 10 off and 20 tax', async () => {
  const result = await calc();
  expect(result.rows.map((r) => r.amount)).toEqual(['39.98', '5.00']);
  expect(result.totals.subtotal).toBe('44.98');
  expect(result.totals.discount).toBe('4.50');
  expect(result.totals.tax).toBe('8.10');
  expect(result.totals.total).toBe('48.58');
  expect(result.totals.discountPercent).toBe('10');
  expect(result.totals.taxPercent).toBe('20');
  expect(result.totals.rounding).toBe('total');

  // The figures shown add up exactly.
  const sum = result.rows.reduce((total, r) => total.plus(r.amount), new D(0));
  expect(sum.toFixed(2)).toBe(result.totals.subtotal);
  const total = new D(result.totals.subtotal).minus(result.totals.discount!).plus(result.totals.tax!);
  expect(total.toFixed(2)).toBe(result.totals.total);

  // The exact figures behind them, from the lower-level functions.
  const items = parseItems(BASE.items!, 'USD');
  const exact = invoiceTotals(items, new D(10), new D(20), 'total', 'USD');
  expect([exact.subtotal, exact.discount, exact.tax, exact.total].map((x) => x.toFixed(2))).toEqual([
    '44.98',
    '4.50',
    '8.10',
    '48.58',
  ]);
  expect(exact.exactTax.toFixed()).toBe('8.096');

  // Optional fields left blank are left out of the totals, and the total is then the subtotal.
  const plain = await calc({ discount: '', taxRate: '' });
  expect(plain.totals.discount).toBeNull();
  expect(plain.totals.tax).toBeNull();
  expect(plain.totals.discountPercent).toBeNull();
  expect(plain.totals.taxPercent).toBeNull();
  expect(plain.totals.total).toBe('44.98');

  // A currency with no decimals shows none; one with three shows three.
  const yen = await calc({
    currency: 'JPY',
    items: 'Widget | 3 | 333\nSetup | 1.5 | 333',
    discount: '',
    taxRate: '10',
  });
  expect(yen.rows.map((r) => r.amount)).toEqual(['999', '500']);
  expect(yen.totals.subtotal).toBe('1499');
  expect(yen.totals.tax).toBe('150');
  expect(yen.totals.total).toBe('1649');
  const dinar = await calc({ currency: 'BHD', items: 'Widget | 3 | 1.125', discount: '', taxRate: '' });
  expect(dinar.totals.total).toBe('3.375');
});

// Tax rounded once on the discounted subtotal (the default) or on each line and added up: the same two modes
// as the sales tax page. Three lines of 0.05 at 10 percent tax: 0.015 once is 0.02, but 0.005 per line is 0.01 each,
// 0.03 in all. With a 10 percent discount too: the discount is 0.015, shown 0.02, so the tax base is 0.13 and the tax
// on the total is 0.013, shown 0.01; per line each share is 0.05 x 0.9 x 0.1 = 0.0045, shown 0.00, so 0.00 in all.
it('rounding per line and on the total follow the same two modes as the tax page and can differ', async () => {
  const three = parseItems('A | 1 | 0.05\nB | 1 | 0.05\nC | 1 | 0.05', 'USD');
  const once = invoiceTotals(three, new D(0), new D(10), 'total', 'USD');
  const each = invoiceTotals(three, new D(0), new D(10), 'line', 'USD');
  expect(once.tax.toFixed(2)).toBe('0.02');
  expect(once.total.toFixed(2)).toBe('0.17');
  expect(each.tax.toFixed(2)).toBe('0.03');
  expect(each.total.toFixed(2)).toBe('0.18');
  expect(each.lineTaxes.map((t) => t.toFixed(2))).toEqual(['0.01', '0.01', '0.01']);
  expect(once.lineTaxes).toEqual([]);

  const a = invoiceTotals(three, new D(10), new D(10), 'total', 'USD');
  const b = invoiceTotals(three, new D(10), new D(10), 'line', 'USD');
  expect(a.discount.toFixed(2)).toBe('0.02');
  expect(a.tax.toFixed(2)).toBe('0.01');
  expect(a.total.toFixed(2)).toBe('0.14');
  expect(b.tax.toFixed(2)).toBe('0.00');
  expect(b.total.toFixed(2)).toBe('0.13');

  // Through the page's own entry point, with the mode typed as it is on the page.
  const typedOnce = await calc({ items: 'A | 1 | 0.05\nB | 1 | 0.05\nC | 1 | 0.05', discount: '', taxRate: '10' });
  const typedEach = await calc({
    items: 'A | 1 | 0.05\nB | 1 | 0.05\nC | 1 | 0.05',
    discount: '',
    taxRate: '10',
    rounding: 'line',
  });
  expect([typedOnce.totals.tax, typedOnce.totals.total]).toEqual(['0.02', '0.17']);
  expect([typedEach.totals.tax, typedEach.totals.total]).toEqual(['0.03', '0.18']);
  expect(typedEach.totals.rounding).toBe('line');
  // The figures shown add up in both modes.
  for (const r of [typedOnce, typedEach]) {
    const total = new D(r.totals.subtotal).plus(r.totals.tax!);
    expect(total.toFixed(2)).toBe(r.totals.total);
  }
  // The first example (two lines, 10 off, 20 tax) gives the same tax either way: 7.20 and 0.90 add to 8.10.
  const same = await calc({ rounding: 'line' });
  expect(same.totals.tax).toBe('8.10');
  expect(same.totals.total).toBe('48.58');
  // The other mode's tax is mentioned when it would differ.
  expect(typedOnce.notes.some((n) => /on each line instead would give 0\.03/.test(n))).toBe(true);
  expect(same.notes.some((n) => /instead would give/.test(n))).toBe(false);
});

it('items keep the order typed and identical lines stay separate', async () => {
  const result = await calc({ items: 'B | 1 | 1.00\n\nA | 1 | 1.00\nB | 1 | 1.00', discount: '', taxRate: '' });
  expect(result.rows.map((r) => r.description)).toEqual(['B', 'A', 'B']);
  // Line numbers count blank lines, so an error can point at the right place.
  expect(result.rows.map((r) => r.line)).toEqual([1, 3, 4]);
  expect(result.totals.subtotal).toBe('3.00');
  const items = parseItems('Same | 1 | 2.50\nSame | 1 | 2.50', 'USD');
  expect(items).toHaveLength(2);
  expect(items.map((i) => i.amount.toFixed(2))).toEqual(['2.50', '2.50']);
});

it('0.1 plus 0.2 is exactly 0.3 through this tool', async () => {
  // The float sum is wrong; the tool's own path (two lines of 0.10 and 0.20 with nothing else typed) is exact.
  expect(0.1 + 0.2).not.toBe(0.3);
  expect(0.1 + 0.2).toBe(0.30000000000000004);
  const result = await calc({ items: 'A | 1 | 0.10\nB | 1 | 0.20', discount: '', taxRate: '' });
  expect(result.totals.subtotal).toBe('0.30');
  expect(result.totals.total).toBe('0.30');
  const exact = invoiceTotals(parseItems('A | 1 | 0.10\nB | 1 | 0.20', 'USD'), new D(0), new D(0), 'total', 'USD');
  expect(exact.subtotal.toFixed()).toBe('0.3');
  expect(exact.total.toFixed()).toBe('0.3');
});

it('nothing typed gives no output, and a missing line item is named and gives no file', async () => {
  expect(await calculateInvoice({})).toBeNull();
  expect(await calculateInvoice({ kind: 'invoice', currency: 'USD', rounding: 'total', pageSize: 'A4' })).toBeNull();
  expect(await calculateInvoice({ number: '  ', seller: '\n\n' })).toBeNull();
  for (const items of [undefined, '', '   \n\n  ']) {
    const err = await refusedAsync(calculateInvoice({ ...BASE, items }));
    expect(err.field).toBe('Line items');
    expect(err.message).toMatch(/missing/);
  }
  // Something typed, nothing else: the items are named first.
  expect((await refusedAsync(calculateInvoice({ seller: 'Example Studio' }))).field).toBe('Line items');
  // Each of the other required fields is named when it is the one missing.
  expect((await refusedAsync(calculateInvoice({ ...BASE, number: '' }))).field).toBe('Invoice or quote number');
  expect((await refusedAsync(calculateInvoice({ ...BASE, issueDate: '' }))).field).toBe('Issue date');
  expect((await refusedAsync(calculateInvoice({ ...BASE, seller: ' ' }))).field).toBe('Your name and address');
  expect((await refusedAsync(calculateInvoice({ ...BASE, buyer: '' }))).field).toBe('Customer name and address');
});

it('every typed value is checked and a problem names the field, the line and the column', async () => {
  const bad = (texts: InvoiceTexts) => refusedAsync(calculateInvoice({ ...BASE, ...texts }));

  const noQuantity = await bad({ items: 'Widget | 0 | 19.99' });
  expect(noQuantity.field).toBe('Line items');
  expect(noQuantity.message).toMatch(/quantity.*above 0/);
  expect([noQuantity.line, noQuantity.column]).toEqual([1, 10]);
  expect((await bad({ items: 'Widget | 1.00001 | 19.99' })).message).toMatch(/quantity.*too many digits/);
  expect((await bad({ items: 'Widget | 1 | 19.999' })).message).toMatch(/unit price.*2 decimal places for USD/);
  expect((await bad({ items: 'Widget | 1 | 19.5', currency: 'JPY' })).message).toMatch(/0 decimal places for JPY/);
  expect((await bad({ items: 'Widget | 1 | -3' })).message).toMatch(/negative/);
  expect((await bad({ items: 'Widget | 1' })).message).toMatch(/expected 3 cells/);
  expect((await bad({ items: 'Widget | 1 | 2 | 3' })).message).toMatch(/at most 3 cells/);
  const noDescription = await bad({ items: 'Widget | 1 | 2\n | 1 | 2' });
  expect(noDescription.message).toMatch(/description/);
  expect(noDescription.line).toBe(2);
  expect((await bad({ items: `${'x'.repeat(501)} | 1 | 2` })).message).toMatch(/at most 500 characters/);

  expect((await bad({ discount: '101' })).field).toBe('Discount on the subtotal (percent)');
  expect((await bad({ discount: '-1' })).field).toBe('Discount on the subtotal (percent)');
  expect((await bad({ taxRate: '100.5' })).field).toBe('Tax rate (percent)');
  expect((await bad({ taxRate: '1e1' })).field).toBe('Tax rate (percent)');
  expect((await bad({ issueDate: '2026-02-30' })).field).toBe('Issue date');
  expect((await bad({ dueDate: '31/10/2026' })).field).toBe('Due date or valid until');
  expect((await bad({ kind: 'receipt' })).field).toBe('Document type');
  expect((await bad({ rounding: 'always' })).field).toBe('Tax rounding');
  expect((await bad({ pageSize: 'A3' })).field).toBe('Paper size');
  expect((await bad({ currency: 'US' })).field).toBe('Currency (ISO 4217 code)');
  expect((await bad({ number: 'N'.repeat(41) })).message).toMatch(/at most 40 characters/);
  expect((await bad({ taxLabel: 'T'.repeat(31) })).message).toMatch(/at most 30 characters/);

  // The three free text boxes hold at most 20 lines and 2,000 characters each.
  const lines21 = Array.from({ length: 21 }, (_, i) => `Line ${i + 1}`).join('\n');
  expect((await bad({ seller: lines21 })).message).toMatch(/at most 20 lines/);
  expect((await bad({ buyer: 'b'.repeat(2001) })).message).toMatch(/at most 2000 characters/);
  expect((await bad({ notes: lines21 })).field).toBe('Notes');
  const twenty = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n');
  expect((await calc({ seller: twenty, buyer: 'c'.repeat(2000) })).pages).toBeGreaterThanOrEqual(1);
});

it('the item cap is 200: exactly 200 are read and the 201st is refused naming the cap and the line', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => `Item ${i + 1} | 1 | 1.00`).join('\n');
  expect(parseItems(rows(200), 'USD')).toHaveLength(200);
  const err = refused(() => parseItems(rows(201), 'USD'));
  expect(err.field).toBe('Line items');
  expect(err.message).toMatch(/at most 200 rows/);
  expect(err.line).toBe(201);
});

it('the working shows every step with the typed numbers and the rounding mode', async () => {
  const { working } = await calc();
  expect(working).toContain('half away from zero');
  expect(working).toContain('2 x 19.99 = 39.98');
  expect(working).toContain('44.98 x 10 / 100 = 4.498');
  expect(working).toContain('(44.98 - 4.50) x 20 / 100 = 8.096');
  expect(working).toContain('48.58');
  expect((await calc({ rounding: 'line' })).working).toContain('on each line');
  expect(working).not.toMatch(/recommend|you should/i);
});
