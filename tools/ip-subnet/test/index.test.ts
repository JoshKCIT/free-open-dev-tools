import { describe, it, expect } from 'vitest';
import {
  parseIpv4,
  parseIpv6,
  formatIpv4,
  formatIpv6,
  expandIpv6,
  describe as describeNet,
  contains,
  split,
  rangeToCidrs,
  summarise,
  classify,
  arpaName,
  maskToPrefix,
  randomInBlock,
  IpError,
} from '../src/index';

describe('IPv4 parsing', () => {
  it('parses the obvious cases', () => {
    expect(parseIpv4('0.0.0.0')).toBe(0n);
    expect(parseIpv4('255.255.255.255')).toBe(4294967295n);
    expect(parseIpv4('192.168.1.1')).toBe(3232235777n);
  });

  it('round-trips through formatting', () => {
    for (const ip of ['0.0.0.0', '1.2.3.4', '10.0.0.1', '255.255.255.255', '127.0.0.1']) {
      expect(formatIpv4(parseIpv4(ip))).toBe(ip);
    }
  });

  it('rejects an octet above 255', () => {
    expect(() => parseIpv4('256.0.0.1')).toThrow(/greater than 255/);
  });

  it('rejects the wrong number of parts', () => {
    expect(() => parseIpv4('1.2.3')).toThrow(/four parts/);
    expect(() => parseIpv4('1.2.3.4.5')).toThrow(/four parts/);
  });

  it('rejects a leading zero rather than guessing octal', () => {
    // 010 is 8 in octal and 10 in decimal. Different libraries disagree, and
    // the disagreement has been used to bypass address filters.
    expect(() => parseIpv4('192.168.01.1')).toThrow(/leading zero/);
    expect(parseIpv4('192.168.0.1')).toBeTypeOf('bigint');
  });

  it('rejects non-numeric parts', () => {
    expect(() => parseIpv4('a.b.c.d')).toThrow();
    expect(() => parseIpv4('1.2.3.-4')).toThrow();
  });
});

describe('IPv6 parsing and RFC 5952 formatting', () => {
  it('parses a full address', () => {
    expect(formatIpv6(parseIpv6('2001:0db8:0000:0000:0000:0000:0000:0001'))).toBe('2001:db8::1');
  });

  it('compresses the longest run of zeros', () => {
    expect(formatIpv6(parseIpv6('2001:db8:0:0:1:0:0:1'))).toBe('2001:db8::1:0:0:1');
  });

  it('does not compress a single zero group, per RFC 5952 section 4.2.2', () => {
    expect(formatIpv6(parseIpv6('2001:db8:0:1:1:1:1:1'))).toBe('2001:db8:0:1:1:1:1:1');
  });

  it('formats the loopback and unspecified addresses', () => {
    expect(formatIpv6(parseIpv6('::1'))).toBe('::1');
    expect(formatIpv6(parseIpv6('::'))).toBe('::');
  });

  it('lowercases hex digits', () => {
    expect(formatIpv6(parseIpv6('2001:DB8::ABCD'))).toBe('2001:db8::abcd');
  });

  it('expands to the full eight group form', () => {
    expect(expandIpv6(parseIpv6('2001:db8::1'))).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
  });

  it('parses an embedded IPv4 tail', () => {
    expect(formatIpv6(parseIpv6('::ffff:192.0.2.1'))).toBe('::ffff:c000:201');
  });

  it('strips a zone index and brackets', () => {
    expect(formatIpv6(parseIpv6('fe80::1%eth0'))).toBe('fe80::1');
    expect(formatIpv6(parseIpv6('[2001:db8::1]'))).toBe('2001:db8::1');
  });

  it('rejects two double colons', () => {
    expect(() => parseIpv6('2001::db8::1')).toThrow(/at most once/);
  });

  it('rejects the wrong group count', () => {
    expect(() => parseIpv6('2001:db8:1:2:3:4:5')).toThrow(/eight groups/);
    expect(() => parseIpv6('1:2:3:4:5:6:7:8:9')).toThrow(/eight groups/);
  });

  it('rejects a double colon that stands for nothing', () => {
    expect(() => parseIpv6('1:2:3:4:5:6:7::8')).toThrow(/at least one group/);
  });

  it('rejects a group with more than four digits', () => {
    expect(() => parseIpv6('12345::1')).toThrow(/one to four hexadecimal/);
  });
});

describe('IPv4 subnet arithmetic', () => {
  const r = describeNet('192.168.1.130/26');

  it('finds the network address the host belongs to', () => {
    expect(r.network).toBe('192.168.1.128');
    expect(r.addressIsNotNetwork).toBe(true);
  });

  it('computes the mask and the wildcard', () => {
    expect(r.mask).toBe('255.255.255.192');
    expect(r.wildcard).toBe('0.0.0.63');
  });

  it('computes the broadcast address and the host range', () => {
    expect(r.broadcast).toBe('192.168.1.191');
    expect(r.firstHost).toBe('192.168.1.129');
    expect(r.lastHost).toBe('192.168.1.190');
  });

  it('counts total and usable addresses', () => {
    expect(r.totalAddresses).toBe('64');
    expect(r.usableHosts).toBe('62');
  });

  it('handles a /24, the common case', () => {
    const n = describeNet('10.0.0.0/24');
    expect(n.mask).toBe('255.255.255.0');
    expect(n.broadcast).toBe('10.0.0.255');
    expect(n.usableHosts).toBe('254');
  });

  it('handles a /32, a single address', () => {
    const n = describeNet('10.0.0.5/32');
    expect(n.totalAddresses).toBe('1');
    expect(n.usableHosts).toBe('1');
    expect(n.firstHost).toBe('10.0.0.5');
  });

  it('treats a /31 as a point-to-point link with two usable addresses, per RFC 3021', () => {
    // The usual "subtract two" rule does not apply here, and getting it wrong
    // makes a valid link look unusable.
    const n = describeNet('10.0.0.0/31');
    expect(n.totalAddresses).toBe('2');
    expect(n.usableHosts).toBe('2');
    expect(n.firstHost).toBe('10.0.0.0');
    expect(n.lastHost).toBe('10.0.0.1');
  });

  it('handles a /0, the whole address space', () => {
    const n = describeNet('0.0.0.0/0');
    expect(n.totalAddresses).toBe('4294967296');
    expect(n.mask).toBe('0.0.0.0');
  });

  it('accepts a dotted subnet mask instead of a prefix length', () => {
    expect(describeNet('192.168.1.0/255.255.255.0').prefix).toBe(24);
  });

  it('rejects a mask with a gap in it', () => {
    expect(() => describeNet('192.168.1.0/255.0.255.0')).toThrow(/run of ones/);
  });

  it('treats a bare address as a single-host block', () => {
    expect(describeNet('192.168.1.1').prefix).toBe(32);
  });

  it('rejects an out-of-range prefix', () => {
    expect(() => describeNet('10.0.0.0/33')).toThrow(/between 0 and 32/);
  });

  it('shows the binary form of the network and the mask', () => {
    const n = describeNet('192.168.1.0/24');
    expect(n.binaryNetwork).toBe('11000000.10101000.00000001.00000000');
    expect(n.binaryMask).toBe('11111111.11111111.11111111.00000000');
  });
});

describe('IPv6 subnet arithmetic', () => {
  it('computes a /64, the standard LAN size', () => {
    const r = describeNet('2001:db8:1:2::abcd/64');
    expect(r.network).toBe('2001:db8:1:2::');
    expect(r.totalAddresses).toBe('18446744073709551616');
    expect(r.lastAddress).toBe('2001:db8:1:2:ffff:ffff:ffff:ffff');
  });

  it('has no broadcast address, because IPv6 has no broadcast', () => {
    expect(describeNet('2001:db8::/64').broadcast).toBeUndefined();
  });

  it('handles a /128, a single address', () => {
    expect(describeNet('::1/128').totalAddresses).toBe('1');
  });

  it('handles a /0', () => {
    expect(describeNet('::/0').totalAddresses).toBe('340282366920938463463374607431768211456');
  });

  it('shows the expanded form alongside the compressed one', () => {
    expect(describeNet('2001:db8::/32').expanded).toBe('2001:0db8:0000:0000:0000:0000:0000:0000');
  });
});

describe('special purpose ranges', () => {
  it('names the RFC 1918 private blocks', () => {
    expect(classify(parseIpv4('10.1.2.3'), 4).join(' ')).toMatch(/RFC 1918/);
    expect(classify(parseIpv4('172.16.0.1'), 4).join(' ')).toMatch(/RFC 1918/);
    expect(classify(parseIpv4('192.168.0.1'), 4).join(' ')).toMatch(/RFC 1918/);
  });

  it('does not call 172.32.0.1 private, since the block is only /12', () => {
    expect(classify(parseIpv4('172.32.0.1'), 4).join(' ')).not.toMatch(/RFC 1918/);
  });

  it('names loopback, link-local and documentation ranges', () => {
    expect(classify(parseIpv4('127.0.0.1'), 4).join(' ')).toMatch(/Loopback/);
    expect(classify(parseIpv4('169.254.1.1'), 4).join(' ')).toMatch(/Link-local/);
    expect(classify(parseIpv4('192.0.2.5'), 4).join(' ')).toMatch(/Documentation/);
  });

  it('names IPv6 special ranges', () => {
    expect(classify(parseIpv6('::1'), 6).join(' ')).toMatch(/Loopback/);
    expect(classify(parseIpv6('fe80::1'), 6).join(' ')).toMatch(/Link-local/);
    expect(classify(parseIpv6('fd00::1'), 6).join(' ')).toMatch(/Unique local/);
    expect(classify(parseIpv6('2001:db8::1'), 6).join(' ')).toMatch(/Documentation/);
  });

  it('calls an ordinary public address globally routable', () => {
    expect(classify(parseIpv4('8.8.8.8'), 4).join(' ')).toMatch(/Globally routable/);
  });
});

describe('containment', () => {
  it('knows whether an address is inside a block', () => {
    expect(contains('192.168.1.0/24', '192.168.1.55')).toBe(true);
    expect(contains('192.168.1.0/24', '192.168.2.55')).toBe(false);
    expect(contains('10.0.0.0/8', '10.255.255.255')).toBe(true);
  });

  it('checks boundaries exactly', () => {
    expect(contains('192.168.1.0/24', '192.168.1.0')).toBe(true);
    expect(contains('192.168.1.0/24', '192.168.1.255')).toBe(true);
    expect(contains('192.168.1.0/24', '192.168.0.255')).toBe(false);
    expect(contains('192.168.1.0/24', '192.168.2.0')).toBe(false);
  });

  it('works for IPv6', () => {
    expect(contains('2001:db8::/32', '2001:db8:ffff::1')).toBe(true);
    expect(contains('2001:db8::/32', '2001:db9::1')).toBe(false);
  });

  it('says no when the versions differ rather than throwing', () => {
    expect(contains('192.168.1.0/24', '::1')).toBe(false);
  });
});

describe('splitting', () => {
  it('splits a /24 into four /26 blocks', () => {
    const r = split('192.168.1.0/24', 26);
    expect(r.total).toBe('4');
    expect(r.subnets.map((s) => s.cidr)).toEqual([
      '192.168.1.0/26',
      '192.168.1.64/26',
      '192.168.1.128/26',
      '192.168.1.192/26',
    ]);
  });

  it('returns the block itself when the prefix is unchanged', () => {
    expect(split('10.0.0.0/8', 8).subnets).toHaveLength(1);
  });

  it('truncates a very large split and says so', () => {
    const r = split('10.0.0.0/8', 24, 10);
    expect(r.truncated).toBe(true);
    expect(r.subnets).toHaveLength(10);
    expect(r.total).toBe('65536');
  });

  it('refuses a prefix shorter than the original', () => {
    expect(() => split('192.168.1.0/24', 16)).toThrow(/larger than the block/);
  });

  it('splits IPv6', () => {
    const r = split('2001:db8::/32', 34);
    expect(r.subnets.map((s) => s.cidr)).toEqual([
      '2001:db8::/34',
      '2001:db8:4000::/34',
      '2001:db8:8000::/34',
      '2001:db8:c000::/34',
    ]);
  });
});

describe('range to CIDR', () => {
  it('covers an aligned range with one block', () => {
    expect(rangeToCidrs('192.168.1.0', '192.168.1.255')).toEqual(['192.168.1.0/24']);
  });

  it('covers an unaligned range with the fewest blocks', () => {
    expect(rangeToCidrs('192.168.1.1', '192.168.1.6')).toEqual([
      '192.168.1.1/32',
      '192.168.1.2/31',
      '192.168.1.4/31',
      '192.168.1.6/32',
    ]);
  });

  it('covers a single address', () => {
    expect(rangeToCidrs('10.0.0.1', '10.0.0.1')).toEqual(['10.0.0.1/32']);
  });

  it('covers the whole IPv4 space', () => {
    expect(rangeToCidrs('0.0.0.0', '255.255.255.255')).toEqual(['0.0.0.0/0']);
  });

  it('refuses a reversed range', () => {
    expect(() => rangeToCidrs('10.0.0.5', '10.0.0.1')).toThrow(/after the end/);
  });

  it('the blocks it produces cover exactly the range and nothing more', () => {
    const cases: [string, string][] = [
      ['10.0.0.3', '10.0.0.200'],
      ['192.168.0.17', '192.168.3.99'],
      ['1.2.3.4', '1.2.3.4'],
      ['0.0.0.1', '0.0.0.2'],
    ];
    for (const [start, end] of cases) {
      const blocks = rangeToCidrs(start, end);
      let covered = 0n;
      for (const block of blocks) {
        const n = describeNet(block);
        covered += BigInt(n.totalAddresses);
      }
      expect(covered).toBe(parseIpv4(end) - parseIpv4(start) + 1n);
      expect(contains(blocks[0]!, start)).toBe(true);
      expect(contains(blocks[blocks.length - 1]!, end)).toBe(true);
    }
  });
});

describe('summarising', () => {
  it('merges two adjacent blocks into one', () => {
    expect(summarise(['192.168.0.0/25', '192.168.0.128/25'])).toEqual(['192.168.0.0/24']);
  });

  it('merges overlapping blocks', () => {
    expect(summarise(['10.0.0.0/8', '10.1.0.0/16'])).toEqual(['10.0.0.0/8']);
  });

  it('leaves blocks that are not adjacent alone', () => {
    expect(summarise(['192.168.0.0/24', '192.168.2.0/24'])).toEqual(['192.168.0.0/24', '192.168.2.0/24']);
  });

  it('handles an empty list', () => {
    expect(summarise([])).toEqual([]);
  });
});

describe('reverse DNS names', () => {
  it('builds an in-addr.arpa name for IPv4', () => {
    expect(arpaName(parseIpv4('192.0.2.5'), 4)).toBe('5.2.0.192.in-addr.arpa');
  });

  it('builds an ip6.arpa name for IPv6', () => {
    expect(arpaName(parseIpv6('2001:db8::1'), 6)).toBe(
      '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa',
    );
  });
});

describe('mask conversion', () => {
  it('converts a dotted mask to a prefix length', () => {
    expect(maskToPrefix(parseIpv4('255.255.255.0'))).toBe(24);
    expect(maskToPrefix(parseIpv4('255.255.255.252'))).toBe(30);
    expect(maskToPrefix(parseIpv4('0.0.0.0'))).toBe(0);
    expect(maskToPrefix(parseIpv4('255.255.255.255'))).toBe(32);
  });
});

describe('random addresses in a block', () => {
  it('always lands inside the block', () => {
    for (const ip of randomInBlock('10.20.0.0/16', 200)) {
      expect(contains('10.20.0.0/16', ip)).toBe(true);
    }
  });

  it('works for IPv6', () => {
    for (const ip of randomInBlock('2001:db8::/32', 50)) {
      expect(contains('2001:db8::/32', ip)).toBe(true);
    }
  });

  it('returns the only address for a /32', () => {
    expect(randomInBlock('10.0.0.7/32', 3)).toEqual(['10.0.0.7', '10.0.0.7', '10.0.0.7']);
  });
});

describe('errors', () => {
  it('throws IpError, not a generic error', () => {
    expect(() => parseIpv4('nope')).toThrow(IpError);
    expect(() => parseIpv6('nope')).toThrow(IpError);
  });
});
