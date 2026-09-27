import { it, expect, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { generatePlaceholder, MAX_SVG_SIDE } from '../src/index';

it('the SVG has the requested width, height and viewBox and escapes the label text', () => {
  const result = generatePlaceholder({ width: 640, height: 360 });
  expect(result.width).toBe(640);
  expect(result.height).toBe(360);
  expect(result.svg).toContain('width="640"');
  expect(result.svg).toContain('height="360"');
  expect(result.svg).toContain('viewBox="0 0 640 360"');
  expect(result.label).toBe('640 × 360');
  expect(result.svg).toContain('640 × 360');

  const custom = generatePlaceholder({ width: 10, height: 10, label: '<b>&"quote"</b>' });
  expect(custom.svg).toContain('&lt;b&gt;&amp;"quote"&lt;/b&gt;');
  expect(custom.svg).not.toContain('<b>');
});

it('hostile label text never produces markup, a script, an event handler or a reference to another resource', () => {
  const hostile = generatePlaceholder({
    // Kept within the 80-character label limit so truncation never clips
    // part of the payload out from under this test's own exact-count checks.
    label: '</text><script>x</script><img href="x" onerror="y" style="url(x)">',
  });
  // Nothing from the label ever becomes a real tag: every `<` the label
  // contributed is escaped, so the only literal `<` characters left in the
  // whole document are this tool's own five fixed elements' own tags.
  const realTags = hostile.svg.match(/<[a-zA-Z/][^>]*>/g) ?? [];
  for (const tag of realTags) {
    expect(['<svg', '<rect', '<text', '</text', '</svg']).toContain(tag.match(/^<\/?[a-zA-Z]+/)![0]);
  }
  // The whole hostile string survives only as escaped text content, never
  // as an attribute value or another element -- so `href`, `url(` and the
  // event handler each appear exactly where the escaped label put them,
  // and only once, not duplicated into some other, unescaped role.
  const textMatch = hostile.svg.match(/<text[^>]*>([\s\S]*)<\/text>/);
  expect(textMatch).not.toBeNull();
  const textContent = textMatch![1]!;
  expect(textContent).toContain('&lt;script&gt;x&lt;/script&gt;');
  expect(textContent).toContain('href=');
  expect((hostile.svg.match(/href=/g) ?? []).length).toBe(1);
  expect((hostile.svg.match(/url\(/g) ?? []).length).toBe(1);
  expect((hostile.svg.match(/onerror=/g) ?? []).length).toBe(1);
});

it('sizes are clamped to the stated maximum with a warning naming the field', () => {
  const zero = generatePlaceholder({ width: 0 });
  expect(zero.width).toBe(1);
  expect(zero.warnings.some((w) => w.includes('width'))).toBe(true);

  const negative = generatePlaceholder({ height: -5 });
  expect(negative.height).toBe(1);
  expect(negative.warnings.some((w) => w.includes('height'))).toBe(true);

  const nan = generatePlaceholder({ width: NaN });
  expect(nan.width).toBe(640);
  expect(nan.warnings.some((w) => w.includes('width'))).toBe(true);

  const tooBig = generatePlaceholder({ width: MAX_SVG_SIDE + 5000 });
  expect(tooBig.width).toBe(MAX_SVG_SIDE);
  expect(tooBig.warnings.some((w) => w.includes('width'))).toBe(true);

  const fine = generatePlaceholder({ width: 200 });
  expect(fine.warnings).toEqual([]);
});

it('colours are accepted only as hash colours and written back in lower case', () => {
  const shortHex = generatePlaceholder({ background: '#F00' });
  expect(shortHex.svg).toContain('fill="#ff0000"');

  const longHex = generatePlaceholder({ background: '#AABBCC' });
  expect(longHex.svg).toContain('fill="#aabbcc"');

  const invalid = generatePlaceholder({ background: 'red;fill:url(#x)' });
  expect(invalid.svg).toContain('fill="#cccccc"'); // default background
  expect(invalid.warnings.some((w) => w.includes('background'))).toBe(true);
  expect(invalid.svg).not.toContain('url(');
});

it('the SVG is well-formed XML with only the elements the placeholder needs', () => {
  const result = generatePlaceholder({ width: 100, height: 50, pattern: 'grid' });
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (_level: string, msg: string) => errors.push(msg),
  });
  const doc = parser.parseFromString(result.svg, 'image/svg+xml');
  expect(errors).toEqual([]);
  expect(doc.documentElement?.nodeName).toBe('svg');

  const allowed = new Set(['svg', 'rect', 'line', 'text']);
  const walk = (node: Element): void => {
    expect(allowed.has(node.nodeName)).toBe(true);
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes.item(i);
      if (child && child.nodeType === 1) walk(child as unknown as Element);
    }
  };
  walk(doc.documentElement as unknown as Element);
});

it('the data URI decodes back to exactly the SVG', () => {
  const result = generatePlaceholder({ width: 320, height: 180, label: 'A test label & more' });
  expect(result.dataUri.startsWith('data:image/svg+xml,')).toBe(true);
  const decoded = decodeURIComponent(result.dataUri.slice('data:image/svg+xml,'.length));
  expect(decoded).toBe(result.svg);
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generatePlaceholder({
      width: -1,
      height: NaN,
      background: 'not-a-colour',
      label: 'x'.repeat(200),
      pattern: 'grid',
    });
    generatePlaceholder({ width: 100, height: 100, pattern: 'cross' });
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});
