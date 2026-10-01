import { it, expect } from 'vitest';
import { MarkupError, buildLink, meta } from '../src/index';
import { serialize, inert } from '../src/markup';
import { attrOf, findAll, parse, textOf } from './parse';

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
