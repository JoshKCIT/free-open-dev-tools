import { extractHeaderListValues, firstBadListLine } from './extract';
import { getCombined, getEntries, readBlock, type HeaderEntry } from './headers';
import { checkInput } from './limits';
import { describeRequest, type CorsInput, type RequestPlan } from './request';
import {
  asciiLower,
  isCorsSafelistedMethod,
  isCorsSafelistedResponseHeaderName,
  isForbiddenResponseHeaderName,
} from './safelist';
import { visible } from './visible';

export type StepResult = 'pass' | 'fail' | 'skipped' | 'info';

/** One check of the Fetch Standard, in the order the browser runs it. */
export interface CorsStep {
  /** A stable name, for example `preflight-authorization`. */
  id: string;
  /** Which fetch the rule belongs to: the request, the preflight or the response. */
  where: string;
  rule: string;
  /** The part of the Fetch Standard the rule comes from. */
  section: string;
  result: StepResult;
  detail: string;
}

export type Verdict =
  'readable' | 'blocked-preflight' | 'blocked-response' | 'same-origin' | 'opaque' | 'refused-request';

/** One header of the pasted answer and whether script can read it. */
export interface ReadableHeader {
  name: string;
  readable: boolean;
  why: string;
}

export interface CorsReport {
  plan: RequestPlan;
  steps: CorsStep[];
  /** The first rule that fails, which is the one the browser stops at. Null when nothing fails. */
  firstFailure: CorsStep | null;
  verdict: Verdict;
  /** One sentence: what a browser following the Fetch Standard would do. */
  summary: string;
  /** The text of the preflight the browser would send, when one is sent. */
  preflightText: string | null;
  /** The headers of the real answer and whether script can read each. Filled only for a cross-origin answer the page can read. */
  readable: ReadableHeader[];
  /** Neutral things to change on the server. */
  advice: string[];
  /** How long the browser may keep the preflight answer, known once the preflight passed. */
  maxAge: { seconds: number; fromHeader: boolean } | null;
}

interface Outcome {
  result: StepResult;
  detail: string;
}
interface StepMeta {
  id: string;
  where: string;
  rule: string;
  section: string;
}

const pass = (detail: string): Outcome => ({ result: 'pass', detail });
const fail = (detail: string): Outcome => ({ result: 'fail', detail });
const info = (detail: string): Outcome => ({ result: 'info', detail });

/** Collects the steps in order. After the first failure every later rule is listed as not reached and never run. */
class Steps {
  readonly list: CorsStep[] = [];
  failure: CorsStep | null = null;

  add(meta: StepMeta, run: () => Outcome): void {
    let outcome: Outcome;
    if (this.failure) {
      const realRequest = meta.id.startsWith('response-') && this.failure.id.startsWith('preflight-');
      outcome = {
        result: 'skipped',
        detail: realRequest
          ? 'Not reached: the preflight failed, so the browser never sends the real request.'
          : 'Not reached: an earlier rule failed, so the browser stops before this one.',
      };
    } else outcome = run();
    const step: CorsStep = { ...meta, ...outcome };
    if (outcome.result === 'fail') this.failure = step;
    this.list.push(step);
  }
}

/** The most list elements a detail names before it says how many more there are. */
const MAX_LISTED = 8;
/** The most characters of a pasted value a table cell shows. */
const CELL = 200;
/** The most response headers listed as readable or not. */
const MAX_READABLE_ROWS = 500;

function listed(items: readonly string[]): string {
  if (items.length === 0) return 'none';
  const shown = items.slice(0, MAX_LISTED).map((item) => visible(item, 40));
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

/** The CORS check of the Fetch Standard (its "CORS check"), as up to three rules. */
function addCorsCheck(
  steps: Steps,
  prefix: 'preflight' | 'response',
  where: string,
  plan: RequestPlan,
  entries: HeaderEntry[],
): void {
  const credentialed = plan.credentials === 'include';
  const origin = getCombined(entries, 'access-control-allow-origin');
  const copies = getEntries(entries, 'access-control-allow-origin').length;
  const shown = origin === null ? '' : visible(origin, CELL);
  const section = 'CORS check';

  steps.add({ id: `${prefix}-acao-present`, where, section, rule: 'Access-Control-Allow-Origin is present' }, () =>
    origin === null
      ? fail('The answer has no Access-Control-Allow-Origin header.')
      : pass(
          copies > 1
            ? `Present on ${copies} lines, read as one combined value: ${shown}`
            : `Present: ${shown === '' ? '(empty)' : shown}`,
        ),
  );

  steps.add(
    {
      id: `${prefix}-acao-match`,
      where,
      section,
      rule: credentialed
        ? 'Access-Control-Allow-Origin is exactly the request origin (* is not accepted when credentials are included)'
        : 'Access-Control-Allow-Origin is * or exactly the request origin',
    },
    () => {
      const value = origin ?? '';
      if (!credentialed && value === '*') return pass('* is accepted because credentials are not included.');
      if (value === plan.requestOrigin) return pass(`The value equals the request origin ${plan.requestOrigin}.`);
      if (value === '*') {
        return fail(
          `* is not accepted when credentials are included. The value must be the request origin ${plan.requestOrigin}.`,
        );
      }
      if (copies > 1 || value.includes(',')) {
        return fail(
          `A repeated header or a comma list is read as one combined value (${shown}), which never equals an origin. Send exactly one origin.`,
        );
      }
      return fail(`The value ${shown === '' ? '(empty)' : shown} is not the request origin ${plan.requestOrigin}.`);
    },
  );

  steps.add(
    {
      id: `${prefix}-acac`,
      where,
      section,
      rule: 'Access-Control-Allow-Credentials is exactly true (checked only when credentials are included)',
    },
    () => {
      if (!credentialed) return { result: 'skipped', detail: 'Not checked: credentials are not included.' };
      const value = getCombined(entries, 'access-control-allow-credentials');
      if (value === 'true') return pass('The value is true.');
      if (value === null) {
        return fail(
          'The answer has no Access-Control-Allow-Credentials header. It must be true when credentials are included.',
        );
      }
      return fail(`The value ${visible(value, CELL)} is not exactly true. The comparison is case sensitive.`);
    },
  );
}

/** Whole seconds from an Access-Control-Max-Age value of digits. Very long numbers are cut at the largest exact whole number. */
function deltaSeconds(digits: string): number {
  return digits.length > 15 ? Number.MAX_SAFE_INTEGER : Number(digits);
}

/** The checks of the CORS-preflight fetch after the CORS check: status, lists, method, Authorization, headers, Max-Age. */
function addPreflightRules(
  steps: Steps,
  plan: RequestPlan,
  input: CorsInput,
  entries: HeaderEntry[],
): { maxAge: CorsReport['maxAge'] } {
  const where = 'Preflight';
  const section = 'CORS-preflight fetch';
  const credentialed = plan.credentials === 'include';
  const status = input.preflightStatus;
  const methods = extractHeaderListValues(entries, 'access-control-allow-methods');
  const headerNames = extractHeaderListValues(entries, 'access-control-allow-headers');
  const methodList = Array.isArray(methods) ? methods : null;
  const headerList = Array.isArray(headerNames) ? headerNames : null;
  const allowedHeaders = new Set((headerList ?? []).map(asciiLower));
  const wildcardHeaders = !credentialed && allowedHeaders.has('*');
  const wildcardMethods = !credentialed && (methodList ?? []).includes('*');
  let maxAge: CorsReport['maxAge'] = null;

  steps.add(
    { id: 'preflight-status', where, section, rule: 'The preflight answer has an ok status (200 to 299)' },
    () => {
      const ok = Number.isInteger(status) && status >= 200 && status <= 299;
      return ok
        ? pass(`Status ${status}.`)
        : fail(
            `Status ${visible(String(status), 20)}. Only 200 to 299 is accepted: a redirect or an error status ends the request.`,
          );
    },
  );

  steps.add(
    {
      id: 'preflight-lists',
      where,
      section,
      rule: 'Access-Control-Allow-Methods and Access-Control-Allow-Headers are lists of names (tokens)',
    },
    () => {
      if (methods === 'failure') {
        const line = firstBadListLine(entries, 'access-control-allow-methods');
        return fail(
          `Access-Control-Allow-Methods on line ${line} is not a comma separated list of method names, so the browser treats the whole preflight as failed. Look for a space inside a name, a quote or another character a name cannot hold.`,
        );
      }
      if (headerNames === 'failure') {
        const line = firstBadListLine(entries, 'access-control-allow-headers');
        return fail(
          `Access-Control-Allow-Headers on line ${line} is not a comma separated list of header names, so the browser treats the whole preflight as failed. Look for a space inside a name, a quote or another character a name cannot hold.`,
        );
      }
      return pass(
        `Allowed methods: ${methodList === null ? 'header absent' : listed(methodList)}. Allowed headers: ${headerList === null ? 'header absent' : listed(headerList)}.`,
      );
    },
  );

  steps.add(
    {
      id: 'preflight-method',
      where,
      section,
      rule: 'The method is listed, is GET, HEAD or POST, or is allowed by * when credentials are not included',
    },
    () => {
      if ((methodList ?? []).includes(plan.method)) return pass(`${visible(plan.method, 40)} is listed.`);
      if (isCorsSafelistedMethod(plan.method)) {
        return pass(`${plan.method} is one of GET, HEAD and POST, which need no listing.`);
      }
      if (wildcardMethods) return pass('* allows every method because credentials are not included.');
      const why =
        methodList === null
          ? 'Access-Control-Allow-Methods is absent.'
          : credentialed && methodList.includes('*')
            ? '* is not a wildcard when credentials are included.'
            : `The list holds: ${listed(methodList)}. The comparison is byte for byte, so letter case matters.`;
      return fail(`${visible(plan.method, 40)} is not allowed. ${why}`);
    },
  );

  steps.add(
    {
      id: 'preflight-authorization',
      where,
      section,
      rule: 'Authorization, when sent, is named in Access-Control-Allow-Headers (a wildcard never covers it)',
    },
    () => {
      if (!plan.unsafeNames.includes('authorization'))
        return pass('Nothing to check: no Authorization header is sent.');
      return allowedHeaders.has('authorization')
        ? pass('authorization is named in Access-Control-Allow-Headers.')
        : fail(
            `authorization is not named in Access-Control-Allow-Headers${allowedHeaders.has('*') ? '. The standard says a * never covers it. Browsers tried so far still accept the * when credentials are not included, so a page can work today and stop working when they enforce the standard' : ''}.`,
          );
    },
  );

  steps.add(
    {
      id: 'preflight-headers',
      where,
      section,
      rule: 'Every CORS-unsafe request header is listed, or * covers it when credentials are not included',
    },
    () => {
      if (plan.unsafeNames.length === 0) return pass('Nothing to check: no CORS-unsafe request header is sent.');
      for (const name of plan.unsafeNames) {
        if (allowedHeaders.has(name) || wildcardHeaders) continue;
        const why =
          headerList === null
            ? 'Access-Control-Allow-Headers is absent.'
            : credentialed && allowedHeaders.has('*')
              ? '* is not a wildcard when credentials are included.'
              : `The list holds: ${listed(headerList)}.`;
        return fail(`${visible(name, 40)} is not listed. ${why}`);
      }
      return pass(`Covered: ${listed(plan.unsafeNames)}.`);
    },
  );

  steps.add(
    {
      id: 'preflight-max-age',
      where,
      section,
      rule: 'The browser may keep the preflight answer for Access-Control-Max-Age seconds (5 when absent or invalid)',
    },
    () => {
      const raw = extractHeaderListValues(entries, 'access-control-max-age');
      const digits = Array.isArray(raw) && raw.length === 1 ? (raw[0] ?? null) : null;
      maxAge =
        digits === null ? { seconds: 5, fromHeader: false } : { seconds: deltaSeconds(digits), fromHeader: true };
      return info(
        digits === null
          ? 'Access-Control-Max-Age is absent or not a whole number, so the browser uses 5 seconds.'
          : `Access-Control-Max-Age is ${maxAge.seconds} seconds.`,
      );
    },
  );

  return { maxAge };
}

/** Which response headers script can read, once the CORS check passed. */
function readableHeaders(plan: RequestPlan, entries: HeaderEntry[]): ReadableHeader[] {
  const credentialed = plan.credentials === 'include';
  const exposed = extractHeaderListValues(entries, 'access-control-expose-headers');
  const exposedNames = new Set(Array.isArray(exposed) ? exposed.map(asciiLower) : []);
  const everything = !credentialed && exposedNames.has('*');
  const seen = new Set<string>();
  const rows: ReadableHeader[] = [];
  for (const entry of entries) {
    const lower = asciiLower(entry.name);
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (rows.length >= MAX_READABLE_ROWS) break;
    const name = visible(entry.name, 40);
    if (isForbiddenResponseHeaderName(lower)) {
      rows.push({
        name,
        readable: false,
        why: 'Set-Cookie and Set-Cookie2 are never given to script, whatever Access-Control-Expose-Headers says.',
      });
    } else if (isCorsSafelistedResponseHeaderName(lower)) {
      rows.push({ name, readable: true, why: 'One of the seven names every cross-origin response shows to script.' });
    } else if (everything) {
      rows.push({
        name,
        readable: true,
        why: 'Access-Control-Expose-Headers holds *, which names every header when credentials are not included.',
      });
    } else if (exposedNames.has(lower)) {
      rows.push({ name, readable: true, why: 'Listed in Access-Control-Expose-Headers.' });
    } else {
      rows.push({
        name,
        readable: false,
        why:
          credentialed && exposedNames.has('*')
            ? 'Access-Control-Expose-Headers holds *, but with credentials included it only names a header called *.'
            : 'Not one of the seven safelisted names and not listed in Access-Control-Expose-Headers.',
      });
    }
  }
  return rows;
}

function preflightText(plan: RequestPlan): string {
  const lines = [
    `OPTIONS ${plan.url}`,
    `Origin: ${plan.requestOrigin}`,
    'Accept: */*',
    `Access-Control-Request-Method: ${plan.method}`,
  ];
  if (plan.preflight.accessControlRequestHeaders !== undefined) {
    lines.push(`Access-Control-Request-Headers: ${plan.preflight.accessControlRequestHeaders}`);
  }
  return lines.join('\n');
}

function summarise(verdict: Verdict, failure: CorsStep | null, plan: RequestPlan): string {
  switch (verdict) {
    case 'readable':
      return 'A browser following the Fetch Standard would let the page read this response.';
    case 'blocked-preflight':
      return `A browser following the Fetch Standard would stop at the preflight and never send the real request. The first rule that fails: ${failure?.rule ?? ''}.`;
    case 'blocked-response':
      return `A browser following the Fetch Standard would send the request but would not let the page read the response. The first rule that fails: ${failure?.rule ?? ''}.`;
    case 'same-origin':
      return 'The address has the same origin as the page, so CORS does not apply and the page can read the response.';
    case 'opaque':
      return 'A no-cors request to another origin is sent, but the page gets an opaque response: its status, headers and body cannot be read.';
    case 'refused-request':
      return `The browser would refuse to build this request, so nothing is sent. ${plan.refused ?? ''}`.trim();
  }
}

/** Neutral things to change on the server (or in the request) for the rule that failed. */
function adviceFor(plan: RequestPlan, failure: CorsStep | null, verdict: Verdict, response: HeaderEntry[]): string[] {
  const credentialed = plan.credentials === 'include';
  const origin = plan.requestOrigin;
  if (verdict === 'opaque') {
    return [
      'A no-cors request never gives the page a readable response. Use mode cors when the page needs to read the answer.',
    ];
  }
  if (verdict === 'readable') {
    const value = getCombined(response, 'access-control-allow-origin');
    const vary = getCombined(response, 'vary');
    const variesOnOrigin =
      vary !== null && vary.split(',').some((item) => asciiLower(item.trim()) === 'origin' || item.trim() === '*');
    if (value !== null && value !== '*' && !variesOnOrigin) {
      return [
        'Access-Control-Allow-Origin names one origin, so also send Vary: Origin on every answer, so that a shared cache keeps one copy for each origin.',
      ];
    }
    return [];
  }
  if (failure === null) return [];
  const forPreflight = failure.id.startsWith('preflight-') ? ' on the answer to the preflight' : '';
  switch (failure.id) {
    case 'request-refused':
      return plan.mode === 'no-cors'
        ? [
            'Use mode cors when the page must send a method other than GET, HEAD or POST, and send the headers the server expects.',
          ]
        : [
            'Send the request with a method and header values the browser accepts: CONNECT, TRACE and TRACK are never sent from script, and a header value may only hold characters up to U+00FF.',
          ];
    case 'preflight-acao-present':
    case 'response-acao-present':
      return [
        `Send Access-Control-Allow-Origin${forPreflight} with the value ${origin}${credentialed ? '' : ', or * when no credentials are included'}. A preflight needs it on its own answer as well as on the real one.`,
      ];
    case 'preflight-acao-match':
    case 'response-acao-match':
      return credentialed
        ? [
            `Send one Access-Control-Allow-Origin${forPreflight} with the exact origin ${origin} (never *) and Access-Control-Allow-Credentials: true. If the server answers several origins, it should compare the Origin of the request with a list of origins it has chosen to trust and send back only the one that matches, never any origin it is given, and add Vary: Origin.`,
          ]
        : [
            `Send one Access-Control-Allow-Origin${forPreflight}: either * or the exact origin ${origin}. For several origins, compare the Origin of the request with a list the server trusts, send back the one that matches, and add Vary: Origin.`,
          ];
    case 'preflight-acac':
    case 'response-acac':
      return [
        `Send Access-Control-Allow-Credentials: true${forPreflight}, written exactly like that, together with the exact origin ${origin}.`,
      ];
    case 'preflight-status':
      return ['Answer the preflight with a status from 200 to 299 (204 is usual) and without a redirect.'];
    case 'preflight-lists':
      return [
        'Write Access-Control-Allow-Methods and Access-Control-Allow-Headers as comma separated lists of names, with no space inside a name and no quotes.',
      ];
    case 'preflight-method':
      return [
        `Add ${visible(plan.method, 40)} to Access-Control-Allow-Methods, written exactly as the page sends it: the comparison is case sensitive${credentialed ? ', and * does not work when credentials are included' : ''}.`,
      ];
    case 'preflight-authorization':
      return ['Name Authorization in Access-Control-Allow-Headers. A * never covers it.'];
    case 'preflight-headers':
      return [
        `Add ${listed(plan.unsafeNames)} to Access-Control-Allow-Headers${credentialed ? '. A * does not work when credentials are included' : ', or send * when no credentials are included (Authorization still has to be named)'}.`,
      ];
    default:
      return [];
  }
}

/**
 * Checks a described cross-origin request against the Fetch Standard: whether a preflight is sent and what it says, every
 * check in order with the first one that fails, and what the page could read. Nothing is looked up or sent; the function
 * holds no state, so the same input always gives the same report.
 */
export function checkCors(input: CorsInput): CorsReport {
  checkInput(input);
  const plan = describeRequest(input);
  const steps = new Steps();
  let maxAge: CorsReport['maxAge'] = null;
  let verdict: Verdict;
  let response: HeaderEntry[] = [];
  let readable: ReadableHeader[] = [];

  if (plan.refused !== null) {
    steps.add(
      {
        id: 'request-refused',
        where: 'Request',
        section: 'Request constructor',
        rule: 'The browser accepts the request: the method is allowed and every header value is a byte string',
      },
      () => fail(plan.refused ?? ''),
    );
    verdict = 'refused-request';
  } else if (!plan.crossOrigin) {
    steps.add(
      {
        id: 'same-origin',
        where: 'Request',
        section: 'Fetch, main fetch',
        rule: 'The address has the same origin as the page',
      },
      () => info(`Both are ${plan.requestOrigin}. No CORS rule applies.`),
    );
    verdict = 'same-origin';
  } else if (plan.mode === 'no-cors') {
    steps.add(
      {
        id: 'no-cors',
        where: 'Request',
        section: 'Fetch, main fetch',
        rule: 'A no-cors request to another origin is sent without a CORS check',
      },
      () => info('The response is opaque: the page cannot read its status, headers or body.'),
    );
    verdict = 'opaque';
  } else {
    const decision: StepMeta = {
      id: 'preflight-needed',
      where: 'Request',
      section: 'Fetch, HTTP fetch',
      rule: 'A preflight is sent when the method is not GET, HEAD or POST or a header is CORS-unsafe',
    };
    if (plan.preflight.sent) {
      const preflight = readBlock(input.preflightHeaders, 'preflight headers').entries;
      steps.add(decision, () => info(plan.preflight.reasons.join(' ')));
      addCorsCheck(steps, 'preflight', 'Preflight', plan, preflight);
      maxAge = addPreflightRules(steps, plan, input, preflight).maxAge;
    } else {
      steps.add(decision, () =>
        info('No preflight: the method is GET, HEAD or POST and no request header is CORS-unsafe.'),
      );
    }
    response = readBlock(input.responseHeaders, 'response headers').entries;
    addCorsCheck(steps, 'response', 'Response', plan, response);
    verdict =
      steps.failure === null
        ? 'readable'
        : steps.failure.id.startsWith('preflight-')
          ? 'blocked-preflight'
          : 'blocked-response';
    if (verdict === 'readable') readable = readableHeaders(plan, response);
  }

  return {
    plan,
    steps: steps.list,
    firstFailure: steps.failure,
    verdict,
    summary: summarise(verdict, steps.failure, plan),
    preflightText: plan.preflight.sent ? preflightText(plan) : null,
    readable,
    advice: adviceFor(plan, steps.failure, verdict, response),
    maxAge,
  };
}
