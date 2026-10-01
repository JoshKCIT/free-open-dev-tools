import { it, expect } from 'vitest';
import {
  addTax,
  calculateSalesTax,
  extractTax,
  meta,
  parseAmountLines,
  parseTaxComponents,
  vatFraction,
  type SalesTaxTexts,
} from '../src/index';
import { D, MoneyInputError } from '../src/money';

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

const calc = (texts: SalesTaxTexts) => {
  const result = calculateSalesTax({ currency: 'USD', ...texts });
  expect(result).not.toBeNull();
  return result!;
};
const add = (lines: string, rates: string, rounding = 'total', currency = 'USD') =>
  calc({ mode: 'add', lines, rates, rounding, currency });
const extract = (lines: string, rates: string, rounding = 'total', currency = 'USD') =>
  calc({ mode: 'extract', lines, rates, rounding, currency });
const lines = (text: string, currency = 'USD') => parseAmountLines(text, currency);
const rates = (text: string) => parseTaxComponents(text);

it('meta: id, name, dependency pin, the required sentences in limits and the HMRC citation', () => {
  expect(meta.id).toBe('sales-tax');
  expect(meta.name).toBe('Sales Tax, VAT & GST Calculator');
  expect(meta.dependencies['decimal.js']).toBe('10.6.0');
  expect(meta.limits.length).toBeGreaterThanOrEqual(3);
  expect(meta.limits.some((l: string) => /half away from zero/i.test(l))).toBe(true);
  expect(meta.limits.some((l: string) => /not financial, tax or legal advice; it ignores /i.test(l))).toBe(true);
  // The page never says which rate or rounding rule is correct for a place: the visitor checks (prohibition P10-06).
  expect(meta.limits.some((l: string) => /yours to check/i.test(l) && /never says which is correct/i.test(l))).toBe(
    true,
  );
  expect(meta.limits.some((l: string) => /No tax rates or tax tables are built in/i.test(l))).toBe(true);
  expect(meta.standards.map((s: { url: string }) => s.url)).toContain(
    'https://www.gov.uk/guidance/vat-guide-notice-700',
  );
});

it('the usage example in meta.json shows what the code returns', () => {
  const { summary } = extract('2.40', 'VAT | 20', 'total', 'GBP');
  expect(summary.totals.tax).toBe('0.40');
  expect(summary.totals.net).toBe('2.00');
  expect(summary.fraction).toBe('1/6');
  expect(meta.usage).toContain("result.summary.totals.tax; // '0.40'");
  expect(meta.usage).toContain("result.summary.totals.net; // '2.00'");
  expect(meta.usage).toContain("result.summary.fraction; // '1/6'");
});

// HMRC VAT Notice 700, https://www.gov.uk/guidance/vat-guide-notice-700 , fetched. Section 7.3.1 VAT fractions: "For
// example, if you sell something for £2.40 and the VAT rate is 20%, then the amount of VAT is 40 pence." "But, 40 pence
// is not 20% of £2.40. It is one-sixth of £2.40. This is because here, VAT is already included in the price." "This is
// how it's worked out: rate of tax divided by (100 + rate of tax)." "So, with VAT at 20% the VAT fraction is: 20/120
// (twenty one hundred and twentieths), which is the same as one-sixth."
it('HMRC VAT Notice 700 section 7.3.1: 2.40 including VAT at 20 percent contains 0.40 of VAT, one-sixth', () => {
  const direct = extractTax(lines('2.40', 'GBP'), rates('VAT | 20'), 'total', 'GBP');
  expect(direct.totals.tax.toString()).toBe('0.4');
  expect(direct.totals.net.toString()).toBe('2');
  expect(direct.totals.gross.toString()).toBe('2.4');
  const result = extract('2.40', 'VAT | 20', 'total', 'GBP');
  expect(result.summary.rows).toHaveLength(1);
  expect(result.summary.rows[0]).toMatchObject({
    line: 1,
    description: '',
    net: '2.00',
    taxes: ['0.40'],
    gross: '2.40',
  });
  expect(result.summary.totals).toMatchObject({ net: '2.00', taxes: ['0.40'], tax: '0.40', gross: '2.40' });
  expect(result.summary.fraction).toBe('1/6');
  expect(result.working).toContain('HMRC VAT Notice 700 section 7.3.1');
  expect(result.working).toContain('VAT fraction = rate / (100 + rate)');
  expect(result.working).toContain('20 / (100 + 20) = 1/6');
  expect(result.working).toContain('2.4 x 20 / 120 = 0.4');
  // The VAT inside 2.40 is not 20 percent of 2.40, which would be 0.48.
  expect(add('2.40', 'VAT | 20', 'total', 'GBP').summary.totals.tax).toBe('0.48');
});

// HMRC VAT Notice 700 section 7.3.1 table of VAT fractions, fetched: 5% 1/21 (one twenty-first); 8% 2/27 (two
// twenty-sevenths); 10% 1/11 (one eleventh); 12.5% 1/9 (one nineth); 15% 3/23 (three twenty-thirds); 17.5% 7/47 (seven
// forty-sevenths); 20% 1/6 (one-sixth); 25% 1/5 (one-fifth). By hand 12.5 / 112.5 = 125 / 1125 = 1/9.
it('HMRC VAT Notice 700 section 7.3.1 VAT fractions: 5 is 1/21, 8 is 2/27, 10 is 1/11, 12.5 is 1/9, 15 is 3/23, 17.5 is 7/47, 20 is 1/6 and 25 is 1/5', () => {
  const table: [string, string][] = [
    ['5', '1/21'],
    ['8', '2/27'],
    ['10', '1/11'],
    ['12.5', '1/9'],
    ['15', '3/23'],
    ['17.5', '7/47'],
    ['20', '1/6'],
    ['25', '1/5'],
  ];
  for (const [rate, fraction] of table) expect(vatFraction(new D(rate))).toBe(fraction);
  // Other rates reduce the same way: 0 is nothing, 100 is a half, 6.25 is 25/425 = 1/17.
  expect(vatFraction(new D(0))).toBe('0/1');
  expect(vatFraction(new D(100))).toBe('1/2');
  expect(vatFraction(new D('6.25'))).toBe('1/17');
  expect(vatFraction(new D('7.5'))).toBe('3/43');
  // Several components have no single fraction on the page.
  expect(extract('10.00', 'State | 6.25\nCity | 2').summary.fraction).toBeNull();
  expect(add('10.00', 'VAT | 20').summary.fraction).toBeNull();
});

// HMRC VAT Notice 700 section 17.5.1, fetched: "If you want to work out the VAT separately for a line of goods or
// services ... you should calculate the separate amounts of VAT by rounding in one of the following ways: down to the
// nearest 0.1 pence - for example, 86.76 pence would be rounded down to 86.7 pence; to the nearest 1 pence or 0.5 pence -
// for example, 86.76 pence would be rounded up to 87 pence". This tool rounds to the nearest 1 pence. A net of 43.38 at
// a rate of 2 percent has line VAT of exactly 43.38 x 0.02 = 0.8676 pounds, 86.76 pence.
it('HMRC VAT Notice 700 section 17.5: line VAT of 86.76 pence rounds to 87 pence', () => {
  for (const rounding of ['line', 'total'] as const) {
    const r = addTax(lines('43.38', 'GBP'), rates('VAT | 2'), rounding, 'GBP');
    expect(r.rows[0]!.taxes[0]!.toString()).toBe('0.87');
    expect(r.totals.tax.toString()).toBe('0.87');
    expect(r.totals.gross.toString()).toBe('44.25');
  }
  const result = add('43.38', 'VAT | 2', 'line', 'GBP');
  expect(result.summary.rows[0]!.taxes).toEqual(['0.87']);
  expect(result.working).toContain('43.38 x 2 / 100 = 0.8676');
  expect(result.working).toContain('rounded half away from zero to 2 decimal places');
  // A line that rounds to exactly half a minor unit goes away from zero: 0.05 at 10 percent is 0.005, so 0.01.
  expect(add('0.05', 'Tax | 10', 'line').summary.totals.tax).toBe('0.01');
  expect(add('0.05', 'Tax | 10', 'total').summary.totals.tax).toBe('0.01');
});

// By hand: three lines of 0.05 at 10 percent have an exact tax of 0.005 each. Rounded per line each is 0.01 (half away
// from zero) and the total is 0.03. On the total the exact taxes add up to 0.015, rounded once to 0.02.
it('rounding per line and on the total differ: three lines of 0.05 at 10 give 0.03 per line and 0.02 on the total', () => {
  const text = '0.05\n0.05\n0.05';
  const perLine = add(text, 'Tax | 10', 'line');
  expect(perLine.summary.rows.map((r) => r.taxes[0])).toEqual(['0.01', '0.01', '0.01']);
  expect(perLine.summary.totals).toMatchObject({ net: '0.15', tax: '0.03', gross: '0.18' });
  const onTotal = add(text, 'Tax | 10', 'total');
  expect(onTotal.summary.totals).toMatchObject({ net: '0.15', tax: '0.02', gross: '0.17' });
  // The lines shown are each rounded for display; the note says the lines may not add up to the total.
  expect(onTotal.summary.rows.map((r) => r.taxes[0])).toEqual(['0.01', '0.01', '0.01']);
  expect(onTotal.summary.notes.join(' ')).toContain('may not add up to the total');
  expect(perLine.summary.notes.join(' ')).not.toContain('may not add up to the total');
  expect(onTotal.working).toContain('rounded once');
  expect(perLine.working).toContain('each line');
  // The default is the total.
  expect(calc({ mode: 'add', lines: text, rates: 'Tax | 10' }).summary.rounding).toBe('total');
  expect(calc({ mode: 'add', lines: text, rates: 'Tax | 10' }).summary.totals.tax).toBe('0.02');
  // Taking tax out of 0.05 three times at 10 percent: 0.05 x 10 / 110 = 0.004545 per line, so 0.00 per line and 0.00 in
  // all, but 0.15 x 10 / 110 = 0.013636 on the total, so 0.01.
  const takeLine = extract(text, 'Tax | 10', 'line');
  expect(takeLine.summary.totals).toMatchObject({ net: '0.15', tax: '0.00', gross: '0.15' });
  const takeTotal = extract(text, 'Tax | 10', 'total');
  expect(takeTotal.summary.totals).toMatchObject({ net: '0.14', tax: '0.01', gross: '0.15' });
  // On every line, net plus tax equals gross exactly, in both modes.
  for (const r of [takeLine, takeTotal]) {
    for (const row of r.summary.rows) {
      const sum = new D(row.net).plus(row.taxes.reduce((a, t) => a.plus(t), new D(0)));
      expect(sum.eq(row.gross)).toBe(true);
    }
  }
});

// By hand: a state tax of 6.25 percent and a city tax of 2 percent each apply to the net 100: 6.25 and 2.00, gross
// 108.25. They are not compounded (that would be 100 x 1.0625 x 1.02 = 108.375). To take them out of 108.25, the rates
// added together are R = 8.25, the tax is 108.25 x 8.25 / 108.25 = 8.25, the net is 108.25 / 1.0825 = 100, and each
// component's share is 100 x rate / 100.
it('several tax components each apply to the net amount and extraction divides by one plus their sum', () => {
  const rows = 'State | 6.25\nCity | 2';
  const added = add('100', rows);
  expect(added.summary.components.map((c) => c.name)).toEqual(['State', 'City']);
  expect(added.summary.rows[0]!.taxes).toEqual(['6.25', '2.00']);
  expect(added.summary.totals).toMatchObject({ net: '100.00', taxes: ['6.25', '2.00'], tax: '8.25', gross: '108.25' });
  const taken = extract('108.25', rows);
  expect(taken.summary.rows[0]).toMatchObject({ net: '100.00', taxes: ['6.25', '2.00'], gross: '108.25' });
  expect(taken.summary.totals).toMatchObject({ net: '100.00', taxes: ['6.25', '2.00'], tax: '8.25', gross: '108.25' });
  expect(taken.working).toContain('R = 6.25 + 2 = 8.25');
  expect(taken.working).toContain('tax inside a gross amount = gross x R / (100 + R)');
  expect(taken.working).toContain('net = gross / (1 + R / 100)');
  expect(added.working).toContain('each component applies to the net amount');
  // The same through the exported functions, with exact values.
  const r = extractTax(lines('108.25'), rates(rows), 'line', 'USD');
  expect(r.totals.net.toString()).toBe('100');
  expect(r.totals.tax.toString()).toBe('8.25');
  // Several lines and a description: net and tax add across lines.
  const many = add('Coffee | 3.50\nCake | 4.25', rows);
  expect(many.summary.rows.map((x) => x.description)).toEqual(['Coffee', 'Cake']);
  expect(many.summary.totals.net).toBe('7.75');
  // 7.75 x 6.25 / 100 = 0.484375 -> 0.48, 7.75 x 2 / 100 = 0.155 -> 0.16 (half away from zero), tax 0.64.
  expect(many.summary.totals.taxes).toEqual(['0.48', '0.16']);
  expect(many.summary.totals.tax).toBe('0.64');
  expect(many.summary.totals.gross).toBe('8.39');
  // A single unnamed rate is called Tax; several unnamed ones are numbered.
  expect(rates('20').map((c) => c.name)).toEqual(['Tax']);
  expect(rates('5\n2').map((c) => c.name)).toEqual(['Tax 1', 'Tax 2']);
  // A rate of 0 gives no tax.
  expect(add('100', 'Zero | 0').summary.totals).toMatchObject({ tax: '0.00', gross: '100.00' });
});

// HMRC VAT Notice 700 section 17.5, fetched: "You may round down the total VAT payable on all goods and services shown on
// a VAT invoice to a whole penny. You can ignore any fraction of a penny." That concession is not applied here: the
// total VAT of 3 lines of 0.05 at 10 percent is 0.015, and the concession would give 0.01, but this tool rounds half
// away from zero to 0.02; 0.8676 is 0.87, not 0.86.
it('the HMRC round-down concession is not applied: totals round half away from zero', () => {
  const total = add('0.05\n0.05\n0.05', 'VAT | 10', 'total', 'GBP');
  expect(total.summary.totals.tax).toBe('0.02');
  expect(add('43.38', 'VAT | 2', 'total', 'GBP').summary.totals.tax).toBe('0.87');
  expect(total.summary.notes.join(' ')).toContain('concession');
  expect(total.summary.notes.join(' ')).toContain('not applied');
  expect(total.working).toContain('not applied');
  expect(extract('0.05\n0.05\n0.05', 'VAT | 10', 'line', 'GBP').summary.notes.join(' ')).toContain('not applied');
  // A negative tax cannot arise (no negative amounts or rates), so only ties away from zero upward matter: 0.15 at 10
  // is 0.015 and 0.25 at 10 is 0.025; both go up.
  expect(add('0.15', 'VAT | 10', 'line').summary.totals.tax).toBe('0.02');
  expect(add('0.25', 'VAT | 10', 'line').summary.totals.tax).toBe('0.03');
  // A currency with no minor unit rounds to whole units: JPY 15 at 10 percent is 1.5, so 2.
  expect(add('15', 'Tax | 10', 'line', 'JPY').summary.totals.tax).toBe('2');
});

it('a bad amount or rate line is reported with its line and column, and more than 200 lines or 10 rates are refused', () => {
  const badAmount = refused(() => lines('2.40\nabc'));
  expect(badAmount.field).toBe('Amounts');
  expect([badAmount.line, badAmount.column]).toEqual([2, 1]);
  const inSecondCell = refused(() => lines('Coffee | 3.50\nCake | 4.2x'));
  expect([inSecondCell.line, inSecondCell.column]).toEqual([2, 8]);
  expect(inSecondCell.message).toContain('amount');
  // More decimal places than the currency's smallest unit, a minus sign and an exponent are refused with a position.
  const tooFine = refused(() => lines('1.00\n  1.234'));
  expect([tooFine.line, tooFine.column]).toEqual([2, 3]);
  expect(tooFine.message).toContain('2 decimal places');
  expect(refused(() => lines('1.5', 'JPY')).message).toContain('0 decimal places');
  expect(lines('1.234', 'BHD')[0]!.amount.toString()).toBe('1.234');
  expect(refused(() => lines('-1')).line).toBe(1);
  expect(refused(() => lines('1e3')).line).toBe(1);
  expect(refused(() => lines('a | b | 5')).message).toContain('at most 2 cells');
  expect(refused(() => lines(`${'x'.repeat(61)} | 5`)).message).toContain('60 characters');
  // Rates: 0 to 100, with the line and column of the cell.
  const bigRate = refused(() => rates('VAT | 20\nCity | 101'));
  expect(bigRate.field).toBe('Tax rates');
  expect([bigRate.line, bigRate.column]).toEqual([2, 8]);
  expect(bigRate.message).toContain('100');
  const badRate = refused(() => rates('VAT | abc'));
  expect([badRate.line, badRate.column]).toEqual([1, 7]);
  expect(refused(() => rates('-5')).line).toBe(1);
  expect(rates('0')[0]!.rate.toString()).toBe('0');
  expect(rates('100')[0]!.rate.toString()).toBe('100');
  // Caps: 200 lines are accepted, the 201st is refused naming the cap; 10 rates are accepted, the 11th is refused.
  const two = Array.from({ length: 200 }, () => '1.00').join('\n');
  expect(lines(two)).toHaveLength(200);
  expect(add(two, 'VAT | 20').summary.totals).toMatchObject({ net: '200.00', tax: '40.00', gross: '240.00' });
  const over = refused(() => lines(`${two}\n1.00`));
  expect(over.message).toContain('200');
  expect(over.line).toBe(201);
  const ten = Array.from({ length: 10 }, (_, i) => `Tax ${i + 1} | 1`).join('\n');
  expect(rates(ten)).toHaveLength(10);
  expect(add('100', ten).summary.totals.tax).toBe('10.00');
  const eleven = refused(() => rates(`${ten}\nOne more | 1`));
  expect(eleven.message).toContain('10');
  expect(eleven.line).toBe(11);
  // Something missing is named, a bad mode, rounding or currency too, and nothing typed shows nothing.
  expect(refused(() => calculateSalesTax({ mode: 'add', lines: '2.40' })).field).toBe('Tax rates');
  expect(refused(() => calculateSalesTax({ mode: 'add', rates: 'VAT | 20' })).field).toBe('Amounts');
  expect(refused(() => calculateSalesTax({ mode: 'refund', lines: '1', rates: '1' })).field).toBe('Mode');
  expect(refused(() => calculateSalesTax({ mode: 'add', lines: '1', rates: '1', rounding: 'up' })).field).toBe(
    'Rounding',
  );
  expect(refused(() => calculateSalesTax({ mode: 'add', lines: '1', rates: '1', currency: 'DOLLARS' })).field).toBe(
    'Currency (ISO 4217 code)',
  );
  expect(calculateSalesTax({ mode: 'add' })).toBeNull();
  expect(calculateSalesTax({ mode: 'extract', lines: '  \n ', rates: ' ' })).toBeNull();
  expect(calculateSalesTax({})).toBeNull();
  // Blank lines are skipped but still counted in line numbers.
  expect(lines('\n2.40\n\nCake | 1.00').map((l) => l.line)).toEqual([2, 4]);
});

// In JavaScript floating point 0.1 + 0.2 is 0.30000000000000004. Amount lines of 0.10 and 0.20 at a rate of 0 give a net
// total and a gross total of exactly 0.30 through this tool.
it('0.1 plus 0.2 is exactly 0.3 through this tool', () => {
  expect(0.1 + 0.2).toBe(0.30000000000000004);
  const r = addTax(lines('0.10\n0.20'), rates('Zero | 0'), 'total', 'USD');
  expect(r.totals.net.toString()).toBe('0.3');
  expect(r.totals.gross.toString()).toBe('0.3');
  expect(r.totals.tax.toString()).toBe('0');
  const result = add('0.10\n0.20', 'Zero | 0');
  expect(result.summary.totals).toMatchObject({ net: '0.30', tax: '0.00', gross: '0.30' });
  const taken = extract('0.10\n0.20', 'Zero | 0', 'line');
  expect(taken.summary.totals).toMatchObject({ net: '0.30', tax: '0.00', gross: '0.30' });
});

it('only arithmetic is shown: no wording recommends or says which rate or rule is correct', () => {
  const texts = [
    add('43.38', 'VAT | 2', 'line', 'GBP').working,
    add('0.05\n0.05\n0.05', 'VAT | 10').summary.notes.join(' '),
    extract('2.40', 'VAT | 20', 'total', 'GBP').working,
    extract('108.25', 'State | 6.25\nCity | 2').working,
    meta.about,
    ...meta.supports,
    ...meta.limits,
    ...meta.ambiguities,
  ].join('\n');
  expect(texts).not.toMatch(/\b(should|recommend\w*|best|better|worse|good|bad|worth|cheap|expensive|safe|risky)\b/i);
  expect(texts).not.toMatch(/\b(correct|legal|required|mandatory) (rate|rounding|rule)\b/i);
});
