import { it, expect } from 'vitest';
import {
  MarkupError,
  SEMANTIC_ELEMENTS,
  buildElement,
  checkMeter,
  checkProgress,
  meta,
  type ElementSpec,
} from '../src/index';
import { serialize, inert } from '../src/markup';
import { HOSTILE, accName, attrOf, findAll, parse, shape, textOf, type ParsedElement } from './parse';

/** The MarkupError a call throws, or null when it does not throw. */
function refusal(spec: ElementSpec): MarkupError | null {
  try {
    buildElement(spec);
    return null;
  } catch (err) {
    if (err instanceof MarkupError) return err;
    throw err;
  }
}

it('has the catalog id and name and states its limits', () => {
  expect(meta.id).toBe('semantic-html-builder');
  expect(meta.name).toBe('Semantic HTML Element Builder');
  expect(meta.limits.length).toBeGreaterThan(0);
});

it('WHATWG 4.5.14 time: the global date and time example of the standard becomes the datetime attribute', () => {
  // WHATWG 4.5.14: a global date and time with milliseconds, written as the standard's own example writes it.
  const built = buildElement({ element: 'time', content: '18 November 2011', datetime: '2011-11-18T14:54:39.929Z' });
  expect(built).not.toBeNull();
  if (built === null) return;
  expect(built.html).toBe('<time datetime="2011-11-18T14:54:39.929Z">18 November 2011</time>');
  expect(built.warnings).toEqual([]);

  // With no datetime typed, the text itself must be a valid value, and then no attribute is written.
  const bare = buildElement({ element: 'time', content: '2011-11-18' });
  expect(bare?.html).toBe('<time>2011-11-18</time>');

  // Text that is not a valid value is refused when there is no datetime to carry it.
  const text = refusal({ element: 'time', content: 'next Tuesday' });
  expect(text?.field).toBe('Datetime');
  expect(text?.message).toContain('2.3.5');
});

it('WHATWG 4.5.14 time accepts every date and time example of the standard and refuses impossible ones', () => {
  // The literals of WHATWG 4.5.14 and 2.3.5, one per form the time element allows.
  const accepted = [
    '2011-11', // month
    '2011-11-18', // date
    '11-18', // yearless date
    '14:54', // time
    '14:54:39', // time with seconds
    '14:54:39.929', // time with milliseconds
    '2011-11-18T14:54', // local date and time
    '2011-11-18 14:54:39.929', // local date and time with a space
    'Z', // time-zone offset
    '+0000',
    '-08:00',
    '2011-11-18T14:54:39.929Z', // global date and time
    '2011-11-18T06:54-0800',
    '2011-W47', // week
    '2011', // year
    '0001',
    '0037-12-13 00:00Z', // a year under four digits is written with leading zeros
    'PT4H18M3S', // duration
    '4h 18m 3s',
  ];
  for (const value of accepted) {
    expect(refusal({ element: 'time', content: 'shown', datetime: value }), `datetime ${value}`).toBeNull();
    expect(refusal({ element: 'time', content: value }), `text ${value}`).toBeNull();
  }

  const impossible = [
    '2011-13-45', // month 13
    '2011-02-29', // February 29 in a common year
    '24:00', // hour 24
    '14:54:60', // second 60 (no leap seconds)
    '14:54:39.9291', // four fraction digits
    '-00:00', // a minus sign on a zero offset
    '37-12-13', // a year under four digits
    '2011-W54', // no year has a week 54
    '2011-11-18T14:54:39.929 Z ', // stray spaces
    'next Tuesday',
  ];
  for (const value of impossible) {
    const error = refusal({ element: 'time', content: 'shown', datetime: value });
    expect(error, `datetime ${value} is refused`).not.toBeNull();
    expect(error?.field).toBe('Datetime');
  }
});

it('the time element parses with parse5 with zero parse errors and the preview equals the inert markup', () => {
  const built = buildElement({ element: 'time', content: '18 November 2011', datetime: '2011-11-18T14:54:39.929Z' });
  expect(built).not.toBeNull();
  if (built === null) return;

  const real = parse(built.html);
  expect(real.errors).toEqual([]);
  const times = findAll(real.frag, 'time');
  expect(times).toHaveLength(1);
  expect(attrOf(times[0]!, 'datetime')).toBe('2011-11-18T14:54:39.929Z');
  expect(textOf(times[0]!)).toBe('18 November 2011');

  const shown = parse(built.preview);
  expect(shown.errors).toEqual([]);
  expect(shape(shown.frag)).toBe(shape(real.frag));
  expect(built.preview).toBe(serialize(inert(built.tree)));
});

it('blank fields give no output', () => {
  expect(buildElement({ element: 'time' })).toBeNull();
  expect(buildElement({ element: 'time', content: '', datetime: '' })).toBeNull();
  // Whitespace only is blank too.
  expect(buildElement({ element: 'time', content: '   ', datetime: ' ' })).toBeNull();
});

it('hostile text in the time content leaves the parsed tree unchanged', () => {
  const plain = buildElement({ element: 'time', content: 'shown', datetime: '2011-11-18' });
  if (plain === null) throw new Error('the plain time element is expected');
  const baseline = shape(parse(plain.html).frag);
  for (const value of HOSTILE) {
    let built;
    try {
      built = buildElement({ element: 'time', content: value, datetime: '2011-11-18' });
    } catch (err) {
      // A value HTML cannot carry (a control character) is refused naming the field.
      expect(err).toBeInstanceOf(MarkupError);
      continue;
    }
    if (built === null) throw new Error('hostile text still gives output');
    const parsed = parse(built.html);
    expect(parsed.errors).toEqual([]);
    expect(shape(parsed.frag)).toBe(baseline);
  }
});

/** The direct child elements of a parsed element, as tag names. */
function childTags(node: ParsedElement): string[] {
  return (node.childNodes as { tagName?: string }[]).flatMap((n) => (n.tagName ? [n.tagName] : []));
}

function attrNames(node: ParsedElement): string[] {
  return node.attrs.map((a) => a.name);
}

/** A meter spec with the label every meter needs; the test overrides the rest. */
function meterSpec(more: Partial<ElementSpec>): ElementSpec {
  return { element: 'meter', label: 'Disk usage', ...more };
}

it('WHATWG 4.11.1 details has exactly one summary first, then the content, and open and name only when chosen', () => {
  const built = buildElement({
    element: 'details',
    summary: 'More',
    paragraphs: 'Hidden text',
    open: true,
    group: 'faq',
  });
  expect(built).not.toBeNull();
  if (built === null) return;

  const parsed = parse(built.html);
  expect(parsed.errors).toEqual([]);
  const details = findAll(parsed.frag, 'details');
  expect(details).toHaveLength(1);
  expect(attrNames(details[0]!)).toEqual(['open', 'name']);
  expect(attrOf(details[0]!, 'name')).toBe('faq');
  expect(childTags(details[0]!)).toEqual(['summary', 'p']);
  expect(findAll(parsed.frag, 'summary')).toHaveLength(1);
  expect(textOf(findAll(parsed.frag, 'summary')[0]!)).toBe('More');

  // Two paragraphs, separated by a blank line, follow the one summary.
  const two = buildElement({ element: 'details', summary: 'More', paragraphs: 'First\n\nSecond' });
  const twoParsed = parse(two?.html ?? '');
  expect(twoParsed.errors).toEqual([]);
  const twoDetails = findAll(twoParsed.frag, 'details')[0]!;
  expect(childTags(twoDetails)).toEqual(['summary', 'p', 'p']);
  // open and name are written only when chosen.
  expect(attrNames(twoDetails)).toEqual([]);

  // The summary is required once anything else is filled in.
  const missing = refusal({ element: 'details', paragraphs: 'Hidden text' });
  expect(missing?.field).toBe('Summary');

  // A group name made only of spaces is the empty string for practical purposes and is refused.
  const spaces = refusal({ element: 'details', summary: 'More', group: '   ' });
  expect(spaces?.field).toBe('Group name');
  // A group name is written exactly as typed.
  const exact = buildElement({ element: 'details', summary: 'More', group: 'Faq Group' });
  expect(attrOf(findAll(parse(exact?.html ?? '').frag, 'details')[0]!, 'name')).toBe('Faq Group');

  // More than 50 paragraphs are refused.
  const many = Array.from({ length: 51 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n');
  expect(refusal({ element: 'details', summary: 'More', paragraphs: many })?.field).toBe('Content');
});

it('WHATWG 4.11.4 dialog gets a close form with method dialog, never a tabindex, and closedby only from its three keywords', () => {
  const built = buildElement({ element: 'dialog', paragraphs: 'Are you sure?', closedby: 'any', id: 'sure' });
  expect(built).not.toBeNull();
  if (built === null) return;

  const parsed = parse(built.html);
  expect(parsed.errors).toEqual([]);
  const dialogs = findAll(parsed.frag, 'dialog');
  expect(dialogs).toHaveLength(1);
  // The element carries nothing but id, closedby (and open when chosen); no focus-order attribute is ever written.
  expect(attrNames(dialogs[0]!).sort()).toEqual(['closedby', 'id']);
  expect(attrNames(dialogs[0]!)).not.toContain('tabindex');
  expect(childTags(dialogs[0]!)).toEqual(['p', 'form']);
  const forms = findAll(parsed.frag, 'form');
  expect(forms).toHaveLength(1);
  expect(attrOf(forms[0]!, 'method')).toBe('dialog');
  expect(childTags(forms[0]!)).toEqual(['button']);
  expect(textOf(findAll(parsed.frag, 'button')[0]!)).toBe('Close');

  // The three keywords are all accepted, the close button text can be changed, and open is written when chosen.
  for (const closedby of ['any', 'closerequest', 'none']) {
    expect(refusal({ element: 'dialog', paragraphs: 'Hello', closedby })).toBeNull();
  }
  const labelled = buildElement({ element: 'dialog', paragraphs: 'Hello', open: true, closeLabel: 'Got it' });
  const labelledDialog = findAll(parse(labelled?.html ?? '').frag, 'dialog')[0]!;
  expect(attrNames(labelledDialog)).toEqual(['open']);
  expect(textOf(findAll(parse(labelled?.html ?? '').frag, 'button')[0]!)).toBe('Got it');

  // Any other keyword is refused naming the field; blank means the attribute is left out.
  const wrong = refusal({ element: 'dialog', paragraphs: 'Hello', closedby: 'sometimes' });
  expect(wrong?.field).toBe('Closed by');
  expect(wrong?.message).toContain('closerequest');
  const none = buildElement({ element: 'dialog', paragraphs: 'Hello', closedby: '' });
  expect(attrNames(findAll(parse(none?.html ?? '').frag, 'dialog')[0]!)).toEqual([]);

  // An id with a space is refused naming Id.
  expect(refusal({ element: 'dialog', paragraphs: 'Hello', id: 'two words' })?.field).toBe('Id');
});

it('WHATWG 4.10.14 meter ordering rules: each of the five inequalities is checked and a missing value is refused', () => {
  // A valid meter keeps min and max out of the markup when they are blank (the defaults are 0 and 1).
  const ok = buildElement(meterSpec({ value: '0.6' }));
  expect(ok?.html).toContain('<meter id="disk-usage" value="0.6"></meter>');
  expect(ok?.html).not.toContain('min=');
  expect(ok?.html).not.toContain('max=');

  // The value is required.
  expect(refusal(meterSpec({}))?.field).toBe('Value');
  expect(refusal(meterSpec({ value: '', min: '0', max: '10' }))?.field).toBe('Value');
  expect(() => checkMeter({ value: '' })).toThrow(MarkupError);

  // Rule 1: minimum <= value <= maximum, with minimum 0 and maximum 1 when absent.
  expect(refusal(meterSpec({ value: '2' }))?.field).toBe('Value');
  expect(refusal(meterSpec({ value: '-0.5' }))?.field).toBe('Value');
  expect(refusal(meterSpec({ value: '5', min: '6', max: '10' }))?.field).toBe('Value');
  expect(refusal(meterSpec({ value: '11', min: '0', max: '10' }))?.field).toBe('Value');
  expect(refusal(meterSpec({ value: '10', min: '0', max: '10' }))).toBeNull();
  // Rule 2: minimum <= low <= maximum.
  expect(refusal(meterSpec({ value: '5', min: '2', max: '10', low: '1' }))?.field).toBe('Low');
  expect(refusal(meterSpec({ value: '5', min: '2', max: '10', low: '11' }))?.field).toBe('Low');
  // Rule 3: minimum <= high <= maximum.
  expect(refusal(meterSpec({ value: '5', min: '2', max: '10', high: '1' }))?.field).toBe('High');
  expect(refusal(meterSpec({ value: '5', min: '2', max: '10', high: '11' }))?.field).toBe('High');
  // Rule 4: minimum <= optimum <= maximum.
  expect(refusal(meterSpec({ value: '5', min: '2', max: '10', optimum: '1' }))?.field).toBe('Optimum');
  expect(refusal(meterSpec({ value: '5', min: '2', max: '10', optimum: '11' }))?.field).toBe('Optimum');
  // Rule 5: low <= high.
  const order = refusal(meterSpec({ value: '0.5', low: '0.8', high: '0.2' }));
  expect(order?.field).toBe('High');
  expect(order?.message).toContain('Low');
  expect(refusal(meterSpec({ value: '0.5', low: '0.2', high: '0.2' }))).toBeNull();

  // Every number must be a valid floating-point number: no leading plus, no trailing point, no NaN.
  for (const bad of ['+5', '5.', 'NaN', 'Infinity', '1,5', ' 5', '5 ', '1e']) {
    const error = refusal(meterSpec({ value: bad, max: '10' }));
    expect(error?.field, `value ${bad}`).toBe('Value');
  }
  for (const good of ['0', '.5', '-0', '1e0', '5E-1', '0.600']) {
    expect(refusal(meterSpec({ value: good, min: '-1', max: '10' })), `value ${good}`).toBeNull();
  }
  expect(refusal(meterSpec({ value: '1', min: '+0' }))?.field).toBe('Min');
  expect(refusal(meterSpec({ value: '1', max: '1.' }))?.field).toBe('Max');
  expect(refusal(meterSpec({ value: '1', low: '.' }))?.field).toBe('Low');

  // The full set, written in the order value, min, max, low, high, optimum, title, with the fallback text inside.
  const full = buildElement(
    meterSpec({
      id: 'disk',
      value: '0.6',
      min: '0',
      max: '1',
      low: '0.25',
      high: '0.75',
      optimum: '0.1',
      title: 'fraction',
      content: '60 percent',
    }),
  );
  expect(full?.html).toContain(
    '<meter id="disk" value="0.6" min="0" max="1" low="0.25" high="0.75" optimum="0.1" title="fraction">60 percent</meter>',
  );
  // The same rules, called directly.
  expect(checkMeter({ value: '0.6' })).toMatchObject({ value: 0.6, min: 0, max: 1 });
  expect(() => checkMeter({ value: '0.6', low: '0.9', high: '0.1' })).toThrow(MarkupError);
});

it('WHATWG 4.10.13 progress value lies between zero and max, max is above zero, and no value means indeterminate', () => {
  const ok = buildElement({ element: 'progress', label: 'Upload', value: '70', max: '100', content: '70 percent' });
  expect(ok?.html).toContain('<progress id="upload" value="70" max="100">70 percent</progress>');
  expect(ok?.warnings).toEqual([]);

  expect(refusal({ element: 'progress', label: 'Upload', value: '120', max: '100' })?.field).toBe('Value');
  expect(refusal({ element: 'progress', label: 'Upload', value: '-1', max: '100' })?.field).toBe('Value');
  expect(refusal({ element: 'progress', label: 'Upload', value: '2' })?.field).toBe('Value');
  expect(refusal({ element: 'progress', label: 'Upload', value: '1' })).toBeNull();
  expect(refusal({ element: 'progress', label: 'Upload', value: '0', max: '100' })).toBeNull();
  expect(refusal({ element: 'progress', label: 'Upload', value: '100', max: '100' })).toBeNull();
  expect(refusal({ element: 'progress', label: 'Upload', value: '0', max: '0' })?.field).toBe('Max');
  expect(refusal({ element: 'progress', label: 'Upload', value: '0', max: '-5' })?.field).toBe('Max');
  expect(refusal({ element: 'progress', label: 'Upload', value: '5', max: '+10' })?.field).toBe('Max');
  expect(refusal({ element: 'progress', label: 'Upload', value: '5.', max: '10' })?.field).toBe('Value');

  // No value means an indeterminate progress bar: no value attribute, and a note says what that means.
  const indeterminate = buildElement({ element: 'progress', label: 'Upload' });
  expect(indeterminate?.html).toBe('<label for="upload">Upload</label>\n<progress id="upload"></progress>');
  expect(indeterminate?.warnings.join(' ')).toContain('indeterminate');
  const withMax = buildElement({ element: 'progress', label: 'Upload', max: '100' });
  expect(withMax?.html).toContain('<progress id="upload" max="100"></progress>');

  expect(() => checkProgress({ value: '120', max: '100' })).toThrow(MarkupError);
  expect(checkProgress({ value: '70', max: '100' })).toMatchObject({ value: 70, max: 100 });
  expect(checkProgress({})).toMatchObject({ max: 1 });
});

it('HTML-AAM 4.1.7 a meter or progress bar gets its accessible name from a label tied by for and id', () => {
  const meter = buildElement(meterSpec({ value: '0.6', id: 'disk' }));
  const progress = buildElement({ element: 'progress', label: 'Upload', value: '70', max: '100' });
  for (const [built, tag, name] of [
    [meter, 'meter', 'Disk usage'],
    [progress, 'progress', 'Upload'],
  ] as const) {
    expect(built).not.toBeNull();
    const parsed = parse(built?.html ?? '');
    expect(parsed.errors).toEqual([]);
    const control = findAll(parsed.frag, tag)[0]!;
    const labels = findAll(parsed.frag, 'label');
    expect(labels).toHaveLength(1);
    expect(attrOf(labels[0]!, 'for')).toBe(attrOf(control, 'id'));
    expect(accName(parsed.frag, control)).toBe(name);
  }

  // The id is derived from the label (lowercase ASCII letters and digits, other runs become a hyphen), or falls back.
  expect(buildElement(meterSpec({ value: '1', label: 'Disk  Usage: C:' }))?.html).toContain(
    '<label for="disk-usage-c">',
  );
  expect(buildElement(meterSpec({ value: '1', label: 'Fuel' }))?.html).toContain('id="fuel"');
  expect(buildElement(meterSpec({ value: '1', label: '!!!' }))?.html).toContain('id="meter-1"');
  expect(buildElement({ element: 'progress', label: '???' })?.html).toContain('id="progress-1"');
  // An explicit id wins; one with a space is refused naming Id; a gauge with no label is refused naming Label.
  expect(buildElement(meterSpec({ value: '1', id: 'my-gauge' }))?.html).toContain('<label for="my-gauge">');
  expect(refusal(meterSpec({ value: '1', id: 'two words' }))?.field).toBe('Id');
  expect(refusal({ element: 'meter', value: '1' })?.field).toBe('Label');
  expect(refusal({ element: 'progress', value: '1' })?.field).toBe('Label');
});

it('the preview shows a closed dialog open while the markup keeps the choice', () => {
  const closed = buildElement({ element: 'dialog', paragraphs: 'Hello', closedby: 'any' });
  expect(closed).not.toBeNull();
  if (closed === null) return;
  expect(attrNames(findAll(parse(closed.html).frag, 'dialog')[0]!)).not.toContain('open');
  const shown = parse(closed.preview);
  expect(shown.errors).toEqual([]);
  expect(attrNames(findAll(shown.frag, 'dialog')[0]!)).toContain('open');
  expect(closed.warnings.join(' ')).toContain('The preview shows the dialog open so you can see it');
  // The preview still comes from the same tree: only the open attribute differs, then every address is removed.
  expect(shape(shown.frag)).toBe(shape(parse(closed.html).frag).replace('<dialog[closedby', '<dialog[open,closedby'));

  // A dialog the visitor opened is written open in both, and needs no note.
  const opened = buildElement({ element: 'dialog', paragraphs: 'Hello', open: true });
  expect(attrNames(findAll(parse(opened?.html ?? '').frag, 'dialog')[0]!)).toContain('open');
  expect(attrNames(findAll(parse(opened?.preview ?? '').frag, 'dialog')[0]!)).toEqual(['open']);
  expect(opened?.warnings).toEqual([]);
  expect(opened?.preview).toBe(serialize(inert(opened?.tree ?? [])));
});

it('details, dialog, meter and progress give no output when every text field is blank', () => {
  expect(buildElement({ element: 'details' })).toBeNull();
  expect(buildElement({ element: 'details', open: true })).toBeNull();
  expect(buildElement({ element: 'dialog' })).toBeNull();
  expect(buildElement({ element: 'dialog', open: true, closedby: '' })).toBeNull();
  expect(buildElement({ element: 'meter' })).toBeNull();
  expect(buildElement({ element: 'progress' })).toBeNull();
  expect(buildElement({ element: 'progress', value: '  ', max: '' })).toBeNull();
});

it('WHATWG 4.7 ins and del datetime accepts a date or a global date and time only', () => {
  // The two literals of WHATWG 4.7.3, one on each element.
  const del = buildElement({ element: 'del', content: 'old', datetime: '2009-10-11T01:25-07:00' });
  expect(del?.html).toBe('<del datetime="2009-10-11T01:25-07:00">old</del>');
  const ins = buildElement({ element: 'ins', content: 'new', datetime: '2005-03-16 00:00Z' });
  expect(ins?.html).toBe('<ins datetime="2005-03-16 00:00Z">new</ins>');
  // A date alone is a valid date string.
  expect(refusal({ element: 'ins', content: 'new', datetime: '2011-11-18' })).toBeNull();
  // Written in the order cite, datetime, and with nothing when both are blank.
  const both = buildElement({ element: 'del', content: 'old', citeUrl: 'changes.html', datetime: '2011-11-18' });
  expect(both?.html).toBe('<del cite="changes.html" datetime="2011-11-18">old</del>');
  expect(buildElement({ element: 'del', content: 'old' })?.html).toBe('<del>old</del>');

  // A local date and time, and every other form the time element takes, is not valid here.
  for (const value of [
    '2011-11-18T14:54',
    '2011-11-18 14:54:39',
    '14:54',
    '2011-11',
    '2011',
    '2011-W47',
    'PT4H18M3S',
    'Z',
  ]) {
    for (const element of ['ins', 'del'] as const) {
      const error = refusal({ element, content: 'x', datetime: value });
      expect(error, `${element} ${value} is refused`).not.toBeNull();
      expect(error?.field).toBe('Datetime');
    }
  }
  // An impossible date and a minus zero offset are refused too.
  expect(refusal({ element: 'ins', content: 'x', datetime: '2011-02-29' })?.field).toBe('Datetime');
  expect(refusal({ element: 'ins', content: 'x', datetime: '2011-11-18T14:54-00:00' })?.field).toBe('Datetime');
});

it('WHATWG 4.4.4 a quotation with citation puts the attribution and the work title in a figcaption outside the blockquote', () => {
  const built = buildElement({
    element: 'blockquote',
    paragraphs: 'Quoted words',
    citeUrl: 'https://example.org/source',
    attribution: 'A. Writer',
    workTitle: 'A Book',
  });
  expect(built).not.toBeNull();
  if (built === null) return;
  const parsed = parse(built.html);
  expect(parsed.errors).toEqual([]);
  const figures = findAll(parsed.frag, 'figure');
  expect(figures).toHaveLength(1);
  expect(childTags(figures[0]!)).toEqual(['blockquote', 'figcaption']);
  const quote = findAll(parsed.frag, 'blockquote')[0]!;
  expect(attrOf(quote, 'cite')).toBe('https://example.org/source');
  expect(childTags(quote)).toEqual(['p']);
  expect(textOf(quote)).toBe('Quoted words');
  // The attribution is outside the blockquote, in the figcaption, and the work title is in a cite element.
  expect(findAll(quote, 'figcaption')).toHaveLength(0);
  const caption = findAll(parsed.frag, 'figcaption')[0]!;
  expect(textOf(caption)).toBe('A. Writer, A Book');
  const cites = findAll(caption, 'cite');
  expect(cites).toHaveLength(1);
  expect(textOf(cites[0]!)).toBe('A Book');
  expect(built.html).toBe(
    [
      '<figure>',
      '  <blockquote cite="https://example.org/source">',
      '    <p>Quoted words</p>',
      '  </blockquote>',
      '  <figcaption>A. Writer, <cite>A Book</cite></figcaption>',
      '</figure>',
    ].join('\n'),
  );

  // The preview has the same shape with the citation address removed.
  const shown = parse(built.preview);
  expect(shown.errors).toEqual([]);
  expect(attrOf(findAll(shown.frag, 'blockquote')[0]!, 'cite')).toBeUndefined();
  expect(built.preview).toBe(serialize(inert(built.tree)));

  // Without an attribution or a work title it is a bare blockquote; each alone gives a figcaption of its own.
  const bare = buildElement({ element: 'blockquote', paragraphs: 'Quoted words' });
  expect(bare?.html).toBe('<blockquote>\n  <p>Quoted words</p>\n</blockquote>');
  const person = buildElement({ element: 'blockquote', paragraphs: 'Quoted words', attribution: 'A. Writer' });
  expect(findAll(parse(person?.html ?? '').frag, 'cite')).toHaveLength(0);
  expect(textOf(findAll(parse(person?.html ?? '').frag, 'figcaption')[0]!)).toBe('A. Writer');
  const work = buildElement({ element: 'blockquote', paragraphs: 'Quoted words', workTitle: 'A Book' });
  expect(textOf(findAll(parse(work?.html ?? '').frag, 'figcaption')[0]!)).toBe('A Book');
  // Two paragraphs make two p elements inside the blockquote.
  const two = buildElement({ element: 'blockquote', paragraphs: 'One\n\nTwo' });
  expect(childTags(findAll(parse(two?.html ?? '').frag, 'blockquote')[0]!)).toEqual(['p', 'p']);

  // A citation address with a script scheme is kept as typed and flagged.
  const flagged = buildElement({ element: 'blockquote', paragraphs: 'Quoted words', citeUrl: 'javascript:alert(1)' });
  expect(attrOf(findAll(parse(flagged?.html ?? '').frag, 'blockquote')[0]!, 'cite')).toBe('javascript:alert(1)');
  expect(flagged?.warnings.join(' ')).toContain('Citation address');
  // The quotation itself is needed once anything else is filled in.
  expect(refusal({ element: 'blockquote', attribution: 'A. Writer' })?.field).toBe('Content');
});

it('WHATWG 4.4.12 the figure caption is the first or last child of the figure', () => {
  const last = buildElement({
    element: 'figure',
    imageUrl: 'pic.png',
    alt: 'A chart',
    caption: 'Sales',
    width: '320',
    height: '200',
  });
  expect(last).not.toBeNull();
  if (last === null) return;
  const lastParsed = parse(last.html);
  expect(lastParsed.errors).toEqual([]);
  const lastFigure = findAll(lastParsed.frag, 'figure')[0]!;
  expect(childTags(lastFigure)).toEqual(['img', 'figcaption']);
  const image = findAll(lastParsed.frag, 'img')[0]!;
  expect(image.attrs.map((a) => a.name)).toEqual(['src', 'alt', 'width', 'height']);
  expect(attrOf(image, 'src')).toBe('pic.png');
  expect(attrOf(image, 'alt')).toBe('A chart');
  expect(textOf(findAll(lastParsed.frag, 'figcaption')[0]!)).toBe('Sales');

  const first = buildElement({
    element: 'figure',
    imageUrl: 'pic.png',
    alt: 'A chart',
    caption: 'Sales',
    captionAt: 'first',
  });
  expect(childTags(findAll(parse(first?.html ?? '').frag, 'figure')[0]!)).toEqual(['figcaption', 'img']);
  // A figure with no caption holds just the image.
  const plain = buildElement({ element: 'figure', imageUrl: 'pic.png', alt: 'A chart' });
  expect(childTags(findAll(parse(plain?.html ?? '').frag, 'figure')[0]!)).toEqual(['img']);

  // The alt text and the image address are required; the sizes must be valid non-negative integers.
  expect(refusal({ element: 'figure', imageUrl: 'pic.png', caption: 'Sales' })?.field).toBe('Alt text');
  expect(refusal({ element: 'figure', alt: 'A chart', caption: 'Sales' })?.field).toBe('Image address');
  expect(refusal({ element: 'figure', imageUrl: 'pic.png', alt: 'A chart', width: '3.5' })?.field).toBe('Width');
  expect(refusal({ element: 'figure', imageUrl: 'pic.png', alt: 'A chart', height: '-1' })?.field).toBe('Height');
  expect(refusal({ element: 'figure', imageUrl: 'pic.png', alt: 'A chart', captionAt: 'middle' })?.field).toBe(
    'Caption position',
  );

  // The preview swaps the address for a data placeholder sized from the width and height; the markup keeps it.
  const preview = parse(last.preview);
  expect(preview.errors).toEqual([]);
  const previewImage = findAll(preview.frag, 'img')[0]!;
  expect(attrOf(previewImage, 'src')?.startsWith('data:image/svg+xml,')).toBe(true);
  expect(last.html).toContain('src="pic.png"');
  expect(last.preview).not.toContain('pic.png');
  expect(last.preview).toBe(serialize(inert(last.tree)));
});

it('WHATWG 4.5.9 abbr title holds the expansion', () => {
  const built = buildElement({
    element: 'abbr',
    content: 'WHATWG',
    title: 'Web Hypertext Application Technology Working Group',
  });
  expect(built?.html).toBe('<abbr title="Web Hypertext Application Technology Working Group">WHATWG</abbr>');
  const parsed = parse(built?.html ?? '');
  expect(parsed.errors).toEqual([]);
  const abbr = findAll(parsed.frag, 'abbr')[0]!;
  expect(attrOf(abbr, 'title')).toBe('Web Hypertext Application Technology Working Group');
  expect(textOf(abbr)).toBe('WHATWG');
  // The expansion is optional and the abbreviation itself is required.
  expect(buildElement({ element: 'abbr', content: 'WHATWG' })?.html).toBe('<abbr>WHATWG</abbr>');
  expect(refusal({ element: 'abbr', title: 'Web Hypertext Application Technology Working Group' })?.field).toBe('Text');
});

it('mark, sub, sup and kbd wrap only the typed text, with the surrounding text outside them', () => {
  const sub = buildElement({ element: 'sub', before: 'H', content: '2', after: 'O' });
  expect(sub?.html).toBe('<p>H<sub>2</sub>O</p>');
  for (const element of ['mark', 'sub', 'sup', 'kbd'] as const) {
    const wrapped = buildElement({ element, before: 'before ', content: 'inside', after: ' after' });
    const parsed = parse(wrapped?.html ?? '');
    expect(parsed.errors, element).toEqual([]);
    const outer = findAll(parsed.frag, 'p')[0]!;
    expect(childTags(outer), element).toEqual([element]);
    expect(textOf(findAll(outer, element)[0]!), element).toBe('inside');
    expect(textOf(outer), element).toBe('before inside after');
    // With nothing around it, the element stands alone and holds only the typed text.
    expect(buildElement({ element, content: 'inside' })?.html).toBe(`<${element}>inside</${element}>`);
  }
  // Text before or after, with nothing inside, is refused naming the text field.
  expect(refusal({ element: 'kbd', before: 'Press ' })?.field).toBe('Text');
  expect(refusal({ element: 'mark', after: ' tail' })?.field).toBe('Text');
  // Spaces around the typed text are kept exactly.
  expect(buildElement({ element: 'del', before: 'Price: ', content: '10', after: ' now 8' })?.html).toBe(
    '<p>Price: <del>10</del> now 8</p>',
  );
});

/** A plain spec for each element, and the free-text fields of it that take any characters. */
const FREE_TEXT: { plain: ElementSpec; free: (keyof ElementSpec)[] }[] = [
  {
    plain: { element: 'details', summary: 'More', paragraphs: 'Hidden', group: 'faq' },
    free: ['summary', 'paragraphs', 'group'],
  },
  {
    plain: { element: 'dialog', paragraphs: 'Hello', closeLabel: 'Close', id: 'sure', closedby: 'any' },
    free: ['paragraphs', 'closeLabel', 'id'],
  },
  {
    plain: { element: 'meter', label: 'Disk', value: '0.5', title: 'unit', content: 'half', id: 'disk' },
    free: ['label', 'title', 'content', 'id'],
  },
  {
    plain: { element: 'progress', label: 'Disk', value: '5', max: '10', content: 'half', id: 'up' },
    free: ['label', 'content', 'id'],
  },
  {
    plain: {
      element: 'blockquote',
      paragraphs: 'Words',
      citeUrl: 'source.html',
      attribution: 'A. Writer',
      workTitle: 'A Book',
    },
    free: ['paragraphs', 'citeUrl', 'attribution', 'workTitle'],
  },
  {
    plain: { element: 'figure', imageUrl: 'pic.png', alt: 'A chart', caption: 'Sales', width: '320', height: '200' },
    free: ['imageUrl', 'alt', 'caption'],
  },
  { plain: { element: 'time', content: 'today', datetime: '2011-11-18' }, free: ['content'] },
  { plain: { element: 'abbr', content: 'WHATWG', title: 'Expansion' }, free: ['content', 'title'] },
  { plain: { element: 'mark', before: 'a ', content: 'b', after: ' c' }, free: ['before', 'content', 'after'] },
  { plain: { element: 'sub', before: 'a ', content: 'b', after: ' c' }, free: ['before', 'content', 'after'] },
  { plain: { element: 'sup', before: 'a ', content: 'b', after: ' c' }, free: ['before', 'content', 'after'] },
  {
    plain: { element: 'del', before: 'a ', content: 'b', after: ' c', citeUrl: 'x.html', datetime: '2011-11-18' },
    free: ['before', 'content', 'after', 'citeUrl'],
  },
  {
    plain: { element: 'ins', before: 'a ', content: 'b', after: ' c', citeUrl: 'x.html', datetime: '2011-11-18' },
    free: ['before', 'content', 'after', 'citeUrl'],
  },
  { plain: { element: 'kbd', before: 'a ', content: 'b', after: ' c' }, free: ['before', 'content', 'after'] },
];

it('hostile text in every free-text field leaves the parsed tree unchanged', () => {
  expect(FREE_TEXT.map((entry) => entry.plain.element).sort()).toEqual([...SEMANTIC_ELEMENTS].sort());
  for (const { plain, free } of FREE_TEXT) {
    const baseline = buildElement(plain);
    if (baseline === null) throw new Error(`${plain.element}: the plain spec gives no output`);
    const expected = shape(parse(baseline.html).frag);
    expect(parse(baseline.html).errors, plain.element).toEqual([]);
    for (const field of free) {
      for (const value of HOSTILE) {
        let built;
        try {
          built = buildElement({ ...plain, [field]: value } as ElementSpec);
        } catch (err) {
          // A value HTML cannot carry (a control character) or an id that holds a space is refused naming a field.
          expect(err, `${plain.element} ${String(field)}`).toBeInstanceOf(MarkupError);
          continue;
        }
        if (built === null) throw new Error(`${plain.element} ${String(field)}: hostile text gives no output`);
        const parsed = parse(built.html);
        expect(parsed.errors, `${plain.element} ${String(field)} ${value.slice(0, 20)}`).toEqual([]);
        expect(shape(parsed.frag), `${plain.element} ${String(field)} ${value.slice(0, 20)}`).toBe(expected);
        // The preview parses cleanly too and holds no address or handler.
        const preview = parse(built.preview);
        expect(preview.errors).toEqual([]);
        for (const tag of ['img', 'blockquote', 'del', 'ins']) {
          for (const node of findAll(preview.frag, tag)) {
            expect(attrOf(node, 'cite')).toBeUndefined();
            const src = attrOf(node, 'src');
            if (src !== undefined) expect(src.startsWith('data:image/svg+xml,')).toBe(true);
          }
        }
      }
    }
  }
});

it('blank content gives no output and a meter without a value is reported naming the field', () => {
  for (const element of SEMANTIC_ELEMENTS) {
    expect(buildElement({ element }), `${element} with nothing typed`).toBeNull();
    expect(buildElement({ element, content: '   ' }), `${element} with only spaces`).toBeNull();
  }
  // Once any other field is filled, the field the element needs is named.
  const needs: [ElementSpec, string][] = [
    [{ element: 'details', paragraphs: 'Hidden' }, 'Summary'],
    [{ element: 'time', datetime: '2011-11-18' }, 'Text'],
    [{ element: 'abbr', title: 'Expansion' }, 'Text'],
    [{ element: 'mark', before: 'a' }, 'Text'],
    [{ element: 'sub', after: 'a' }, 'Text'],
    [{ element: 'sup', before: 'a' }, 'Text'],
    [{ element: 'kbd', after: 'a' }, 'Text'],
    [{ element: 'ins', citeUrl: 'x.html' }, 'Text'],
    [{ element: 'del', datetime: '2011-11-18' }, 'Text'],
    [{ element: 'blockquote', workTitle: 'A Book' }, 'Content'],
    [{ element: 'figure', caption: 'Sales' }, 'Image address'],
    [{ element: 'figure', imageUrl: 'pic.png' }, 'Alt text'],
    [{ element: 'meter', label: 'Disk' }, 'Value'],
    [{ element: 'meter', min: '0', max: '10' }, 'Label'],
  ];
  for (const [spec, field] of needs) {
    expect(refusal(spec)?.field, `${spec.element} ${JSON.stringify(spec)}`).toBe(field);
  }
  // A progress bar without a value is valid and indeterminate.
  expect(refusal({ element: 'progress', label: 'Disk' })).toBeNull();
  // A checked box and a blank list of choices alone give no output.
  expect(buildElement({ element: 'details', open: true })).toBeNull();
  expect(buildElement({ element: 'figure', captionAt: 'first' })).toBeNull();
});
