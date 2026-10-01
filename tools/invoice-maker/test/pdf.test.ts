import { it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { assertWritable, buildInvoicePdf, downloadName, type InvoicePdfItem, type InvoicePdfModel } from '../src/pdf';
import { calculateInvoice } from '../src/index';
import { MoneyInputError } from '../src/money';

// pdfjs-dist runs its own "fake worker" loopback in plain Node; its shared message handler calls the standard
// `Promise.try`, which this project's Node floor does not yet ship. Test-only, never shipped in the package.
if (typeof (Promise as unknown as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> }).try =
    function promiseTryPolyfill(fn, ...args) {
      return new Promise((resolve) => resolve(fn(...args)));
    };
}

interface ReadItem {
  str: string;
  x: number;
  width: number;
}
interface ReadPage {
  width: number;
  height: number;
  items: ReadItem[];
  /** Everything on the page with all white space removed, in drawing order. */
  text: string;
}
interface ReadPdf {
  pages: ReadPage[];
  info: Record<string, unknown>;
}

/** Reads a PDF back with the independent pdfjs-dist reader. A fresh copy of the bytes every call (pdfjs detaches them). */
async function readPdf(bytes: Uint8Array): Promise<ReadPdf> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), useWorkerFetch: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: ReadPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: ReadItem[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      items.push({ str: item.str, x: item.transform[4] as number, width: item.width });
    }
    pages.push({
      width: viewport.width,
      height: viewport.height,
      items,
      text: items
        .map((i2) => i2.str)
        .join('')
        .replace(/\s+/g, ''),
    });
  }
  const metadata = await doc.getMetadata();
  await task.destroy();
  return { pages, info: metadata.info as Record<string, unknown> };
}

const squash = (s: string) => s.replace(/\s+/g, '');
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

const ITEMS: InvoicePdfItem[] = [
  { description: 'Widget', quantity: '2', unitPrice: '19.99', amount: '39.98' },
  { description: 'Setup', quantity: '1', unitPrice: '5.00', amount: '5.00' },
];
const MODEL: InvoicePdfModel = {
  kind: 'invoice',
  number: '2026-001',
  issueDate: '2026-10-01',
  dueDate: '2026-10-31',
  currency: 'USD',
  seller: ['Example Studio', '1 High Street'],
  buyer: ['Example Client', '2 Low Road'],
  items: ITEMS,
  totals: {
    subtotal: '44.98',
    discount: { percent: '10', amount: '4.50' },
    tax: { label: 'Tax', percent: '20', amount: '8.10' },
    total: '48.58',
  },
  notes: ['Thank you for your business'],
  paper: 'A4',
};
const withModel = (extra: Partial<InvoicePdfModel>): InvoicePdfModel => ({ ...MODEL, ...extra });

async function refusedBuild(model: InvoicePdfModel): Promise<MoneyInputError> {
  try {
    await buildInvoicePdf(model);
  } catch (err) {
    expect(err).toBeInstanceOf(MoneyInputError);
    return err as MoneyInputError;
  }
  throw new Error('expected a MoneyInputError but a PDF was produced');
}

// ISO 32000-1:2008, 7.5.2 File Header (fetched 2026-10-01): "The first line of a PDF file shall be a header consisting
// of the 5 characters %PDF - followed by a version number of the form 1.N, where N is a digit between 0 and 7."
// pdfjs-dist is an independent reader, so the library that wrote the file is never the only thing that reads it.
it('ISO 32000-1: the file starts with the PDF header and pdfjs-dist reads back the seller, buyer, every item and the total', async () => {
  const bytes = await buildInvoicePdf(MODEL);
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(latin1(bytes.slice(0, 5))).toBe('%PDF-');
  expect(latin1(bytes.slice(0, 8))).toMatch(/^%PDF-1\.[0-7]/);

  const read = await readPdf(bytes);
  expect(read.pages).toHaveLength(1);
  const text = read.pages[0]!.text;
  for (const wanted of [
    'Invoice2026-001',
    'Issuedate:2026-10-01',
    'Duedate:2026-10-31',
    'AmountsinUSD',
    'ExampleStudio',
    '1HighStreet',
    'ExampleClient',
    '2LowRoad',
    'Description',
    'Widget',
    'Setup',
    '39.98',
    '19.99',
    '44.98',
    'Discount(10%)',
    '4.50',
    'Tax(20%)',
    '8.10',
    '48.58',
    'Thankyouforyourbusiness',
    'Page1of1',
  ]) {
    expect(text, `the page should contain ${wanted}`).toContain(wanted);
  }
  // Paper sizes in points: A4 and US Letter.
  expect(read.pages[0]!.width).toBeCloseTo(595.28, 1);
  expect(read.pages[0]!.height).toBeCloseTo(841.89, 1);
  const letter = await readPdf(await buildInvoicePdf(withModel({ paper: 'Letter' })));
  expect([letter.pages[0]!.width, letter.pages[0]!.height]).toEqual([612, 792]);

  // The title says what it is, and no program name or date is stamped in.
  expect(read.info.Title).toBe('Invoice 2026-001');
  expect(read.info.Producer).toBeUndefined();
  expect(read.info.Creator).toBeUndefined();
  expect(read.info.CreationDate).toBeUndefined();

  // A quote reads as a quote, with valid-until wording, and optional parts left blank are left out.
  const quote = await readPdf(
    await buildInvoicePdf(
      withModel({
        kind: 'quote',
        dueDate: undefined,
        notes: [],
        totals: { subtotal: '44.98', total: '44.98' },
      }),
    ),
  );
  const quoteText = quote.pages[0]!.text;
  expect(quoteText).toContain('Quote2026-001');
  expect(quoteText).not.toContain('Validuntil');
  expect(quoteText).not.toContain('Notes');
  expect(quoteText).not.toContain('Discount');
  expect(quote.info.Title).toBe('Quote 2026-001');
  const dated = await readPdf(await buildInvoicePdf(withModel({ kind: 'quote' })));
  expect(dated.pages[0]!.text).toContain('Validuntil:2026-10-31');
});

// ISO 32000-1:2008 Annex D.2 "Latin Character Set and Encodings": the character set "shall be supported by the Times,
// Helvetica, and Courier font families", with an octal code for WinAnsiEncoding; characters without one are marked
// "unencoded". The installed library does not refuse such a character: it quietly writes a question mark instead, so
// this tool refuses first.
it('ISO 32000-1 Annex D WinAnsiEncoding: a character outside it is refused by name and code point before any PDF is written', async () => {
  const cjk = await refusedBuild(withModel({ seller: ['Example Studio', '日本 Studio'] }));
  expect(cjk.field).toBe('Your name and address');
  expect(cjk.message).toContain('日');
  expect(cjk.message).toContain('U+65E5');
  expect(cjk.message).toMatch(/WinAnsi/);
  expect([cjk.line, cjk.column]).toEqual([2, 1]);

  const arrow = await refusedBuild(withModel({ buyer: ['Example Client', 'Go → home'] }));
  expect(arrow.field).toBe('Customer name and address');
  expect(arrow.message).toContain('→');
  expect(arrow.message).toContain('U+2192');
  expect([arrow.line, arrow.column]).toEqual([2, 4]);

  // An emoji is one character above the first plane: named by its whole code point, not half of it.
  const emoji = await refusedBuild(withModel({ notes: ['Nice 😀'] }));
  expect(emoji.field).toBe('Notes');
  expect(emoji.message).toContain('U+1F600');
  expect(emoji.column).toBe(6);

  // An item description points at the line and column of the items box it came from.
  const item = await refusedBuild(
    withModel({
      items: [ITEMS[0]!, { ...ITEMS[1]!, description: 'Setup Ж', line: 3, column: 5 }],
    }),
  );
  expect(item.field).toBe('Line items');
  expect(item.message).toContain('U+0416');
  expect([item.line, item.column]).toEqual([3, 11]);

  // Every typed field is checked: the number, the tax name and the dates, not only the text boxes.
  expect((await refusedBuild(withModel({ number: 'Nº→1' }))).field).toBe('Invoice or quote number');
  expect(
    (
      await refusedBuild(
        withModel({ totals: { ...MODEL.totals, tax: { label: 'ТВ', percent: '20', amount: '8.10' } } }),
      )
    ).field,
  ).toBe('Tax name');

  // The same check on its own, with the character set the built-in font reports (218 code points).
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const charset = font.getCharacterSet();
  expect(charset.length).toBe(218);
  expect(() => assertWritable('Plain ASCII, € £ é “ ” – •', 'Notes', charset)).not.toThrow();
  const err = (() => {
    try {
      assertWritable('ab→cd', 'Notes', new Set(charset), { line: 7, column: 10 });
    } catch (e) {
      return e as MoneyInputError;
    }
    throw new Error('expected a refusal');
  })();
  expect(err).toBeInstanceOf(MoneyInputError);
  expect(err.field).toBe('Notes');
  expect([err.line, err.column]).toEqual([7, 12]);
});

it('the euro sign, pound sign, accented Latin letters and curly quotes are written, and a tab inside a cell is refused', async () => {
  const seller = ['Café Müller & Søn', 'Price: €5 or £4', 'He said “yes” and ‘maybe’ – ñ ç ß'];
  const bytes = await buildInvoicePdf(withModel({ seller }));
  const text = (await readPdf(bytes)).pages[0]!.text;
  for (const line of seller) expect(text).toContain(squash(line));
  // No question mark was put in the place of a letter.
  expect(text).not.toContain('?');

  const tab = await refusedBuild(
    withModel({ items: [{ ...ITEMS[0]!, description: 'Wid\tget', line: 1, column: 1 }, ITEMS[1]!] }),
  );
  expect(tab.field).toBe('Line items');
  expect(tab.message).toMatch(/tab/i);
  expect(tab.message).toContain('U+0009');
  expect([tab.line, tab.column]).toEqual([1, 4]);
  const inSeller = await refusedBuild(withModel({ seller: ['A\tB'] }));
  expect(inSeller.message).toContain('U+0009');
  // A line break inside one line is a control character too: lines are the caller's to split.
  expect((await refusedBuild(withModel({ buyer: ['A\nB'] }))).message).toContain('U+000A');
});

it('two builds of the same invoice are byte-identical', async () => {
  const a = await buildInvoicePdf(MODEL);
  const b = await buildInvoicePdf(MODEL);
  expect(a.length).toBe(b.length);
  expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  // No date, program name or font file is in the bytes.
  expect(latin1(a)).not.toMatch(/CreationDate|ModDate|Producer|Creator|pdf-lib|FontFile/);
  // A different invoice is a different file.
  const c = await buildInvoicePdf(withModel({ number: '2026-002' }));
  expect(Buffer.compare(Buffer.from(a), Buffer.from(c))).not.toBe(0);
  // The same through the page's entry point, whose figures and file come from one run.
  const texts = {
    number: '2026-001',
    issueDate: '2026-10-01',
    seller: 'Example Studio',
    buyer: 'Example Client',
    items: 'Widget | 2 | 19.99\nSetup | 1 | 5.00',
    discount: '10',
    taxRate: '20',
  };
  const r1 = await calculateInvoice(texts);
  const r2 = await calculateInvoice(texts);
  expect(Buffer.compare(Buffer.from(r1!.bytes), Buffer.from(r2!.bytes))).toBe(0);
});

it('200 items spread over several pages with every line present, and 201 are refused', async () => {
  const many: InvoicePdfItem[] = Array.from({ length: 200 }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return { description: `Item${n}`, quantity: '1', unitPrice: '1.00', amount: '1.00' };
  });
  const bytes = await buildInvoicePdf(withModel({ items: many }));
  const read = await readPdf(bytes);
  expect(read.pages.length).toBeGreaterThanOrEqual(5);
  const all = read.pages.map((p) => p.text).join('');
  for (const item of many) expect(all, item.description).toContain(item.description);
  // In the order typed, each once.
  const positions = many.map((m) => all.indexOf(m.description));
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(all.split('Item001').length).toBe(2);
  // Every page says where it is, and a page that carries rows repeats the table heading.
  read.pages.forEach((p, i) => {
    expect(p.text).toContain(`Page${i + 1}of${read.pages.length}`);
    if (i > 0) expect(p.text).toContain('DescriptionQty');
  });
  // The totals come after the last row, on the last page.
  expect(read.pages[read.pages.length - 1]!.text).toContain('48.58');

  const tooMany = await refusedBuild(
    withModel({ items: [...many, { description: 'One too many', quantity: '1', unitPrice: '1.00', amount: '1.00' }] }),
  );
  expect(tooMany.field).toBe('Line items');
  expect(tooMany.message).toMatch(/at most 200/);
});

it('a row that does not fit at the foot of a page moves whole to the next page', async () => {
  const long = (i: number) => `Row${i} ${'lorem ipsum dolor sit amet '.repeat(6)}end${i}`;
  const rows: InvoicePdfItem[] = Array.from({ length: 40 }, (_, i) => ({
    description: long(i + 1),
    quantity: '1',
    unitPrice: '1.00',
    amount: '1.00',
  }));
  const read = await readPdf(await buildInvoicePdf(withModel({ items: rows })));
  expect(read.pages.length).toBeGreaterThanOrEqual(3);
  for (const row of rows) {
    const whole = squash(row.description);
    const holders = read.pages.filter((p) => p.text.includes(whole));
    expect(holders, `${row.description.slice(0, 8)} should sit whole on one page`).toHaveLength(1);
  }
});

it('a 400-character word is broken across lines and stays inside the page', async () => {
  const word = 'ABCDEFGHIJ'.repeat(40);
  expect(word).toHaveLength(400);
  const bytes = await buildInvoicePdf(
    withModel({
      items: [{ description: word, quantity: '1', unitPrice: '1.00', amount: '1.00' }, ITEMS[1]!],
      seller: ['Example Studio', word],
      notes: [word],
    }),
  );
  const read = await readPdf(bytes);
  const all = read.pages.map((p) => p.text).join('');
  // The word is all there, in order, three times (item, seller and notes), and none of it was dropped.
  expect(all.split(word).length - 1).toBe(3);
  // Every piece of it sits inside the page's side margins.
  let pieces = 0;
  for (const page of read.pages) {
    for (const item of page.items) {
      if (!/^[A-J]{5,}$/.test(item.str)) continue;
      pieces++;
      expect(item.x).toBeGreaterThanOrEqual(49);
      expect(item.x + item.width).toBeLessThanOrEqual(page.width - 49);
    }
  }
  expect(pieces).toBeGreaterThan(3);
});

it('items keep the order typed in the file and identical lines stay separate lines', async () => {
  const same = { description: 'Same', quantity: '1', unitPrice: '2.50', amount: '2.50' };
  const read = await readPdf(
    await buildInvoicePdf(
      withModel({
        items: [{ ...same, description: 'Zed' }, { ...same }, { ...same }, { ...same, description: 'Alpha' }],
      }),
    ),
  );
  const text = read.pages[0]!.text;
  const rows = [...text.matchAll(/Zed|Same|Alpha/g)].map((m) => m[0]);
  expect(rows).toEqual(['Zed', 'Same', 'Same', 'Alpha']);
});

it('amounts are written as plain digits with grouping and the currency as a code, so a symbol outside the fonts never blocks a file', async () => {
  const result = await calculateInvoice({
    number: 'INR-1',
    issueDate: '2026-10-01',
    seller: 'Example Studio',
    buyer: 'Example Client',
    items: 'Big job | 2 | 617250.25\nSmall job | 1.5 | 10',
    currency: 'INR',
    taxRate: '18',
  });
  expect(result).not.toBeNull();
  const text = (await readPdf(result!.bytes)).pages[0]!.text;
  expect(text).toContain('AmountsinINR');
  expect(text).toContain('1,234,500.50');
  expect(text).toContain('617,250.25');
  expect(text).not.toContain('₹');
  expect(text).not.toContain('?');
  // Every figure on the page and in the file is the same one.
  expect(text).toContain(result!.totals.total.replace(/(\d)(?=(\d{3})+\.)/g, '$1,'));
});

it('the download name keeps only letters, digits, dots, dashes and underscores from the invoice number', () => {
  expect(downloadName('invoice', '2026-001')).toBe('invoice-2026-001.pdf');
  expect(downloadName('quote', 'Q_7.v2')).toBe('quote-Q_7.v2.pdf');
  expect(downloadName('invoice', '../../etc/passwd')).toBe('invoice-....etcpasswd.pdf');
  expect(downloadName('invoice', 'a b/c\\d:e*f?g"h<i>j|k')).toBe('invoice-abcdefghijk.pdf');
  expect(downloadName('invoice', '1\r\nSet-Cookie: x')).toBe('invoice-1Set-Cookiex.pdf');
  expect(downloadName('invoice', 'Café')).toBe('invoice-Caf.pdf');
  // Nothing left: the plain name.
  expect(downloadName('invoice', '日本 /\\ ?')).toBe('invoice.pdf');
  expect(downloadName('quote', '')).toBe('quote.pdf');
  for (const number of ['x/y', '..\\..', 'a\u0000b', '%00', ' ', '"quoted"', 'тест']) {
    expect(downloadName('invoice', number)).toMatch(/^(invoice|quote)(-[A-Za-z0-9._-]+)?\.pdf$/);
  }
});
