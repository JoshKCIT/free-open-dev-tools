import { parseAuthenticationResults, type AuthResult } from './auth-results';
import { parseTagList } from './dkim';
import { MAX_AUTH_HEADERS } from './limits';

/** One header field handed to the grouping: its 1-based position in the message, its name and its unfolded value. */
export interface ArcInput {
  index: number;
  name: string;
  value: string;
}

/** An ARC-Seal as its sealer wrote it. */
export interface ArcSeal {
  header: number;
  domain: string;
  selector: string;
  /** The chain validation status the sealer claims: none, pass or fail. */
  cv: string;
  algorithm: string;
  issues: string[];
}

/** An ARC-Message-Signature as its signer wrote it. */
export interface ArcSignature {
  header: number;
  domain: string;
  selector: string;
  algorithm: string;
  signedHeaders: string[];
  issues: string[];
}

/** An ARC-Authentication-Results as its writer wrote it. */
export interface ArcResults {
  header: number;
  serverId: string;
  results: AuthResult[];
  notes: string[];
}

/** One ARC set: the headers that share an instance number. Everything in it is a claim written by a server. */
export interface ArcSet {
  instance: number;
  seal: ArcSeal | null;
  signature: ArcSignature | null;
  authResults: ArcResults | null;
  /** One line saying what the set claims, as the servers wrote it. */
  summary: string;
  issues: string[];
}

export interface ArcGroups {
  /** The sets in instance order, oldest first. */
  sets: ArcSet[];
  notes: string[];
}

type Kind = 'seal' | 'signature' | 'results';

const KINDS: ReadonlyMap<string, Kind> = new Map([
  ['arc-seal', 'seal'],
  ['arc-message-signature', 'signature'],
  ['arc-authentication-results', 'results'],
]);

const CANONICAL_NAME: Record<Kind, string> = {
  seal: 'ARC-Seal',
  signature: 'ARC-Message-Signature',
  results: 'ARC-Authentication-Results',
};

interface Pieces {
  seals: { header: number; tags: [string, string][] }[];
  signatures: { header: number; tags: [string, string][] }[];
  results: { header: number; payload: string }[];
}

function tagOf(tags: readonly [string, string][], name: string): string {
  for (const [key, value] of tags) if (key === name) return value;
  return '';
}

/** The instance number of a header's first tag-spec `i=N`, or null when it has none readable. */
function instanceOf(text: string): number | null {
  const trimmed = text.trim();
  const equals = trimmed.indexOf('=');
  if (equals < 0 || trimmed.slice(0, equals).trim() !== 'i') return null;
  const digits = trimmed.slice(equals + 1).trim();
  return /^[0-9]{1,6}$/.test(digits) ? Number(digits) : null;
}

function describeResults(results: readonly AuthResult[]): string {
  return results.map((r) => `${r.method}=${r.result}`).join(', ');
}

/**
 * Groups the ARC headers of a message by instance number (RFC 8617 sections 4.1 and 4.2): each ARC-Seal,
 * ARC-Message-Signature and ARC-Authentication-Results carries `i=N` and the three with the same N are one set. Each set
 * is shown as what its servers claimed, never as a chain that holds: nothing is checked. Headers with no readable instance
 * are listed in the notes. The issues name what RFC 8617 says a set must be and is not: exactly one of each header, an
 * instance from 1 to 50, no h tag in a seal.
 */
export function groupArc(headers: readonly ArcInput[]): ArcGroups {
  const notes: string[] = [];
  const sets = new Map<number, Pieces>();
  let seen = 0;
  let cut = false;
  for (const header of headers) {
    const kind = KINDS.get(header.name.toLowerCase());
    if (kind === undefined) continue;
    if (seen >= MAX_AUTH_HEADERS * 3) {
      cut = true;
      break;
    }
    seen++;
    let instance: number | null;
    let tags: [string, string][] = [];
    let payload = '';
    if (kind === 'results') {
      const semicolon = header.value.indexOf(';');
      instance = instanceOf(semicolon < 0 ? header.value : header.value.slice(0, semicolon));
      payload = semicolon < 0 ? '' : header.value.slice(semicolon + 1);
    } else {
      tags = parseTagList(header.value).entries;
      instance = instanceOf(`i=${tagOf(tags, 'i')}`);
      if (tagOf(tags, 'i') === '') instance = null;
    }
    if (instance === null) {
      notes.push(
        `An ${CANONICAL_NAME[kind]} at header ${header.index} has no readable instance number, so it was not grouped.`,
      );
      continue;
    }
    let pieces = sets.get(instance);
    if (pieces === undefined) {
      pieces = { seals: [], signatures: [], results: [] };
      sets.set(instance, pieces);
    }
    if (kind === 'seal') pieces.seals.push({ header: header.index, tags });
    else if (kind === 'signature') pieces.signatures.push({ header: header.index, tags });
    else pieces.results.push({ header: header.index, payload });
  }
  if (cut) notes.push(`The message has more than ${MAX_AUTH_HEADERS * 3} ARC headers, so the rest were not read.`);

  const order = [...sets.keys()].sort((a, b) => a - b);
  const out: ArcSet[] = [];
  for (const instance of order) {
    const pieces = sets.get(instance);
    if (pieces === undefined) continue;
    const issues: string[] = [];
    if (instance < 1 || instance > 50) {
      issues.push('The instance number is not between 1 and 50, which is the range RFC 8617 section 4.2.1 allows.');
    }
    for (const [kind, count] of [
      ['seal', pieces.seals.length],
      ['signature', pieces.signatures.length],
      ['results', pieces.results.length],
    ] as const) {
      if (count === 0) issues.push(`This set has no ${CANONICAL_NAME[kind]}.`);
      if (count > 1) issues.push(`This set has more than one ${CANONICAL_NAME[kind]}.`);
    }

    const sealPiece = pieces.seals[0];
    let seal: ArcSeal | null = null;
    if (sealPiece !== undefined) {
      const sealIssues: string[] = [];
      const cv = tagOf(sealPiece.tags, 'cv');
      if (sealPiece.tags.some(([name]) => name === 'h')) {
        sealIssues.push('This ARC-Seal has an h tag, which RFC 8617 section 4.1.3 says it must not have.');
      }
      if (cv !== '' && cv !== 'none' && cv !== 'pass' && cv !== 'fail') {
        sealIssues.push('The cv tag is not none, pass or fail.');
      }
      if (instance === order[order.length - 1] && cv === 'fail') {
        sealIssues.push(
          'The newest ARC-Seal says cv=fail: the server that wrote it marked the chain it received as failed.',
        );
      }
      seal = {
        header: sealPiece.header,
        domain: tagOf(sealPiece.tags, 'd'),
        selector: tagOf(sealPiece.tags, 's'),
        cv,
        algorithm: tagOf(sealPiece.tags, 'a'),
        issues: sealIssues,
      };
      issues.push(...sealIssues);
    }

    const signaturePiece = pieces.signatures[0];
    const signature: ArcSignature | null =
      signaturePiece === undefined
        ? null
        : {
            header: signaturePiece.header,
            domain: tagOf(signaturePiece.tags, 'd'),
            selector: tagOf(signaturePiece.tags, 's'),
            algorithm: tagOf(signaturePiece.tags, 'a'),
            signedHeaders: tagOf(signaturePiece.tags, 'h')
              .split(':')
              .map((name) => name.trim().toLowerCase())
              .filter((name) => name !== ''),
            issues: [],
          };

    const resultsPiece = pieces.results[0];
    let authResults: ArcResults | null = null;
    if (resultsPiece !== undefined) {
      const parsed = parseAuthenticationResults(resultsPiece.payload);
      authResults = {
        header: resultsPiece.header,
        serverId: parsed.serverId,
        results: parsed.results,
        notes: parsed.notes,
      };
    }

    const parts: string[] = [];
    if (seal !== null) {
      parts.push(
        `sealed by d=${seal.domain === '' ? '(none)' : seal.domain} s=${seal.selector === '' ? '(none)' : seal.selector} with cv=${seal.cv === '' ? '(none)' : seal.cv}`,
      );
    }
    if (signature !== null) {
      parts.push(`message signature by d=${signature.domain === '' ? '(none)' : signature.domain}`);
    }
    if (authResults !== null) {
      parts.push(
        `${authResults.serverId === '' ? 'a server' : authResults.serverId} wrote: ${authResults.results.length === 0 ? 'no results' : describeResults(authResults.results)}`,
      );
    }
    out.push({
      instance,
      seal,
      signature,
      authResults,
      summary: `Set ${instance}: ${parts.length === 0 ? 'nothing readable' : parts.join('; ')}`,
      issues,
    });
  }

  if (order.length > 0) {
    const consecutive = order.every((value, i) => value === i + 1);
    if (!consecutive) notes.push(`The ARC instance numbers are not consecutive from 1 (found ${order.join(', ')}).`);
  }
  return { sets: out, notes };
}
