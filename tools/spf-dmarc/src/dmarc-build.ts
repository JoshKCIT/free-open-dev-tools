import { checkDmarc, type DmarcReport } from './dmarc-check';
import { parseDmarc, parseUriList } from './dmarc-parse';
import { SpfDmarcError } from './errors';
import { MAX_RECORD_CHARACTERS, MAX_RECORDS, STRING_OCTETS, checkPaste, withCommas } from './limits';

export type DmarcPolicyChoice = 'none' | 'quarantine' | 'reject';

/** What the DMARC builder is given. The two address fields hold one address per line. */
export interface DmarcFields {
  /** The policy for the domain itself (p). */
  policy: DmarcPolicyChoice;
  /** The policy for existing subdomains (sp), or inherit to leave the tag out so p applies. */
  subPolicy: 'inherit' | DmarcPolicyChoice;
  /** The policy for non-existent subdomains (np), or inherit to leave the tag out. */
  nonExistent: 'inherit' | DmarcPolicyChoice;
  /** DKIM alignment (adkim): r is the default and is not written. */
  adkim: 'r' | 's';
  /** SPF alignment (aspf): r is the default and is not written. */
  aspf: 'r' | 's';
  /** Aggregate report addresses, one per line. A bare address becomes a mailto: address. */
  rua: string;
  /** Failure report addresses, one per line. */
  ruf: string;
  /** The failure reporting options (fo), colon separated values of 0, 1, d and s. */
  fo: string;
  /** Write t=y (testing). */
  test: boolean;
}

export type DmarcBuildField = 'rua' | 'ruf' | 'fo';

/** An entry that was left out of the record, with the field and the 1-based line it was on. Never holds the entry. */
export interface DmarcBuildProblem {
  field: DmarcBuildField;
  line: number;
  message: string;
}

export interface BuiltDmarc {
  /** The record on one line, tags in the fixed order v, p, sp, np, adkim, aspf, rua, ruf, fo, t. */
  record: string;
  length: number;
  octets: number;
  problems: DmarcBuildProblem[];
  /** Advice, never an error: what RFC 9989 and RFC 9990 say about the record that was built. */
  advice: string[];
  /** The record read back by the same parser and checker the page uses to check a pasted record. */
  report: DmarcReport;
}

function isBlank(code: number): boolean {
  return code === 32 || code === 9;
}

/** The lines of an address field with their 1-based numbers; blank lines are skipped and surrounding blanks trimmed. */
function entriesOf(text: string, field: 'rua' | 'ruf'): Array<{ line: number; entry: string }> {
  const out: Array<{ line: number; entry: string }> = [];
  if (text === '') return out;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i] ?? '';
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    let from = 0;
    let to = raw.length;
    while (from < to && isBlank(raw.charCodeAt(from))) from++;
    while (to > from && isBlank(raw.charCodeAt(to - 1))) to--;
    if (from === to) continue;
    if (out.length >= MAX_RECORDS) {
      throw new SpfDmarcError(
        `The ${field} list holds more than ${MAX_RECORDS} entries. The limit is ${MAX_RECORDS}, so the entry on line ${withCommas(i + 1)} and the rest were not read.`,
        'builder',
        i + 1,
      );
    }
    out.push({ line: i + 1, entry: raw.slice(from, to) });
  }
  return out;
}

/** The address as it is written in the tag, or the reason the entry cannot be used. */
function addressFor(entry: string): { uri: string; scheme: string | null } | { message: string } {
  for (let i = 0; i < entry.length; i++) {
    const c = entry.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return { message: 'An address can hold only printing ASCII characters.' };
    if (c === 59) return { message: 'An address cannot hold a semicolon, which ends a tag.' };
    if (c === 44) return { message: 'An address cannot hold a comma: write one address per line.' };
  }
  const candidate = entry.includes(':') ? entry : 'mailto:' + entry;
  const uris = parseUriList(candidate);
  const uri = uris[0];
  if (uris.length !== 1 || uri === undefined) return { message: 'This entry does not read as one address.' };
  if (uri.kind === 'invalid') return { message: uri.problem ?? 'This entry is not a usable address.' };
  if (uri.obsoleteSize !== null) return { message: 'The size suffix is obsolete, so this address was left out.' };
  return { uri: uri.text, scheme: uri.scheme };
}

const ADVICE_REJECT =
  'The policy is reject. RFC 9989 section 7.4 advises domains whose users post to mailing lists not to publish p=reject, and to publish p=none for at least a month and then p=quarantine for as long before reject, reading the aggregate reports meanwhile. This is advice, not an error.';

/**
 * Builds a DMARC record from fields, writing only the tags of RFC 9989 (never pct, rf or ri). The tags are always written in
 * the same order: v=DMARC1 first, then p, sp, np, adkim, aspf, rua, ruf, fo and t. Tags that hold their default are not
 * written. Every address goes through the parser a pasted record goes through; one that is not usable is left out and listed
 * with its field and line, never its text. The finished record is parsed and checked again before it is returned.
 */
export function buildDmarc(fields: DmarcFields): BuiltDmarc {
  checkPaste(fields.rua, 'builder');
  checkPaste(fields.ruf, 'builder');
  checkPaste(fields.fo, 'builder');
  const problems: DmarcBuildProblem[] = [];
  const advice: string[] = [];
  const tags: string[] = ['v=DMARC1', `p=${fields.policy}`];
  if (fields.subPolicy !== 'inherit') tags.push(`sp=${fields.subPolicy}`);
  if (fields.nonExistent !== 'inherit') tags.push(`np=${fields.nonExistent}`);
  if (fields.adkim === 's') tags.push('adkim=s');
  if (fields.aspf === 's') tags.push('aspf=s');

  let sawOther = false;
  let sawMailto = false;
  const addresses = (field: 'rua' | 'ruf', text: string): string[] => {
    const written: string[] = [];
    for (const { line, entry } of entriesOf(text, field)) {
      const result = addressFor(entry);
      if ('message' in result) {
        problems.push({ field, line, message: result.message });
        continue;
      }
      written.push(result.uri);
      if (result.scheme === 'mailto') sawMailto = true;
      else sawOther = true;
    }
    if (written.length > 0) tags.push(`${field}=${written.join(',')}`);
    return written;
  };
  const rua = addresses('rua', fields.rua);
  const ruf = addresses('ruf', fields.ruf);

  // fo: a value of the same grammar as a pasted record, written only when it is not the default and a ruf address is there.
  let foValue = '';
  let from = 0;
  let to = fields.fo.length;
  while (from < to && isBlank(fields.fo.charCodeAt(from))) from++;
  while (to > from && isBlank(fields.fo.charCodeAt(to - 1))) to--;
  foValue = fields.fo.slice(from, to).toLowerCase();
  if (foValue !== '' && foValue !== '0') {
    let problem: string | null = null;
    if (foValue.length > 16 || !/^[01ds:]+$/.test(foValue)) {
      problem = 'The value can hold only 0, 1, d and s, separated by colons.';
    } else {
      problem = parseDmarc(`v=DMARC1; fo=${foValue}`).byName.get('fo')?.problem ?? null;
    }
    if (problem !== null) {
      problems.push({ field: 'fo', line: 1, message: problem });
    } else if (ruf.length === 0) {
      problems.push({
        field: 'fo',
        line: 1,
        message: 'fo is ignored without a ruf address, so it was left out.',
      });
    } else {
      tags.push(`fo=${foValue}`);
    }
  }
  if (fields.test) tags.push('t=y');

  const record = tags.join('; ');
  if (record.length > MAX_RECORD_CHARACTERS) {
    throw new SpfDmarcError(
      `The record built from these fields would hold ${withCommas(record.length)} characters. The limit is ${withCommas(MAX_RECORD_CHARACTERS)}, so remove some addresses.`,
      'builder',
    );
  }
  const octets = new TextEncoder().encode(record).length;

  const policies = [fields.policy, fields.subPolicy, fields.nonExistent];
  if (policies.includes('reject')) advice.push(ADVICE_REJECT);
  const allNone = policies.every((p) => p === 'none' || p === 'inherit');
  if (fields.test) {
    advice.push(
      allNone
        ? 't=y has no effect on a policy of none (RFC 9989 section 4.7).'
        : 't=y asks receivers to give failing mail the policy one level below the one written: quarantine becomes none and reject becomes quarantine. Remove it when you are ready for the policy to apply (RFC 9989 section 4.7).',
    );
  }
  if (rua.length === 0) {
    advice.push(
      'There is no rua address, so no aggregate reports are requested and you get no feedback on who sends mail as your domain (RFC 9989 section 4.7).',
    );
  }
  if (sawOther) {
    advice.push(
      'An address with a scheme other than mailto: is written as given; receivers that do not support the scheme ignore it (RFC 9989 section 4.7).',
    );
  }
  if (sawMailto) {
    advice.push(
      'If an address is in a different domain from the one you publish this record for, that domain must publish a TXT record with the value v=DMARC1; at <your domain>._report._dmarc.<its domain>, or receivers ignore the address (RFC 9990 section 4).',
    );
  }
  if (octets > STRING_OCTETS) {
    advice.push(
      `The record is ${octets} octets, more than the 255 one string of a TXT record holds, so it is published as more than one string; the zone form below splits it.`,
    );
  }
  return {
    record,
    length: record.length,
    octets,
    problems,
    advice,
    report: checkDmarc(parseDmarc(record)),
  };
}
