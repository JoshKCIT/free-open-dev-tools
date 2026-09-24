import { it, expect } from 'vitest';
import figlet from 'figlet';
import { parseFont, renderBanner, FigletFontError } from '../src/index';
import { FONTS, FONT_NAMES } from '../src/fonts/index';

it('every bundled font parses as FIGfont version 2 with its declared height and all printable ASCII characters', () => {
  for (const name of FONT_NAMES) {
    const raw = FONTS[name];
    // Read the declared Height independently of parseFont: the header's
    // first six characters are the "flf2a" signature plus the hardblank
    // character (which may itself be a literal space), so splitting the
    // whole line on whitespace is unreliable -- slice off exactly those six
    // characters first, matching index.ts's own header-parsing approach.
    const headerLine = raw.split(/\r\n|\r|\n/)[0]!;
    const declaredHeight = Number(headerLine.slice(6).trim().split(/\s+/)[0]);
    expect(Number.isInteger(declaredHeight) && declaredHeight > 0).toBe(true);

    const font = parseFont(raw);
    expect(font.height).toBe(declaredHeight);
    for (let code = 32; code <= 126; code++) {
      const glyph = font.characters.get(code);
      expect(glyph, `font "${name}" is missing code ${code}`).toBeDefined();
      expect(glyph).toHaveLength(font.height);
    }
  }
});

it('the bundled fonts are exactly the 15 whose header grants permission and the three excluded fonts are absent', () => {
  const expected = [
    'standard',
    'small',
    'slant',
    'big',
    'block',
    'bubble',
    'digital',
    'lean',
    'mini',
    'script',
    'shadow',
    'smscript',
    'smshadow',
    'smslant',
    'term',
  ].sort();
  expect([...FONT_NAMES].sort()).toEqual(expected);
  expect(FONT_NAMES).toHaveLength(15);

  for (const name of FONT_NAMES) {
    // Every bundled font's own raw text carries FIGlet's permission line
    // verbatim (D-41), fetched live and quoted here for a second check
    // independent of the fetch-time header inspection recorded in the
    // SUMMARY.
    expect(FONTS[name]).toContain(
      "Permission is hereby given to modify this font, as long as the\nmodifier's name is placed on a comment line.",
    );
  }

  // The three excluded fonts (ivrit, mnemonic, banner) were confirmed this
  // session to carry no such permission line and are never bundled.
  expect(Object.keys(FONTS)).not.toContain('ivrit');
  expect(Object.keys(FONTS)).not.toContain('mnemonic');
  expect(Object.keys(FONTS)).not.toContain('banner');
});

it('full width layout matches the figlet reference implementation for every bundled font', () => {
  // A sample of printable ASCII: upper- and lower-case letters, digits,
  // punctuation and a space, all within the required 32-126 range.
  const sample = "Az09 !@#'.,";
  for (const name of FONT_NAMES) {
    figlet.parseFont(name, FONTS[name]);
    const reference = figlet.textSync(sample, { font: name, horizontalLayout: 'full' });
    const ours = renderBanner(name, sample, { layout: 'full' }).lines.join('\n');
    expect(ours, `font "${name}" full-width output differs from the figlet reference`).toBe(reference);
  }
});

it('fitted layout matches the figlet reference implementation for every bundled font', () => {
  const sample = "Az09 !@#'.,";
  for (const name of FONT_NAMES) {
    figlet.parseFont(name, FONTS[name]);
    const reference = figlet.textSync(sample, { font: name, horizontalLayout: 'fitted' });
    const ours = renderBanner(name, sample, { layout: 'fitted' }).lines.join('\n');
    expect(ours, `font "${name}" fitted output differs from the figlet reference`).toBe(reference);
  }
});

it('fitted characters touch without overlapping and a hardblank blocks fitting', () => {
  // small.flf's own space (32) glyph is entirely hardblank (proven in the
  // "hardblanks render as spaces" test below): two spaces back to back
  // must NOT compress at all in fitted layout, because a hardblank counts
  // as visible for fitting purposes and blocks the very fit that would
  // otherwise be available between two all-blank glyphs.
  const fittedSpaces = renderBanner('small', '  ', { layout: 'fitted' });
  const fullSpaces = renderBanner('small', '  ', { layout: 'full' });
  expect(fittedSpaces.lines).toEqual(fullSpaces.lines);

  // Two ordinary letters DO touch: fitted output is narrower than full
  // width once real gaps exist between glyphs.
  const fittedLT = renderBanner('standard', 'LT', { layout: 'fitted' });
  const fullLT = renderBanner('standard', 'LT', { layout: 'full' });
  const fittedWidth = Math.max(...fittedLT.lines.map((l) => l.length));
  const fullWidth = Math.max(...fullLT.lines.map((l) => l.length));
  expect(fittedWidth).toBeLessThan(fullWidth);
});

it('hardblanks render as spaces and endmark runs are stripped', () => {
  const font = parseFont(FONTS.small);
  // Fetched directly from small.flf this session: the space (32)
  // character's five raw lines are " $@", " $@", " $@", " $@" and " $@@".
  // After stripping the trailing run of the last repeated character (the
  // endmark -- one "@" on the first four lines, two on the last), every
  // line keeps only its leading space and the hardblank.
  expect(font.characters.get(32)).toEqual([' $', ' $', ' $', ' $', ' $']);

  const result = renderBanner('small', 'a', { layout: 'full' });
  expect(result.lines.join('\n')).not.toContain(font.hardblank);
});

it('a character missing from the font is skipped and reported', () => {
  // U+00A0 (non-breaking space) is outside the required 32-126 ASCII range
  // this tool reads, so no bundled font has a glyph for it.
  const result = renderBanner('standard', 'A B', { layout: 'full' });
  expect(result.missing).toEqual([' ']);
  expect(result.lines.some((line) => line.trim().length > 0)).toBe(true);
});

it('a malformed font throws FigletFontError', () => {
  expect(() => parseFont('not a figfont at all')).toThrow(FigletFontError);
  expect(() => parseFont('flf2a')).toThrow(FigletFontError); // no hardblank character at all
  expect(() => parseFont('flf2a$ 6 5 16 15 15 0 24463 229')).toThrow(FigletFontError); // valid header, but the file ends before any character data
});
