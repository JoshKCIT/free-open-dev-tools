import { it, expect } from 'vitest';
import {
  MarkupError,
  assertSafeText,
  el,
  escapeAttr,
  escapeText,
  inert,
  placeholderImage,
  riskyScheme,
  schemeWarning,
  serialize,
  urlScheme,
  type El,
} from '../src/markup';
import { HOSTILE, attrOf, findAll, hasControlCharacter, parse, shape, textOf } from './parse';

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

it('a hostile value in any text or attribute leaves the parsed tree unchanged apart from text and values', () => {
  const build = (text: string, attr: string): El[] => [
    el(
      'label',
      [
        ['for', 'a'],
        ['title', attr],
      ],
      [text],
    ),
    el('input', [
      ['type', 'text'],
      ['id', 'a'],
      ['name', attr],
      ['value', attr],
      ['placeholder', attr],
    ]),
    el(
      'textarea',
      [
        ['id', 'b'],
        ['title', attr],
      ],
      [text],
    ),
    el('select', [['id', 'c']], [el('option', [['value', attr]], [text])]),
    el(
      'a',
      [
        ['href', attr],
        ['rel', 'nofollow'],
      ],
      [text],
    ),
    el(
      'video',
      [['poster', attr]],
      [
        el('track', [
          ['kind', 'subtitles'],
          ['src', attr],
          ['label', attr],
        ]),
      ],
    ),
    el('p', [], [text, el('b', [], [text])]),
  ];
  const benign = shape(parse(serialize(build('plain', 'plain'))).frag);
  for (const hostile of HOSTILE) {
    if (hasControlCharacter(hostile)) continue;
    const html = serialize(build(hostile, hostile));
    const { frag, errors } = parse(html);
    expect(errors, hostile.slice(0, 30)).toEqual([]);
    expect(shape(frag), hostile.slice(0, 30)).toBe(benign);
    expect(findAll(frag, 'script')).toHaveLength(0);
    expect(findAll(frag, 'img')).toHaveLength(0);
    // The preview of the same tree is just as unchanged, and carries no address of the visitor.
    const preview = serialize(inert(build(hostile, hostile)));
    expect(parse(preview).errors, hostile.slice(0, 30)).toEqual([]);
    expect(findAll(parse(preview).frag, 'script')).toHaveLength(0);
  }
  // An entity typed by a visitor stays visible text and is not decoded.
  const entity = parse(serialize(el('p', [], ['&#106;avascript:alert(1) &lt;b&gt;'])));
  expect(textOf(findAll(entity.frag, 'p')[0]!)).toBe('&#106;avascript:alert(1) &lt;b&gt;');
  const attr = parse(serialize(el('a', [['href', '&#106;avascript:alert(1)']], ['x'])));
  expect(attrOf(findAll(attr.frag, 'a')[0]!, 'href')).toBe('&#106;avascript:alert(1)');
});

it('el refuses event handler attributes, duplicate attributes and the script, style, iframe, object, embed, base, link and meta elements', () => {
  const refused = (run: () => unknown): MarkupError => {
    try {
      run();
    } catch (e) {
      if (e instanceof MarkupError) return e;
      throw e;
    }
    throw new Error('expected a MarkupError');
  };
  for (const tag of [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'base',
    'link',
    'meta',
    'frame',
    'frameset',
    'template',
    'noscript',
  ]) {
    expect(refused(() => el(tag)).message, tag).toContain(tag);
  }
  for (const name of ['onclick', 'onerror', 'onmouseover', 'onload', 'onfocus']) {
    expect(refused(() => el('div', [[name, 'x']])).message, name).toContain('event handler');
  }
  expect(
    refused(() =>
      el('input', [
        ['id', 'a'],
        ['id', 'b'],
      ]),
    ).message,
  ).toContain('twice');
  // A repeated name is only a problem when both survive: a dropped one does not count.
  expect(() =>
    el('input', [
      ['id', 'a'],
      ['id', undefined],
    ]),
  ).not.toThrow();
  // Names are lowercase ASCII letters, digits and hyphens starting with a letter.
  for (const tag of ['', 'Div', '1div', 'a b', 'a>b', 'a"b', 'a/b', 'a_b'])
    expect(() => el(tag), tag).toThrow(MarkupError);
  for (const name of ['', 'Id', '1id', 'a b', 'a=b', 'a"b', 'a>b'])
    expect(() => el('div', [[name, 'x']]), name).toThrow(MarkupError);
  expect(() =>
    el('div', [
      ['data-x', 'y'],
      ['aria-label', 'z'],
    ]),
  ).not.toThrow();
  // A void element has no children, and falsy children are dropped.
  expect(() => el('input', [], ['x'])).toThrow(MarkupError);
  expect(el('p', [], [false, null, undefined, 'x']).children).toEqual(['x']);
});

it('a javascript, data or vbscript scheme is detected the way the URL Standard parses it, including tab-split and leading-space forms', () => {
  // The URL Standard strips leading and trailing C0 controls and spaces and removes tabs and newlines first.
  expect(urlScheme('javascript:alert(1)')).toBe('javascript');
  expect(urlScheme('JaVaScRiPt:alert(1)')).toBe('javascript');
  expect(urlScheme('java\tscript:alert(1)')).toBe('javascript');
  expect(urlScheme('java\nscript:alert(1)')).toBe('javascript');
  expect(urlScheme('   javascript:alert(1)')).toBe('javascript');
  expect(urlScheme('\u0001\u0001 javascript:alert(1)')).toBe('javascript');
  expect(urlScheme('https://example.invalid/x')).toBe('https');
  expect(urlScheme('mailto:a@example.invalid')).toBe('mailto');
  // Relative and malformed forms have no scheme.
  expect(urlScheme('//example.invalid/x')).toBeNull();
  expect(urlScheme('/path/x')).toBeNull();
  expect(urlScheme('image.png')).toBeNull();
  expect(urlScheme('&#106;avascript:alert(1)')).toBeNull();
  expect(urlScheme('')).toBeNull();

  expect(riskyScheme('javascript:alert(1)')).toBe('javascript');
  expect(riskyScheme('JaVaScRiPt:alert(1)')).toBe('javascript');
  expect(riskyScheme('java\tscript:alert(1)')).toBe('javascript');
  expect(riskyScheme('  javascript:alert(1)')).toBe('javascript');
  expect(riskyScheme('data:text/html;base64,PHNjcmlwdD4=')).toBe('data');
  expect(riskyScheme('vbscript:x')).toBe('vbscript');
  expect(riskyScheme('https://example.invalid/x')).toBeNull();
  expect(riskyScheme('//example.invalid/x')).toBeNull();
  expect(riskyScheme('mailto:a@example.invalid')).toBeNull();

  expect(schemeWarning('Image address', 'javascript:alert(1)')).toBe(
    'Image address: this address uses the javascript: scheme, which runs or embeds content when followed; it is kept as you typed it.',
  );
  expect(schemeWarning('Link', 'data:text/html,x')).toContain('data: scheme');
  expect(schemeWarning('Link', 'vbscript:x')).toContain('vbscript: scheme');
  expect(schemeWarning('Link', 'https://example.invalid/x')).toBeNull();
  expect(schemeWarning('Link', '')).toBeNull();
});

it('the inert placeholder is a data URI SVG sized from width and height', () => {
  const placeholder = placeholderImage(40, 20);
  expect(placeholder.startsWith('data:image/svg+xml,')).toBe(true);
  const svg = decodeURIComponent(placeholder.slice('data:image/svg+xml,'.length));
  expect(svg).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="100%" height="100%" fill="#ddd"/></svg>',
  );
  // The default is 300 by 150, and each side is clamped to 1 to 4000.
  expect(decodeURIComponent(placeholderImage())).toContain('width="300" height="150"');
  expect(decodeURIComponent(placeholderImage(0, 99999))).toContain('width="1" height="4000"');
  // It is safe inside a double-quoted attribute and inside a srcset: no quote, space or comma after the prefix.
  expect(placeholder.slice('data:image/svg+xml,'.length)).not.toMatch(/["\s,<>]/);
  // The inert pass sizes it from the element's own width and height, and falls back to the default.
  const sized = inert(
    el('img', [
      ['src', 'https://example.invalid/a.png'],
      ['alt', 'A'],
      ['width', '64'],
      ['height', '48'],
    ]),
  );
  expect(serialize(sized)).toContain(encodeURIComponent('width="64" height="48"'));
  expect(
    serialize(
      inert(
        el('img', [
          ['src', 'a.png'],
          ['alt', ''],
          ['width', 'wide'],
        ]),
      ),
    ),
  ).toContain(encodeURIComponent('width="300" height="150"'));
});

it('inert drops the sources of video and audio, empties track addresses and gives picture sources the placeholder', () => {
  const video = el(
    'video',
    [
      ['src', 'https://example.invalid/v.mp4'],
      ['poster', 'https://example.invalid/p.png'],
      ['controls', true],
    ],
    [
      el('source', [
        ['src', 'https://example.invalid/v.webm'],
        ['type', 'video/webm'],
      ]),
      el('source', [
        ['src', 'https://example.invalid/v.mp4'],
        ['type', 'video/mp4'],
      ]),
      el('track', [
        ['kind', 'subtitles'],
        ['src', 'https://example.invalid/en.vtt'],
        ['srclang', 'en'],
        ['label', 'English'],
      ]),
    ],
  );
  const audio = el(
    'audio',
    [
      ['src', 'https://example.invalid/a.mp3'],
      ['controls', true],
    ],
    [
      el('source', [
        ['src', 'https://example.invalid/a.ogg'],
        ['type', 'audio/ogg'],
      ]),
    ],
  );
  const picture = el(
    'picture',
    [],
    [
      el('source', [
        ['srcset', 'https://example.invalid/wide.avif 1x, https://example.invalid/wide2.avif 2x'],
        ['type', 'image/avif'],
        ['media', '(min-width: 800px)'],
      ]),
      el('source', [
        ['srcset', 'https://example.invalid/mid.webp'],
        ['type', 'image/webp'],
      ]),
      el('img', [
        ['src', 'https://example.invalid/fallback.jpg'],
        ['srcset', 'https://example.invalid/fallback-2x.jpg 2x'],
        ['alt', 'Photo'],
        ['width', '120'],
        ['height', '80'],
      ]),
    ],
  );
  const html = serialize(inert([video, audio, picture]));
  expect(html).not.toContain('example.invalid');
  const { frag, errors } = parse(html);
  expect(errors).toEqual([]);
  const v = findAll(frag, 'video')[0]!;
  expect(v.attrs.map((a) => a.name)).toEqual(['controls']);
  expect(findAll(v, 'source')).toHaveLength(0);
  const track = findAll(v, 'track')[0]!;
  expect(track.attrs.map((a) => a.name)).toEqual(['kind', 'srclang', 'label']);
  const a = findAll(frag, 'audio')[0]!;
  expect(a.attrs.map((x) => x.name)).toEqual(['controls']);
  expect(findAll(a, 'source')).toHaveLength(0);
  // Each picture source keeps its media condition and gets a placeholder in srcset, typed as SVG, sized from the img.
  const sources = findAll(frag, 'source').filter((s) => !s.attrs.some((x) => x.name === 'src'));
  expect(sources).toHaveLength(2);
  for (const s of sources) {
    const srcset = attrOf(s, 'srcset')!;
    expect(srcset.startsWith('data:image/svg+xml,')).toBe(true);
    expect(srcset).not.toMatch(/\s/);
    expect(decodeURIComponent(srcset)).toContain('width="120" height="80"');
    expect(attrOf(s, 'type')).toBe('image/svg+xml');
  }
  expect(attrOf(sources[0]!, 'media')).toBe('(min-width: 800px)');
  expect(attrOf(sources[1]!, 'media')).toBeUndefined();
  const img = findAll(frag, 'img')[0]!;
  expect(img.attrs.map((x) => x.name)).toEqual(['src', 'alt', 'width', 'height']);
  // A source with its own width and height uses them, and one without a type gets none added.
  const own = serialize(
    inert(
      el(
        'picture',
        [],
        [
          el('source', [
            ['srcset', 'a.png'],
            ['width', '10'],
            ['height', '5'],
          ]),
          el('img', [
            ['src', 'b.png'],
            ['alt', ''],
          ]),
        ],
      ),
    ),
  );
  expect(own).toContain(encodeURIComponent('width="10" height="5"'));
  expect(findAll(parse(own).frag, 'source')[0]!.attrs.map((x) => x.name)).toEqual(['srcset', 'width', 'height']);
  // Citations, plugin data and the other address attributes go too, and the input tree is never changed.
  const cites = [
    el('blockquote', [['cite', 'https://example.invalid/q']], ['Quoted']),
    el('q', [['cite', 'https://example.invalid/q']], ['Quoted']),
    el(
      'ins',
      [
        ['cite', 'https://example.invalid/i'],
        ['datetime', '2011-11-18'],
      ],
      ['New'],
    ),
    el(
      'del',
      [
        ['cite', 'https://example.invalid/d'],
        ['datetime', '2011-11-18'],
      ],
      ['Old'],
    ),
  ];
  const before = JSON.stringify(cites);
  const out = serialize(inert(cites));
  expect(out).not.toContain('example.invalid');
  expect(out).not.toContain('cite=');
  expect(out).toContain('datetime="2011-11-18"');
  expect(JSON.stringify(cites)).toBe(before);
  const object: El = {
    tag: 'object',
    attrs: [
      ['data', 'https://example.invalid/x.swf'],
      ['type', 'application/x-shockwave-flash'],
    ],
    children: [],
  };
  expect(serialize(inert(object))).toBe('<object type="application/x-shockwave-flash"></object>');
  const stray: El = {
    tag: 'div',
    attrs: [
      ['background', 'https://example.invalid/b.png'],
      ['manifest', 'x'],
      ['ping', 'y'],
      ['id', 'k'],
    ],
    children: [],
  };
  expect(serialize(inert(stray))).toBe('<div id="k"></div>');
});

it('a textarea or pre whose text starts with a line break keeps it after parsing', () => {
  // The parser drops one line feed right after the start tag (WHATWG 13.2.6.4), so the serializer writes one extra.
  const textarea = serialize(el('textarea', [['id', 'x']], ['\nline1\nline2']));
  expect(textarea).toBe('<textarea id="x">\n\nline1\nline2</textarea>');
  const parsed = parse(textarea);
  expect(parsed.errors).toEqual([]);
  expect(textOf(findAll(parsed.frag, 'textarea')[0]!)).toBe('\nline1\nline2');
  const pre = serialize(el('pre', [], ['\nfirst']));
  expect(textOf(findAll(parse(pre).frag, 'pre')[0]!)).toBe('\nfirst');
  // A carriage return counts as a line break too, and text without one gets no extra line feed.
  expect(textOf(findAll(parse(serialize(el('textarea', [], ['\r\nx']))).frag, 'textarea')[0]!)).toBe('\nx');
  expect(textOf(findAll(parse(serialize(el('textarea', [], ['x\ny']))).frag, 'textarea')[0]!)).toBe('x\ny');
  expect(serialize(el('textarea', [], ['x']))).toBe('<textarea>x</textarea>');
  // A closing tag typed into a textarea stays text.
  const closing = parse(serialize(el('textarea', [], ['</textarea><script>x</script>'])));
  expect(findAll(closing.frag, 'script')).toHaveLength(0);
  expect(textOf(findAll(closing.frag, 'textarea')[0]!)).toBe('</textarea><script>x</script>');
});
