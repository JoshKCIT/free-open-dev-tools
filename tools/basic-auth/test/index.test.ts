import { describe, it, expect } from 'vitest';
import { buildHeader, parseHeader, buildChallenge, BasicAuthError } from '../src/index';

// RFC 7617 section 2's own worked example:
// "If the user agent wishes to send the user-id 'Aladdin' and password
// 'open sesame', it would use the following header field:
//   Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="
// https://www.rfc-editor.org/rfc/rfc7617#section-2
const RFC_7617_HEADER = 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==';

it('RFC 7617 section 2: buildHeader of Aladdin and open sesame is the published header value', () => {
  expect(buildHeader({ userid: 'Aladdin', password: 'open sesame' })).toBe(RFC_7617_HEADER);
});

it('RFC 7617 section 2: parseHeader of that header returns the published user-id and password', () => {
  expect(parseHeader(RFC_7617_HEADER)).toEqual({ userid: 'Aladdin', password: 'open sesame' });
});

it('the built credentials header carries no auth-param', () => {
  // A non-ASCII password (per RFC 7617 section 2.1's own worked example: user
  // "test", password "123" + U+00A3 POUND SIGN) still produces exactly
  // "Basic " + one token68 run, with no comma and no name=value parameter
  // after it -- charset belongs on the CHALLENGE only (section 2.1), never
  // on the credentials, which are non-extensible token68 syntax.
  const header = buildHeader({ userid: 'test', password: '123£' });
  expect(header).toBe('Basic dGVzdDoxMjPCow==');
  expect(header).not.toContain(',');
  expect(header).not.toMatch(/[A-Za-z]+="[^"]*"/); // no name="value" auth-param
});

it('a user-id containing a colon is rejected', () => {
  try {
    buildHeader({ userid: 'ala:ddin', password: 'open sesame' });
    expect.fail('expected to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(BasicAuthError);
    expect((err as BasicAuthError).message).toMatch(/colon/i);
  }
});

it('a password containing a colon survives, because parsing splits on the first colon only', () => {
  const header = buildHeader({ userid: 'Aladdin', password: 'open:sesame:door' });
  expect(parseHeader(header)).toEqual({ userid: 'Aladdin', password: 'open:sesame:door' });
});

it('buildChallenge escapes a double quote and a backslash in the realm', () => {
  expect(buildChallenge('a"b')).toBe('Basic realm="a\\"b"');
  expect(buildChallenge('a\\b')).toBe('Basic realm="a\\\\b"');
});

it('buildChallenge rejects a realm containing a carriage return', () => {
  try {
    buildChallenge('foo\r\nX-Injected: yes');
    expect.fail('expected to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(BasicAuthError);
    expect((err as BasicAuthError).message).toMatch(/control character/i);
  }
});

it('buildChallenge emits the charset parameter only when asked', () => {
  expect(buildChallenge('WallyWorld')).toBe('Basic realm="WallyWorld"');
  expect(buildChallenge('foo', { charset: true })).toBe('Basic realm="foo", charset="UTF-8"');
});

// Additional coverage beyond the eight mandated titles.

describe('additional coverage', () => {
  it('an empty password is accepted and parses back to an empty string, not undefined', () => {
    const header = buildHeader({ userid: 'nopass', password: '' });
    const parsed = parseHeader(header);
    expect(parsed.password).toBe('');
    expect(parsed.password).not.toBeUndefined();
  });

  it('a header value whose scheme is not Basic is rejected, naming the scheme found', () => {
    try {
      parseHeader('Bearer abc123');
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BasicAuthError);
      expect((err as BasicAuthError).message).toContain('Bearer');
    }
  });

  it('a header value whose credentials are not valid base64 is rejected with the offending position', () => {
    try {
      parseHeader('Basic not!valid==');
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BasicAuthError);
      expect((err as BasicAuthError).position).toBeGreaterThanOrEqual(0);
    }
  });

  it('a non-ASCII password round trips correctly through UTF-8', () => {
    const header = buildHeader({ userid: 'test', password: '123£' });
    expect(parseHeader(header)).toEqual({ userid: 'test', password: '123£' });
  });

  it('buildChallenge rejects a non-ASCII realm unless the charset option is on', () => {
    expect(() => buildChallenge('café')).toThrow(BasicAuthError);
    expect(() => buildChallenge('café', { charset: true })).not.toThrow();
  });
});
