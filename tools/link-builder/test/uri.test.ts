import { it, expect } from 'vitest';
import { MarkupError } from '../src/markup';
import { buildMailto, buildSms, buildTel, encodeHeaderValue, encodeLocalPart, percentEncode } from '../src/uri';
import { buildLink } from '../src/index';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

function refusal(run: () => unknown): MarkupError {
  try {
    run();
  } catch (e) {
    if (e instanceof MarkupError) return e;
    throw e;
  }
  throw new Error('expected a MarkupError, but nothing was thrown');
}

it('RFC 6068 section 6.1 body with two lines joins them with an encoded carriage return and line feed', () => {
  // RFC 6068 section 6.1: "send current-issue" and, on the next line, "send index".
  const literal = 'mailto:infobot@example.com?body=send%20current-issue%0D%0Asend%20index';
  const lines = ['send current-issue', 'send index'];
  // RFC 6068 section 5: line breaks in the body MUST be encoded with a carriage return and line feed,
  // whichever line break was typed.
  for (const separator of [LF, CR + LF, CR]) {
    expect(buildMailto({ to: ['infobot@example.com'], body: lines.join(separator) })).toBe(literal);
  }
});

it('RFC 6068 section 6.1 every basic example is reproduced exactly', () => {
  // RFC 6068 section 6.1: an ordinary individual mailing address.
  expect(buildMailto({ to: ['chris@example.com'] })).toBe('mailto:chris@example.com');
  // A mail response system that requires the name of the file to be sent back in the subject.
  expect(buildMailto({ to: ['infobot@example.com'], subject: 'current-issue' })).toBe(
    'mailto:infobot@example.com?subject=current-issue',
  );
  // A "send" request in the body.
  expect(buildMailto({ to: ['infobot@example.com'], body: 'send current-issue' })).toBe(
    'mailto:infobot@example.com?body=send%20current-issue',
  );
  // A request to subscribe to a mailing list.
  expect(buildMailto({ to: ['majordomo@example.com'], body: 'subscribe bamboo-l' })).toBe(
    'mailto:majordomo@example.com?body=subscribe%20bamboo-l',
  );
  // A single user with a copy to another user; the ampersand between header fields stays bare in the address.
  expect(buildMailto({ to: ['joe@example.com'], cc: ['bob@example.com'], body: 'hello' })).toBe(
    'mailto:joe@example.com?cc=bob@example.com&body=hello',
  );
  // An In-Reply-To header field (a header name this builder does not offer, so the value is encoded by the same
  // header value encoder the offered fields use): the Message-ID in angle brackets.
  expect(`mailto:list@example.org?In-Reply-To=${encodeHeaderValue('<3469A91.D10AF4C@example.com>')}`).toBe(
    'mailto:list@example.org?In-Reply-To=%3C3469A91.D10AF4C@example.com%3E',
  );
  // RFC 6068 section 2: to and the to header field are equivalent; the address list is comma separated.
  expect(buildMailto({ to: ['addr1@an.example', 'addr2@an.example'] })).toBe(
    'mailto:addr1@an.example,addr2@an.example',
  );
  // A body with no recipient is valid: mailto = "mailto:" [ to ] [ hfields ].
  expect(buildMailto({ body: 'hi' })).toBe('mailto:?body=hi');
});

it('RFC 6068 section 6.2 percent, ampersand, question mark, quotes and backslashes in a local part are percent-encoded', () => {
  // RFC 6068 section 6.1: "gorby%kremvax@example.com", "Mike&family@example.org", "unlikely?address@example.com".
  expect(buildMailto({ to: ['gorby%kremvax@example.com'] })).toBe('mailto:gorby%25kremvax@example.com');
  expect(buildMailto({ to: ['Mike&family@example.org'] })).toBe('mailto:Mike%26family@example.org');
  expect(`${buildMailto({ to: ['unlikely?address@example.com'] })}?blat=${encodeHeaderValue('foop')}`).toBe(
    'mailto:unlikely%3Faddress@example.com?blat=foop',
  );
  // RFC 6068 section 6.2: the three complicated addresses. The address is split at its last at sign.
  expect(buildMailto({ to: ['"not@me"@example.org'] })).toBe('mailto:%22not%40me%22@example.org');
  expect(buildMailto({ to: [String.raw`"oh\\no"@example.org`] })).toBe('mailto:%22oh%5C%5Cno%22@example.org');
  expect(buildMailto({ to: [String.raw`"\\\"it's\ ugly\\\""@example.org`] })).toBe(
    "mailto:%22%5C%5C%5C%22it's%5C%20ugly%5C%5C%5C%22%22@example.org",
  );
  // The encoders on their own: only unreserved characters and ! $ ' ( ) * stay in a local part.
  expect(encodeLocalPart('a b#/[]=,@"\\%&?+')).toBe('a%20b%23%2F%5B%5D%3D%2C%40%22%5C%25%26%3F%2B');
  expect(encodeLocalPart("!$'()*-._~")).toBe("!$'()*-._~");
});

it('RFC 6068 section 6.3 non-ASCII subject and body are UTF-8 then percent-encoded and a non-ASCII domain becomes punycode by default', () => {
  // RFC 6068 section 6.3: the subject "cafe" with a final e-acute (U+00E9), written with UTF-8 and percent-encoding.
  const cafe = 'café';
  expect(buildMailto({ to: ['user@example.org'], subject: cafe })).toBe('mailto:user@example.org?subject=caf%C3%A9');
  // The same subject as an MIME encoded word: the equals sign and question mark are reserved, so they are encoded.
  expect(buildMailto({ to: ['user@example.org'], subject: '=?utf-8?Q?caf=C3=A9?=' })).toBe(
    'mailto:user@example.org?subject=%3D%3Futf-8%3FQ%3Fcaf%3DC3%3DA9%3F%3D',
  );
  expect(buildMailto({ to: ['user@example.org'], subject: '=?iso-8859-1?Q?caf=E9?=' })).toBe(
    'mailto:user@example.org?subject=%3D%3Fiso-8859-1%3FQ%3Fcaf%3DE9%3F%3D',
  );
  // Back to straight UTF-8 with a body of the same value.
  expect(buildMailto({ to: ['user@example.org'], subject: cafe, body: cafe })).toBe(
    'mailto:user@example.org?subject=caf%C3%A9&body=caf%C3%A9',
  );
  // The Japanese word natto (U+7D0D U+8C46) as a domain name label.
  const natto = '納豆';
  const parts = { to: [`user@${natto}.example.org`], subject: 'Test', body: 'NATTO' };
  // By default the label is converted to punycode, which RFC 6068 section 2 point 4 recommends for interoperability.
  expect(buildMailto(parts)).toBe('mailto:user@xn--99zt52a.example.org?subject=Test&body=NATTO');
  // The package option writes the RFC 6068 section 6.3 literal: each UTF-8 byte of the label percent-encoded.
  expect(buildMailto(parts, { domainEncoding: 'percent' })).toBe(
    'mailto:user@%E7%B4%8D%E8%B1%86.example.org?subject=Test&body=NATTO',
  );
  // An emoji in a local part is four UTF-8 bytes.
  expect(buildMailto({ to: ['\u{1f600}@example.org'] })).toBe('mailto:%F0%9F%98%80@example.org');
});

it('RFC 6068 section 5 a line break in the subject or a recipient is refused so no header can be added', () => {
  const message = 'RFC 6068 section 5';
  for (const lineBreak of [LF, CR, CR + LF]) {
    expect(
      refusal(() => buildMailto({ to: ['a@example.org'], subject: `Hi${lineBreak}Bcc: x@example.org` })).field,
    ).toBe('Subject');
    expect(refusal(() => buildMailto({ to: [`a@example.org${lineBreak}Bcc: x@example.org`] })).field).toBe('To');
    expect(refusal(() => buildMailto({ cc: [`a@example.org${lineBreak}x`] })).field).toBe('Cc');
    expect(refusal(() => buildMailto({ bcc: [`a@example.org${lineBreak}x`] })).field).toBe('Bcc');
  }
  expect(refusal(() => buildMailto({ subject: `a${LF}b` })).message).toContain(message);
  // An encoded line break typed as text is data, not a line break: the percent sign itself is encoded.
  const typed = buildMailto({ to: ['a@example.org'], subject: 'x%0D%0ABcc: evil@example.org' });
  expect(typed).toBe('mailto:a@example.org?subject=x%250D%250ABcc:%20evil@example.org');
  expect(typed).not.toContain('%0D');
  // Only the body carries line breaks.
  expect(buildMailto({ body: `a${LF}b` })).toBe('mailto:?body=a%0D%0Ab');
});

it('RFC 6068 section 7 headers keep each field once in a fixed order and recipients are capped', () => {
  const full = buildMailto({
    to: ['a@example.org', 'b@example.org'],
    cc: ['c@example.org'],
    bcc: ['d@example.org', 'e@example.org'],
    subject: 'Hello world',
    body: 'Body text',
  });
  expect(full).toBe(
    'mailto:a@example.org,b@example.org?cc=c@example.org&bcc=d@example.org,e@example.org&subject=Hello%20world&body=Body%20text',
  );
  const many = Array.from({ length: 26 }, (_, i) => `u${i}@example.org`);
  const refused = refusal(() => buildMailto({ to: many, cc: many }));
  expect(refused.message).toContain('50');
  expect(() => buildMailto({ to: many.slice(0, 25), cc: many.slice(0, 25) })).not.toThrow();
});

it('a stress case with plus, ampersand, quotes, number sign, percent and an emoji is encoded once and exactly', () => {
  const uri = buildMailto({
    to: ['a@b.example'],
    subject: 'C++ & "quotes" #1 100%',
    body: 'l1' + CR + 'l2' + LF + 'l3 \u{1f600}',
  });
  expect(uri).toBe(
    'mailto:a@b.example?subject=C%2B%2B%20%26%20%22quotes%22%20%231%20100%25&body=l1%0D%0Al2%0D%0Al3%20%F0%9F%98%80',
  );
  // percentEncode on its own: uppercase hex, by code point.
  expect(percentEncode('é \u{1f600}', (ch) => ch === ' ')).toBe('%C3%A9 %F0%9F%98%80');
});

it('RFC 3966 section 6 and section 8 examples are reproduced exactly', () => {
  // RFC 3966 section 6: a number in the United States, with hyphens that separate country, area code and subscriber.
  expect(buildTel('+1-201-555-0123').uri).toBe('tel:+1-201-555-0123');
  // A local number valid within the context example.com.
  expect(buildTel('7042', { phoneContext: 'example.com' }).uri).toBe('tel:7042;phone-context=example.com');
  // A local number valid within a particular phone prefix.
  expect(buildTel('863-1234', { phoneContext: '+1-914-555' }).uri).toBe('tel:863-1234;phone-context=+1-914-555');
  // Section 5.3 and section 3: the extension parameter comes first, then the context.
  expect(buildTel('+1-201-555-0123', { ext: '4567' }).uri).toBe('tel:+1-201-555-0123;ext=4567');
  expect(buildTel('7042', { ext: '12', phoneContext: 'example.com' }).uri).toBe(
    'tel:7042;ext=12;phone-context=example.com',
  );
  // Section 8: the link encloses the number, and the number in the address is global even when the text is not.
  const enclose = buildLink({ kind: 'tel', phone: '+1-212-555-0101' });
  expect(enclose?.html).toBe('<a href="tel:+1-212-555-0101">+1-212-555-0101</a>');
  const local = buildLink({ kind: 'tel', phone: '+1-201-555-0111', text: '(201) 555-0111' });
  expect(local?.html).toBe('<a href="tel:+1-201-555-0111">(201) 555-0111</a>');
  const letters = buildLink({ kind: 'tel', phone: '+1-555-438-3732', text: '1-555-IETF-RFC' });
  expect(letters?.html).toBe('<a href="tel:+1-555-438-3732">1-555-IETF-RFC</a>');
  // Section 5.1.3 and grammar: a star is allowed in a local number and a number sign is percent-encoded.
  expect(buildTel('*21#', { phoneContext: 'example.com' }).uri).toBe('tel:*21%23;phone-context=example.com');
});

it('RFC 3966 section 5.1.1 spaces become dashes with a note, letters are refused and a local number needs a phone-context', () => {
  const spaced = buildTel('+1 201 555 0123');
  expect(spaced.uri).toBe('tel:+1-201-555-0123');
  expect(spaced.notes.join(' ')).toContain('5.1.1');
  expect(buildTel('+1-201-555-0123').notes).toEqual([]);
  // Several spaces in a row become one hyphen.
  expect(buildTel('+1   201').uri).toBe('tel:+1-201');
  // Section 5.1.2: letters standing for digits are not supported.
  const letters = refusal(() => buildTel('1-555-IETF-RFC'));
  expect(letters.message).toContain('5.1.2');
  expect(refusal(() => buildTel('+1-800-FLOWERS')).message).toContain('5.1.2');
  // Section 5.1.5: a local number MUST be tagged with a phone-context.
  expect(refusal(() => buildTel('7042')).message).toContain('5.1.5');
  expect(refusal(() => buildTel('201-555-0123')).message).toContain('5.1.5');
  // A global number needs at least one digit after the plus sign (RFC 3966 section 3, erratum 4376).
  for (const bad of ['+', '+-', '+()', '', '   ']) {
    expect(() => buildTel(bad)).toThrow(MarkupError);
  }
  // The context is a domain name or a global number; anything else is refused.
  expect(refusal(() => buildTel('7042', { phoneContext: 'not a domain' })).field).toBe('Phone context');
  expect(refusal(() => buildTel('7042', { phoneContext: '1234' })).field).toBe('Phone context');
  expect(refusal(() => buildTel('+1-201-555-0123', { ext: 'ab' })).field).toBe('Extension');
  // Section 5.1.4: a global number works everywhere, so it takes no phone-context.
  expect(refusal(() => buildTel('+1-201-555-0123', { phoneContext: 'example.com' })).field).toBe('Phone context');
});

it('RFC 5724 section 2.5 recipient lists and the body example are reproduced exactly', () => {
  // RFC 5724 section 2.5: one recipient, two recipients, one recipient with a body.
  expect(buildSms(['+15105550101']).uri).toBe('sms:+15105550101');
  expect(buildSms(['+15105550101', '+15105550102']).uri).toBe('sms:+15105550101,+15105550102');
  expect(buildSms(['+15105550101'], 'hello there').uri).toBe('sms:+15105550101?body=hello%20there');
  // A recipient is an RFC 3966 telephone subscriber, so a local number carries its phone-context.
  expect(buildSms(['7042;phone-context=example.com']).uri).toBe('sms:7042;phone-context=example.com');
  expect(refusal(() => buildSms(['7042'])).message).toContain('5.1.5');
  expect(refusal(() => buildSms([])).field).toBe('Recipients');
  const twentyOne = Array.from({ length: 21 }, (_, i) => `+1510555${String(i).padStart(4, '0')}`);
  expect(refusal(() => buildSms(twentyOne)).message).toContain('20');
  expect(buildSms(twentyOne.slice(0, 20)).uri.startsWith('sms:+15105550000,')).toBe(true);
});

it('RFC 5724 an sms body encodes everything except unreserved characters, including line breaks and non-ASCII letters', () => {
  // RFC 5724 section 2.2: escaped-value = *( unreserved / pct-encoded ), so everything else is percent-encoded.
  const body = 'Tom & Jerry: 50% off!' + LF + 'see you at 5, ok? café';
  expect(buildSms(['+15105550101'], body).uri).toBe(
    'sms:+15105550101?body=Tom%20%26%20Jerry%3A%2050%25%20off%21%0Asee%20you%20at%205%2C%20ok%3F%20caf%C3%A9',
  );
  // Unreserved characters stay; the marks that mailto keeps are encoded here.
  expect(buildSms(['+15105550101'], "-._~ !'()*").uri).toBe('sms:+15105550101?body=-._~%20%21%27%28%29%2A');
  // Every line break form is written as one encoded line feed (RFC 5724 is silent; the character set has LF).
  for (const lineBreak of [LF, CR + LF, CR]) {
    expect(buildSms(['+15105550101'], `a${lineBreak}b`).uri).toBe('sms:+15105550101?body=a%0Ab');
  }
  expect(buildSms(['+15105550101'], '\u{1f600}').uri).toBe('sms:+15105550101?body=%F0%9F%98%80');
  // The body is written once, and only when there is one.
  expect(buildSms(['+15105550101'], '').uri).toBe('sms:+15105550101');
});
