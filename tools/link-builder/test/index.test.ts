import { it, expect } from 'vitest';
import { MarkupError, buildLink, meta, parseRel, type LinkSpec } from '../src/index';
import {
  IANA_REGISTRY_UPDATED,
  LINK_TYPES_ON_A,
  REGISTERED_EXTENSIONS,
  SPEC_FETCHED,
  SPEC_LAST_UPDATED,
  TARGET_KEYWORDS,
} from '../src/spec-data';
import { serialize, inert } from '../src/markup';
import { HOSTILE, attrOf, findAll, hasControlCharacter, parse, shape, textOf } from './parse';

const LF = String.fromCharCode(10);

it('has the catalog id and name and states its limits', () => {
  expect(meta.id).toBe('link-builder');
  expect(meta.name).toBe('HTML Link Builder (mailto, tel, sms)');
  expect(meta.limits.length).toBeGreaterThan(0);
});

it('the link parses with parse5 with zero parse errors and the preview link has no href', () => {
  const link = buildLink({
    kind: 'mailto',
    to: 'infobot@example.com',
    body: 'send current-issue' + LF + 'send index',
  });
  expect(link).not.toBeNull();
  if (link === null) return;

  const literal = 'mailto:infobot@example.com?body=send%20current-issue%0D%0Asend%20index';
  expect(link.address).toBe(literal);

  const real = parse(link.html);
  expect(real.errors).toEqual([]);
  const anchors = findAll(real.frag, 'a');
  expect(anchors).toHaveLength(1);
  expect(attrOf(anchors[0]!, 'href')).toBe(literal);
  expect(textOf(anchors[0]!)).toBe('infobot@example.com');

  const shown = parse(link.preview);
  expect(shown.errors).toEqual([]);
  const previewAnchors = findAll(shown.frag, 'a');
  expect(previewAnchors).toHaveLength(1);
  expect(previewAnchors[0]!.attrs.map((a) => a.name)).not.toContain('href');
  expect(textOf(previewAnchors[0]!)).toBe('infobot@example.com');
  expect(link.preview).toBe(serialize(inert(link.tree)));
});

it('blank fields give no output', () => {
  expect(buildLink({ kind: 'mailto', to: '', body: '', text: '' })).toBeNull();
});

it('RFC 6068 section 6.1 the ampersand between header fields is written as an entity inside the href attribute', () => {
  // RFC 6068 section 6.1: <a href="mailto:joe@an.example?cc=bob@an.example&amp;body=hello">...</a>
  const link = buildLink({ kind: 'mailto', to: 'joe@an.example', cc: 'bob@an.example', body: 'hello' });
  expect(link).not.toBeNull();
  if (link === null) return;
  expect(link.html).toBe('<a href="mailto:joe@an.example?cc=bob@an.example&amp;body=hello">joe@an.example</a>');
  // The bare address, for use outside HTML, has no entity.
  expect(link.address).toBe('mailto:joe@an.example?cc=bob@an.example&body=hello');
  const parsed = parse(link.html);
  expect(parsed.errors).toEqual([]);
  expect(attrOf(findAll(parsed.frag, 'a')[0]!, 'href')).toBe(link.address);
});

it('RFC 6068 section 5 a line break in a mailto field is refused naming the field', () => {
  for (const field of ['to', 'cc', 'bcc', 'subject'] as const) {
    const names = { to: 'To', cc: 'Cc', bcc: 'Bcc', subject: 'Subject' };
    try {
      buildLink({ kind: 'mailto', to: 'a@example.org', [field]: `x@example.org${LF}Bcc: y@example.org` });
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(MarkupError);
      expect((e as MarkupError).field).toBe(names[field]);
      expect((e as MarkupError).message).toContain('RFC 6068 section 5');
    }
  }
});

it('an address outside the standard email expression is written as typed with a warning, and bcc is stated to be visible', () => {
  const odd = buildLink({ kind: 'mailto', to: '"not@me"@example.org, plain@example.org' });
  expect(odd?.address).toBe('mailto:%22not%40me%22@example.org,plain@example.org');
  expect(odd?.warnings.join(' ')).toContain('"not@me"@example.org');
  expect(odd?.warnings.join(' ')).not.toContain('plain@example.org');
  const noAt = buildLink({ kind: 'mailto', to: 'nobody' });
  expect(noAt?.address).toBe('mailto:nobody');
  expect(noAt?.warnings.join(' ')).toContain('nobody');
  const bcc = buildLink({ kind: 'mailto', to: 'a@example.org', bcc: 'b@example.org' });
  expect(bcc?.warnings.join(' ')).toContain('RFC 6068 section 7');
  expect(bcc?.warnings.join(' ')).toContain('visible');
  const plain = buildLink({ kind: 'mailto', to: 'a@example.org' });
  expect(plain?.warnings).toEqual([]);
});

it('tel and sms links carry their notes, their bare address and an inert preview', () => {
  const tel = buildLink({ kind: 'tel', phone: '+1 201 555 0123' });
  expect(tel?.address).toBe('tel:+1-201-555-0123');
  expect(tel?.html).toBe('<a href="tel:+1-201-555-0123">+1 201 555 0123</a>');
  expect(tel?.warnings.join(' ')).toContain('5.1.1');
  const ext = buildLink({ kind: 'tel', phone: '7042', ext: '12', phoneContext: 'example.com' });
  expect(ext?.address).toBe('tel:7042;ext=12;phone-context=example.com');
  const sms = buildLink({ kind: 'sms', recipients: '+15105550101, +15105550102', smsBody: 'hello there' });
  expect(sms?.address).toBe('sms:+15105550101,+15105550102?body=hello%20there');
  expect(sms?.html).toBe('<a href="sms:+15105550101,+15105550102?body=hello%20there">+15105550101, +15105550102</a>');
  for (const link of [tel, ext, sms]) {
    expect(link).not.toBeNull();
    if (link === null) continue;
    expect(parse(link.html).errors).toEqual([]);
    const anchors = findAll(parse(link.preview).frag, 'a');
    expect(anchors[0]!.attrs.map((a) => a.name)).not.toContain('href');
  }
  expect(buildLink({ kind: 'tel', phone: '', ext: '', phoneContext: '' })).toBeNull();
  expect(buildLink({ kind: 'sms', recipients: '', smsBody: '' })).toBeNull();
});

/** The attributes of the one link a builder wrote, in the order written. */
function attributesOf(html: string): [string, string][] {
  const parsed = parse(html);
  expect(parsed.errors).toEqual([]);
  const anchors = findAll(parsed.frag, 'a');
  expect(anchors).toHaveLength(1);
  return anchors[0]!.attrs.map((a) => [a.name, a.value]);
}

function refusalOf(run: () => unknown): MarkupError {
  try {
    run();
  } catch (e) {
    if (e instanceof MarkupError) return e;
    throw e;
  }
  throw new Error('expected a MarkupError, but nothing was thrown');
}

it('WHATWG 4.6.8 the 16 link types allowed on a and the two registered extensions are copied with their dates', () => {
  expect(LINK_TYPES_ON_A.map((t) => t.value)).toEqual([
    'alternate',
    'author',
    'bookmark',
    'external',
    'help',
    'license',
    'next',
    'nofollow',
    'noopener',
    'noreferrer',
    'opener',
    'prev',
    'privacy-policy',
    'search',
    'tag',
    'terms-of-service',
  ]);
  expect(LINK_TYPES_ON_A.filter((t) => t.effect === 'Annotation').map((t) => t.value)).toEqual([
    'external',
    'nofollow',
    'noopener',
    'noreferrer',
    'opener',
  ]);
  expect(REGISTERED_EXTENSIONS.map((t) => [t.value, t.recorded])).toEqual([
    ['sponsored', '2019-11-07'],
    ['ugc', '2019-11-07'],
  ]);
  expect(TARGET_KEYWORDS).toEqual(['_blank', '_self', '_parent', '_top']);
  for (const date of [SPEC_LAST_UPDATED, SPEC_FETCHED, IANA_REGISTRY_UPDATED]) {
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});

it('WHATWG link types: the link carries exactly the rel values chosen, in the order chosen, and nothing else', () => {
  // No rel and no target chosen: the link has an href and nothing else.
  const bare = buildLink({ kind: 'web', href: 'https://example.org/', text: 'Example' });
  expect(attributesOf(bare!.html)).toEqual([['href', 'https://example.org/']]);
  expect(bare!.warnings).toEqual([]);

  // The values chosen, in the order chosen, spelled as typed.
  const chosen = buildLink({
    kind: 'web',
    href: 'https://example.org/',
    rel: ['noopener', 'nofollow', 'license'],
  });
  expect(attributesOf(chosen!.html)).toEqual([
    ['href', 'https://example.org/'],
    ['rel', 'noopener nofollow license'],
  ]);
  const spelled = buildLink({ kind: 'web', href: 'https://example.org/', rel: ['NoFollow', 'author'] });
  expect(attributesOf(spelled!.html)[1]).toEqual(['rel', 'NoFollow author']);

  // Target and download only when chosen, after rel, in the order href, rel, target, download.
  const all = buildLink({
    kind: 'web',
    href: 'https://example.org/report.pdf',
    rel: ['nofollow'],
    target: '_self',
    download: 'report.pdf',
  });
  expect(attributesOf(all!.html).map(([name]) => name)).toEqual(['href', 'rel', 'target', 'download']);
  expect(all!.html).toBe(
    '<a href="https://example.org/report.pdf" rel="nofollow" target="_self" download="report.pdf">https://example.org/report.pdf</a>',
  );
  // A download with no name is the bare attribute.
  const unnamed = buildLink({ kind: 'web', href: 'https://example.org/x', download: true });
  expect(unnamed!.html).toBe('<a href="https://example.org/x" download>https://example.org/x</a>');
  const onlyTarget = buildLink({ kind: 'web', href: 'https://example.org/', target: '_top' });
  expect(attributesOf(onlyTarget!.html).map(([name]) => name)).toEqual(['href', 'target']);

  // Every link type of the table can be written, one at a time, and none adds another.
  for (const type of LINK_TYPES_ON_A) {
    const link = buildLink({ kind: 'web', href: 'https://example.org/', rel: [type.value] });
    expect(attributesOf(link!.html)[1]).toEqual(['rel', type.value]);
  }

  // Link text is the address as typed when left blank.
  expect(textOf(findAll(parse(bare!.html).frag, 'a')[0]!)).toBe('Example');
  expect(buildLink({ kind: 'web', href: 'https://example.org/a b' })!.html).toBe(
    '<a href="https://example.org/a b">https://example.org/a b</a>',
  );
});

it('IANA Link Relations: sponsored and ugc are accepted as registered extensions, and unknown or repeated values are refused', () => {
  const ok = parseRel(['noopener', 'nofollow', 'license']);
  expect(ok.tokens).toEqual(['noopener', 'nofollow', 'license']);
  expect(ok.registered).toEqual([]);

  const extensions = parseRel(['sponsored', 'UGC']);
  expect(extensions.tokens).toEqual(['sponsored', 'UGC']);
  expect(extensions.registered).toEqual(['sponsored', 'UGC']);
  const link = buildLink({ kind: 'web', href: 'https://example.org/', rel: ['sponsored', 'ugc'] });
  expect(attributesOf(link!.html)[1]).toEqual(['rel', 'sponsored ugc']);
  expect(link!.warnings.join(' ')).toContain('IANA');
  expect(link!.warnings.join(' ')).toContain('2019-11-07');

  const unknown = refusalOf(() => parseRel(['bogus']));
  expect(unknown.field).toBe('Rel');
  expect(unknown.message).toContain('bogus');
  expect(unknown.message).toContain('noopener');
  const repeated = refusalOf(() => parseRel(['nofollow', 'NOFOLLOW']));
  expect(repeated.field).toBe('Rel');
  expect(repeated.message).toContain('more than once');
  expect(refusalOf(() => parseRel(['no follow'])).field).toBe('Rel');
  // A value the table does not list is not invented, even when it is a real attribute name elsewhere.
  expect(refusalOf(() => parseRel(['hreflang'])).field).toBe('Rel');
  // An empty list is allowed and writes no rel attribute.
  expect(parseRel([]).tokens).toEqual([]);
  expect(parseRel(['', '  ']).tokens).toEqual([]);
});

it('opener together with noopener or noreferrer is flagged as contradictory and target _blank gets a note, not an added value', () => {
  const blank = buildLink({ kind: 'web', href: 'https://example.org/', target: '_blank' });
  expect(attributesOf(blank!.html)).toEqual([
    ['href', 'https://example.org/'],
    ['target', '_blank'],
  ]);
  expect(blank!.warnings).toEqual([
    'The standard already opens this link without a reference to this page (target _blank implies noopener), so rel=noopener is not needed and was not added.',
  ]);
  // The keyword is compared ASCII case-insensitively.
  const upper = buildLink({ kind: 'web', href: 'https://example.org/', target: '_BLANK' });
  expect(upper!.warnings).toHaveLength(1);
  expect(attributesOf(upper!.html)).toEqual([
    ['href', 'https://example.org/'],
    ['target', '_BLANK'],
  ]);

  for (const other of ['noopener', 'noreferrer']) {
    const link = buildLink({ kind: 'web', href: 'https://example.org/', rel: ['opener', other], target: '_blank' });
    expect(attributesOf(link!.html)[1]).toEqual(['rel', `opener ${other}`]);
    expect(link!.warnings.join(' ')).toContain('contradict');
    expect(link!.warnings.join(' ')).toContain('noopener wins');
    // The note about target is not shown when the visitor chose rel values that already settle it.
    expect(link!.warnings.join(' ')).not.toContain('was not added');
  }
  // Opener alone with target _blank is the visitor choice, and nothing is said.
  const opener = buildLink({ kind: 'web', href: 'https://example.org/', rel: ['opener'], target: '_blank' });
  expect(opener!.warnings).toEqual([]);
  // A noopener the visitor chose is written, and no note says it was not added.
  const chosen = buildLink({ kind: 'web', href: 'https://example.org/', rel: ['noopener'], target: '_blank' });
  expect(attributesOf(chosen!.html)[1]).toEqual(['rel', 'noopener']);
  expect(chosen!.warnings).toEqual([]);
  // A target name of its own is valid; a bad one is refused naming Target.
  expect(buildLink({ kind: 'web', href: 'https://example.org/', target: 'results' })!.warnings).toEqual([]);
  const nowhere = refusalOf(() => buildLink({ kind: 'web', href: 'https://example.org/', target: '_nowhere' }));
  expect(nowhere.field).toBe('Target');
  const tabbed = refusalOf(() => buildLink({ kind: 'web', href: 'https://example.org/', target: 'a\t<b' }));
  expect(tabbed.field).toBe('Target');
});

it('a javascript, data or vbscript address is kept as typed and flagged with a warning', () => {
  const tabbed = 'java' + String.fromCharCode(9) + 'script:alert(1)';
  const cases: [string, string][] = [
    ['javascript:alert(1)', 'javascript'],
    ['JaVaScRiPt:alert(1)', 'javascript'],
    [tabbed, 'javascript'],
    ['  javascript:alert(1)', 'javascript'],
    ['vbscript:x', 'vbscript'],
    ['data:text/html;base64,PHNjcmlwdD4=', 'data'],
  ];
  for (const [href, scheme] of cases) {
    const link = buildLink({ kind: 'web', href });
    expect(link).not.toBeNull();
    expect(link!.warnings.join(' ')).toContain('Address');
    expect(link!.warnings.join(' ')).toContain(`${scheme}:`);
    // Kept as typed: the address in the parsed href is exactly what was typed.
    expect(attrOf(findAll(parse(link!.html).frag, 'a')[0]!, 'href')).toBe(href);
    expect(link!.address).toBe(href);
  }
  // A character reference typed as text is escaped, so it is a relative address and gets no warning.
  const reference = buildLink({ kind: 'web', href: '&#106;avascript:alert(1)' });
  expect(reference!.warnings).toEqual([]);
  expect(reference!.html).toContain('href="&amp;#106;avascript:alert(1)"');
  expect(buildLink({ kind: 'web', href: 'https://example.org/' })!.warnings).toEqual([]);
  // A required address: typing other fields without one is reported naming Address.
  expect(refusalOf(() => buildLink({ kind: 'web', text: 'Go' })).field).toBe('Address');
  expect(buildLink({ kind: 'web' })).toBeNull();
});

/** One benign value for every field of each kind, and the fields that accept any text. */
const BENIGN: Record<string, { fixed: Record<string, unknown>; free: string[] }> = {
  web: {
    fixed: { kind: 'web', href: 'https://example.org/', text: 'Link', target: 'frame', download: 'a.pdf' },
    free: ['href', 'text', 'target', 'download'],
  },
  mailto: {
    fixed: {
      kind: 'mailto',
      to: 'a@example.org',
      cc: 'b@example.org',
      bcc: 'c@example.org',
      subject: 'Hello',
      body: 'Body',
      text: 'Mail',
    },
    free: ['to', 'cc', 'bcc', 'subject', 'body', 'text'],
  },
  tel: { fixed: { kind: 'tel', phone: '+1-201-555-0123', text: 'Call' }, free: ['text'] },
  sms: { fixed: { kind: 'sms', recipients: '+15105550101', smsBody: 'Hi', text: 'Text' }, free: ['smsBody', 'text'] },
};

it('hostile text in every field leaves the parsed link tree unchanged', () => {
  for (const [kind, { fixed, free }] of Object.entries(BENIGN)) {
    const base = buildLink(fixed as unknown as LinkSpec);
    expect(base, kind).not.toBeNull();
    const expected = shape(parse(base!.html).frag);
    for (const field of free) {
      for (const hostile of HOSTILE) {
        const spec = { ...fixed, [field]: hostile } as unknown as LinkSpec;
        if (hasControlCharacter(hostile)) {
          // A control character is refused before any markup is built, naming the field.
          expect(() => buildLink(spec), `${kind} ${field}`).toThrow(MarkupError);
          continue;
        }
        const link = buildLink(spec);
        expect(link, `${kind} ${field} ${hostile.slice(0, 20)}`).not.toBeNull();
        const parsed = parse(link!.html);
        expect(parsed.errors, `${kind} ${field}`).toEqual([]);
        expect(shape(parsed.frag), `${kind} ${field} ${hostile.slice(0, 20)}`).toBe(expected);
        // The preview parses with no errors too.
        expect(parse(link!.preview).errors).toEqual([]);
      }
    }
  }
});

it('markup, preview and warnings come from one call on one input', () => {
  const specs: LinkSpec[] = [
    {
      kind: 'web',
      href: 'https://example.org/?a=1&b=2',
      rel: ['noopener', 'sponsored'],
      target: '_blank',
      text: 'x & y',
    },
    { kind: 'web', href: 'javascript:alert(1)', rel: ['opener', 'noreferrer'], target: '_blank' },
    { kind: 'mailto', to: 'joe@an.example', cc: 'bob@an.example', bcc: 'x', subject: 'Hi there', body: 'a\nb' },
    { kind: 'tel', phone: '+1 201 555 0123', ext: '4567' },
    { kind: 'sms', recipients: '+15105550101, +15105550102', smsBody: 'hello there' },
  ];
  for (const spec of specs) {
    const link = buildLink(spec);
    expect(link, spec.kind).not.toBeNull();
    // The markup, the preview and the address are all read off the one tree.
    expect(link!.html).toBe(serialize(link!.tree));
    expect(link!.preview).toBe(serialize(inert(link!.tree)));
    const anchor = link!.tree[0]!;
    expect(anchor.tag).toBe('a');
    const href = anchor.attrs.find(([name]) => name === 'href');
    expect(href?.[1]).toBe(link!.address);
    // The same input gives the same result, so nothing in it depends on when or how often it is built.
    const again = buildLink(spec);
    expect(again!.html).toBe(link!.html);
    expect(again!.preview).toBe(link!.preview);
    expect(again!.address).toBe(link!.address);
    expect(again!.warnings).toEqual(link!.warnings);
    // The preview carries no address attribute at all.
    expect(attributesOf(link!.preview).map(([name]) => name)).not.toContain('href');
  }
});

it('download, rel and target are refused for mailto, tel and sms links naming the field', () => {
  const bases: LinkSpec[] = [
    { kind: 'mailto', to: 'a@example.org' },
    { kind: 'tel', phone: '+1-201-555-0123' },
    { kind: 'sms', recipients: '+15105550101' },
  ];
  for (const base of bases) {
    expect(refusalOf(() => buildLink({ ...base, download: true })).field).toBe('Download');
    expect(refusalOf(() => buildLink({ ...base, download: 'x.pdf' })).message).toContain('4.6.6');
    expect(refusalOf(() => buildLink({ ...base, rel: ['nofollow'] })).field).toBe('Rel');
    expect(refusalOf(() => buildLink({ ...base, target: '_blank' })).field).toBe('Target');
    expect(buildLink({ ...base, rel: [], target: '', download: undefined })).not.toBeNull();
  }
});
