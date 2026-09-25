import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ptrNames, IpPtrError } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, '');
}

function readFixture(...parts: string[]): string {
  return readFileSync(join(here, 'fixtures', ...parts), 'utf8');
}

const rfc1035 = readFixture('rfc1035', 'rfc1035.txt');
const rfc3596 = readFixture('rfc3596', 'rfc3596.txt');

it('the RFC 1035 section 3.5 example 10.2.0.52 becomes 52.0.2.10.in-addr.arpa', () => {
  const result = ptrNames('10.2.0.52');
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]!.reverseName).toBe('52.0.2.10.in-addr.arpa');
  // RFC 1035 section 3.5 gives this example as 52.0.2.10.IN-ADDR.ARPA.
  expect(stripWhitespace(rfc1035)).toContain(stripWhitespace('52.0.2.10.IN-ADDR.ARPA.'));
});

it('the RFC 3596 section 2.5 example 4321:0:1:2:3:4:567:89ab becomes its 32-nibble ip6.arpa name', () => {
  const result = ptrNames('4321:0:1:2:3:4:567:89ab');
  expect(result.rows).toHaveLength(1);
  const expected = 'b.a.9.8.7.6.5.0.4.0.0.0.3.0.0.0.2.0.0.0.1.0.0.0.0.0.0.0.1.2.3.4.ip6.arpa';
  expect(result.rows[0]!.reverseName).toBe(expected);
  expect(result.rows[0]!.reverseName!.split('.').filter((p) => p !== 'ip6' && p !== 'arpa')).toHaveLength(32);
  // RFC 3596 section 2.5 gives this example, wrapped across two lines, in capitals.
  const rfcExample = 'b.a.9.8.7.6.5.0.4.0.0.0.3.0.0.0.2.0.0.0.1.0.0.0.0.0.0.0.1.2.3.4.IP6.ARPA.';
  expect(stripWhitespace(rfc3596)).toContain(stripWhitespace(rfcExample));
});

it('every RFC 4291 section 2.2 text form of the same address gives the same ip6.arpa name', () => {
  // RFC 4291 section 2.2's own unicast example, in its full and compressed forms,
  // plus a lower-cased full form and a fully zero-padded full form.
  const forms = [
    '2001:DB8:0:0:8:800:200C:417A',
    '2001:DB8::8:800:200C:417A',
    '2001:db8:0:0:8:800:200c:417a',
    '2001:0db8:0000:0000:0008:0800:200c:417a',
  ];
  const names = forms.map((form) => ptrNames(form).rows[0]!.reverseName);
  for (const name of names) expect(name).toBe(names[0]);
});

it('addresses are shown in the RFC 5952 recommended text form', () => {
  const result = ptrNames('2001:0DB8:0000:0000:0000:0000:0000:0001');
  // RFC 5952: lowercase, no leading zeros, the longest run of zero groups compressed.
  expect(result.rows[0]!.address).toBe('2001:db8::1');
  const ipv4 = ptrNames('10.2.0.52');
  expect(ipv4.rows[0]!.address).toBe('10.2.0.52');
});

it('a block on an octet or nibble boundary gives its reverse zone and any other prefix is refused naming RFC 2317', () => {
  expect(ptrNames('192.0.2.0/24').rows[0]!.zone).toBe('2.0.192.in-addr.arpa');
  expect(ptrNames('192.0.2.0/16').rows[0]!.zone).toBe('0.192.in-addr.arpa');
  expect(ptrNames('192.0.2.0/8').rows[0]!.zone).toBe('192.in-addr.arpa');
  expect(ptrNames('2001:db8::/32').rows[0]!.zone).toBe('8.b.d.0.1.0.0.2.ip6.arpa');

  const badV4 = ptrNames('192.0.2.0/25');
  expect(badV4.rows).toHaveLength(0);
  expect(badV4.problems).toHaveLength(1);
  expect(badV4.problems[0]!.message).toContain('RFC 2317');

  const badV6 = ptrNames('2001:db8::/33');
  expect(badV6.rows).toHaveLength(0);
  expect(badV6.problems).toHaveLength(1);
  expect(badV6.problems[0]!.message).toContain('RFC 2317');
});

it('a PTR record line follows the RFC 1035 master file format and the target must be an RFC 1123 host name', () => {
  const noTtl = ptrNames('192.0.2.1', { hostname: 'host.example.com' });
  expect(noTtl.records).toEqual(['1.2.0.192.in-addr.arpa. IN PTR host.example.com.']);

  const withTtl = ptrNames('192.0.2.1', { hostname: 'host.example.com', ttl: 3600 });
  expect(withTtl.records).toEqual(['1.2.0.192.in-addr.arpa. 3600 IN PTR host.example.com.']);

  const alreadyDotted = ptrNames('192.0.2.1', { hostname: 'host.example.com.' });
  expect(alreadyDotted.records).toEqual(['1.2.0.192.in-addr.arpa. IN PTR host.example.com.']);

  expect(() => ptrNames('192.0.2.1', { hostname: 'bad_host name!' })).toThrow(IpPtrError);
  expect(() => ptrNames('192.0.2.1', { hostname: 'bad_host name!' })).toThrow(/RFC 1123/);

  const negativeTtl = ptrNames('192.0.2.1', { hostname: 'host.example.com', ttl: -5 });
  expect(negativeTtl.records).toEqual(['1.2.0.192.in-addr.arpa. IN PTR host.example.com.']);
  expect(negativeTtl.problems.some((p) => p.line === 0)).toBe(true);
});

it('malformed lines are reported with their line number and the other lines still convert', () => {
  const result = ptrNames('192.0.2.1\nnot-an-address\n10.0.0.1\n192.0.2.0/25\nfe80::1%eth0');
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0]!.reverseName).toBe('1.2.0.192.in-addr.arpa');
  expect(result.rows[1]!.reverseName).toBe('1.0.0.10.in-addr.arpa');

  expect(result.problems).toHaveLength(3);
  const byLine = new Map(result.problems.map((p) => [p.line, p.message]));
  expect(byLine.get(2)).toBeTruthy();
  expect(byLine.get(4)).toContain('RFC 2317');
  expect(byLine.get(5)).toContain('zone index');
});

it('nothing is written to the console while building names', () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  try {
    ptrNames('192.0.2.1\nnot-an-address\n2001:db8::1%eth0\n192.0.2.0/25', { hostname: 'host.example.com', ttl: -1 });
    ptrNames('::ffff:192.0.2.1');
    try {
      ptrNames('192.0.2.1', { hostname: 'bad_host name!' });
    } catch {
      // expected: only checking console output here
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

it('an IPv4-mapped IPv6 address also notes the embedded IPv4 address own reverse name', () => {
  const result = ptrNames('::ffff:192.0.2.1');
  // 192.0.2.1 is c000:0201 in hex, so the full address is 0000:...:0000:ffff:c000:0201.
  const nibbles = '00000000000000000000ffffc0000201'.split('').reverse().join('.');
  expect(result.rows[0]!.reverseName).toBe(`${nibbles}.ip6.arpa`);
  expect(result.problems.some((p) => p.message.includes('1.2.0.192.in-addr.arpa'))).toBe(true);
});

it('at most 10000 lines are converted before the input is refused', () => {
  const tooMany = new Array(10001).fill('192.0.2.1').join('\n');
  expect(() => ptrNames(tooMany)).toThrow(IpPtrError);
  const atLimit = new Array(10000).fill('192.0.2.1').join('\n');
  expect(() => ptrNames(atLimit)).not.toThrow();
});
