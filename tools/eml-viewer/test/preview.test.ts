/**
 * The HTML preview. Only small, shallow markup is given to jsdom: deep or large markup is refused by the pre-scan before
 * any DOM call, and its test checks the refusal and a time ratio on the scan only (never feed deep markup to jsdom).
 */
import { it, expect } from 'vitest';
import type { WindowLike } from 'dompurify';
import {
  MAX_CID_IMAGE_BYTES,
  MAX_HTML_DEPTH,
  MAX_HTML_PREVIEW_BYTES,
  MAX_HTML_TAGS,
  previewHtml,
  scanHtml,
} from '../src/index';
import { loadHostile, makeWindow, pngBytes } from './helpers';

it('no anchor keeps href, target, ping or rel after the post-pass', () => {
  const win = makeWindow();
  const html =
    '<p>See <a href="https://example.test/menu" target="_blank" ping="https://example.test/ping" rel="noopener">the menu</a> or ' +
    '<a href="mailto:alice@example.test" rel="nofollow">write</a> or <a href="#top" target="_top">top</a>.</p>';
  const result = previewHtml(html, win, []);
  expect(result.status).toBe('shown');
  if (result.status !== 'shown') return;

  // What the visitor's frame will read: parse the result and look at every anchor.
  const doc = new (win as unknown as { DOMParser: typeof DOMParser }).DOMParser().parseFromString(
    result.html,
    'text/html',
  );
  const anchors = Array.from(doc.querySelectorAll('a'));
  expect(anchors.length).toBe(3);
  for (const anchor of anchors) {
    for (const name of ['href', 'target', 'ping', 'rel']) {
      expect(anchor.hasAttribute(name), `an anchor kept ${name}`).toBe(false);
    }
  }
  // The anchors' text survives and the targets are listed as text instead.
  expect(doc.body.textContent).toContain('the menu');
  expect(result.links.map((l) => l.target)).toEqual(['https://example.test/menu', 'mailto:alice@example.test', '#top']);
  expect(result.links.map((l) => l.text)).toEqual(['the menu', 'write', 'top']);
});

/** A window whose parser throws: proves a refusal happened before any DOM call. */
function untouchableWindow(): WindowLike {
  return {
    get DOMParser(): never {
      throw new Error('the DOM was touched');
    },
    get document(): never {
      throw new Error('the DOM was touched');
    },
  } as unknown as WindowLike;
}

const shownHtml = (result: ReturnType<typeof previewHtml>): string => {
  expect(result.status).toBe('shown');
  return result.status === 'shown' ? result.html : '';
};

it('the HTML pre-scan refuses over 1 MiB, more than 20,000 tags or a depth over 200 before any DOM call', () => {
  const win = untouchableWindow();
  const refused = (html: string, reason: RegExp): void => {
    const result = previewHtml(html, win, []);
    expect(result.status).toBe('skipped');
    expect(result.status === 'skipped' ? result.reason : '').toMatch(reason);
    expect(result.blocked).toEqual([]);
    expect(result.links).toEqual([]);
  };

  // Size: bytes, not characters, and 1 MiB itself is allowed.
  refused('a'.repeat(MAX_HTML_PREVIEW_BYTES + 1), /larger than 1 MiB/);
  refused(String.fromCodePoint(0x20ac).repeat(Math.floor(MAX_HTML_PREVIEW_BYTES / 3) + 1), /larger than 1 MiB/);
  expect(scanHtml('a'.repeat(MAX_HTML_PREVIEW_BYTES))).toEqual({ ok: true });

  // Tags: the number of < characters, 20,000 allowed, 20,001 refused.
  expect(scanHtml('<br>'.repeat(MAX_HTML_TAGS))).toEqual({ ok: true });
  refused('<br>'.repeat(MAX_HTML_TAGS + 1), /more than 20,000 tags/);
  refused('<'.repeat(MAX_HTML_TAGS + 1), /more than 20,000 tags/);

  // Depth: 200 open elements allowed, 201 refused, and the scan stops at 201 whatever follows.
  expect(scanHtml('<div>'.repeat(MAX_HTML_DEPTH))).toEqual({ ok: true });
  refused('<div>'.repeat(MAX_HTML_DEPTH + 1), /deeper than 200 levels/);
  refused('<div>'.repeat(5_000), /deeper than 200 levels/);
  refused('<a><b>'.repeat(101), /deeper than 200 levels/);
  // Closing tags bring the depth back, so a long document of shallow elements is fine.
  expect(scanHtml('<div><p>x</p></div>'.repeat(5_000))).toEqual({ ok: true });
  // Elements whose end tag is optional do not pile up: a thousand paragraphs or list items are one level deep.
  expect(scanHtml('<p>x'.repeat(1_000))).toEqual({ ok: true });
  expect(scanHtml('<ul>' + '<li>x'.repeat(1_000) + '</ul>')).toEqual({ ok: true });
  expect(scanHtml('<table>' + '<tr><td>a<td>b'.repeat(1_000) + '</table>')).toEqual({ ok: true });
  // Void elements and self-closing slashes never open a level.
  expect(scanHtml('<img src=x>'.repeat(1_000) + '<br/>'.repeat(1_000))).toEqual({ ok: true });
  // Comments and doctypes are not elements.
  expect(scanHtml('<!doctype html><!-- <div> -->' + '<p>ok</p>')).toEqual({ ok: true });
});

it('every remote reference in the hostile message is listed and removed, and a small cid image becomes a data address', () => {
  const hostile = loadHostile();
  const win = makeWindow();
  const result = previewHtml(hostile.html, win, [{ id: hostile.cid, bytes: pngBytes() }]);
  const html = shownHtml(result);
  const lower = html.toLowerCase();

  // Nothing that loads or runs survives: no address of the attacker, no script scheme, no active element, no attribute
  // that names an address, no style block.
  expect(html).not.toContain('evil.example');
  expect(lower).not.toContain('javascript:');
  for (const tag of [
    '<script',
    '<iframe',
    '<object',
    '<embed',
    '<form',
    '<audio',
    '<video',
    '<link',
    '<base',
    '<meta',
    '<style',
    '<input',
    '<button',
    '<svg',
    '<source',
  ]) {
    expect(lower, tag).not.toContain(tag);
  }
  for (const attribute of [
    ' href',
    ' ping',
    ' srcset',
    ' background',
    ' poster',
    ' action',
    ' formaction',
    ' onload',
    ' xlink:href',
  ]) {
    expect(lower, attribute).not.toContain(attribute + '=');
  }
  expect(lower).not.toContain('expression(');
  expect(lower).not.toContain('-moz-binding');
  expect(lower).not.toContain('image-set');
  // The text of the page is still there, and so is the link text (as plain words).
  expect(html).toContain('entity scheme');
  expect(html).toContain('link {{MARKER}}');

  // The cid image became a data address of the part's own bytes, and nothing else did.
  expect(html).toContain(`src="data:image/png;base64,${hostile.pngBase64}"`);
  expect(html.match(/ src="/g)).toHaveLength(1);

  // Every address of the attacker in the source is in the list of what was blocked or in the list of links, as text.
  const written = new Set(hostile.html.match(/https:\/\/evil\.example\/[^"'\s)<>]*/g) ?? []);
  expect(written.size).toBeGreaterThanOrEqual(30);
  const addresses = [...result.blocked.map((b) => b.address), ...result.links.map((l) => l.target)];
  for (const address of written) {
    expect(
      addresses.some((a) => a.includes(address)),
      address,
    ).toBe(true);
  }
  const listed = result.blocked.map((b) => `${b.kind} | ${b.where} | ${b.address}`);
  for (const wanted of [
    'base address | base href | https://evil.example/',
    'meta refresh | meta content | https://evil.example/r',
    'link element | link href | https://evil.example/a.css',
    'style import | style element | https://evil.example/i.css',
    'style url | style element | https://evil.example/b.png',
    'background | body background | https://evil.example/bg.gif',
    'source | img src | https://evil.example/1.png',
    'srcset | img srcset | https://evil.example/2.png',
    'srcset | source srcset | https://evil.example/3.png',
    'source | input src | https://evil.example/5.png',
    'reference | image href | https://evil.example/6.png',
    'reference | use href | https://evil.example/7.svg#a',
    'ping | a ping | https://evil.example/ping',
    'link with an unsafe address | a href | javascript:alert(1)',
    'style url | style attribute (div) | https://evil.example/8.png',
    'style url | style attribute (div) | https://evil.example/x.xml#b',
    'style url | style attribute (div) | https://evil.example/f.woff',
    'source | audio src | https://evil.example/a.mp3',
    'poster | video poster | https://evil.example/v.png',
    'source | iframe src | https://evil.example/frame',
    'object data | object data | https://evil.example/o',
    'source | embed src | https://evil.example/e',
    'form action | form action | https://evil.example/post',
    'form action | button formaction | https://evil.example/f',
    'source | script src | https://evil.example/s.js',
    'background | table background | https://evil.example/t.gif',
    'background | td background | https://evil.example/td.gif',
  ]) {
    expect(listed, wanted).toContain(wanted);
  }
  expect(listed.some((l) => l.startsWith('style image | style attribute (div) | image-set('))).toBe(true);
  // The two entity forms of javascript: are one reference written twice, and a host is named for each address.
  expect(result.blocked.find((b) => b.kind === 'link with an unsafe address')?.count).toBe(2);
  expect(result.blocked.find((b) => b.address === 'https://evil.example/1.png')?.host).toBe('evil.example');
  // The links are listed as text; the two scripts-scheme anchors had their address removed by the sanitiser already.
  expect(result.links.map((l) => l.text)).toEqual(['link {{MARKER}}', 'entity scheme', 'numeric entity']);
  expect(result.links.map((l) => l.target)).toEqual(['https://evil.example/click', '', '']);
});

it('inline images come only from small raster parts identified by their first bytes, never SVG, and only within the limits', () => {
  const win = makeWindow();
  const png = pngBytes();
  const page = (id = 'logo1') => `<p>x</p><img src="cid:${id}" alt="logo">`;
  const kinds = (result: ReturnType<typeof previewHtml>) => result.blocked.map((b) => b.kind);

  // The bytes decide, in the four formats, whatever the part was declared as.
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  for (const [bytes, type] of [
    [png, 'png'],
    [gif, 'gif'],
    [jpeg, 'jpeg'],
    [webp, 'webp'],
  ] as const) {
    const html = shownHtml(previewHtml(page(), win, [{ id: 'logo1', bytes }]));
    expect(html, type).toContain(`src="data:image/${type};base64,`);
  }

  // SVG, text and anything else is refused, and the reference is listed as text.
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const refusedSvg = previewHtml(page(), win, [{ id: 'logo1', bytes: svg }]);
  expect(shownHtml(refusedSvg)).not.toContain('data:image');
  expect(shownHtml(refusedSvg)).not.toContain('<img src');
  expect(kinds(refusedSvg)).toEqual(['inline image is not a PNG, JPEG, GIF or WebP']);
  expect(refusedSvg.blocked[0]?.address).toBe('cid:logo1');
  expect(kinds(previewHtml(page(), win, [{ id: 'logo1', bytes: new TextEncoder().encode('GIF89') }]))).toEqual([
    'inline image is not a PNG, JPEG, GIF or WebP',
  ]);

  // An id that names no part, and an id written with percent codes.
  expect(kinds(previewHtml(page('missing'), win, [{ id: 'logo1', bytes: png }]))).toEqual(['inline image not found']);
  expect(kinds(previewHtml(page(), win, []))).toEqual(['inline image not found']);
  expect(shownHtml(previewHtml(page('logo%201'), win, [{ id: 'logo 1', bytes: png }]))).toContain(
    'data:image/png;base64,',
  );
  // An id such as __proto__ is only a name.
  expect(kinds(previewHtml(page('__proto__'), win, [{ id: 'logo1', bytes: png }]))).toEqual(['inline image not found']);
  expect(shownHtml(previewHtml(page('__proto__'), win, [{ id: '__proto__', bytes: png }]))).toContain(
    'data:image/png;base64,',
  );

  // Size: 1 MiB is shown, one byte more is not, and 5 MiB is the most for all of them together.
  const big = (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    bytes.set(png.subarray(0, 8), 0);
    return bytes;
  };
  expect(shownHtml(previewHtml(page(), win, [{ id: 'logo1', bytes: big(MAX_CID_IMAGE_BYTES) }]))).toContain(
    'data:image/png;base64,',
  );
  expect(kinds(previewHtml(page(), win, [{ id: 'logo1', bytes: big(MAX_CID_IMAGE_BYTES + 1) }]))).toEqual([
    'inline image over the size limit',
  ]);
  const five = previewHtml('<img src="cid:a">'.repeat(6), win, [{ id: 'a', bytes: big(MAX_CID_IMAGE_BYTES) }]);
  expect(shownHtml(five).match(/data:image\/png;base64,/g)).toHaveLength(5);
  expect(kinds(five)).toEqual(['inline image over the size limit']);
}, 60_000);

it('inline styles lose only the declarations that load something, and style blocks and link text are handled as text', () => {
  const win = makeWindow();
  const result = previewHtml(
    '<style>p{color:blue}</style><p style="color:red;background:url(https://x.example/a.png);margin:0">t</p>' +
      '<a href="https://real.example/page">www.fake.example</a><a href="https://same.example/a">https://same.example/b</a>' +
      '<a href="mailto:alice@example.test">alice@example.test</a><a href="https://x.example/">click here</a>',
    win,
    [],
  );
  const html = shownHtml(result);
  expect(html).not.toContain('<style');
  expect(html).toContain('color:red');
  expect(html).toContain('margin:0');
  expect(html).not.toContain('x.example');
  expect(result.blocked.map((b) => `${b.kind} | ${b.where} | ${b.address}`)).toEqual([
    'style url | style attribute (p) | https://x.example/a.png',
  ]);
  // The visible text names a different host from the link in the first only.
  expect(result.links.map((l) => [l.text, l.host, l.mismatch])).toEqual([
    ['www.fake.example', 'real.example', true],
    ['https://same.example/b', 'same.example', false],
    ['alice@example.test', 'example.test', false],
    ['click here', 'x.example', false],
  ]);
  // The same reference written twice is one row with a count.
  const twice = previewHtml('<img src="https://t.example/p.gif"><img src="https://t.example/p.gif">', win, []);
  expect(twice.blocked).toHaveLength(1);
  expect(twice.blocked[0]?.count).toBe(2);
});
