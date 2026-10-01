import meta from './meta.json';
import {
  D,
  type Dec,
  MoneyInputError,
  isBlank,
  formatMoney,
  parseCurrency,
  parseDecimal,
  parseIsoDate,
  formatIsoDate,
  parseRows,
  cellDecimal,
  cellText,
  roundTo,
  toPlain,
  minorUnits,
} from './money';
import {
  FIELD_BUYER,
  FIELD_DUE,
  FIELD_ISSUE,
  FIELD_ITEMS,
  FIELD_NOTES,
  FIELD_NUMBER,
  FIELD_SELLER,
  FIELD_TAX_LABEL,
  assertWritable,
  buildInvoicePdf,
  downloadName,
  renderInvoicePdf,
  type DocumentKind,
  type InvoicePdfModel,
  type PaperSize,
} from './pdf';

export { meta, D, MoneyInputError, isBlank, formatMoney, assertWritable, buildInvoicePdf, downloadName };
export type { Dec, DocumentKind, PaperSize };

/** The most line items accepted. */
export const MAX_ITEMS = 200;
/** Longest description, invoice number and tax name accepted. */
const MAX_DESCRIPTION = 500;
const MAX_NUMBER = 40;
const MAX_TAX_LABEL = 30;
/** Each free text box (seller, customer, notes) holds at most this many lines and characters. */
const MAX_BLOCK_LINES = 20;
const MAX_BLOCK_CHARS = 2000;
/** Decimal places used for the unrounded figures in the working. */
const WORKING_PLACES = 10;
/** The most lines whose arithmetic is written out in the working; the table shows all of them. */
const WORKING_LINES = 10;

const FIELD_KIND = 'Document type';
const FIELD_DISCOUNT = 'Discount on the subtotal (percent)';
const FIELD_TAX_RATE = 'Tax rate (percent)';
const FIELD_ROUNDING = 'Tax rounding';
const FIELD_PAPER = 'Paper size';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

const HUNDRED = new D(100);

/** One line item: its description, quantity, unit price and amount (quantity x unit price rounded to the smallest unit). */
export interface InvoiceItem {
  description: string;
  quantity: Dec;
  unitPrice: Dec;
  amount: Dec;
  /** The 1-based line number in the items text. */
  line: number;
  /** Where the description starts on that line. */
  column: number;
}

/**
 * Reads the items text: one item per line as `description | quantity | unit price`, up to 200 lines. The quantity is
 * above 0 with up to 4 decimal places; the unit price is 0 or more with at most the decimal places of the currency's
 * smallest unit. A problem names the line and column.
 */
export function parseItems(text: string, currency: string): InvoiceItem[] {
  const places = minorUnits(currency);
  const rows = parseRows(text, FIELD_ITEMS, {
    columns: ['description', 'quantity', 'unit price'],
    required: 3,
    maxRows: MAX_ITEMS,
  });
  return rows.map((row) => {
    const description = cellText(row, 0);
    const descriptionColumn = row.starts[0] ?? 1;
    if (description === '') {
      throw new MoneyInputError(FIELD_ITEMS, 'description: missing, type what the line is for', {
        line: row.line,
        column: descriptionColumn,
      });
    }
    if (description.length > MAX_DESCRIPTION) {
      throw new MoneyInputError(FIELD_ITEMS, `description: at most ${MAX_DESCRIPTION} characters`, {
        line: row.line,
        column: descriptionColumn,
      });
    }
    const quantity = cellDecimal(row, 1, FIELD_ITEMS, 'quantity', { maxInt: 7, maxFrac: 4 });
    if (!quantity.gt(0)) {
      throw new MoneyInputError(FIELD_ITEMS, 'quantity: must be above 0', {
        line: row.line,
        column: row.starts[1] ?? 1,
      });
    }
    const unitPrice = cellDecimal(row, 2, FIELD_ITEMS, 'unit price', { maxInt: 10 });
    if (unitPrice.dp() > places) {
      throw new MoneyInputError(
        FIELD_ITEMS,
        `unit price: at most ${places} decimal places for ${currency}, the smallest unit of ${currency}`,
        { line: row.line, column: row.starts[2] ?? 1 },
      );
    }
    return {
      description,
      quantity,
      unitPrice,
      amount: roundTo(quantity.times(unitPrice), places),
      line: row.line,
      column: descriptionColumn,
    };
  });
}

/** `total` rounds the tax once on the discounted subtotal (the default); `line` rounds each line's tax and adds them up. */
export type Rounding = 'total' | 'line';
const ROUNDINGS: readonly Rounding[] = ['total', 'line'];

export interface InvoiceTotals {
  subtotal: Dec;
  discount: Dec;
  tax: Dec;
  total: Dec;
  /** The tax before any rounding: one figure on the total, or the lines' unrounded taxes added up. */
  exactTax: Dec;
  /** Each line's rounded tax, only when rounding on each line; otherwise empty. */
  lineTaxes: Dec[];
}

function sum(values: readonly Dec[]): Dec {
  return values.reduce((total, value) => total.plus(value), new D(0));
}

/**
 * The subtotal is the sum of the rounded line amounts. The discount is the subtotal times the discount percent over 100,
 * rounded. Tax rounded on the total is (subtotal - discount) x tax percent / 100, rounded once. Tax rounded on each
 * line is each line's share after the discount, line amount x (100 - discount percent) / 100 x tax percent / 100,
 * rounded, and added up. The total is subtotal - discount + tax, so every figure shown adds up exactly. Rounding is
 * half away from zero to the currency's smallest unit.
 */
export function invoiceTotals(
  items: readonly InvoiceItem[],
  discountPercent: Dec,
  taxPercent: Dec,
  rounding: Rounding,
  currency: string,
): InvoiceTotals {
  const places = minorUnits(currency);
  const subtotal = sum(items.map((i) => i.amount));
  const discount = roundTo(subtotal.times(discountPercent).div(HUNDRED), places);
  let tax: Dec;
  let exactTax: Dec;
  let lineTaxes: Dec[] = [];
  if (rounding === 'total') {
    exactTax = subtotal.minus(discount).times(taxPercent).div(HUNDRED);
    tax = roundTo(exactTax, places);
  } else {
    const kept = HUNDRED.minus(discountPercent).div(HUNDRED);
    const exact = items.map((i) => i.amount.times(kept).times(taxPercent).div(HUNDRED));
    lineTaxes = exact.map((e) => roundTo(e, places));
    tax = sum(lineTaxes);
    exactTax = sum(exact);
  }
  return { subtotal, discount, tax, total: subtotal.minus(discount).plus(tax), exactTax, lineTaxes };
}

/** The values the page holds, exactly as typed. Any of them may be left out. */
export interface InvoiceTexts {
  /** `invoice` (the default) or `quote`. */
  kind?: string;
  number?: string;
  /** YYYY-MM-DD. */
  issueDate?: string;
  /** YYYY-MM-DD, optional. */
  dueDate?: string;
  /** One line per line. */
  seller?: string;
  buyer?: string;
  /** One item per line: `description | quantity | unit price`. */
  items?: string;
  /** Percent, optional. */
  discount?: string;
  /** Percent, optional. */
  taxRate?: string;
  /** Optional; a blank one prints Tax. */
  taxLabel?: string;
  /** `total` (the default) or `line`. */
  rounding?: string;
  notes?: string;
  /** Default USD. */
  currency?: string;
  /** `A4` (the default) or `Letter`. */
  pageSize?: string;
}

/** One line of the page's table, every figure as plain decimal text at the currency's decimal places. */
export interface InvoiceRow {
  line: number;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface InvoiceResultTotals {
  subtotal: string;
  /** The percent typed, or null when none was typed. */
  discountPercent: string | null;
  discount: string | null;
  taxPercent: string | null;
  taxLabel: string;
  tax: string | null;
  total: string;
  rounding: Rounding;
  currency: string;
  /** Decimal places of the currency's smallest unit. */
  decimals: number;
}

export interface InvoiceResult {
  kind: DocumentKind;
  totals: InvoiceResultTotals;
  rows: InvoiceRow[];
  /** The PDF file, built in the same run and from the same values as the totals. */
  bytes: Uint8Array;
  fileName: string;
  pages: number;
  /** The formulas, the typed numbers put into them, and how the rounding was done. */
  working: string;
  notes: string[];
}

/** Puts a comma between groups of three digits in the whole part of plain decimal text. */
function group(plain: string): string {
  const negative = plain.startsWith('-');
  const [whole = '', fraction] = plain.replace(/^-/, '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** A figure for the working: rounded half away from zero to 10 places with trailing zeros dropped. */
function exactText(x: Dec): string {
  return roundTo(x, WORKING_PLACES).toFixed();
}

function shorten(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

/** A free text box: one entry per typed line (trailing blank lines dropped), at most 20 lines and 2,000 characters. */
function parseBlock(text: string | undefined, field: string, required: boolean): string[] {
  const raw = text ?? '';
  if (isBlank(raw)) {
    if (required) throw new MoneyInputError(field, 'missing, type at least one line');
    return [];
  }
  if (raw.length > MAX_BLOCK_CHARS) {
    throw new MoneyInputError(field, `at most ${MAX_BLOCK_CHARS} characters are accepted, this has ${raw.length}`);
  }
  const lines = raw.split(/\r?\n/);
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  if (lines.length > MAX_BLOCK_LINES) {
    throw new MoneyInputError(field, `at most ${MAX_BLOCK_LINES} lines are accepted, this has ${lines.length}`, {
      line: MAX_BLOCK_LINES + 1,
      column: 1,
    });
  }
  return lines.map((l) => l.trimEnd());
}

/** A percent from 0 to 100, or null when left blank. */
function parsePercent(text: string | undefined, field: string): Dec | null {
  if (text === undefined || isBlank(text)) return null;
  const percent = parseDecimal(text, field, { maxInt: 3, maxFrac: 4 });
  if (percent.gt(HUNDRED)) throw new MoneyInputError(field, 'must be from 0 to 100 percent');
  return percent;
}

function choose<T extends string>(
  text: string | undefined,
  allowed: readonly T[],
  fallback: T,
  field: string,
  hint: string,
): T {
  if (text === undefined || isBlank(text)) return fallback;
  const found = allowed.find((a) => a === text.trim());
  if (found === undefined) throw new MoneyInputError(field, hint);
  return found;
}

/**
 * Reads the invoice or quote the page holds, works out the totals and builds the PDF from the same parsed values.
 * Returns null when nothing is typed. A missing item, number, date or name, a bad value, or a character the PDF's
 * built-in fonts cannot write is refused by name, and no file is produced.
 */
export async function calculateInvoice(texts: InvoiceTexts): Promise<InvoiceResult | null> {
  const typed = [
    texts.number,
    texts.issueDate,
    texts.dueDate,
    texts.seller,
    texts.buyer,
    texts.items,
    texts.discount,
    texts.taxRate,
    texts.taxLabel,
    texts.notes,
  ];
  if (typed.every((t) => t === undefined || isBlank(t))) return null;

  const kind = choose<DocumentKind>(texts.kind, ['invoice', 'quote'], 'invoice', FIELD_KIND, 'choose invoice or quote');
  const rounding = choose<Rounding>(
    texts.rounding,
    ROUNDINGS,
    'total',
    FIELD_ROUNDING,
    'choose round the tax on the total or round it on each line',
  );
  const paper = choose<PaperSize>(texts.pageSize, ['A4', 'Letter'], 'A4', FIELD_PAPER, 'choose A4 or Letter');
  const currency = parseCurrency(
    texts.currency === undefined || isBlank(texts.currency) ? 'USD' : texts.currency,
    FIELD_CURRENCY,
  );
  const places = minorUnits(currency);

  const items = parseItems(texts.items ?? '', currency);
  if (items.length === 0) {
    throw new MoneyInputError(FIELD_ITEMS, 'missing, type at least one line such as Widget | 2 | 19.99');
  }
  const discountPercent = parsePercent(texts.discount, FIELD_DISCOUNT);
  const taxPercent = parsePercent(texts.taxRate, FIELD_TAX_RATE);
  const totals = invoiceTotals(items, discountPercent ?? new D(0), taxPercent ?? new D(0), rounding, currency);

  const numberText = (texts.number ?? '').trim();
  if (numberText === '') throw new MoneyInputError(FIELD_NUMBER, 'missing, type a number such as 2026-001');
  if (numberText.length > MAX_NUMBER) {
    throw new MoneyInputError(FIELD_NUMBER, `at most ${MAX_NUMBER} characters`);
  }
  const issueDate = formatIsoDate(parseIsoDate(texts.issueDate ?? '', FIELD_ISSUE));
  const dueText = texts.dueDate ?? '';
  const dueDate = isBlank(dueText) ? undefined : formatIsoDate(parseIsoDate(dueText, FIELD_DUE));
  const seller = parseBlock(texts.seller, FIELD_SELLER, true);
  const buyer = parseBlock(texts.buyer, FIELD_BUYER, true);
  const taxLabelText = (texts.taxLabel ?? '').trim();
  if (taxLabelText.length > MAX_TAX_LABEL) {
    throw new MoneyInputError(FIELD_TAX_LABEL, `at most ${MAX_TAX_LABEL} characters`);
  }
  const taxLabel = taxLabelText === '' ? 'Tax' : taxLabelText;
  const notes = parseBlock(texts.notes, FIELD_NOTES, false);

  const plain = (x: Dec) => toPlain(x, places);
  const shown: InvoiceResultTotals = {
    subtotal: plain(totals.subtotal),
    discountPercent: discountPercent === null ? null : discountPercent.toFixed(),
    discount: discountPercent === null ? null : plain(totals.discount),
    taxPercent: taxPercent === null ? null : taxPercent.toFixed(),
    taxLabel,
    tax: taxPercent === null ? null : plain(totals.tax),
    total: plain(totals.total),
    rounding,
    currency,
    decimals: places,
  };
  const rows: InvoiceRow[] = items.map((item) => ({
    line: item.line,
    description: item.description,
    quantity: item.quantity.toFixed(),
    unitPrice: plain(item.unitPrice),
    amount: plain(item.amount),
  }));

  const pdfModel: InvoicePdfModel = {
    kind,
    number: numberText,
    issueDate,
    dueDate,
    currency,
    seller,
    buyer,
    items: rows.map((row, i) => ({
      description: row.description,
      quantity: group(row.quantity),
      unitPrice: group(row.unitPrice),
      amount: group(row.amount),
      line: items[i]?.line ?? i + 1,
      column: items[i]?.column ?? 1,
    })),
    totals: {
      subtotal: group(shown.subtotal),
      ...(shown.discountPercent !== null && shown.discount !== null
        ? { discount: { percent: shown.discountPercent, amount: group(shown.discount) } }
        : {}),
      ...(shown.taxPercent !== null && shown.tax !== null
        ? { tax: { label: taxLabel, percent: shown.taxPercent, amount: group(shown.tax) } }
        : {}),
      total: group(shown.total),
    },
    notes,
    paper,
  };
  const { bytes, pages } = await renderInvoicePdf(pdfModel);

  const resultNotes: string[] = [];
  if (taxPercent !== null) {
    const other = rounding === 'total' ? 'line' : 'total';
    const alternative = invoiceTotals(items, discountPercent ?? new D(0), taxPercent, other, currency);
    if (!alternative.tax.eq(totals.tax)) {
      resultNotes.push(
        `Rounding the tax ${other === 'line' ? 'on each line' : 'on the total'} instead would give ${plain(alternative.tax)}, a total of ${plain(alternative.total)}.`,
      );
    }
  }

  const working: string[] = [
    `Line amount = quantity x unit price, rounded half away from zero to ${places} decimal places (the smallest unit of ${currency}).`,
    'Subtotal = the sum of the rounded line amounts.',
  ];
  if (discountPercent !== null) working.push('Discount = subtotal x discount percent / 100, rounded the same way.');
  if (taxPercent !== null) {
    working.push(
      rounding === 'total'
        ? 'Tax (rounded once, on the total) = (subtotal - discount) x tax percent / 100, rounded.'
        : 'Tax (rounded on each line) = for each line, line amount x (1 - discount percent / 100) x tax percent / 100, rounded, then added up.',
    );
  }
  working.push('Total = subtotal - discount + tax.', '', 'With your numbers:');
  rows.slice(0, WORKING_LINES).forEach((row, i) => {
    working.push(`  line ${row.line} ${shorten(row.description)}: ${row.quantity} x ${row.unitPrice} = ${row.amount}`);
    const lineTax = totals.lineTaxes[i];
    const source = items[i];
    if (taxPercent !== null && rounding === 'line' && lineTax !== undefined && source !== undefined) {
      const kept = HUNDRED.minus(discountPercent ?? new D(0)).div(HUNDRED);
      const exact = source.amount.times(kept).times(taxPercent).div(HUNDRED);
      working.push(
        `    tax on this line = ${row.amount} x (1 - ${(discountPercent ?? new D(0)).toFixed()} / 100) x ${taxPercent.toFixed()} / 100 = ${exactText(exact)}, shown as ${plain(lineTax)}`,
      );
    }
  });
  if (rows.length > WORKING_LINES) {
    working.push(`  ... and ${rows.length - WORKING_LINES} more lines (the table shows them all)`);
  }
  working.push(`  subtotal = the sum of ${rows.length} line amounts = ${shown.subtotal}`);
  if (discountPercent !== null) {
    working.push(
      `  discount = ${shown.subtotal} x ${discountPercent.toFixed()} / 100 = ${exactText(totals.subtotal.times(discountPercent).div(HUNDRED))}, shown as ${shown.discount}`,
    );
  }
  if (taxPercent !== null) {
    working.push(
      rounding === 'total'
        ? `  tax = (${shown.subtotal} - ${shown.discount ?? plain(new D(0))}) x ${taxPercent.toFixed()} / 100 = ${exactText(totals.exactTax)}, shown as ${shown.tax}`
        : `  tax = the rounded line taxes added up = ${shown.tax} (the unrounded taxes add up to ${exactText(totals.exactTax)})`,
    );
  }
  working.push(
    `  total = ${shown.subtotal} - ${shown.discount ?? plain(new D(0))} + ${shown.tax ?? plain(new D(0))} = ${shown.total}`,
  );

  return {
    kind,
    totals: shown,
    rows,
    bytes,
    fileName: downloadName(kind, numberText),
    pages,
    working: working.join('\n'),
    notes: resultNotes,
  };
}
