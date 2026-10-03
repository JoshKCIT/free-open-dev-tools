/**
 * Puts a set of certificates in issuing order: a leaf, then the certificate whose subject is the leaf's issuer, and so on
 * until a self-issued certificate or an issuer that is not in the set.
 *
 * This is a display order found by comparing names, not a verified chain. Issuer and subject are compared as the exact DER
 * bytes of their Names (never as display strings, which can differ for equal names and agree for different ones). When two
 * certificates share one subject, the authority key identifier of the certificate being followed is compared with the
 * subject key identifier of each candidate. No signature, date, constraint or trust is checked anywhere in this file.
 *
 * RULE (as in der.ts): no message from this file may hold a fragment of a pasted value; it makes no messages at all.
 */
import type { CertificateInfo } from './x509';

/** Why an order stopped: at a self-issued certificate, at an issuer that is not in the paste, at a repeat, or at the cap. */
export type StopReason = 'self-issued' | 'issuer-not-in-paste' | 'cycle' | 'cap';

/** What a certificate is within its order. `alone` is a certificate that is not part of any order of two or more. */
export type ChainRole = 'leaf' | 'intermediate' | 'root' | 'alone';

export interface ChainResult {
  /** Positions in the list given to `orderChains`, leaf first. */
  order: number[];
  /** True when the order ends at a self-issued certificate. */
  complete: boolean;
  stopReason: StopReason;
  /** The role of each position in `order`. */
  roles: ChainRole[];
}

/** The most certificates one order holds. */
export const MAX_CHAIN_LENGTH = 50;

/** The bytes as a string of one character per byte, for use as a Map key. */
function keyOf(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at < bytes.length; at += 4096) {
    out += String.fromCharCode(...bytes.subarray(at, Math.min(at + 4096, bytes.length)));
  }
  return out;
}

/**
 * Orders the certificates. `duplicates` lists the positions of exact repeats of an earlier certificate (the same bytes);
 * a repeat is left out of every order. Every other certificate is in at least one order: orders that start at a leaf come
 * first, in paste order, then one order is started from each certificate no earlier order reached.
 */
export function orderChains(items: CertificateInfo[]): { chains: ChainResult[]; duplicates: number[] } {
  const duplicates: number[] = [];
  const seen = new Set<string>();
  const unique: number[] = [];
  items.forEach((item, index) => {
    // The SHA-256 fingerprint is made over the whole certificate, so equal fingerprints mean equal bytes.
    const fingerprint = item.fingerprints.sha256;
    if (seen.has(fingerprint)) duplicates.push(index);
    else {
      seen.add(fingerprint);
      unique.push(index);
    }
  });

  const subjectKey = items.map((item) => keyOf(item.subject.der));
  const issuerKey = items.map((item) => keyOf(item.issuer.der));
  const selfIssued = items.map((_, index) => subjectKey[index] === issuerKey[index]);

  // Subjects, and the issuers named by certificates that are not self-issued (a self-issued certificate names itself).
  const bySubject = new Map<string, number[]>();
  const namedAsIssuer = new Set<string>();
  for (const index of unique) {
    const list = bySubject.get(subjectKey[index]!);
    if (list === undefined) bySubject.set(subjectKey[index]!, [index]);
    else list.push(index);
    if (!selfIssued[index]) namedAsIssuer.add(issuerKey[index]!);
  }

  /** The certificate that issued `current`, or the reason there is none. */
  const issuerOf = (current: number, inChain: Set<number>): number | StopReason => {
    const named = bySubject.get(issuerKey[current]!);
    if (named === undefined) return 'issuer-not-in-paste';
    // Key identifiers decide between candidates that share a subject. A candidate whose key identifier is known and differs
    // from the one named is not the issuer; one with no key identifier cannot be told apart and stays.
    const wanted = items[current]!.aki;
    let pool = named;
    if (wanted !== undefined) {
      const matching = named.filter((candidate) => items[candidate]!.ski === wanted);
      pool = matching.length > 0 ? matching : named.filter((candidate) => items[candidate]!.ski === undefined);
    }
    if (pool.length === 0) return 'issuer-not-in-paste';
    const fresh = pool.find((candidate) => !inChain.has(candidate));
    return fresh === undefined ? 'cycle' : fresh;
  };

  const build = (start: number): ChainResult => {
    const order = [start];
    const inChain = new Set<number>(order);
    let stopReason: StopReason;
    for (;;) {
      const current = order[order.length - 1]!;
      if (selfIssued[current]) {
        stopReason = 'self-issued';
        break;
      }
      const next = issuerOf(current, inChain);
      if (typeof next === 'string') {
        stopReason = next;
        break;
      }
      if (order.length >= MAX_CHAIN_LENGTH) {
        stopReason = 'cap';
        break;
      }
      order.push(next);
      inChain.add(next);
    }
    const last = order.length - 1;
    const roles: ChainRole[] = order.map((index, position) => {
      if (order.length === 1) return stopReason === 'self-issued' ? 'root' : 'alone';
      if (position === 0) return namedAsIssuer.has(subjectKey[index]!) ? 'intermediate' : 'leaf';
      if (position === last && stopReason === 'self-issued') return 'root';
      return 'intermediate';
    });
    return { order, complete: stopReason === 'self-issued', stopReason, roles };
  };

  const chains: ChainResult[] = [];
  const covered = new Set<number>();
  const add = (start: number): void => {
    const chain = build(start);
    chains.push(chain);
    for (const index of chain.order) covered.add(index);
  };
  // A leaf is a certificate whose subject no other certificate names as its issuer (a self-issued certificate that nothing
  // else names is its own group).
  for (const index of unique) if (!namedAsIssuer.has(subjectKey[index]!)) add(index);
  for (const index of unique) if (!covered.has(index)) add(index);
  return { chains, duplicates };
}
