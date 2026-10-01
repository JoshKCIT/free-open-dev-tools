import { PDFDocument, StandardFonts, PageSizes, rgb, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { MoneyInputError } from './money';

/**
 * Writes an invoice or quote as a PDF with the fonts built into every PDF reader (Helvetica, no font file), so the
 * file is small and the same input always gives the same bytes: no date and no program name is stamped into it.
 *
 * The installed PDF library does not refuse a character those fonts cannot write (ISO 32000-1 Annex D,
 * WinAnsiEncoding): it quietly writes a question mark in its place. So every string is checked against the font's own
 * character set first, before anything is drawn, and refused with the character, its code point and the field.
 *
 * Layout is plain arithmetic on point positions; money amounts arrive here already as text.
 */

/** The labels of the fields that reach the PDF, as the page names them in a message. */
export const FIELD_NUMBER = 'Invoice or quote number';
export const FIELD_ISSUE = 'Issue date';
export const FIELD_DUE = 'Due date or valid until';
export const FIELD_SELLER = 'Your name and address';
export const FIELD_BUYER = 'Customer name and address';
export const FIELD_ITEMS = 'Line items';
export const FIELD_NOTES = 'Notes';
export const FIELD_TAX_LABEL = 'Tax name';
const FIELD_CURRENCY = 'Currency (ISO 4217 code)';

/** The most line items a PDF is built with. */
export const MAX_PDF_ITEMS = 200;

export type DocumentKind = 'invoice' | 'quote';
export type PaperSize = 'A4' | 'Letter';

/** One table row, every figure already text: grouped digits, no currency symbol. */
export interface InvoicePdfItem {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  /** Where the description was typed in the line items box, so a refused character can point at it. */
  line?: number;
  column?: number;
}

export interface InvoicePdfTotals {
  subtotal: string;
  /** Left out when no discount was typed. `amount` is shown with a minus sign. */
  discount?: { percent: string; amount: string };
  /** Left out when no tax rate was typed. `label` is the typed tax name. */
  tax?: { label: string; percent: string; amount: string };
  total: string;
}

export interface InvoicePdfModel {
  kind: DocumentKind;
  number: string;
  /** ISO date text, YYYY-MM-DD. */
  issueDate: string;
  /** ISO date text; the due date of an invoice or the valid-until date of a quote. Left out when blank. */
  dueDate?: string | undefined;
  /** An ISO 4217 code, written once in the heading block; the amounts are plain digits. */
  currency: string;
  /** One entry per typed line. */
  seller: string[];
  buyer: string[];
  items: InvoicePdfItem[];
  totals: InvoicePdfTotals;
  notes: string[];
  paper: PaperSize;
}

export interface RenderedInvoice {
  bytes: Uint8Array;
  pages: number;
}

// Layout, in points (1/72 inch).
const MARGIN = 50;
const BODY = 10;
const SMALL = 9;
const TITLE = 20;
const LEADING = 14;
const TITLE_LEADING = 24;
const ROW_PAD = 6;
const COLUMN_GAP = 12;
const MIN_DESCRIPTION_WIDTH = 100;
const FOOTER_Y = 28;
const BOTTOM = MARGIN + 6;

const KIND_LABEL: Record<DocumentKind, string> = { invoice: 'Invoice', quote: 'Quote' };
const DUE_LABEL: Record<DocumentKind, string> = { invoice: 'Due date', quote: 'Valid until' };
const TO_LABEL: Record<DocumentKind, string> = { invoice: 'Bill to', quote: 'Prepared for' };

function codePointText(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function describeCharacter(ch: string, cp: number): string {
  const code = codePointText(cp);
  if (cp === 9) return `a tab (${code})`;
  if (cp === 10) return `a line break (${code})`;
  if (cp === 13) return `a carriage return (${code})`;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return `the control character ${code}`;
  return `the character "${ch}" (${code})`;
}

/**
 * Refuses text the PDF's built-in fonts cannot write. `charset` is the font's own list of code points
 * (`PDFFont.getCharacterSet()`). The first character outside it is named with its code point; `position` is where the
 * text starts (line and column of a text box), so the error can point at the character itself.
 */
export function assertWritable(
  text: string,
  field: string,
  charset: readonly number[] | ReadonlySet<number>,
  position?: { line: number; column: number },
): void {
  const allowed: ReadonlySet<number> = charset instanceof Set ? charset : new Set(charset);
  let index = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!allowed.has(cp)) {
      throw new MoneyInputError(
        field,
        `${describeCharacter(ch, cp)} cannot be written: the PDF's built-in fonts (WinAnsiEncoding, ISO 32000-1 Annex D) do not include it. Remove it or replace it with a character they do include.`,
        position ? { line: position.line, column: position.column + index } : undefined,
      );
    }
    index += ch.length;
  }
}

/**
 * The file name offered for the download: `invoice-<number>.pdf` or `quote-<number>.pdf`, keeping only ASCII letters,
 * digits, dots, dashes and underscores of the number, or `invoice.pdf` / `quote.pdf` when nothing is left.
 */
export function downloadName(kind: DocumentKind, number: string): string {
  const kept = number.replace(/[^A-Za-z0-9._-]/g, '');
  return kept === '' ? `${kind}.pdf` : `${kind}-${kept}.pdf`;
}

/**
 * Breaks one line of text into lines no wider than `maxWidth`, at spaces. A word wider than a line is broken between
 * characters. Runs of spaces inside a line are kept; spaces at a break are dropped. No other character is lost.
 */
function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (text === '') return [''];
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  const lines: string[] = [];
  let current = '';

  for (const token of text.split(/( +)/)) {
    if (token === '') continue;
    if (token.startsWith(' ')) {
      if (current === '' && lines.length > 0) continue;
      if (width(current + token) <= maxWidth) {
        current += token;
      } else {
        if (current.trim() !== '') lines.push(current.trimEnd());
        current = '';
      }
      continue;
    }
    if (width(current + token) <= maxWidth) {
      current += token;
      continue;
    }
    if (current.trim() !== '') lines.push(current.trimEnd());
    current = '';
    if (width(token) <= maxWidth) {
      current = token;
      continue;
    }
    let piece = '';
    for (const ch of token) {
      if (piece !== '' && width(piece + ch) > maxWidth) {
        lines.push(piece);
        piece = '';
      }
      piece += ch;
    }
    current = piece;
  }
  if (current !== '') lines.push(current.trimEnd());
  return lines.length > 0 ? lines : [''];
}

/** Checks every typed string of the model against the character set before anything is drawn. */
function validateModel(model: InvoicePdfModel, charset: ReadonlySet<number>): void {
  assertWritable(model.number, FIELD_NUMBER, charset);
  assertWritable(model.issueDate, FIELD_ISSUE, charset);
  if (model.dueDate !== undefined) assertWritable(model.dueDate, FIELD_DUE, charset);
  assertWritable(model.currency, FIELD_CURRENCY, charset);
  const lines = (field: string, texts: readonly string[]) =>
    texts.forEach((text, i) => assertWritable(text, field, charset, { line: i + 1, column: 1 }));
  lines(FIELD_SELLER, model.seller);
  lines(FIELD_BUYER, model.buyer);
  for (const item of model.items) {
    const position = item.line === undefined ? undefined : { line: item.line, column: item.column ?? 1 };
    assertWritable(item.description, FIELD_ITEMS, charset, position);
    assertWritable(item.quantity, FIELD_ITEMS, charset);
    assertWritable(item.unitPrice, FIELD_ITEMS, charset);
    assertWritable(item.amount, FIELD_ITEMS, charset);
  }
  const { totals } = model;
  assertWritable(totals.subtotal, FIELD_ITEMS, charset);
  if (totals.discount) {
    assertWritable(totals.discount.percent, FIELD_ITEMS, charset);
    assertWritable(totals.discount.amount, FIELD_ITEMS, charset);
  }
  if (totals.tax) {
    assertWritable(totals.tax.label, FIELD_TAX_LABEL, charset);
    assertWritable(totals.tax.percent, FIELD_ITEMS, charset);
    assertWritable(totals.tax.amount, FIELD_ITEMS, charset);
  }
  assertWritable(totals.total, FIELD_ITEMS, charset);
  lines(FIELD_NOTES, model.notes);
}

const isZeroText = (amount: string) => /^0(\.0+)?$/.test(amount);

/** Builds the PDF and reports how many pages it has. Refuses unwritable text before any page is drawn. */
export async function renderInvoicePdf(model: InvoicePdfModel): Promise<RenderedInvoice> {
  if (model.items.length === 0) {
    throw new MoneyInputError(FIELD_ITEMS, 'missing, type at least one line such as Widget | 2 | 19.99');
  }
  if (model.items.length > MAX_PDF_ITEMS) {
    throw new MoneyInputError(FIELD_ITEMS, `at most ${MAX_PDF_ITEMS} rows are accepted, this has more`);
  }

  // No creation or modification date and no producer or creator: two builds of one invoice are the same bytes.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const boldSet = new Set(bold.getCharacterSet());
  const charset: ReadonlySet<number> = new Set(regular.getCharacterSet().filter((cp) => boldSet.has(cp)));

  validateModel(model, charset);

  const { kind } = model;
  doc.setTitle(`${KIND_LABEL[kind]} ${model.number}`);

  const [pageWidth, pageHeight] = model.paper === 'Letter' ? PageSizes.Letter : PageSizes.A4;
  const contentWidth = pageWidth - 2 * MARGIN;
  const rightEdge = pageWidth - MARGIN;
  const pages: PDFPage[] = [];
  let page: PDFPage = doc.addPage([pageWidth, pageHeight]);
  pages.push(page);
  let y = pageHeight - MARGIN;

  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    pages.push(page);
    y = pageHeight - MARGIN;
  };
  /** Starts a new page when `height` points do not fit above the bottom margin. */
  const ensure = (height: number) => {
    if (y - height < BOTTOM) newPage();
  };
  const widthOf = (text: string, font: PDFFont, size: number) => font.widthOfTextAtSize(text, size);
  /** Every string that reaches the page goes through the same check first, so nothing is ever drawn as a question mark. */
  const put = (target: PDFPage, text: string, x: number, baseline: number, size: number, font: PDFFont) => {
    if (text === '') return;
    assertWritable(text, 'PDF text', charset);
    target.drawText(text, { x, y: baseline, size, font });
  };
  /** One line of text at the cursor; the cursor moves down by `leading`. */
  const line = (text: string, font: PDFFont, size: number, leading: number) => {
    ensure(leading);
    put(page, text, MARGIN, y - size, size, font);
    y -= leading;
  };
  /** A paragraph of typed lines: each wraps inside the page, a blank typed line stays a blank line. */
  const block = (texts: readonly string[], font: PDFFont, size: number, leading: number) => {
    for (const text of texts) {
      for (const part of wrapLine(text, font, size, contentWidth)) line(part, font, size, leading);
    }
  };
  const gap = (height: number) => {
    y -= height;
  };

  // Heading.
  for (const part of wrapLine(`${KIND_LABEL[kind]} ${model.number}`, bold, TITLE, contentWidth)) {
    line(part, bold, TITLE, TITLE_LEADING);
  }
  gap(4);
  line(`Issue date: ${model.issueDate}`, regular, BODY, LEADING);
  if (model.dueDate !== undefined && model.dueDate !== '') {
    line(`${DUE_LABEL[kind]}: ${model.dueDate}`, regular, BODY, LEADING);
  }
  line(`Amounts in ${model.currency}`, regular, BODY, LEADING);
  gap(10);
  line('From', bold, BODY, LEADING);
  block(model.seller, regular, BODY, LEADING);
  gap(10);
  line(TO_LABEL[kind], bold, BODY, LEADING);
  block(model.buyer, regular, BODY, LEADING);
  gap(16);

  // Items table. The three number columns are as wide as their widest figure; the description takes the rest.
  const columnWidth = (heading: string, values: readonly string[]) =>
    Math.max(widthOf(heading, bold, BODY), ...values.map((v) => widthOf(v, regular, BODY)));
  const quantityWidth = columnWidth(
    'Qty',
    model.items.map((i) => i.quantity),
  );
  const priceWidth = columnWidth(
    'Unit price',
    model.items.map((i) => i.unitPrice),
  );
  const amountWidth = columnWidth(
    'Amount',
    model.items.map((i) => i.amount),
  );
  const descriptionWidth = contentWidth - quantityWidth - priceWidth - amountWidth - 3 * COLUMN_GAP;
  if (descriptionWidth < MIN_DESCRIPTION_WIDTH) {
    throw new MoneyInputError(FIELD_ITEMS, 'the quantities and amounts are too wide to fit on the page');
  }
  const quantityRight = MARGIN + descriptionWidth + COLUMN_GAP + quantityWidth;
  const priceRight = quantityRight + COLUMN_GAP + priceWidth;
  const amountRight = rightEdge;

  const headerHeight = LEADING + 4;
  const drawHeader = () => {
    const baseline = y - BODY;
    put(page, 'Description', MARGIN, baseline, BODY, bold);
    put(page, 'Qty', quantityRight - widthOf('Qty', bold, BODY), baseline, BODY, bold);
    put(page, 'Unit price', priceRight - widthOf('Unit price', bold, BODY), baseline, BODY, bold);
    put(page, 'Amount', amountRight - widthOf('Amount', bold, BODY), baseline, BODY, bold);
    page.drawLine({
      start: { x: MARGIN, y: y - LEADING },
      end: { x: rightEdge, y: y - LEADING },
      thickness: 0.8,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= headerHeight;
  };

  const wrapped = model.items.map((item) => wrapLine(item.description, regular, BODY, descriptionWidth));
  const rowHeightOf = (index: number) => (wrapped[index]?.length ?? 1) * LEADING + ROW_PAD;
  ensure(headerHeight + rowHeightOf(0));
  drawHeader();
  model.items.forEach((item, index) => {
    const rowHeight = rowHeightOf(index);
    // A row never splits: when it does not fit it moves whole to the next page, under a repeated heading.
    if (y - rowHeight < BOTTOM) {
      newPage();
      drawHeader();
    }
    const lines = wrapped[index] ?? [''];
    // Description lines first, then the figures, so the lines of a description stay together in the file.
    lines.forEach((part, i) => put(page, part, MARGIN, y - BODY - i * LEADING, BODY, regular));
    const baseline = y - BODY;
    put(page, item.quantity, quantityRight - widthOf(item.quantity, regular, BODY), baseline, BODY, regular);
    put(page, item.unitPrice, priceRight - widthOf(item.unitPrice, regular, BODY), baseline, BODY, regular);
    put(page, item.amount, amountRight - widthOf(item.amount, regular, BODY), baseline, BODY, regular);
    y -= rowHeight;
    page.drawLine({
      start: { x: MARGIN, y: y + ROW_PAD / 2 },
      end: { x: rightEdge, y: y + ROW_PAD / 2 },
      thickness: 0.4,
      color: rgb(0.85, 0.85, 0.85),
    });
  });

  // Totals, kept together at the right.
  const { totals } = model;
  const totalRows: { label: string; value: string; strong: boolean }[] = [
    { label: 'Subtotal', value: totals.subtotal, strong: false },
  ];
  if (totals.discount) {
    const shown = isZeroText(totals.discount.amount) ? totals.discount.amount : `-${totals.discount.amount}`;
    totalRows.push({ label: `Discount (${totals.discount.percent} %)`, value: shown, strong: false });
  }
  if (totals.tax) {
    totalRows.push({ label: `${totals.tax.label} (${totals.tax.percent} %)`, value: totals.tax.amount, strong: false });
  }
  totalRows.push({ label: 'Total', value: totals.total, strong: true });
  const valueWidth = Math.max(...totalRows.map((r) => widthOf(r.value, r.strong ? bold : regular, BODY)));
  const labelRight = rightEdge - valueWidth - 16;
  gap(8);
  ensure(totalRows.length * LEADING + 8);
  for (const row of totalRows) {
    const font = row.strong ? bold : regular;
    if (row.strong) {
      page.drawLine({
        start: { x: labelRight - 120, y: y - 1 },
        end: { x: rightEdge, y: y - 1 },
        thickness: 0.8,
        color: rgb(0.2, 0.2, 0.2),
      });
      gap(3);
    }
    const baseline = y - BODY;
    put(page, row.label, labelRight - widthOf(row.label, font, BODY), baseline, BODY, font);
    put(page, row.value, rightEdge - widthOf(row.value, font, BODY), baseline, BODY, font);
    y -= LEADING;
  }

  // Notes.
  if (model.notes.some((n) => n.trim() !== '')) {
    gap(14);
    ensure(2 * LEADING);
    line('Notes', bold, BODY, LEADING);
    block(model.notes, regular, BODY, LEADING);
  }

  // Page N of M on every page, drawn last because the count is only known now.
  pages.forEach((target, index) => {
    const text = `Page ${index + 1} of ${pages.length}`;
    put(target, text, (pageWidth - widthOf(text, regular, SMALL)) / 2, FOOTER_Y, SMALL, regular);
  });

  return { bytes: await doc.save(), pages: pages.length };
}

/** Builds the PDF. Text the built-in fonts cannot write is refused before any file is produced. */
export async function buildInvoicePdf(model: InvoicePdfModel): Promise<Uint8Array> {
  return (await renderInvoicePdf(model)).bytes;
}
