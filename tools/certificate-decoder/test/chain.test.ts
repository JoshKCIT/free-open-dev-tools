import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { decodeInput } from '../src/index';
import { orderChains } from '../src/chain';
import { readCertificate } from '../src/x509';
import { CHAIN_CERTIFICATES } from './fixtures/certs';
import { base64, buildCertificate, name, printable, rdn, utf8 } from './fixtures/der-build';
import { NOW_MS, anyCertificateDer, anyCertificatePem, pemText } from './fixtures/helpers';

/**
 * Issuing order: a pasted set of certificates is put in the order that each one names the next as its issuer. The order is
 * found by comparing the DER bytes of names (and key identifiers when two certificates share a name); nothing is verified.
 * The certificates are OpenSSL's, recorded in test/fixtures (the chain set was made by the extras part of make-fixtures.sh).
 */

// The package prints nothing, whatever it is given.
const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};
beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});
afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

/** Pastes the named fixtures in the given order and gives the result with the names put back in place of the indexes. */
function paste(names: string[]) {
  const result = decodeInput(names.map((n) => anyCertificatePem(n)).join(''), { nowMs: NOW_MS });
  return {
    result,
    chains: result.chains.map((chain) => ({
      names: chain.order.map((index) => names[index]!),
      complete: chain.complete,
      stopReason: chain.stopReason,
    })),
    duplicates: result.duplicates,
  };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
  );
}

it('all six orderings of the leaf, intermediate and root chain come out in issuing order', () => {
  const orders = permutations(['leaf', 'int', 'root']);
  expect(orders).toHaveLength(6);
  for (const pasted of orders) {
    const { chains, duplicates } = paste(pasted);
    expect(chains, pasted.join(',')).toEqual([
      { names: ['leaf', 'int', 'root'], complete: true, stopReason: 'self-issued' },
    ]);
    expect(duplicates, pasted.join(',')).toEqual([]);
  }
  // The roles follow the position in the order, whatever the paste order was.
  const { result } = paste(['root', 'leaf', 'int']);
  expect(result.chains[0]!.roles).toEqual(['leaf', 'intermediate', 'root']);
  // A single certificate, self-issued or not, is a chain of one.
  expect(paste(['root']).chains).toEqual([{ names: ['root'], complete: true, stopReason: 'self-issued' }]);
  expect(paste(['int']).chains).toEqual([{ names: ['int'], complete: false, stopReason: 'issuer-not-in-paste' }]);
});

it('duplicates are reported once and unrelated certificates form their own group', () => {
  const pasted = ['leaf', 'int', 'root', 'int', 'ec256'];
  const { chains, duplicates, result } = paste(pasted);
  // Chains that start at a leaf come first, in paste order, then chains started by a certificate no leaf reached; the repeat of the intermediate is left out of both.
  expect(chains).toEqual([
    { names: ['leaf', 'int', 'root'], complete: true, stopReason: 'self-issued' },
    { names: ['ec256'], complete: true, stopReason: 'self-issued' },
  ]);
  expect(duplicates).toEqual([3]);
  expect(result.chains[1]!.roles).toEqual(['root']);
  // Three copies are two repeats, each reported once, in paste order.
  expect(paste(['root', 'root', 'leaf', 'root', 'int']).duplicates).toEqual([1, 3]);
  // Every certificate shows up in the order or in the duplicates, never in neither.
  const seen = new Set([...result.chains.flatMap((chain) => chain.order), ...duplicates]);
  expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
});

it('a chain without its root ends with issuer not in the paste', () => {
  expect(paste(['int', 'leaf']).chains).toEqual([
    { names: ['leaf', 'int'], complete: false, stopReason: 'issuer-not-in-paste' },
  ]);
  expect(paste(['leaf']).chains).toEqual([{ names: ['leaf'], complete: false, stopReason: 'issuer-not-in-paste' }]);
  const { result } = paste(['int', 'leaf']);
  expect(result.chains[0]!.roles).toEqual(['leaf', 'intermediate']);
  // A certificate that is nobody's issuer and whose issuer is missing is not in a chain.
  expect(paste(['leaf']).result.chains[0]!.roles).toEqual(['alone']);
});

it('two issuers with one subject are told apart by the key identifiers', () => {
  const both = CHAIN_CERTIFICATES['chainintA']!;
  const other = CHAIN_CERTIFICATES['chainintB']!;
  // The two intermediates have one subject and different keys; each leaf names its issuer by key identifier only.
  expect(both.subjectOneline).toBe(other.subjectOneline);
  expect(both.ski).not.toBe(other.ski);
  expect(CHAIN_CERTIFICATES['chainleafA']!.aki).toBe(both.ski);
  expect(CHAIN_CERTIFICATES['chainleafB']!.aki).toBe(other.ski);
  const info = readCertificate(anyCertificateDer('chainintA'), NOW_MS);
  expect(info.ski).toBe(both.ski);
  expect(readCertificate(anyCertificateDer('chainleafA'), NOW_MS).aki).toBe(both.ski);

  // Whatever the paste order, leaf A goes with intermediate A and leaf B with intermediate B.
  const six = ['chainroot', 'chainintA', 'chainintB', 'chainleafA', 'chainleafB'];
  for (const pasted of [six, [...six].reverse(), ['chainintB', 'chainleafB', 'chainroot', 'chainleafA', 'chainintA']]) {
    const { chains } = paste(pasted);
    const byLeaf = new Map(chains.map((chain) => [chain.names[0], chain]));
    expect(byLeaf.get('chainleafA'), pasted.join(',')).toEqual({
      names: ['chainleafA', 'chainintA', 'chainroot'],
      complete: true,
      stopReason: 'self-issued',
    });
    expect(byLeaf.get('chainleafB'), pasted.join(',')).toEqual({
      names: ['chainleafB', 'chainintB', 'chainroot'],
      complete: true,
      stopReason: 'self-issued',
    });
    expect(chains).toHaveLength(2);
  }

  // One leaf with both intermediates: the other intermediate is not left out, it starts a chain of its own.
  const lone = paste(['chainintB', 'chainleafA', 'chainintA', 'chainroot']);
  expect(lone.chains).toEqual([
    { names: ['chainleafA', 'chainintA', 'chainroot'], complete: true, stopReason: 'self-issued' },
    { names: ['chainintB', 'chainroot'], complete: true, stopReason: 'self-issued' },
  ]);
  // A leaf whose issuer by key is missing does not take the other intermediate with the same name.
  const wrong = paste(['chainleafA', 'chainintB', 'chainroot']);
  expect(wrong.chains).toEqual([
    { names: ['chainleafA'], complete: false, stopReason: 'issuer-not-in-paste' },
    { names: ['chainintB', 'chainroot'], complete: true, stopReason: 'self-issued' },
  ]);
});

/** `count` certificates that name each next one as issuer by CN, the last one self-issued when `selfIssuedEnd` is true. */
function links(count: number, selfIssuedEnd: boolean): string[] {
  const out: string[] = [];
  const cn = (index: number) => name(rdn('2.5.4.3', utf8(`link-${index}`)));
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    const issuer = last && selfIssuedEnd ? cn(i) : cn(i + 1);
    out.push(base64(buildCertificate({ serialHex: (i + 1).toString(16).padStart(4, '0'), subject: cn(i), issuer })));
  }
  return out;
}

it('a cycle and a chain longer than 50 stop with a note', () => {
  // Two certificates that name each other as issuer never end: the order stops where it would repeat.
  const cross = paste(['crossa', 'crossb']);
  expect(cross.chains).toEqual([{ names: ['crossa', 'crossb'], complete: false, stopReason: 'cycle' }]);
  expect(paste(['crossb', 'crossa']).chains).toEqual([
    { names: ['crossb', 'crossa'], complete: false, stopReason: 'cycle' },
  ]);

  // 51 links: the order stops at 50 with the cap as its reason, however the paste is ordered.
  const long = links(51, true);
  const forward = decodeInput(long.map((b64) => pemText('CERTIFICATE', b64)).join(''), { nowMs: NOW_MS });
  // The 51st certificate is not lost: no order reached it, so it starts one of its own.
  expect(forward.chains).toHaveLength(2);
  expect(forward.chains[0]!.order).toHaveLength(50);
  expect(forward.chains[0]!.order).toEqual(Array.from({ length: 50 }, (_, i) => i));
  expect(forward.chains[0]!.stopReason).toBe('cap');
  expect(forward.chains[0]!.complete).toBe(false);
  const reversed = decodeInput(
    [...long]
      .reverse()
      .map((b64) => pemText('CERTIFICATE', b64))
      .join(''),
    { nowMs: NOW_MS },
  );
  expect(reversed.chains[0]!.order).toHaveLength(50);
  expect(reversed.chains[0]!.stopReason).toBe('cap');
  expect(forward.chains[1]).toMatchObject({ order: [50], stopReason: 'self-issued', complete: true });
  expect(reversed.chains).toHaveLength(2);
  expect(reversed.chains.flatMap((chain) => chain.order).sort((a, b) => a - b)).toEqual(
    Array.from({ length: 51 }, (_, i) => i),
  );

  // Exactly 50 links ending at a self-issued certificate is complete, not capped.
  const fifty = decodeInput(
    links(50, true)
      .map((b64) => pemText('CERTIFICATE', b64))
      .join(''),
    { nowMs: NOW_MS },
  );
  expect(fifty.chains).toHaveLength(1);
  expect(fifty.chains[0]!.order).toHaveLength(50);
  expect(fifty.chains[0]!.stopReason).toBe('self-issued');
  expect(fifty.chains[0]!.complete).toBe(true);

  // orderChains takes the certificate models directly.
  const direct = orderChains([readCertificate(anyCertificateDer('leaf'), NOW_MS)]);
  expect(direct.chains).toHaveLength(1);
  expect(direct.duplicates).toEqual([]);
}, 60_000);

it('subject common names are read for the issuing order list', () => {
  expect(readCertificate(anyCertificateDer('root'), NOW_MS).subject.commonName).toBe('Example Root CA');
  expect(readCertificate(anyCertificateDer('leaf'), NOW_MS).subject.commonName).toBe('example.com');
  const noName = buildCertificate({ subject: name(rdn('2.5.4.10', utf8('Only An Organisation'))) });
  expect(readCertificate(noName, NOW_MS).subject.commonName).toBeUndefined();
});

it('names are compared as bytes, so equal looking names written as different string types are not linked', () => {
  const subjectName = (make: (text: string) => Uint8Array) => name(rdn('2.5.4.3', make('Same Name')));
  const child = buildCertificate({
    subject: name(rdn('2.5.4.3', utf8('child'))),
    issuer: subjectName(printable),
    serialHex: '0001',
  });
  const sameBytes = buildCertificate({
    subject: subjectName(printable),
    issuer: subjectName(printable),
    serialHex: '0002',
  });
  const otherBytes = buildCertificate({ subject: subjectName(utf8), issuer: subjectName(utf8), serialHex: '0003' });
  const pasted = (...ders: Uint8Array[]) =>
    decodeInput(ders.map((der) => pemText('CERTIFICATE', base64(der))).join(''), { nowMs: NOW_MS }).chains.map(
      (chain) => chain.order,
    );
  // Written the same way, the child is followed by its issuer; written as a UTF8String, the same text is another name.
  expect(pasted(child, sameBytes)).toEqual([[0, 1]]);
  expect(pasted(child, otherBytes)).toEqual([[0], [1]]);
});
