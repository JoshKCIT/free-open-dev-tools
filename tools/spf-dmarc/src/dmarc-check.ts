import { parseDmarc, type DmarcRecord, type DmarcUri } from './dmarc-parse';
import type { TxtRecord } from './txt';

/** The policy a receiver reads for each kind of name, as one of none, quarantine or reject (RFC 9989 sections 4.7 and 4.10.1). */
export interface DmarcPolicies {
  /** For mail from the domain the record is published for. */
  domain: string;
  /** For mail from an existing subdomain: sp, else p. */
  subdomains: string;
  /** For mail from a subdomain that does not exist: np, else sp, else p. */
  nonExistent: string;
}

/** One reporting address with the tag it came from. */
export interface DmarcAddress {
  tag: 'rua' | 'ruf';
  /** The address as written. */
  text: string;
  uri: DmarcUri;
}

export interface DmarcReport {
  record: DmarcRecord;
  /** The domain the visitor gave (lower case, no trailing dot), or null. */
  domain: string | null;
  policy: DmarcPolicies;
  /** The report addresses in record order: every rua address, then every ruf address as the record lists them. */
  addresses: DmarcAddress[];
}

/** The value of a tag when it was read and is valid, in lower case, else null. */
function valueOf(record: DmarcRecord, name: string): string | null {
  const tag = record.byName.get(name);
  return tag !== undefined && tag.status === 'ok' && tag.value !== null ? tag.value.toLowerCase() : null;
}

/**
 * Reads what a parsed record asks for: the policy for the domain, for its subdomains and for subdomains that do not exist,
 * and the report addresses as written. Nothing is looked up.
 */
export function checkDmarc(record: DmarcRecord, domain?: string): DmarcReport {
  const p = valueOf(record, 'p') ?? 'none';
  const sp = valueOf(record, 'sp');
  const np = valueOf(record, 'np');
  const addresses: DmarcAddress[] = [];
  for (const tag of record.tags) {
    if (tag.name !== 'rua' && tag.name !== 'ruf') continue;
    if (tag.status !== 'ok') continue;
    for (const uri of tag.uris) addresses.push({ tag: tag.name, text: uri.text, uri });
  }
  return {
    record,
    domain: domain === undefined || domain === '' ? null : domain,
    policy: { domain: p, subdomains: sp ?? p, nonExistent: np ?? sp ?? p },
    addresses,
  };
}

/** The record a box holds once the records RFC 9989 section 4.10 discards are set aside. */
export interface DmarcPick {
  record: DmarcRecord;
  /** The box entry the record was read from. */
  source: TxtRecord;
}

/** Chooses the record to check from what a box holds, or null when the box holds none. */
export function pickDmarcRecord(records: TxtRecord[]): DmarcPick | null {
  const first = records[0];
  if (first === undefined) return null;
  return { record: parseDmarc(first.text), source: first };
}
