import { LOOKUP_LIMIT } from './limits';
import type { SpfReport } from './spf-check';
import type { TreeCount } from './spf-tree';

/** The one-line verdict on an SPF record: a warning or a success, in plain words. */
export interface SpfVerdict {
  tone: 'success' | 'warn';
  text: string;
}

const NOT_JUDGED = 'What a receiver decides for a message is not checked here.';

/**
 * The verdict on the first record of the SPF box. When more than one record was pasted, `tree` is the whole-tree count of
 * `countLookups`: RFC 7208 section 4.6.4 applies the limit of 10 to the whole evaluation, so a first record within the
 * limit is still a warning when the records it includes or redirects to take the total over it. A whole-tree count that
 * is a lower bound (a name not pasted, a macro, a loop) is said to be one. Fixed text: it never holds the record.
 */
export function spfVerdict(report: SpfReport, tree: TreeCount | null): SpfVerdict {
  if (!report.record.isSpf) {
    return {
      tone: 'warn',
      text: 'This text does not start with v=spf1 followed by a space or the end, so it is not read as an SPF record.',
    };
  }
  if (report.record.errors.length > 0) {
    const n = report.record.errors.length;
    return {
      tone: 'warn',
      text: `The record has ${n} syntax ${n === 1 ? 'error' : 'errors'}, and a receiver that finds one gives the result permerror (RFC 7208 section 4.6).`,
    };
  }
  if (!report.withinLimit) {
    return {
      tone: 'warn',
      text: `The record reads without a syntax error, but ${report.lookupCount} terms cause lookups and the limit is ${LOOKUP_LIMIT}.`,
    };
  }
  const own = `The record reads without a syntax error and has ${report.lookupCount} of ${LOOKUP_LIMIT} terms that cause DNS lookups.`;
  if (tree === null) return { tone: 'success', text: `${own} ${NOT_JUDGED}` };
  if (tree.stopped || tree.total > LOOKUP_LIMIT) {
    return {
      tone: 'warn',
      text: `${own} The records pasted with it, followed through include and redirect, cause ${tree.total}${tree.stopped ? ' or more' : ''} lookups together, over the limit of ${LOOKUP_LIMIT}, so a receiver gives the result permerror (RFC 7208 section 4.6.4).`,
    };
  }
  if (tree.lowerBound) {
    return {
      tone: 'success',
      text: `${own} Followed through the records pasted with it, the whole tree causes at least ${tree.total} of ${LOOKUP_LIMIT}: a lower bound, because part of the tree was not pasted or could not be followed (see the list below). ${NOT_JUDGED}`,
    };
  }
  return {
    tone: 'success',
    text: `${own} Followed through the records pasted with it, the whole tree causes ${tree.total} of ${LOOKUP_LIMIT}. ${NOT_JUDGED}`,
  };
}
