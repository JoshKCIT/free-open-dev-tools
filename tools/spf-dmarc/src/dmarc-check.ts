import { SpfDmarcError } from './errors';
import { isMailHost, parseDmarc, type DmarcRecord, type DmarcUri } from './dmarc-parse';
import { boxName } from './limits';
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

export type DmarcNoteTone = 'info' | 'warn';

export interface DmarcNote {
  tone: DmarcNoteTone;
  /** A fixed sentence. Never holds typed text. */
  message: string;
}

/** What a mailto address needs when it is in another domain (RFC 9990 section 4). */
export interface DmarcAuthorisation {
  tag: 'rua' | 'ruf';
  /** The address as written. */
  address: string;
  /** The domain of the address, in lower case. */
  host: string;
  /** True when the address is in a different domain from the one the record is published for, judged by names alone. */
  outside: boolean;
  /** The name of the TXT record the other domain publishes, or null when no record is needed or the name is too long. */
  name: string | null;
  /** The value of that record, or null when no record is needed. */
  value: string | null;
  /** A fixed sentence about this address. */
  message: string;
}

export interface DmarcReport {
  record: DmarcRecord;
  /** The domain the visitor gave (lower case, no trailing dot), or null. */
  domain: string | null;
  policy: DmarcPolicies;
  /** The usable report addresses in record order: every rua address, then every ruf address as the record lists them. */
  addresses: DmarcAddress[];
  /** One entry per mailto address, when a domain was given. */
  authorisations: DmarcAuthorisation[];
  /** True when the record holds a mailto address and no domain was given, so no name could be written. */
  needsDomain: boolean;
  notes: DmarcNote[];
  /** True when the record is a DMARC record and no tag or address in it is wrong. */
  valid: boolean;
}

/** The most notes about addresses a report holds; the rest are counted in one last note. */
const MAX_ADDRESS_NOTES = 50;

const VALUE_AUTHORISING = 'v=DMARC1;';
const ZERO: DmarcPolicies = { domain: 'none', subdomains: 'none', nonExistent: 'none' };

/** The value of a tag when it was read and is valid, in lower case, else null. */
function valueOf(record: DmarcRecord, name: string): string | null {
  const tag = record.byName.get(name);
  return tag !== undefined && tag.status === 'ok' && tag.value !== null ? tag.value.toLowerCase() : null;
}

/**
 * Reads the domain the visitor gave: lower case, one trailing period taken off, and a leading _dmarc label taken off. A
 * name that is not a domain name is refused with a fixed sentence that never holds what was typed.
 */
function readDomain(domain: string | undefined): { name: string | null; notes: DmarcNote[] } {
  const notes: DmarcNote[] = [];
  if (domain === undefined) return { name: null, notes };
  let from = 0;
  let to = domain.length;
  while (from < to && (domain.charCodeAt(from) === 32 || domain.charCodeAt(from) === 9)) from++;
  while (to > from && (domain.charCodeAt(to - 1) === 32 || domain.charCodeAt(to - 1) === 9)) to--;
  if (from === to) return { name: null, notes };
  if (to - from > 260) {
    throw new SpfDmarcError(
      `The ${boxName('domain')} holds more than 253 characters, the most a domain name can hold.`,
      'domain',
    );
  }
  let name = domain.slice(from, to).toLowerCase();
  if (name.endsWith('.')) name = name.slice(0, -1);
  if (name.startsWith('_dmarc.')) {
    name = name.slice(7);
    notes.push({
      tone: 'info',
      message:
        'The leading _dmarc label of the domain was taken off: the record is published at _dmarc.<domain>, and the name below is made from <domain>.',
    });
  }
  if (!isMailHost(name)) {
    throw new SpfDmarcError(
      `The ${boxName('domain')} must hold a domain name made of letters, digits and hyphens, with labels of 1 to 63 characters separated by periods, and at most 253 characters in all.`,
      'domain',
    );
  }
  return { name, notes };
}

/** True when two names are the same domain by name alone: equal, or one a subdomain of the other. */
function sameDomain(domain: string, host: string): boolean {
  if (domain === host) return true;
  if (host.endsWith('.' + domain)) return true;
  return domain.endsWith('.' + host) && host.includes('.');
}

/**
 * Reads what a parsed record asks for: the policy for the domain, for its subdomains and for subdomains that do not exist,
 * the report addresses as written, the TXT record name another domain must publish for an address outside the domain, and
 * what is worth a look. Nothing is looked up. A domain that is not a name is refused (SpfDmarcError, part domain).
 */
export function checkDmarc(record: DmarcRecord, domain?: string): DmarcReport {
  const given = readDomain(domain);
  const notes: DmarcNote[] = [...given.notes];
  const report: DmarcReport = {
    record,
    domain: given.name,
    policy: ZERO,
    addresses: [],
    authorisations: [],
    needsDomain: false,
    notes,
    valid: false,
  };
  if (!record.isDmarc) return report;
  for (const note of record.notes) notes.push({ tone: 'info', message: note });

  // Tags that are repeated or retired or not known: one note for each name, in record order.
  const repeated = new Set<string>();
  const retired = new Set<string>();
  let unknown = 0;
  let valid = true;
  for (const tag of record.tags) {
    if (tag.status === 'repeated' && !repeated.has(tag.name)) {
      repeated.add(tag.name);
      notes.push({
        tone: 'warn',
        message: `The tag ${tag.name} is repeated and the first value is used (RFC 9989 does not say what a repeat means).`,
      });
    } else if (tag.status === 'retired' && !retired.has(tag.name)) {
      retired.add(tag.name);
      notes.push({
        tone: 'info',
        message: `The tag ${tag.name} is retired in RFC 9989. Receivers that still follow RFC 7489 read it; others ignore it.`,
      });
    } else if (tag.status === 'unknown') {
      unknown++;
    } else if (tag.status === 'invalid') {
      valid = false;
    }
  }
  if (unknown > 0) {
    notes.push({
      tone: 'info',
      message: `The record holds ${unknown} ${unknown === 1 ? 'tag' : 'tags'} that RFC 9989 does not define; receivers ignore them (section 4.7).`,
    });
  }

  // The usable report addresses, and what is wrong with the others.
  const rua = record.byName.get('rua');
  const ruf = record.byName.get('ruf');
  let addressNotes = 0;
  let leftOut = 0;
  const addressNote = (note: DmarcNote): void => {
    if (addressNotes < MAX_ADDRESS_NOTES) {
      notes.push(note);
      addressNotes++;
    } else {
      leftOut++;
    }
  };
  for (const tag of [rua, ruf]) {
    if (tag === undefined || tag.status !== 'ok') continue;
    const which = tag.name === 'rua' ? 'rua' : 'ruf';
    let sawOther = false;
    let sawSize = false;
    for (const uri of tag.uris) {
      if (uri.kind === 'invalid') {
        valid = false;
        addressNote({
          tone: 'warn',
          message: `One entry of the ${which} tag is not a usable address and is left out: ${uri.problem ?? 'it is not a URI.'}`,
        });
        continue;
      }
      report.addresses.push({ tag: which, text: uri.text, uri });
      if (uri.kind === 'other' && !sawOther) {
        sawOther = true;
        addressNote({
          tone: 'info',
          message: `An address of the ${which} tag uses a scheme other than mailto:; receivers that do not support the scheme ignore it (RFC 9989 section 4.7).`,
        });
      }
      if (uri.obsoleteSize !== null && !sawSize) {
        sawSize = true;
        addressNote({
          tone: 'info',
          message: `An address of the ${which} tag carries a size suffix. The size suffix is obsolete and ignored (RFC 9989 section 4.8 and Appendix C.4).`,
        });
      }
    }
  }
  if (leftOut > 0) {
    notes.push({
      tone: 'info',
      message: `${leftOut} more ${leftOut === 1 ? 'note' : 'notes'} about addresses ${leftOut === 1 ? 'was' : 'were'} left out.`,
    });
  }

  // The policies. An invalid p, sp or np makes the record read as p=none (RFC 9989 section 4.10.1).
  const hasValidReporting = report.addresses.some((a) => a.tag === 'rua');
  let invalidPolicy = false;
  for (const name of ['p', 'sp', 'np']) {
    if (record.byName.get(name)?.status === 'invalid') {
      invalidPolicy = true;
      notes.push({
        tone: 'warn',
        message: hasValidReporting
          ? `The ${name} tag is not valid, so under RFC 9989 section 4.10.1 a receiver acts as if p=none was published, because rua holds a valid reporting address.`
          : `The ${name} tag is not valid. RFC 9989 section 4.10.1 says a receiver then applies no DMARC processing, because rua holds no valid reporting address.`,
      });
    }
  }
  if (invalidPolicy) {
    report.policy = ZERO;
  } else {
    const p = valueOf(record, 'p') ?? 'none';
    const sp = valueOf(record, 'sp');
    const np = valueOf(record, 'np');
    report.policy = { domain: p, subdomains: sp ?? p, nonExistent: np ?? sp ?? p };
    if (!record.byName.has('p')) {
      notes.push({
        tone: 'info',
        message: 'The record has no p tag, so it is treated as p=none (RFC 9989 section 4.7).',
      });
    }
  }
  const all = [report.policy.domain, report.policy.subdomains, report.policy.nonExistent];
  if (all.includes('reject')) {
    notes.push({
      tone: 'info',
      message:
        'The policy is reject. RFC 9989 section 7.4 advises domains whose users post to mailing lists not to publish p=reject, and to publish p=none for at least a month and then p=quarantine for as long before reject, reading the aggregate reports meanwhile.',
    });
  }
  if (valueOf(record, 't') === 'y') {
    notes.push({
      tone: 'info',
      message:
        't=y is set: a receiver is asked not to apply the policy but to give failing mail the policy one level below it, so quarantine becomes none and reject becomes quarantine (RFC 9989 section 4.7).',
    });
    if (all.every((policy) => policy === 'none')) {
      notes.push({ tone: 'info', message: 't=y has no effect on a policy of none (RFC 9989 section 4.7).' });
    }
  }
  if (rua === undefined) {
    notes.push({
      tone: 'info',
      message: 'There is no rua tag, so no aggregate reports are requested (RFC 9989 section 4.7).',
    });
  }
  if (record.byName.get('fo')?.status === 'ok' && !report.addresses.some((a) => a.tag === 'ruf')) {
    notes.push({
      tone: 'info',
      message: 'fo is ignored because the record has no ruf address (RFC 9989 section 4.7).',
    });
  }

  // The names another domain must publish for the addresses outside this domain (RFC 9990 section 4).
  for (const address of report.addresses) {
    if (address.uri.kind !== 'mailto' || address.uri.host === null) continue;
    if (report.domain === null) {
      report.needsDomain = true;
      continue;
    }
    const host = address.uri.host;
    if (sameDomain(report.domain, host)) {
      report.authorisations.push({
        tag: address.tag,
        address: address.text,
        host,
        outside: false,
        name: null,
        value: null,
        message:
          'This address is in the same domain by name, so no record is needed. This page has no list of public suffixes, so it compares names only.',
      });
      continue;
    }
    const name = `${report.domain}._report._dmarc.${host}`;
    const fits = name.length <= 253;
    report.authorisations.push({
      tag: address.tag,
      address: address.text,
      host,
      outside: true,
      name: fits ? name : null,
      value: fits ? VALUE_AUTHORISING : null,
      message: fits
        ? 'This address is in another domain. A receiver that follows RFC 9990 section 4 looks up a TXT record at this name and ignores the address unless a record there starts with v=DMARC1. If both domains share one organizational domain no record is needed. This page cannot look it up.'
        : 'This address is in another domain, but the name its authorisation record would need is over the DNS limits, so a receiver cannot confirm it (RFC 9990 section 4, step 4).',
    });
  }
  report.valid = valid;
  return report;
}

/** The record a box holds once the records RFC 9989 section 4.10 discards are set aside. */
export interface DmarcPick {
  /** The record to check, or null when all the DMARC records were discarded. */
  record: DmarcRecord | null;
  /** The box entry the record was read from, or null when none was chosen. */
  source: TxtRecord | null;
  /** How many records of the box start with v=DMARC1. */
  candidates: number;
  /** The 1-based lines of the records discarded because there was more than one, else an empty list. */
  discardedLines: number[];
  /** Why nothing was chosen, or null. */
  discarded: string | null;
  /** How many records were set aside because they do not start with v=DMARC1 while another does. */
  setAside: number;
}

/**
 * Chooses the record to check from what a box holds. RFC 9989 section 4.10, step 2: records that do not start with the v
 * tag are discarded, and if more than one DMARC record is returned for a name they are all discarded. A box with no record
 * gives null.
 */
export function pickDmarcRecord(records: TxtRecord[]): DmarcPick | null {
  const parsed = records.map((source) => ({ source, record: parseDmarc(source.text) }));
  const first = parsed[0];
  if (first === undefined) return null;
  const dmarc = parsed.filter((entry) => entry.record.isDmarc);
  if (dmarc.length >= 2) {
    return {
      record: null,
      source: null,
      candidates: dmarc.length,
      discardedLines: dmarc.map((entry) => entry.source.line),
      discarded: `The box holds ${dmarc.length} records that start with v=DMARC1. When more than one DMARC record is found for a name, a receiver discards all of them (RFC 9989 section 4.10), so none is checked here. Keep one.`,
      setAside: parsed.length - dmarc.length,
    };
  }
  const chosen = dmarc[0] ?? first;
  return {
    record: chosen.record,
    source: chosen.source,
    candidates: dmarc.length,
    discardedLines: [],
    discarded: null,
    setAside: parsed.length - 1,
  };
}
