import { it, expect } from 'vitest';
import { MarkupError, assertSafeText, el, escapeAttr, escapeText, inert, serialize, type El } from '../src/markup';
import { findAll, parse } from './parse';

it('escapeText replaces ampersand, less-than and greater-than and nothing else', () => {
  expect(escapeText('a & <b> "c" \'d\'')).toBe('a &amp; &lt;b&gt; "c" \'d\'');
  // The ampersand goes first, so an entity typed by a visitor stays visible text.
  expect(escapeText('&lt;')).toBe('&amp;lt;');
  expect(escapeText('')).toBe('');
});

it('escapeAttr also replaces the double quote so an attribute value can never end early', () => {
  expect(escapeAttr('a & <b> "c"')).toBe('a &amp; &lt;b&gt; &quot;c&quot;');
  expect(escapeAttr('x" onmouseover="alert(1)')).toBe('x&quot; onmouseover=&quot;alert(1)');
  // The single quote is left alone because every attribute is written in double quotes.
  expect(escapeAttr("it's")).toBe("it's");
});

it('serialize writes void elements without an end tag, boolean attributes bare and every value in double quotes', () => {
  expect(
    serialize(
      el('input', [
        ['type', 'text'],
        ['required', true],
      ]),
    ),
  ).toBe('<input type="text" required>');
  expect(serialize(el('img', [['alt', '']]))).toBe('<img alt="">');
  // Attributes whose value is undefined, null or false are dropped.
  expect(
    serialize(
      el('input', [
        ['type', 'text'],
        ['id', undefined],
        ['disabled', false],
        ['name', null],
      ]),
    ),
  ).toBe('<input type="text">');
  // An element with a text child is written on one line, with its text escaped.
  expect(serialize(el('p', [], ['a & ', el('b', [], ['<x>'])]))).toBe('<p>a &amp; <b>&lt;x&gt;</b></p>');
  // Top-level nodes each go on their own line.
  expect(serialize([el('label', [['for', 'fn']], ['Full name:']), el('input', [['id', 'fn']])])).toBe(
    '<label for="fn">Full name:</label>\n<input id="fn">',
  );
  // An element whose children are all elements writes each child on its own line, two spaces deeper.
  expect(serialize(el('fieldset', [], [el('legend', [], ['Pick one']), el('input', [['type', 'radio']])]))).toBe(
    '<fieldset>\n  <legend>Pick one</legend>\n  <input type="radio">\n</fieldset>',
  );
  expect(serialize(el('div'))).toBe('<div></div>');
  // The parser drops one line feed right after a textarea or pre start tag, so one extra is written.
  expect(serialize(el('textarea', [], ['\nline1']))).toBe('<textarea>\n\nline1</textarea>');
  expect(serialize(el('textarea', [], ['line1']))).toBe('<textarea>line1</textarea>');
});

it('every serialized tree parses with parse5 with zero parse errors', () => {
  const hostile = '"><img src=x onerror="alert(1)"><script>x</script> & &amp; \'';
  const tree = [
    el('label', [['for', 'a']], [hostile]),
    el('input', [
      ['type', 'text'],
      ['id', 'a'],
      ['name', hostile],
      ['value', hostile],
      ['required', true],
    ]),
    el('textarea', [['id', 'b']], ['\n' + hostile]),
    el(
      'fieldset',
      [],
      [
        el('legend', [], [hostile]),
        el('input', [
          ['type', 'radio'],
          ['value', hostile],
        ]),
      ],
    ),
  ];
  const { frag, errors } = parse(serialize(tree));
  expect(errors).toEqual([]);
  // Hostile text stayed text: the parse found only the elements we built.
  expect(findAll(frag, 'script')).toHaveLength(0);
  expect(findAll(frag, 'img')).toHaveLength(0);
  expect(findAll(frag, 'input')).toHaveLength(2);
});

it('control characters, noncharacters and lone surrogates are refused naming the field and the code point', () => {
  const refused: [string, string][] = [
    ['a' + String.fromCharCode(0) + 'b', 'U+0000'],
    ['a' + String.fromCharCode(1) + 'b', 'U+0001'],
    ['a' + String.fromCharCode(0x7f) + 'b', 'U+007F'],
    ['a' + String.fromCharCode(0x85) + 'b', 'U+0085'],
    ['a' + String.fromCharCode(0xfdd0) + 'b', 'U+FDD0'],
    ['a' + String.fromCharCode(0xfffe) + 'b', 'U+FFFE'],
    ['a' + String.fromCodePoint(0x1ffff) + 'b', 'U+1FFFF'],
    ['a' + String.fromCharCode(0xd800) + 'b', 'U+D800'],
    ['a' + String.fromCharCode(0xdc00), 'U+DC00'],
    ['line one\nline two', 'U+000A'],
    ['carriage\rreturn', 'U+000D'],
  ];
  for (const [value, point] of refused) {
    let caught: unknown;
    try {
      assertSafeText(value, 'Label');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MarkupError);
    expect((caught as MarkupError).field).toBe('Label');
    expect((caught as MarkupError).name).toBe('MarkupError');
    expect((caught as MarkupError).message).toContain(point);
  }
  // A tab, an emoji (a surrogate pair), right-to-left text and combining marks are fine.
  expect(() => assertSafeText('a\tb \u{1F600} אב é', 'Label')).not.toThrow();
  // Line feed and carriage return are allowed in a multi-line field only.
  expect(() => assertSafeText('a\r\nb\nc', 'Starting value', { multiline: true })).not.toThrow();
  // The default cap is 20,000 UTF-16 code units, and a field can pass a smaller one.
  expect(() => assertSafeText('x'.repeat(20000), 'Label')).not.toThrow();
  expect(() => assertSafeText('x'.repeat(20001), 'Label')).toThrow(/20,000/);
  expect(() => assertSafeText('x'.repeat(11), 'Label', { max: 10 })).toThrow(/10/);
});

it('inert removes or replaces every address-bearing attribute and keeps the rest of the tree', () => {
  const tree: El[] = [
    el('img', [
      ['src', 'https://example.invalid/a.png'],
      ['srcset', 'https://example.invalid/a.png 2x'],
      ['alt', 'A'],
      ['width', '40'],
      ['height', '20'],
    ]),
    el(
      'a',
      [
        ['href', 'https://example.invalid/x'],
        ['ping', 'https://example.invalid/p'],
        ['rel', 'nofollow'],
      ],
      ['Link'],
    ),
    el('area', [
      ['href', 'https://example.invalid/y'],
      ['alt', 'Area'],
    ]),
    el(
      'form',
      [
        ['action', 'https://example.invalid/f'],
        ['method', 'post'],
      ],
      [
        el('input', [
          ['type', 'image'],
          ['src', 'https://example.invalid/b.png'],
          ['alt', 'Go'],
          ['formaction', 'https://example.invalid/g'],
        ]),
        el(
          'button',
          [
            ['type', 'submit'],
            ['formaction', 'https://example.invalid/h'],
          ],
          ['Send'],
        ),
        el('input', [
          ['type', 'text'],
          ['name', 'q'],
        ]),
      ],
    ),
  ];
  const before = JSON.stringify(tree);
  const out = inert(tree);
  // The input tree is never mutated.
  expect(JSON.stringify(tree)).toBe(before);

  const html = serialize(out);
  const { frag, errors } = parse(html);
  expect(errors).toEqual([]);
  const urlAttrs = [
    'src',
    'srcset',
    'poster',
    'href',
    'action',
    'formaction',
    'data',
    'cite',
    'ping',
    'background',
    'manifest',
  ];
  const walk = (nodes: ReturnType<typeof findAll>): void => {
    for (const n of nodes) {
      for (const a of n.attrs) {
        if (urlAttrs.includes(a.name)) expect(a.value.startsWith('data:image/svg+xml')).toBe(true);
      }
    }
  };
  for (const tag of ['img', 'a', 'area', 'form', 'input', 'button']) walk(findAll(frag, tag));
  const img = findAll(frag, 'img')[0]!;
  expect(img.attrs.find((a) => a.name === 'src')?.value.startsWith('data:image/svg+xml')).toBe(true);
  expect(img.attrs.some((a) => a.name === 'srcset')).toBe(false);
  expect(img.attrs.find((a) => a.name === 'alt')?.value).toBe('A');
  const link = findAll(frag, 'a')[0]!;
  expect(link.attrs.map((a) => a.name)).toEqual(['rel']);
  expect(findAll(frag, 'area')[0]!.attrs.map((a) => a.name)).toEqual(['alt']);
  expect(findAll(frag, 'form')[0]!.attrs.map((a) => a.name)).toEqual(['method']);
  expect(findAll(frag, 'button')[0]!.attrs.map((a) => a.name)).toEqual(['type']);
  const imageInput = findAll(frag, 'input').find((i) => i.attrs.some((a) => a.name === 'type' && a.value === 'image'))!;
  expect(imageInput.attrs.map((a) => a.name)).toEqual(['type', 'src', 'alt']);
  expect(html).not.toContain('example.invalid');
  // Everything else survives: the text, the other attributes and the nesting.
  expect(findAll(frag, 'form')[0]!.childNodes.filter((c) => 'tagName' in c)).toHaveLength(3);
});
