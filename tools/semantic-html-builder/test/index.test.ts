import { it, expect } from 'vitest';
import { MarkupError, buildElement, meta, type ElementSpec } from '../src/index';
import { serialize, inert } from '../src/markup';
import { HOSTILE, attrOf, findAll, parse, shape, textOf } from './parse';

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
