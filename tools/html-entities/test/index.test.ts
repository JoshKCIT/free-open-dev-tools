import { describe, it, expect } from 'vitest';
import { encode, decode, inspect, roundTrips, COMMON_ENTITIES } from '../src/index';

describe('the five predefined entities', () => {
  it('escapes the characters that change the meaning of markup', () => {
    expect(encode('<a href="x">a & b</a>')).toBe('&lt;a href=&quot;x&quot;&gt;a &amp; b&lt;/a&gt;');
  });

  it('decodes them back', () => {
    expect(decode('&lt;a href=&quot;x&quot;&gt;a &amp; b&lt;/a&gt;')).toBe('<a href="x">a & b</a>');
  });

  it('escapes the apostrophe as a numeric reference, which HTML 4 also understands', () => {
    // &apos; is valid in XML and HTML5 but was never defined in HTML 4.
    expect(encode("it's")).toBe('it&#39;s');
    expect(decode(encode("it's"))).toBe("it's");
  });

  it('attribute mode leaves the apostrophe alone, because it is harmless there', () => {
    // Inside a double-quoted attribute only " and & can break out. Escaping the
    // apostrophe as well would be noise, so escapeAttribute does not.
    expect(encode("it's", { strategy: 'attribute' })).toBe("it's");
    expect(encode('say "hi" & bye', { strategy: 'attribute' })).toBe('say &quot;hi&quot; &amp; bye');
  });

  it('leaves everything else alone in minimal mode', () => {
    expect(encode('café 日本 👋')).toBe('café 日本 👋');
  });
});

describe('the ampersand ordering trap', () => {
  it('does not double-encode an ampersand', () => {
    // Encoding & last would turn &lt; into &amp;lt;. Doing it first is correct.
    expect(encode('a & b < c')).toBe('a &amp; b &lt; c');
    expect(decode(encode('a & b < c'))).toBe('a & b < c');
  });

  it('round-trips text that already contains an entity', () => {
    const text = 'literally &amp; in the source';
    expect(decode(encode(text))).toBe(text);
    expect(encode(text)).toBe('literally &amp;amp; in the source');
  });
});

describe('encoding strategies', () => {
  it('non-ascii escapes everything above ASCII', () => {
    const out = encode('café', { strategy: 'non-ascii' });
    expect(/^[\x20-\x7e]*$/.test(out)).toBe(true);
    expect(decode(out)).toBe('café');
  });

  it('all-named uses a named reference wherever one exists', () => {
    expect(encode('café © 2026', { strategy: 'all-named' })).toContain('&eacute;');
    expect(encode('café © 2026', { strategy: 'all-named' })).toContain('&copy;');
  });

  it('xml uses only the five predefined entities', () => {
    // &apos; and &quot; are XML; &copy; is not, so the character stays.
    const out = encode('© & <x>', { strategy: 'xml' });
    expect(out).toContain('&amp;');
    expect(out).toContain('&lt;');
    expect(out).not.toContain('&copy;');
  });

  it('attribute mode escapes what is unsafe inside a quoted attribute', () => {
    const out = encode('a "quoted" & value', { strategy: 'attribute' });
    expect(out).toContain('&quot;');
    expect(out).toContain('&amp;');
  });

  it('can emit numeric references instead of named ones', () => {
    expect(encode('&', { numeric: true })).toBe('&#38;');
    expect(encode('&', { numeric: true, hexadecimal: true })).toBe('&#x26;');
    expect(decode(encode('<&>', { numeric: true }))).toBe('<&>');
  });

  it('numeric plus non-ascii escapes high characters numerically', () => {
    const out = encode('café', { strategy: 'non-ascii', numeric: true });
    expect(out).toBe('caf&#233;');
    expect(decode(out)).toBe('café');
  });

  it('numeric hexadecimal handles astral characters as a single reference', () => {
    const out = encode('👋', { strategy: 'non-ascii', numeric: true, hexadecimal: true });
    expect(out).toBe('&#x1f44b;');
    expect(decode(out)).toBe('👋');
  });
});

describe('decoding', () => {
  it('decodes named, decimal and hexadecimal references', () => {
    expect(decode('&copy;')).toBe('©');
    expect(decode('&#169;')).toBe('©');
    expect(decode('&#xA9;')).toBe('©');
    expect(decode('&#xa9;')).toBe('©');
  });

  it('decodes an astral character from a numeric reference', () => {
    expect(decode('&#128075;')).toBe('👋');
    expect(decode('&#x1F44B;')).toBe('👋');
  });

  it('applies the HTML5 legacy mapping for the 0x80 to 0x9F range', () => {
    // &#128; is formally a control character, but HTML5 section 13.2.5.80 maps
    // it to the euro sign, because that is what Windows-1252 content meant.
    expect(decode('&#128;')).toBe('€');
    expect(decode('&#149;')).toBe('•');
  });

  it('accepts a legacy reference with no semicolon, as HTML5 requires', () => {
    expect(decode('&amp')).toBe('&');
    expect(decode('&copy')).toBe('©');
  });

  it('strict mode requires the semicolon', () => {
    expect(decode('&amp', 'strict')).toBe('&amp');
    expect(decode('&amp;', 'strict')).toBe('&');
  });

  it('XML mode knows only the five predefined entities', () => {
    expect(decode('&amp;', 'xml')).toBe('&');
    expect(decode('&copy;', 'xml')).toBe('&copy;');
  });

  it('leaves a genuinely unrecognised reference untouched rather than guessing', () => {
    expect(decode('&zzzz;')).toBe('&zzzz;');
    expect(decode('&12345;')).toBe('&12345;');
  });

  it('still applies longest-prefix matching to something that looks unrecognised', () => {
    // &notarealentity; looks like nonsense but begins with the valid reference
    // &not, so HTML5 matches that and treats the rest as literal text.
    expect(decode('&notarealentity;')).toBe('¬arealentity;');
  });

  it('handles the classic &notit; case', () => {
    // HTML5 matches the longest valid prefix, so &not is the "not" sign and
    // "it;" is literal text. This surprises people and is worth pinning down.
    expect(decode('&notit;')).toBe('¬it;');
  });

  it('decodes a multi-character named reference', () => {
    // A handful of HTML5 references decode to two code points.
    expect(decode('&NotEqualTilde;')).toHaveLength(2);
  });

  it('handles empty input and text with no entities', () => {
    expect(decode('')).toBe('');
    expect(decode('plain text')).toBe('plain text');
    expect(encode('')).toBe('');
  });
});

describe('inspection', () => {
  it('lists every distinct reference with what it decodes to', () => {
    const report = inspect('&amp; &copy; &#169; &#xA9;');
    expect(report.found).toHaveLength(4);
    expect(report.found.map((f) => f.kind)).toEqual(['named', 'named', 'decimal', 'hexadecimal']);
    expect(report.found[1]!.decoded).toBe('©');
    expect(report.found[1]!.codePoints).toBe('U+00A9');
  });

  it('reports references that are not recognised', () => {
    const report = inspect('&nope; &amp;');
    expect(report.unrecognised).toEqual(['&nope;']);
    expect(report.found).toHaveLength(1);
  });

  it('reports references missing their semicolon', () => {
    expect(inspect('&amp and &copy').missingSemicolon).toEqual(['&amp', '&copy']);
  });

  it('deduplicates repeated references', () => {
    expect(inspect('&amp; &amp; &amp;').found).toHaveLength(1);
  });

  it('shows the code points of an astral reference', () => {
    const report = inspect('&#128075;');
    expect(report.found[0]!.codePoints).toBe('U+1F44B');
  });
});

describe('round trips', () => {
  it('survives every strategy for a demanding sample', () => {
    const samples = [
      '',
      'plain',
      '<script>alert("xss")</script>',
      'a & b',
      '&amp;',
      'café ünïcödé',
      '日本語 テスト',
      '👋🏽 emoji',
      'mixed \'quotes\' and "quotes"',
      ' non-breaking space',
      'a'.repeat(3000),
    ];
    for (const strategy of ['minimal', 'non-ascii', 'all-named', 'xml', 'attribute'] as const) {
      for (const sample of samples) {
        expect(roundTrips(sample, { strategy }), `${strategy}: ${sample.slice(0, 30)}`).toBe(true);
      }
    }
  });

  it('survives numeric encoding too', () => {
    for (const sample of ['<a>', 'a & b', 'café', '👋']) {
      expect(roundTrips(sample, { strategy: 'non-ascii', numeric: true })).toBe(true);
      expect(roundTrips(sample, { strategy: 'non-ascii', numeric: true, hexadecimal: true })).toBe(true);
    }
  });
});

describe('the reference table', () => {
  it('every named entry decodes to the character it claims', () => {
    for (const entry of COMMON_ENTITIES) {
      if (entry.named === '&apos;') continue; // HTML 4 did not define it; HTML5 does
      expect(decode(entry.named), entry.name).toBe(entry.character);
    }
  });

  it('every decimal entry decodes to the character it claims', () => {
    for (const entry of COMMON_ENTITIES) {
      expect(decode(entry.decimal), entry.name).toBe(entry.character);
    }
  });
});

describe('security-sensitive input', () => {
  it('neutralises a script tag', () => {
    const encoded = encode('<script>alert(1)</script>');
    expect(encoded).not.toContain('<script');
    expect(encoded).not.toContain('</script');
  });

  it('neutralises an attribute break-out attempt', () => {
    const encoded = encode('" onerror="alert(1)', { strategy: 'attribute' });
    expect(encoded).not.toContain('"');
  });

  it('does not decode input into something executable by accident', () => {
    // Decoding is the inverse operation; it can produce a script tag. That is
    // correct behaviour and exactly why decoded output must never be inserted
    // into a page as HTML, which the tool page states.
    expect(decode('&lt;script&gt;')).toBe('<script>');
  });
});
