import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  checkPadding,
  checkSpriteFile,
  MAX_IMAGE_BYTES,
  meta as toolMeta,
  planSprites,
  plainPng,
  spriteClassName,
  spriteCss,
  SpriteSheetError,
  spritePreviewCss,
  type SpriteInput,
  type SpritePlan,
} from '../src/index';

/**
 * Top-level `it(...)` calls, never nested in `describe(...)`: the project's verify scripts match required titles by
 * exact full name. Expected positions and sizes are worked out by hand from the layout rules written in meta.json and
 * are written here as literals; the property checks (no overlap, padding kept, inside the sheet) are written again here
 * and never taken from the package.
 */

const consoleSpies = [] as ReturnType<typeof vi.spyOn>[];

beforeEach(() => {
  consoleSpies.length = 0;
  for (const method of ['log', 'warn', 'error'] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A seeded generator (mulberry32), so every run builds the same pictures. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomItems(seed: number, count: number, maxSide: number): SpriteInput[] {
  const next = mulberry32(seed);
  const items: SpriteInput[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      name: `pic-${i}.png`,
      width: 1 + Math.floor(next() * maxSide),
      height: 1 + Math.floor(next() * maxSide),
    });
  }
  return items;
}

const THREE: SpriteInput[] = [
  { name: 'a.png', width: 10, height: 10 },
  { name: 'b.png', width: 20, height: 5 },
  { name: 'c.png', width: 5, height: 30 },
];

/** The gap between two rectangles along one axis: negative or zero when they overlap or touch on that axis. */
function gap(aStart: number, aSize: number, bStart: number, bSize: number): number {
  return Math.max(bStart - (aStart + aSize), aStart - (bStart + bSize));
}

/** Every pair is separated by at least `padding` along x or along y, so none overlaps and neighbours keep their space. */
function expectSeparated(plan: SpritePlan, padding: number): void {
  const list = plan.placements;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.x + a.width).toBeLessThanOrEqual(plan.width);
    expect(a.y + a.height).toBeLessThanOrEqual(plan.height);
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      const gx = gap(a.x, a.width, b.x, b.width);
      const gy = gap(a.y, a.height, b.y, b.height);
      expect(Math.max(gx, gy)).toBeGreaterThanOrEqual(padding);
    }
  }
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SpriteSheetError);
    return (err as Error).message;
  }
  throw new Error('nothing was thrown');
}

it('grid layout places images in the picked order with the padding between them and never overlaps', () => {
  const plan = planSprites(THREE, { layout: 'grid', padding: 2 });
  // Three images need ceil(sqrt(3)) = 2 columns and 2 rows; the cell is 20 by 30 (the widest and the tallest); the step
  // is the cell plus 2; the sheet is 2 * 20 + 2 by 2 * 30 + 2.
  expect([plan.width, plan.height]).toEqual([42, 62]);
  expect(plan.placements.map((p) => [p.index, p.x, p.y, p.width, p.height])).toEqual([
    [0, 0, 0, 10, 10],
    [1, 22, 0, 20, 5],
    [2, 0, 32, 5, 30],
  ]);
  expectSeparated(plan, 2);

  // Many images: the picked order is row-major, whatever the sizes. Worked out again here for 50 seeded images.
  const items = randomItems(11, 50, 40);
  for (const padding of [0, 1, 2, 7]) {
    const big = planSprites(items, { layout: 'grid', padding });
    let columns = 1;
    while (columns * columns < items.length) columns++;
    const cellWidth = Math.max(...items.map((i) => i.width));
    const cellHeight = Math.max(...items.map((i) => i.height));
    const rows = Math.ceil(items.length / columns);
    expect([big.width, big.height]).toEqual([
      columns * cellWidth + (columns - 1) * padding,
      rows * cellHeight + (rows - 1) * padding,
    ]);
    big.placements.forEach((p, i) => {
      expect(p.index).toBe(i);
      expect(p.x).toBe((i % columns) * (cellWidth + padding));
      expect(p.y).toBe(Math.floor(i / columns) * (cellHeight + padding));
    });
    expectSeparated(big, padding);
  }
});

it('with padding 0 neighbouring sprites touch and never overlap', () => {
  const squares: SpriteInput[] = ['a', 'b', 'c'].map((n) => ({ name: `${n}.png`, width: 10, height: 10 }));
  for (const layout of ['grid', 'shelf'] as const) {
    const plan = planSprites(squares, { layout, padding: 0 });
    const [a, b, c] = plan.placements as [
      SpritePlan['placements'][0],
      SpritePlan['placements'][0],
      SpritePlan['placements'][0],
    ];
    if (layout === 'grid') {
      // Two columns: the first two sit side by side and touch, the third is below the first.
      expect([plan.width, plan.height]).toEqual([20, 20]);
      expect([a.x, a.y, b.x, b.y, c.x, c.y]).toEqual([0, 0, 10, 0, 0, 10]);
      expect(a.x + a.width).toBe(b.x);
    } else {
      // The shelf is ceil(sqrt(300)) = 18 wide, so only one 10 wide image fits in a row: they are stacked and touch.
      expect([plan.width, plan.height]).toEqual([10, 30]);
      expect([a.x, a.y, b.x, b.y, c.x, c.y]).toEqual([0, 0, 0, 10, 0, 20]);
      expect(a.y + a.height).toBe(b.y);
    }
    expectSeparated(plan, 0);
    // No two rectangles share any pixel: an exact test on the pixels they cover.
    const covered = new Set<string>();
    for (const p of plan.placements) {
      for (let y = p.y; y < p.y + p.height; y++) {
        for (let x = p.x; x < p.x + p.width; x++) {
          const key = `${x},${y}`;
          expect(covered.has(key)).toBe(false);
          covered.add(key);
        }
      }
    }
    expect(covered.size).toBe(300);
  }
  // Seeded sets, both layouts, padding 0: still no overlap.
  for (const layout of ['grid', 'shelf'] as const) {
    for (const seed of [1, 2, 3]) {
      expectSeparated(planSprites(randomItems(seed, 40, 30), { layout, padding: 0 }), 0);
    }
  }
});

it('shelf layout puts the tallest first and keeps the picked order among equal heights', () => {
  const items: SpriteInput[] = [
    { name: 'a.png', width: 10, height: 10 },
    { name: 'b.png', width: 20, height: 5 },
    { name: 'c.png', width: 5, height: 30 },
    { name: 'd.png', width: 10, height: 10 },
  ];
  // Total area 100 + 100 + 150 + 100 = 450, so the shelf is ceil(sqrt(450)) = 22 wide (the widest image is 20). Sorted:
  // c (30 tall), a (10), d (10, picked after a), b (5). With 2 pixels of padding: c at 0 0, a at 7 0 (7 + 10 = 17 is
  // within 22), d does not fit (19 + 10 = 29) so a new row starts at 30 + 2 = 32, b does not fit (12 + 20 = 32) so a
  // third row starts at 32 + 10 + 2 = 44. The sheet is 20 wide (the widest row) and 44 + 5 = 49 tall.
  const plan = planSprites(items, { layout: 'shelf', padding: 2 });
  expect([plan.width, plan.height]).toEqual([20, 49]);
  const byIndex = plan.placements.map((p) => [p.index, p.x, p.y]);
  expect(byIndex).toEqual([
    [0, 7, 0],
    [1, 0, 44],
    [2, 0, 0],
    [3, 0, 32],
  ]);
  expectSeparated(plan, 2);

  // The three-image example from the grid test: widest 20, total area 350 (shelf width 19, raised to 20).
  const three = planSprites(THREE, { layout: 'shelf', padding: 2 });
  expect(three.placements.map((p) => [p.index, p.x, p.y])).toEqual([
    [0, 7, 0],
    [1, 0, 32],
    [2, 0, 0],
  ]);
  expect([three.width, three.height]).toEqual([20, 37]);

  // Equal heights keep the order picked: five 10 by 10 images in a shelf of width ceil(sqrt(500)) = 23 fill row one with
  // the first two (the third would pass 23), so picked order runs left to right and then down.
  const squares: SpriteInput[] = ['p', 'q', 'r', 's', 't'].map((n) => ({ name: `${n}.png`, width: 10, height: 10 }));
  const rows = planSprites(squares, { layout: 'shelf', padding: 0 });
  expect(rows.placements.map((p) => [p.index, p.x, p.y])).toEqual([
    [0, 0, 0],
    [1, 10, 0],
    [2, 0, 10],
    [3, 10, 10],
    [4, 0, 20],
  ]);

  // Seeded sets: never an overlap, the padding kept, every sprite inside the sheet, and the first sprite of each row is
  // never shorter than the others in it (sorted tallest first).
  for (const padding of [0, 2, 5]) {
    for (const seed of [4, 5, 6]) {
      const items2 = randomItems(seed, 60, 50);
      const plan2 = planSprites(items2, { layout: 'shelf', padding });
      expectSeparated(plan2, padding);
      const sorted = plan2.placements.slice().sort((a, b) => a.y - b.y || a.x - b.x);
      let tallestSoFar = Infinity;
      for (const p of sorted) {
        expect(p.height).toBeLessThanOrEqual(tallestSoFar);
        tallestSoFar = Math.min(tallestSoFar, p.height);
      }
    }
  }
});

it('class names are lower case, at most 40 characters, and repeated names get distinct suffixes', () => {
  const used = new Set<string>();
  expect(spriteClassName('icon.png', used)).toBe('icon');
  expect(spriteClassName('Icon.PNG', used)).toBe('icon-2');
  expect(spriteClassName('icon (copy).png', used)).toBe('icon-copy');
  expect(spriteClassName('icon', used)).toBe('icon-3');
  expect(spriteClassName('ICON.gif', used)).toBe('icon-4');

  // A name of 60 letters is cut to 40; the second copy gets a suffix and is still at most 40 characters.
  const sixty = 'abcdefghij'.repeat(6);
  const longUsed = new Set<string>();
  const first = spriteClassName(`${sixty}.png`, longUsed);
  expect(first).toBe(sixty.slice(0, 40));
  const second = spriteClassName(`${sixty}.png`, longUsed);
  expect(second).toBe(`${sixty.slice(0, 38)}-2`);
  expect(second.length).toBe(40);
  expect(spriteClassName(`${sixty}.png`, longUsed)).toBe(`${sixty.slice(0, 38)}-3`);

  // A name with no letters or digits gives sprite, and then sprite-2.
  const bare = new Set<string>();
  expect(spriteClassName('---.png', bare)).toBe('sprite');
  expect(spriteClassName(`${String.fromCodePoint(0x65e5, 0x672c)}.png`, bare)).toBe('sprite-2');
  expect(spriteClassName('.png', bare)).toBe('png');

  // Hostile names: only a to z, 0 to 9 and hyphens survive, never a quote, brace, slash, angle bracket or space.
  const hostile = [
    '"}; body{display:none} /*.png',
    '<img src=x onerror=alert(1)>.png',
    '../../etc/passwd.png',
    'a\\b/c:d*e?f|g.png',
    'url(http://x.invalid/a).png',
    '__proto__.png',
    'constructor.png',
    'toString.png',
    'hasOwnProperty.png',
    ` ${String.fromCodePoint(0x202e)}evil${String.fromCodePoint(0x0)}.png`,
  ];
  const hostileUsed = new Set<string>();
  const results = hostile.map((n) => spriteClassName(n, hostileUsed));
  expect(results).toEqual([
    'body-display-none',
    'img-src-x-onerror-alert-1',
    'etc-passwd',
    'a-b-c-d-e-f-g',
    'url-http-x-invalid-a',
    'proto',
    'constructor',
    'tostring',
    'hasownproperty',
    'evil',
  ]);
  for (const r of results) expect(r).toMatch(/^[a-z0-9-]{1,40}$/);
  // The same word twice is told apart even when it names an object property.
  expect(spriteClassName('constructor.png', hostileUsed)).toBe('constructor-2');
  expect(spriteClassName('__proto__.png', hostileUsed)).toBe('proto-2');

  // Over many seeded awkward names every class name matches, none repeats, none starts or ends with a hyphen.
  const next = mulberry32(99);
  const alphabet = 'aAbB09 -_.(){}[]"\'<>/\\:;,!@#$%^&*+=~`?|';
  const every = new Set<string>();
  for (let i = 0; i < 300; i++) {
    let name = '';
    const length = 1 + Math.floor(next() * 70);
    for (let k = 0; k < length; k++) name += alphabet[Math.floor(next() * alphabet.length)];
    const className = spriteClassName(`${name}.png`, every);
    expect(className).toMatch(/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/);
  }
  expect(every.size).toBe(300);

  // In a plan, names are made in the order picked whatever the layout.
  const names = ['x.png', 'X.png', 'x (1).png'].map((name) => ({ name, width: 4, height: 4 }));
  for (const layout of ['grid', 'shelf'] as const) {
    expect(planSprites(names, { layout, padding: 1 }).placements.map((p) => p.className)).toEqual(['x', 'x-2', 'x-1']);
  }
});

it('the CSS has one rule per image with its position and size, and the preview differs only in the sheet address', () => {
  const plan = planSprites(THREE, { layout: 'grid', padding: 2 });
  const css = spriteCss(plan);
  const expected = [
    '.sprite {',
    '  display: inline-block;',
    '  background-image: url(sprite.png);',
    '  background-repeat: no-repeat;',
    '}',
    '',
    '.sprite-a {',
    '  background-position: 0 0;',
    '  width: 10px;',
    '  height: 10px;',
    '}',
    '',
    '.sprite-b {',
    '  background-position: -22px 0;',
    '  width: 20px;',
    '  height: 5px;',
    '}',
    '',
    '.sprite-c {',
    '  background-position: 0 -32px;',
    '  width: 5px;',
    '  height: 30px;',
    '}',
    '',
  ].join('\n');
  expect(css).toBe(expected);
  // One rule for each image, and exactly one mention of the sheet file.
  expect(css.split('background-position').length - 1).toBe(3);
  expect(css.split('url(sprite.png)').length - 1).toBe(1);
  expect(css).not.toContain('-0');
  expect(css).not.toContain('\r');

  // The preview text is the same text with the one url(sprite.png) replaced by a data address.
  const dataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const preview = spritePreviewCss(css, dataUrl);
  const at = css.indexOf('url(sprite.png)');
  expect(preview).toBe(`${css.slice(0, at)}url(${dataUrl})${css.slice(at + 'url(sprite.png)'.length)}`);
  expect(preview.split('url(sprite.png)').length - 1).toBe(0);
  // Everything else is identical: removing the token from both leaves the same text.
  expect(preview.replace(`url(${dataUrl})`, '')).toBe(css.replace('url(sprite.png)', ''));

  // The preview refuses CSS that does not hold the token exactly once, and an address that is not a PNG data address.
  expect(() => spritePreviewCss('.sprite { }', dataUrl)).toThrow(SpriteSheetError);
  expect(() => spritePreviewCss(`${css}${css}`, dataUrl)).toThrow(SpriteSheetError);
  for (const bad of [
    'http://example.invalid/sheet.png',
    'data:text/html;base64,PGI+',
    'data:image/png;base64,AAAA)',
    'data:image/png;base64,AA AA',
    'data:image/png;base64,AAAA;background:red',
    '',
  ]) {
    expect(() => spritePreviewCss(css, bad)).toThrow(SpriteSheetError);
  }
});

it('no images gives nothing and one image gives a sheet of its own size', () => {
  for (const layout of ['grid', 'shelf'] as const) {
    expect(planSprites([], { layout, padding: 2 })).toEqual({ width: 0, height: 0, placements: [] });
    for (const padding of [0, 2, 64]) {
      const one = planSprites([{ name: 'only.png', width: 37, height: 23 }], { layout, padding });
      expect([one.width, one.height]).toEqual([37, 23]);
      expect(one.placements).toEqual([
        { name: 'only.png', className: 'only', x: 0, y: 0, width: 37, height: 23, index: 0 },
      ]);
      expect(spriteCss(one)).toContain(
        '.sprite-only {\n  background-position: 0 0;\n  width: 37px;\n  height: 23px;\n}',
      );
    }
  }
  expect(spriteCss({ width: 0, height: 0, placements: [] })).toBe('');
});

it('too many images, a side over 4096 and a sheet over the caps are refused with plain messages', () => {
  const marker = 'FODT-MARKER-NAME';
  const tiny = (n: number): SpriteInput[] =>
    Array.from({ length: n }, (_, i) => ({ name: `${marker}-${i}.png`, width: 2, height: 2 }));

  // 200 images are accepted and 201 are not.
  expect(planSprites(tiny(200), { layout: 'grid', padding: 0 }).placements).toHaveLength(200);
  const tooMany = messageOf(() => planSprites(tiny(201), { layout: 'grid', padding: 0 }));
  expect(tooMany).toBe('You picked 201 images. The most that can be packed is 200.');

  // A side of 4096 is accepted and 4097 is not, wide or tall.
  expect(planSprites([{ name: 'w.png', width: 4096, height: 1 }], { layout: 'shelf', padding: 0 }).width).toBe(4096);
  expect(
    messageOf(() => planSprites([{ name: `${marker}.png`, width: 4097, height: 1 }], { layout: 'grid', padding: 0 })),
  ).toBe('Image 1 is 4097 by 1 pixels. The most is 4096 pixels on a side.');
  expect(
    messageOf(() =>
      planSprites([tiny(1)[0]!, { name: 'tall.png', width: 1, height: 4097 }], { layout: 'grid', padding: 0 }),
    ),
  ).toBe('Image 2 is 1 by 4097 pixels. The most is 4096 pixels on a side.');

  // The sheet may be 8192 wide and not 8194: two images of 4096 side by side, with 0 and then 2 pixels between them.
  const pair = (height: number): SpriteInput[] => [
    { name: 'l.png', width: 4096, height },
    { name: 'r.png', width: 4096, height },
  ];
  expect(planSprites(pair(10), { layout: 'grid', padding: 0 }).width).toBe(8192);
  expect(messageOf(() => planSprites(pair(10), { layout: 'grid', padding: 2 }))).toBe(
    'This layout would make a sheet of 8194 by 10 pixels. A sheet may be at most 8192 pixels on a side and 16,000,000 pixels in all. Pick fewer or smaller images, or try the other layout.',
  );
  // The same two images in the shelf layout wrap to a second row instead of passing 8192, so they are accepted.
  const shelf = planSprites(pair(10), { layout: 'shelf', padding: 2 });
  expect([shelf.width, shelf.height]).toEqual([4096, 22]);

  // A sheet may be 8192 tall and not 8194: with one image 4096 tall among four, the grid has two rows of 4096.
  const tall = (): SpriteInput[] => [
    { name: 't.png', width: 100, height: 4096 },
    ...[1, 2, 3].map((n) => ({ name: `s${n}.png`, width: 5, height: 5 })),
  ];
  const tallPlan = planSprites(tall(), { layout: 'grid', padding: 0 });
  expect([tallPlan.width, tallPlan.height]).toEqual([200, 8192]);
  expect(messageOf(() => planSprites(tall(), { layout: 'grid', padding: 2 }))).toBe(
    'This layout would make a sheet of 202 by 8194 pixels. A sheet may be at most 8192 pixels on a side and 16,000,000 pixels in all. Pick fewer or smaller images, or try the other layout.',
  );

  // A sheet may hold 16,000,000 pixels and not more, even when the images themselves are smaller than that: one image
  // 4096 by 976 among four sits in a grid of 8192 by 1952, which is 15,990,784 pixels; 4096 by 977 makes 8192 by 1954,
  // which is 16,007,168.
  const roomy = (height: number): SpriteInput[] => [
    { name: 'r.png', width: 4096, height },
    ...[1, 2, 3].map((n) => ({ name: `s${n}.png`, width: 5, height: 5 })),
  ];
  const roomyPlan = planSprites(roomy(976), { layout: 'grid', padding: 0 });
  expect([roomyPlan.width, roomyPlan.height, roomyPlan.width * roomyPlan.height]).toEqual([8192, 1952, 15_990_784]);
  expect(messageOf(() => planSprites(roomy(977), { layout: 'grid', padding: 0 }))).toBe(
    'This layout would make a sheet of 8192 by 1954 pixels. A sheet may be at most 8192 pixels on a side and 16,000,000 pixels in all. Pick fewer or smaller images, or try the other layout.',
  );

  // Images that together hold 16,000,000 pixels fit (15,998,976 here); one more row of pixels each does not, and that
  // is refused before any layout is made because a sheet can never hold less than the images.
  const wide = (height: number): SpriteInput[] => [
    { name: 'l.png', width: 4096, height },
    { name: 'r.png', width: 4096, height },
  ];
  const ok = planSprites(wide(1953), { layout: 'grid', padding: 0 });
  expect([ok.width, ok.height, ok.width * ok.height]).toEqual([8192, 1953, 15_998_976]);
  const over = messageOf(() => planSprites(wide(1954), { layout: 'grid', padding: 0 }));
  expect(over).toBe(
    'These images hold 16,007,168 pixels together. A sheet may have at most 16,000,000 pixels, so pick fewer or smaller images.',
  );
  const heavy = messageOf(() =>
    planSprites([...wide(1954), { name: 'x.png', width: 1, height: 1 }], { layout: 'shelf', padding: 0 }),
  );
  expect(heavy).toBe(
    'These images hold 16,007,169 pixels together. A sheet may have at most 16,000,000 pixels, so pick fewer or smaller images.',
  );

  // Padding: a whole number from 0 to 64.
  for (const bad of [-1, 65, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -1_000_000_000]) {
    expect(messageOf(() => planSprites(THREE, { layout: 'grid', padding: bad }))).toBe(
      'Padding must be a whole number from 0 to 64.',
    );
    expect(messageOf(() => checkPadding(bad))).toBe('Padding must be a whole number from 0 to 64.');
  }
  expect(checkPadding(0)).toBe(0);
  expect(checkPadding(64)).toBe(64);

  // A size that is not a whole positive number is refused.
  expect(messageOf(() => planSprites([{ name: 'z.png', width: 0, height: 5 }], { layout: 'grid', padding: 0 }))).toBe(
    'Image 1 has no usable size.',
  );
  expect(messageOf(() => planSprites([{ name: 'z.png', width: 2.5, height: 5 }], { layout: 'grid', padding: 0 }))).toBe(
    'Image 1 has no usable size.',
  );

  // No message ever holds a file name.
  for (const text of [tooMany, over, heavy]) expect(text).not.toContain(marker);
});

it('the same files and settings always give the same plan and CSS', () => {
  for (const layout of ['grid', 'shelf'] as const) {
    const first = planSprites(randomItems(21, 80, 60), { layout, padding: 3 });
    const second = planSprites(randomItems(21, 80, 60), { layout, padding: 3 });
    expect(second).toEqual(first);
    expect(spriteCss(second)).toBe(spriteCss(first));
  }
  // The input is not changed by planning.
  const items = randomItems(5, 20, 30);
  const copy = JSON.parse(JSON.stringify(items)) as SpriteInput[];
  planSprites(items, { layout: 'shelf', padding: 1 });
  expect(items).toEqual(copy);
  // A grid sheet has the same size whatever the order picked (the cell is the widest by the tallest); its positions follow
  // the order.
  const reversed = items.slice().reverse();
  const forward = planSprites(items, { layout: 'grid', padding: 1 });
  const backward = planSprites(reversed, { layout: 'grid', padding: 1 });
  expect([backward.width, backward.height]).toEqual([forward.width, forward.height]);
});

it('planning 200 images takes a moment', () => {
  const items = randomItems(77, 200, 40);
  for (const layout of ['grid', 'shelf'] as const) {
    const before = performance.now();
    const plan = planSprites(items, { layout, padding: 2 });
    const elapsed = performance.now() - before;
    expect(plan.placements).toHaveLength(200);
    expect(elapsed).toBeLessThan(2000);
  }
}, 60_000);

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** The first 29 bytes of a PNG: the signature and an IHDR chunk, which is all the header check reads. */
function pngHeader(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0,
  ]);
}

it('files over 20 MB, over 4096 a side or not images are refused before decoding', () => {
  expect(MAX_IMAGE_BYTES).toBe(20 * 1024 * 1024);
  // 4096 by 3906 is 15,998,976 pixels, which fits a sheet; 4096 by 3907 is 16,003,072, which does not.
  expect(checkSpriteFile(pngHeader(4096, 3906), 1000)).toEqual({ kind: 'png', width: 4096, height: 3906 });
  expect(messageOf(() => checkSpriteFile(pngHeader(4096, 3907), 1000))).toBe(
    'This image holds 16,003,072 pixels. A sheet may have at most 16,000,000 pixels, so it cannot fit.',
  );
  expect(messageOf(() => checkSpriteFile(pngHeader(4, 4), MAX_IMAGE_BYTES + 1))).toBe(
    'This file is larger than 20 MB, the most this page accepts for one image.',
  );
  expect(checkSpriteFile(pngHeader(4, 4), MAX_IMAGE_BYTES).kind).toBe('png');
  expect(messageOf(() => checkSpriteFile(new Uint8Array(0), 0))).toBe('This file is empty.');
  expect(messageOf(() => checkSpriteFile(new TextEncoder().encode('just some text here, not a picture'), 40))).toBe(
    'This is not a PNG, JPEG, GIF, WebP or BMP image.',
  );
  // A PDF is a known kind but not a picture.
  expect(messageOf(() => checkSpriteFile(new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n'), 40))).toBe(
    'This is not a PNG, JPEG, GIF, WebP or BMP image.',
  );
  expect(messageOf(() => checkSpriteFile(pngHeader(4097, 10), 1000))).toBe(
    'This image is 4097 by 10 pixels. The most is 4096 pixels on a side.',
  );
  expect(messageOf(() => checkSpriteFile(pngHeader(10, 4097), 1000))).toBe(
    'This image is 10 by 4097 pixels. The most is 4096 pixels on a side.',
  );
  expect(messageOf(() => checkSpriteFile(pngHeader(4096, 4096), 1000))).toBe(
    'This image holds 16,777,216 pixels. A sheet may have at most 16,000,000 pixels, so it cannot fit.',
  );
});

it('meta states the limits that the code enforces', () => {
  const limits = toolMeta.limits.join('\n');
  expect(limits).toContain('At most 200 images');
  expect(limits).toContain('20 MB');
  expect(limits).toContain('4,096 pixels a side');
  expect(limits).toContain('16,000,000 pixels and 8,192 pixels a side');
  expect(limits).toContain('40 characters');
  expect(toolMeta.id).toBe('sprite-sheet');
});

/** CRC-32 as the PNG specification gives it (section 5.5, polynomial 0xEDB88320), written here and not taken from the package. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: number[]): number[] {
  const body = [...Array.from(type, (ch) => ch.charCodeAt(0)), ...data];
  return [...u32be(data.length), ...body, ...u32be(crc32(Uint8Array.from(body)))];
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function chunkNames(png: Uint8Array): string[] {
  const names: string[] = [];
  let at = 8;
  while (at < png.length) {
    const length = ((png[at]! << 24) | (png[at + 1]! << 16) | (png[at + 2]! << 8) | png[at + 3]!) >>> 0;
    names.push(String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!));
    at += 12 + length;
  }
  return names;
}

it('a browser PNG loses its colour profile tags and keeps its pixels', () => {
  const ihdr = pngChunk('IHDR', [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]);
  const idat = pngChunk('IDAT', [0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0xf8, 0x0f, 0x00, 0x01, 0x01, 0x01, 0x00]);
  const iend = pngChunk('IEND', []);
  // The order WebKit writes: IHDR, sBIT, iCCP, IDAT, IEND; the others are the colour tags the PNG specification names.
  const tagged = Uint8Array.from([
    ...PNG_SIGNATURE,
    ...ihdr,
    ...pngChunk('sBIT', [8, 8, 8, 8]),
    ...pngChunk('iCCP', [0x70, 0x00, 0x00, 1, 2, 3]),
    ...pngChunk('gAMA', [0, 1, 0x8f, 0xc0]),
    ...pngChunk('cHRM', new Array<number>(32).fill(1)),
    ...pngChunk('sRGB', [0]),
    ...pngChunk('cICP', [1, 13, 0, 1]),
    ...pngChunk('tEXt', [65, 0, 66]),
    ...idat,
    ...iend,
  ]);
  const plain = plainPng(tagged);
  expect(chunkNames(plain)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND']);
  // Every chunk that stays is byte for byte the one that was there, so the pixels and every checksum are untouched.
  expect(Array.from(plain)).toEqual([...PNG_SIGNATURE, ...ihdr, ...pngChunk('tEXt', [65, 0, 66]), ...idat, ...iend]);
  // A PNG with none of those chunks comes back as it was, and the input is never changed.
  const untagged = Uint8Array.from([...PNG_SIGNATURE, ...ihdr, ...idat, ...iend]);
  expect(Array.from(plainPng(untagged))).toEqual(Array.from(untagged));
  expect(chunkNames(tagged)).toContain('iCCP');
  // Anything that is not a whole PNG is returned unchanged rather than guessed at.
  const text = new TextEncoder().encode('not a picture at all, just some text');
  expect(Array.from(plainPng(text))).toEqual(Array.from(text));
  const cut = tagged.slice(0, tagged.length - 7);
  expect(Array.from(plainPng(cut))).toEqual(Array.from(cut));
  expect(Array.from(plainPng(new Uint8Array(0)))).toEqual([]);
  // A chunk (with room for a whole header after it) whose length runs past the end makes the whole input count as not a PNG: even the tag before it stays.
  const lying = Uint8Array.from([
    ...PNG_SIGNATURE,
    ...ihdr,
    ...pngChunk('iCCP', [1, 2, 3]),
    0x7f,
    0xff,
    0xff,
    0xff,
    0x49,
    0x44,
    0x41,
    0x54,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
  ]);
  expect(Array.from(plainPng(lying))).toEqual(Array.from(lying));
});

it('nothing is written to the console while planning a sheet', () => {
  const plan = planSprites(THREE, { layout: 'shelf', padding: 2 });
  spriteCss(plan);
  spritePreviewCss(spriteCss(plan), 'data:image/png;base64,AAAA');
  spriteClassName('x.png', new Set());
  plainPng(Uint8Array.from([1, 2, 3]));
  try {
    planSprites(THREE, { layout: 'grid', padding: -1 });
  } catch {
    // The refusal is expected; only the console matters here.
  }
  try {
    checkSpriteFile(new Uint8Array(0), 0);
  } catch {
    // Same.
  }
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it('the limits say that fingerprinting protections can change the pixels a page reads back', () => {
  expect(toolMeta.limits).toContain(
    "Browser privacy protections against fingerprinting can change the pixels a page reads back from a canvas, so a result can differ slightly from the picture's own pixels.",
  );
});
