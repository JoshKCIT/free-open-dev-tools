import { extractHeaderListValues } from './extract';
import { getCombined, getEntries, readBlock, type HeaderEntry } from './headers';
import { checkInput } from './limits';
import { describeRequest, type CorsInput, type RequestPlan } from './request';
import { asciiLower, isCorsSafelistedMethod } from './safelist';
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
  /** The headers of the real answer and whether script can read each (empty unless the response is readable). */
  readable: ReadableHeader[];
  /** Neutral things to change on the server. */
  advice: string[];
  /** How long the browser may keep the preflight answer, once the preflight passed. */
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
  const shown = origin === null ? '' : visible(origin, 200);
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
      return fail(`The value ${visible(value, 200)} is not exactly true. The comparison is case sensitive.`);
    },
  );
}

/** Whole seconds from an Access-Control-Max-Age value, or null when it is not only digits. */
function parseDeltaSeconds(value: string): number | null {
  if (value.length === 0 || value.length > 15) return null;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) return null;
  }
  return Number(value);
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
  const allowedHeaders = new Set((headerNames ?? []).map(asciiLower));
  const wildcardHeaders = !credentialed && allowedHeaders.has('*');
  const wildcardMethods = !credentialed && (methods ?? []).includes('*');
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
      rule: 'Access-Control-Allow-Methods and Access-Control-Allow-Headers are read',
    },
    () =>
      pass(
        `Allowed methods: ${methods === null ? 'header absent' : listed(methods)}. Allowed headers: ${headerNames === null ? 'header absent' : listed(headerNames)}.`,
      ),
  );

  steps.add(
    {
      id: 'preflight-method',
      where,
      section,
      rule: 'The method is listed, is GET, HEAD or POST, or is allowed by * when credentials are not included',
    },
    () => {
      if ((methods ?? []).includes(plan.method)) return pass(`${visible(plan.method, 40)} is listed.`);
      if (isCorsSafelistedMethod(plan.method))
        return pass(`${plan.method} is one of GET, HEAD and POST, which need no listing.`);
      if (wildcardMethods) return pass('* allows every method because credentials are not included.');
      const why =
        methods === null
          ? 'Access-Control-Allow-Methods is absent.'
          : credentialed && methods.includes('*')
            ? '* is not a wildcard when credentials are included.'
            : `The list holds: ${listed(methods)}. The comparison is byte for byte, so letter case matters.`;
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
      const sends = plan.unsafeNames.includes('authorization');
      if (!sends) return pass('Nothing to check: no Authorization header is sent.');
      return allowedHeaders.has('authorization')
        ? pass('authorization is named in Access-Control-Allow-Headers.')
        : fail(
            `authorization is not named in Access-Control-Allow-Headers${allowedHeaders.has('*') ? '. A * never covers it' : ''}.`,
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
          headerNames === null
            ? 'Access-Control-Allow-Headers is absent.'
            : credentialed && allowedHeaders.has('*')
              ? '* is not a wildcard when credentials are included.'
              : `The list holds: ${listed(headerNames)}.`;
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
      const values = getEntries(entries, 'access-control-max-age');
      const parsed = values.length === 1 ? parseDeltaSeconds(values[0]?.value ?? '') : null;
      maxAge = parsed === null ? { seconds: 5, fromHeader: false } : { seconds: parsed, fromHeader: true };
      return info(
        parsed === null
          ? 'Access-Control-Max-Age is absent or not a whole number, so the browser uses 5 seconds.'
          : `Access-Control-Max-Age is ${parsed} seconds.`,
      );
    },
  );

  return { maxAge };
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

function summarise(verdict: Verdict, failure: CorsStep | null): string {
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
      return 'The browser would refuse to build this request.';
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

  if (!plan.crossOrigin) {
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
    if (plan.preflight.sent) {
      const preflight = readBlock(input.preflightHeaders, 'preflight headers').entries;
      steps.add(
        {
          id: 'preflight-needed',
          where: 'Request',
          section: 'Fetch, HTTP fetch',
          rule: 'A preflight is sent when the method is not GET, HEAD or POST or a header is CORS-unsafe',
        },
        () => info(plan.preflight.reasons.join(' ')),
      );
      addCorsCheck(steps, 'preflight', 'Preflight', plan, preflight);
      maxAge = addPreflightRules(steps, plan, input, preflight).maxAge;
    } else {
      steps.add(
        {
          id: 'preflight-needed',
          where: 'Request',
          section: 'Fetch, HTTP fetch',
          rule: 'A preflight is sent when the method is not GET, HEAD or POST or a header is CORS-unsafe',
        },
        () => info('No preflight: the method is GET, HEAD or POST and no request header is CORS-unsafe.'),
      );
    }
    const response = readBlock(input.responseHeaders, 'response headers').entries;
    addCorsCheck(steps, 'response', 'Response', plan, response);
    verdict =
      steps.failure === null
        ? 'readable'
        : steps.failure.id.startsWith('preflight-')
          ? 'blocked-preflight'
          : 'blocked-response';
  }

  return {
    plan,
    steps: steps.list,
    firstFailure: steps.failure,
    verdict,
    summary: summarise(verdict, steps.failure),
    preflightText: plan.preflight.sent ? preflightText(plan) : null,
    readable: [],
    advice: [],
    maxAge,
  };
}
