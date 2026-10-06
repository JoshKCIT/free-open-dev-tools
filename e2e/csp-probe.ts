import type { ConsoleMessage, Page, Worker } from '@playwright/test';

/**
 * The content security policy violation probe, shared by the per-tool privacy test and the dedicated policy spec.
 *
 * Why it exists. Once every page carries its own policy, a request the policy blocks produces NO Playwright `request`
 * event (a blocked fetch, beacon or worker fetch shows nothing in any engine; an image or XHR shows only in Chromium,
 * as a failed request). The old "no network request happened" assertion therefore stays green for a leak the browser
 * refused, and the only thing that can see the attempt is the violation itself. This probe records every violation
 * the page, its frames and its workers raise, armed BEFORE navigation so load-time violations count.
 *
 * What it installs (all measured in four engines while planning, see the capture matrix in `csp.spec.ts`):
 *  - an init script with a `securitypolicyviolation` listener on `document` in the page and in every frame whose scripts
 *    can run, forwarded through an exposed binding;
 *  - a wrapper around the `Blob` constructor that prefixes every JavaScript blob (Vite's inline workers are exactly
 *    such blobs) with a worker-side listener posting to a `BroadcastChannel`, plus the page-side receiver. Chromium and
 *    Firefox deliver worker violations this way; WebKit delivers none from workers, so its worker proof is behavioural;
 *  - `console`, `pageerror`, `worker` and worker `console` listeners, keeping only lines in the three engines' wording
 *    of a policy violation, and the three warnings that mean the generated policy itself is wrong.
 *
 * What it never filters. Only Playwright's own `Blocked script execution in 'about:srcdoc' because the document's frame
 * is sandboxed` line (its init script produces it on every `sandbox=""` preview frame in Chromium and WebKit) is dropped.
 * A duplicate directive, a meta element outside the head and a directive ignored in a meta element ALWAYS count:
 * they mean the page's policy is wrong.
 *
 * Capture is per page (one probe per `Page`, held in a WeakMap), so four projects at two workers never share a probe
 * and a violation fails the test of the page that raised it.
 *
 * The control helpers at the bottom make a page try something its policy must refuse (an outside request, a worker
 * from an address, a blob worker, `new Function`, a WebAssembly compile, an inline script). Their code always comes from
 * a same-origin script the page loads as a script element (served by `page.route`), never from `page.evaluate`:
 * code run through `evaluate` is not subject to `script-src` and would succeed on a locked page.
 */

export interface CspFinding {
  source: 'document' | 'frame' | 'worker' | 'console' | 'pageerror';
  directive?: string;
  blocked?: string;
  text?: string;
}

export interface CspProbe {
  /** A copy of everything recorded so far. */
  findings(): CspFinding[];
  /** The live list; helpers slice it to find what one action produced. */
  events: CspFinding[];
}

/** The path the probe script is served from (same origin, so `script-src 'self'` allows it). */
export const PROBE_SCRIPT_PATH = '/__fodt-probe.js';
/** A real same-origin script address for the address worker control. */
export const ADDRESS_WORKER_PATH = '/__fodt-address-worker.js';

const PROBE_ROUTE = /[/]__fodt-probe[.]js(?:[?]|$)/;
const ADDRESS_WORKER_ROUTE = /[/]__fodt-address-worker[.]js(?:[?]|$)/;

/** A violation line in the wording of Chromium, Firefox and WebKit. */
const VIOLATION_LINE = /violates the following Content Security Policy directive|Content-Security-Policy:|Refused to/;
/** A line that means the generated policy itself is wrong; never filtered, never a noise rule. */
const POLICY_DEFECT_LINE =
  /Ignoring duplicate Content-Security-Policy|duplicate (?:Content-Security-Policy )?directive|outside the document.s head|is ignored when delivered via a <meta> element/i;
/** The one sentence that is Playwright's own doing, not the page's. */
const PLAYWRIGHT_SRCDOC_LINE = /Blocked script execution in 'about:srcdoc' because the document.s frame is sandboxed/;
/** An uncaught error that a policy refusal throws (eval, WebAssembly). */
const POLICY_ERROR = /Content Security Policy|unsafe-eval|Refused to|Wasm code generation disallowed|call to eval/i;

/**
 * The text of the init script. Regular expressions inside this template literal use `[/]` and never a backslash: a
 * backslash in a template literal is eaten and the expression becomes invalid.
 */
const INIT = `(() => {
  const topLevel = window === window.top;
  const report = (source, d, b) => { try { window.__fodtCspEvent({ source, d, b }); } catch (x) {} };
  document.addEventListener('securitypolicyviolation', (e) => report(topLevel ? 'document' : 'frame', e.effectiveDirective, String(e.blockedURI).slice(0, 80)));
  const Original = window.Blob;
  const PREFIX = "try{self.addEventListener('securitypolicyviolation',function(e){try{new BroadcastChannel('__fodt_csp').postMessage({d:e.effectiveDirective,b:String(e.blockedURI).slice(0,80)})}catch(x){}})}catch(x){};";
  // newTarget is kept, so a class that extends Blob still gets its own prototype and methods under the probe.
  window.Blob = new Proxy(Original, { construct(target, args, newTarget) {
    const parts = args[0];
    const opts = args[1];
    if (opts && typeof opts.type === 'string' && /^(text|application)[/]javascript/.test(opts.type) && Array.isArray(parts)) {
      return Reflect.construct(target, [[PREFIX, ...parts], ...args.slice(1)], newTarget);
    }
    return Reflect.construct(target, args, newTarget);
  } });
  if (topLevel) {
    try {
      const channel = new BroadcastChannel('__fodt_csp');
      channel.onmessage = (e) => report('worker', e.data && e.data.d, e.data && e.data.b);
      window.__fodtCspChannel = channel;
    } catch (x) {}
  }
})();`;

const probes = new WeakMap<Page, CspProbe>();

/** The probe armed on this page; throws when `armCspProbe` was never called for it. */
export function probeOf(page: Page): CspProbe {
  const probe = probes.get(page);
  if (!probe) throw new Error('armCspProbe(page) must be called before this page is used');
  return probe;
}

/** One finding as one readable line (used in failure messages). */
export function describeFinding(finding: CspFinding): string {
  const where = finding.source;
  if (finding.text !== undefined) return `${where}: ${finding.text.slice(0, 200)}`;
  return `${where}: ${finding.directive ?? '?'} blocked ${finding.blocked ?? '?'}`;
}

/**
 * Arms the probe. Call it BEFORE `page.goto`, so a violation raised while the page loads is recorded. Nothing the
 * probe does reads or writes storage, the page address or the console.
 */
export async function armCspProbe(page: Page): Promise<CspProbe> {
  const events: CspFinding[] = [];

  await page.exposeBinding('__fodtCspEvent', (_source, payload: { source?: string; d?: string; b?: string }) => {
    const source = payload.source === 'frame' || payload.source === 'worker' ? payload.source : 'document';
    events.push({ source, directive: payload.d, blocked: payload.b });
  });
  await page.addInitScript(INIT);

  const keepLine = (message: ConsoleMessage, prefix: CspFinding['source']): void => {
    const text = message.text();
    if (PLAYWRIGHT_SRCDOC_LINE.test(text)) return;
    if (VIOLATION_LINE.test(text) || POLICY_DEFECT_LINE.test(text)) events.push({ source: prefix, text });
  };
  page.on('console', (message) => keepLine(message, 'console'));
  page.on('pageerror', (error) => {
    if (POLICY_ERROR.test(error.message)) events.push({ source: 'pageerror', text: error.message });
  });
  page.on('worker', (worker: Worker) => {
    worker.on('console', (message) => keepLine(message, 'console'));
  });

  const probe: CspProbe = { findings: () => events.slice(), events };
  probes.set(page, probe);
  return probe;
}

/** Serves `code` as the probe script (the last call wins). */
export async function routeProbeScript(page: Page, code: string): Promise<void> {
  await page.route(PROBE_ROUTE, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: code }));
}

let runCounter = 0;

/**
 * Runs `body` (the body of an async function; its return value is handed back) as page code: served by `page.route`,
 * loaded as a script element, so it is governed by the page's own policy exactly like page code. Returns what it
 * returned and the findings recorded while it ran and for a moment after.
 */
export async function runProbeBody(
  page: Page,
  body: string,
  settleMs = 500,
): Promise<{ result: unknown; findings: CspFinding[] }> {
  const probe = probeOf(page);
  const before = probe.events.length;
  const code = `(async () => {
  let result;
  try { result = await (async () => { ${body}
  })(); } catch (error) { result = { threw: String(error && error.name) }; }
  window.__fodtProbeResult = result;
  window.__fodtProbeDone = true;
})();`;
  await routeProbeScript(page, code);
  runCounter += 1;
  const src = new URL(`${PROBE_SCRIPT_PATH}?run=${runCounter}`, page.url()).toString();
  await page.evaluate((scriptSrc) => {
    const holder = window as unknown as Record<string, unknown>;
    holder.__fodtProbeDone = false;
    holder.__fodtProbeResult = undefined;
    const element = document.createElement('script');
    element.src = scriptSrc;
    document.head.append(element);
  }, src);
  await page.waitForFunction(() => (window as unknown as Record<string, unknown>).__fodtProbeDone === true, null, {
    timeout: 15_000,
  });
  const result = await page.evaluate(() => (window as unknown as Record<string, unknown>).__fodtProbeResult);
  await page.waitForTimeout(settleMs);
  return { result, findings: probe.events.slice(before) };
}

export type Outcome = 'refused' | 'allowed';

export interface ControlResult {
  outcome: Outcome;
  findings: CspFinding[];
  /** What the page itself saw, for failure messages. */
  detail: string;
}

/** True when a finding names a directive (its own name, or in the console wording). */
export function namesDirective(finding: CspFinding, directive: string): boolean {
  if (finding.directive !== undefined && finding.directive.startsWith(directive)) return true;
  return finding.text !== undefined && finding.text.includes(directive);
}

/** The kinds of outside request a page can try. */
export const OUTSIDE_KINDS = ['fetch', 'xhr', 'beacon', 'websocket', 'eventsource', 'image'] as const;
export type OutsideKind = (typeof OUTSIDE_KINDS)[number];

const OUTSIDE_CODE: Record<OutsideKind, (outside: string) => string> = {
  fetch: (u) => `const u = ${JSON.stringify(u)};
    try { await fetch(u + 'fetch', { mode: 'no-cors' }); return 'sent'; } catch (e) { return 'failed'; }`,
  xhr: (u) => `const u = ${JSON.stringify(u)};
    return await new Promise((resolve) => {
      try {
        const x = new XMLHttpRequest();
        x.open('GET', u + 'xhr');
        x.onerror = () => resolve('failed');
        x.onload = () => resolve('loaded');
        x.send();
      } catch (e) { resolve('threw'); }
      setTimeout(() => resolve('timeout'), 3000);
    });`,
  beacon: (u) => `const u = ${JSON.stringify(u)};
    try { return navigator.sendBeacon(u + 'beacon', 'x') ? 'queued' : 'refused'; } catch (e) { return 'threw'; }`,
  websocket: (u) => `const u = ${JSON.stringify(u)}.replace(/^http/, 'ws');
    return await new Promise((resolve) => {
      try {
        const s = new WebSocket(u + 'ws');
        s.onopen = () => resolve('opened');
        s.onerror = () => resolve('failed');
        s.onclose = () => resolve('closed');
      } catch (e) { resolve('threw'); }
      setTimeout(() => resolve('timeout'), 3000);
    });`,
  eventsource: (u) => `const u = ${JSON.stringify(u)};
    return await new Promise((resolve) => {
      try {
        const s = new EventSource(u + 'es');
        s.onopen = () => { s.close(); resolve('opened'); };
        s.onerror = () => { s.close(); resolve('failed'); };
      } catch (e) { resolve('threw'); }
      setTimeout(() => resolve('timeout'), 3000);
    });`,
  image: (u) => `const u = ${JSON.stringify(u)};
    return await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve('loaded');
      i.onerror = () => resolve('failed');
      i.src = u + 'image.png';
      setTimeout(() => resolve('timeout'), 3000);
    });`,
};

/** The directive each kind of outside request is governed by. */
export function directiveForOutside(kind: OutsideKind): string {
  return kind === 'image' ? 'img-src' : 'connect-src';
}

/**
 * Makes the page try each kind of outside request at `outsideUrl` (which must end in a slash). Each outcome is
 * `refused` when the probe recorded the matching violation, or (for fetch and beacon, whose result the page can read
 * reliably) the page itself saw the refusal; `allowed` otherwise.
 */
export async function outsideRequestOutcomes(
  page: Page,
  outsideUrl: string,
): Promise<Record<OutsideKind, ControlResult>> {
  const results = {} as Record<OutsideKind, ControlResult>;
  for (const kind of OUTSIDE_KINDS) {
    const { result, findings } = await runProbeBody(page, OUTSIDE_CODE[kind](outsideUrl));
    const seen = String(typeof result === 'object' && result !== null ? JSON.stringify(result) : result);
    const recorded = findings.some((finding) => namesDirective(finding, directiveForOutside(kind)));
    const behaviour = (kind === 'fetch' && seen === 'failed') || (kind === 'beacon' && seen === 'refused');
    results[kind] = { outcome: recorded || behaviour ? 'refused' : 'allowed', findings, detail: `${kind}: ${seen}` };
  }
  return results;
}

/**
 * How long a worker control waits for an answer when nothing at all happens. The controls decide by events (the
 * worker's own message, an error event, a thrown constructor, a `worker-src` violation on the document), so this is
 * only a backstop; a control that ends on it says so in its detail (`ended by the backstop`), and the tests that need
 * a refusal also require the recorded violation, so the backstop alone can never make a refusal pass.
 */
const WORKER_BACKSTOP_MS = 10_000;

/**
 * Page code that ends a worker control on the first decisive event. `finish(how)` resolves once; a `worker-src`
 * violation on the document ends it as `violation`; the backstop ends it as `backstop`.
 */
const WORKER_SETTLE = `let settled = false;
      let resolveOnce;
      const done = new Promise((resolve) => { resolveOnce = resolve; });
      const onViolation = (e) => { if (String(e.effectiveDirective).startsWith('worker-src')) finish('violation'); };
      const finish = (how) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('securitypolicyviolation', onViolation);
        resolveOnce(how);
      };
      document.addEventListener('securitypolicyviolation', onViolation);
      setTimeout(() => finish('backstop'), ${WORKER_BACKSTOP_MS});`;

/**
 * A worker started from a real same-origin script address. The address is served by `page.route`, so on a page
 * with no policy it would start; on any page of this site it must never start. Ends on the worker's message, an
 * error event, a thrown constructor or a `worker-src` violation, whichever comes first.
 */
export async function addressWorkerOutcome(page: Page): Promise<ControlResult> {
  await page.route(ADDRESS_WORKER_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: 'postMessage("started");' }),
  );
  const { result, findings } = await runProbeBody(
    page,
    `${WORKER_SETTLE}
      try {
        const worker = new Worker(location.origin + ${JSON.stringify(ADDRESS_WORKER_PATH)});
        worker.onmessage = () => finish('started');
        worker.onerror = () => finish('error-event');
      } catch (e) { finish('threw:' + e.name); }
      return await done;`,
    800,
  );
  const how = String(result);
  return {
    outcome: how === 'started' ? 'allowed' : 'refused',
    findings,
    detail: `address worker: ${how === 'backstop' ? 'ended by the backstop' : how}`,
  };
}

/**
 * A worker from a JavaScript blob, which then tries an outside fetch. `allowed` means the worker started; `inner`
 * says what its own outside fetch did (`failed` is what the policy must make it do). Ends when the worker reports
 * what its fetch did, or on an error event, a thrown constructor or a `worker-src` violation, whichever comes first.
 */
export async function blobWorkerOutcome(
  page: Page,
  outsideUrl: string,
): Promise<ControlResult & { inner: 'sent' | 'failed' | 'none' }> {
  const { result, findings } = await runProbeBody(
    page,
    `const source = 'postMessage("started");fetch(' + JSON.stringify(${JSON.stringify(outsideUrl)} + 'worker-fetch') + ',{mode:"no-cors"}).then(function(){postMessage("fetch:sent")},function(){postMessage("fetch:failed")});';
      const got = [];
      ${WORKER_SETTLE}
      try {
        const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
        worker.onmessage = (e) => { got.push(String(e.data)); if (String(e.data).startsWith('fetch:')) finish('fetch-answered'); };
        worker.onerror = () => { got.push('error-event'); finish('error-event'); };
      } catch (e) { finish('threw:' + e.name); }
      const how = await done;
      return { how, got };`,
    800,
  );
  const record = result as { how?: string; got?: string[] } | undefined;
  const got = record?.got ?? [];
  const started = got.includes('started');
  const inner = got.includes('fetch:failed') ? 'failed' : got.includes('fetch:sent') ? 'sent' : 'none';
  const how = record?.how === 'backstop' ? 'ended by the backstop' : (record?.how ?? '?');
  return {
    outcome: started ? 'allowed' : 'refused',
    findings,
    detail: `blob worker: ${how} ${got.join(',')}`,
    inner,
  };
}

/** `new Function`: `allowed` only where the policy has `'unsafe-eval'`. */
export async function evalOutcome(page: Page): Promise<ControlResult> {
  const { result, findings } = await runProbeBody(
    page,
    `try { return new Function('return 7')() === 7 ? 'ran' : 'wrong'; } catch (e) { return 'blocked:' + e.name; }`,
  );
  return { outcome: result === 'ran' ? 'allowed' : 'refused', findings, detail: `eval: ${String(result)}` };
}

/** A WebAssembly compile of an empty module: `allowed` where the policy has `'unsafe-eval'` or `'wasm-unsafe-eval'`. */
export async function wasmCompileOutcome(page: Page): Promise<ControlResult> {
  const { result, findings } = await runProbeBody(
    page,
    `try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); return 'compiled'; } catch (e) { return 'blocked:' + e.name; }`,
  );
  return {
    outcome: result === 'compiled' ? 'allowed' : 'refused',
    findings,
    detail: `wasm compile: ${String(result)}`,
  };
}

/** An inline script element added by page code: it must never run. */
export async function inlineScriptOutcome(page: Page): Promise<ControlResult> {
  const { result, findings } = await runProbeBody(
    page,
    `const holder = window;
    holder.__fodtInlineRan = false;
    const element = document.createElement('script');
    element.textContent = 'window.__fodtInlineRan = true;';
    document.head.append(element);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return holder.__fodtInlineRan ? 'ran' : 'blocked';`,
  );
  return { outcome: result === 'ran' ? 'allowed' : 'refused', findings, detail: `inline script: ${String(result)}` };
}
