import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addressWorkerOutcome,
  armCspProbe,
  blobWorkerOutcome,
  describeFinding,
  directiveForOutside,
  evalOutcome,
  inlineScriptOutcome,
  namesDirective,
  OUTSIDE_KINDS,
  outsideRequestOutcomes,
  runProbeBody,
  wasmCompileOutcome,
  type ControlResult,
  type CspFinding,
} from './csp-probe';

/**
 * Proof that every page's own content security policy refuses what it must, and that the instrument noticing a refusal
 * can fail. The shared probe lives in `e2e/csp-probe.ts` and is also armed inside the per-tool test of
 * `e2e/privacy.spec.ts`, so all 211 tool pages are driven through every control state with zero violations allowed.
 *
 * Page code for the controls is served by `page.route` from `__fodt-probe.js` and loaded as a script element, never run
 * through `page.evaluate`: code run by `evaluate` is not subject to the page's `script-src` and its `eval` and
 * `Function` calls succeed even on a locked page, in all four engines.
 *
 * WHAT IS PROOF WHERE (measured in Chromium, Firefox, Windows WebKit and Linux WebKit while planning; trust no green
 * WebKit event assertion more than the table allows):
 *
 *   violation                               Chromium          Firefox            WebKit
 *   page fetch or image                     event + console   event + console    event + console
 *   page new Function with no grant         event             event + console    event
 *   page WebAssembly.compile, no grant      event             event + console    NO EVENT; the compile throws (behaviour)
 *   script-enabled frame (Mermaid) fetch    event + console   event + console    event + console
 *   sandbox="" preview frame (no scripts)   console only      event + console    console only
 *   blob worker fetch                       prefix event      prefix event       console only
 *   blob worker eval or WebAssembly         prefix event      prefix event       NOTHING; proof is the tool's run completing
 *
 * So on WebKit the proof for worker and WebAssembly violations is behavioural, and these tests assert behaviour there
 * (the worker starts or never starts; the compile throws or compiles; the server saw nothing). Never assert that eval
 * is refused right after a WebAssembly compile on WebKit (it has a measured lapse); the eval-refused control runs first
 * on a fresh page, before any compile.
 *
 * The outside address is a local recording server (so a leak shows as a server hit) or, when E2E_BASE_URL points at a
 * deployed site, `https://example.invalid/` (an https page cannot reach a plain http server). That address fails by name
 * lookup with or without a policy, so against the deployed site every negative control rests on a RECORDED violation
 * (the worker controls included: a worker event, or a console line on WebKit), and what cannot be recorded is skipped
 * rather than passed: the positive controls and the closed preview frame link run only against the local build.
 *
 * The worker controls end on the first decisive event (the worker's message, an error event, a thrown constructor or a
 * `worker-src` violation), never at the end of a fixed window; their long backstop only stops a control that hears
 * nothing, and a refusal still needs its recorded violation to pass.
 *
 * One representative page is tested for each DISTINCT policy string the build serves, found from the served pages, so a
 * new combination of needs gets every control with no edit here.
 */

const rel = (path: string) => path.replace(/^\//, '');
const deployed = Boolean(process.env.E2E_BASE_URL);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = (process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/?$/, '/');

/**
 * Runs `body` with the address of a local HTTP server that records every request it receives (or the never-resolving
 * `https://example.invalid/` when testing a deployed site), waits a moment for a stray request to land, and returns what
 * the server saw. Copied here from e2e/vision-mermaid.spec.ts on purpose: specs never import from each other.
 */
async function withOutsideAddress(body: (address: string) => Promise<void>): Promise<string[]> {
  if (deployed) {
    await body('https://example.invalid/');
    return [];
  }
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await body(`http://127.0.0.1:${port}/`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return seen;
}

async function openToolPage(page: Page, id: string): Promise<void> {
  await page.goto(rel(`/tools/${id}`));
  await page.waitForLoadState('networkidle');
}

/** The findings as readable lines, for failure messages. */
const lines = (findings: CspFinding[]): string => findings.map(describeFinding).join(' | ') || 'none';

// ---------------------------------------------------------------------------------------------------------------------
// Policy groups: one representative per distinct policy, from the repository; then every served page is read once.
//
// The groups, their labels, their representatives and their grants come from each catalog tool's declared needs
// (`tools/<id>/src/meta.json`), which every process reads identically, so no test title depends on a network read
// (a title that changed between the main process and a worker would stop the group with "Test not found in the
// worker process"). Whether the served pages agree is a test of its own: it reads every catalog page, fails on any page
// it could not read (an unread page could hide a whole policy group), and fails when a page serves a policy other than
// the one its needs give, or two groups serve the same policy.
// ---------------------------------------------------------------------------------------------------------------------

type ParsedPolicy = Map<string, string[]>;

function parsePolicyText(text: string): ParsedPolicy {
  const parsed: ParsedPolicy = new Map();
  for (const part of text.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift();
    if (name) parsed.set(name, tokens);
  }
  return parsed;
}

const POLICY_META = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/;

interface Representative {
  id: string;
  /** Every catalog tool whose declared needs give this policy, sorted; the representative is the first. */
  members: string[];
  label: string;
  grants: { eval: boolean; wasm: boolean; blobWorkers: boolean };
}

/** The label a served policy earns, read from the policy text itself. */
function labelOf(parsed: ParsedPolicy): string {
  const script = parsed.get('script-src') ?? [];
  const parts: string[] = [];
  if (script.includes("'unsafe-eval'")) parts.push('eval');
  if (script.includes("'wasm-unsafe-eval'")) parts.push('wasm');
  if ((parsed.get('worker-src') ?? []).includes('blob:')) parts.push('workers');
  if ((parsed.get('style-src') ?? []).includes("'unsafe-inline'")) parts.push('inline styles');
  if (script.filter((token) => token.startsWith("'sha256-")).length > 1) parts.push('frame hashes');
  return parts.length > 0 ? parts.join(' + ') : 'baseline';
}

/**
 * The label a tool's declared needs give, in the same words and order as `labelOf` reads from a served policy:
 * `sandboxed-html` and `mermaid-frame` both add inline styles, and `mermaid-frame` adds the two frame hashes.
 */
function labelOfNeeds(needs: readonly string[]): string {
  const n = new Set(needs);
  const parts: string[] = [];
  if (n.has('eval')) parts.push('eval');
  if (n.has('wasm')) parts.push('wasm');
  if (n.has('workers')) parts.push('workers');
  if (n.has('sandboxed-html') || n.has('mermaid-frame')) parts.push('inline styles');
  if (n.has('mermaid-frame')) parts.push('frame hashes');
  return parts.length > 0 ? parts.join(' + ') : 'baseline';
}

const CATALOG_IDS = (JSON.parse(readFileSync(join(root, 'docs', 'catalog.json'), 'utf8')) as { id: string }[])
  .map((entry) => entry.id)
  .sort();

/** The policy group of every catalog tool, from its declared needs (no `needs` means the baseline). */
const GROUP_OF = new Map(
  CATALOG_IDS.map((id) => {
    const meta = JSON.parse(readFileSync(join(root, 'tools', id, 'src', 'meta.json'), 'utf8')) as { needs?: string[] };
    return [id, labelOfNeeds(meta.needs ?? [])] as const;
  }),
);

const REPRESENTATIVES: Representative[] = [...new Set(GROUP_OF.values())]
  .map((label) => {
    const members = CATALOG_IDS.filter((id) => GROUP_OF.get(id) === label);
    const parts = new Set(label.split(' + '));
    return {
      id: members[0]!,
      members,
      label,
      grants: {
        eval: parts.has('eval'),
        wasm: parts.has('eval') || parts.has('wasm'),
        blobWorkers: parts.has('workers'),
      },
    };
  })
  .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

/**
 * The served text of one tool page, asked up to three times with a short pause (a single failed read must not hide a
 * page). Against the local build a page that still cannot be asked for is read from the built files the preview serves;
 * against a deployed site there is no such fallback, because the built files there are not the site under test.
 */
async function servedPageText(id: string): Promise<string | undefined> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(new URL(`tools/${id}`, baseUrl));
      if (response.ok) return await response.text();
    } catch {
      /* asked again below */
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  if (deployed) return undefined;
  const built = join(root, 'apps', 'web', 'dist', 'tools', `${id}.html`);
  return existsSync(built) ? readFileSync(built, 'utf8') : undefined;
}

test('every catalog page is read and serves the policy its declared needs give, one distinct policy per group', async () => {
  test.setTimeout(240_000);
  const served = new Map<string, string | undefined>();
  for (let start = 0; start < CATALOG_IDS.length; start += 24) {
    const batch = CATALOG_IDS.slice(start, start + 24);
    const texts = await Promise.all(batch.map((id) => servedPageText(id)));
    batch.forEach((id, index) => {
      const text = texts[index];
      served.set(id, text ? POLICY_META.exec(text)?.[1] : undefined);
    });
  }
  test.info().annotations.push({
    type: 'policy groups',
    description: REPRESENTATIVES.map((rep) => `${rep.label}: ${rep.id} (${rep.members.length} pages)`).join('; '),
  });

  const unread = CATALOG_IDS.filter((id) => served.get(id) === undefined);
  expect(
    unread,
    'every catalog page must be read with its policy; an unread page could hide a whole policy group',
  ).toEqual([]);
  const disagreeing = CATALOG_IDS.filter((id) => labelOf(parsePolicyText(served.get(id)!)) !== GROUP_OF.get(id)).map(
    (id) => `${id} declares ${GROUP_OF.get(id)} but serves ${labelOf(parsePolicyText(served.get(id)!))}`,
  );
  expect(disagreeing, 'every page serves the policy its declared needs give').toEqual([]);
  for (const rep of REPRESENTATIVES) {
    const policies = new Set(rep.members.map((id) => served.get(id)));
    expect(policies.size, `every page of the ${rep.label} group serves one and the same policy`).toBe(1);
  }
  const groupPolicies = REPRESENTATIVES.map((rep) => served.get(rep.id));
  expect(new Set(groupPolicies).size, 'no two groups serve the same policy').toBe(REPRESENTATIVES.length);
  expect(REPRESENTATIVES.length, 'at least the baseline and the worker policies are served').toBeGreaterThan(1);
});

// ---------------------------------------------------------------------------------------------------------------------
// The probe itself: blob workers (research A1), the page's own worker, load-time violations.
// ---------------------------------------------------------------------------------------------------------------------

test.describe('the violation probe sees what the policy refuses', () => {
  test('a blob worker that tries an outside fetch is recorded, refused and never reaches the server', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName === 'webkit', 'WebKit delivers no worker violation events; its worker proof is behavioural');
    const probe = await armCspProbe(page);
    await openToolPage(page, 'regex-tester');
    expect(probe.findings().map(describeFinding), 'the regex tester loads clean under its own policy').toEqual([]);

    const seen = await withOutsideAddress(async (outside) => {
      const worker = await blobWorkerOutcome(page, outside);
      expect(worker.outcome, `the regex tester allows a blob worker (${worker.detail})`).toBe('allowed');
      expect(worker.inner, `the worker's own outside fetch must fail (${worker.detail})`).toBe('failed');
      const fromWorker = worker.findings.filter(
        (finding) => finding.source === 'worker' && namesDirective(finding, 'connect-src'),
      );
      expect(
        fromWorker.length,
        `a violation raised inside the blob worker is recorded by the probe (${lines(worker.findings)})`,
      ).toBeGreaterThan(0);
    });
    expect(seen, 'the recording server saw nothing from the worker').toEqual([]);
  });

  test('a blob worker that tries an outside fetch is refused and never reaches the server (every engine)', async ({
    page,
  }) => {
    const probe = await armCspProbe(page);
    await openToolPage(page, 'regex-tester');
    const seen = await withOutsideAddress(async (outside) => {
      const worker = await blobWorkerOutcome(page, outside);
      expect(worker.outcome, `the regex tester allows a blob worker (${worker.detail})`).toBe('allowed');
      expect(worker.inner, `the worker's own outside fetch must fail (${worker.detail})`).toBe('failed');
    });
    expect(seen, 'the recording server saw nothing from the worker').toEqual([]);
    // The refusal is recorded in every engine: as a worker event through the Blob prefix in Chromium and Firefox, as a
    // console line naming connect-src in WebKit. Against the deployed site the outside address fails by name lookup
    // whatever the policy says, so this recorded refusal, not the failed fetch, is the proof there.
    expect(
      probe.findings().some((finding) => namesDirective(finding, 'connect-src')),
      `the worker's refused fetch is recorded, naming connect-src (${lines(probe.findings())})`,
    ).toBe(true);
  });

  test('a class that extends Blob keeps its own class and methods with the probe armed', async ({ page }) => {
    const probe = await armCspProbe(page);
    await openToolPage(page, 'regex-tester');
    // Page code (a same-origin script, governed by the page policy): a library class built on Blob, once with a
    // JavaScript type (which the probe prefixes) and once with a plain text type.
    const { result } = await runProbeBody(
      page,
      `class Tagged extends Blob { tag() { return 'kept'; } }
      const js = new Tagged(['1;'], { type: 'text/javascript' });
      const plain = new Tagged(['plain'], { type: 'text/plain' });
      return {
        jsIsTagged: js instanceof Tagged,
        jsTag: typeof js.tag === 'function' ? js.tag() : 'lost',
        plainIsTagged: plain instanceof Tagged,
        plainTag: typeof plain.tag === 'function' ? plain.tag() : 'lost',
        stillBlob: js instanceof Blob && plain instanceof Blob,
        plainText: await plain.text(),
        jsPrefixed: (await js.text()).startsWith('try{self.addEventListener'),
      };`,
      0,
    );
    expect(result, 'a Blob subclass under the probe').toEqual({
      jsIsTagged: true,
      jsTag: 'kept',
      plainIsTagged: true,
      plainTag: 'kept',
      stillBlob: true,
      plainText: 'plain',
      jsPrefixed: true,
    });
    expect(probe.findings().map(describeFinding), 'the subclass raised a violation').toEqual([]);
  });

  test('the page own worker still runs with the probe armed and the policy in force', async ({ page }) => {
    const probe = await armCspProbe(page);
    await openToolPage(page, 'regex-tester');
    await page.locator('#f-pattern').fill('a+');
    await page.locator('#f-input').fill('baaab');
    await expect(page.locator('section[aria-label="Output"] table.output-table')).toContainText('aaa', {
      timeout: 10_000,
    });
    expect(probe.findings().map(describeFinding), 'the page worker raised a violation').toEqual([]);
  });

  test('a violation raised while the page loads is recorded (the probe is armed before navigation)', async ({
    page,
  }) => {
    const probe = await armCspProbe(page);
    await withOutsideAddress(async (outside) => {
      // Added when the document has been parsed (the policy meta is the first element of the head, so it is in force
      // by then) and before load settles: an outside image the policy must refuse. An image started earlier than the
      // meta element is not covered by it, in any engine.
      await page.addInitScript((address) => {
        document.addEventListener('DOMContentLoaded', () => {
          new Image().src = `${address}load-time.png`;
        });
      }, outside);
      await openToolPage(page, 'base64');
      // Which directive an engine names for an image started this early differs (Chromium says connect-src), so the
      // finding is recognised by the address it refused. Waited for as an event, not a fixed pause.
      await expect
        .poll(
          () =>
            probe.findings().filter((finding) => (finding.blocked ?? finding.text ?? '').includes('load-time.png'))
              .length,
          { message: `the image refused during load is in the probe (${lines(probe.findings())})`, timeout: 10_000 },
        )
        .toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The structure of every page in the real browser.
// ---------------------------------------------------------------------------------------------------------------------

/** The policy meta is the first element of the head, the charset meta the second, and the icon (a data address) loads. */
async function expectStructure(page: Page, label: string): Promise<void> {
  const structure = await page.evaluate(() => {
    const first = document.head.children[0];
    const second = document.head.children[1];
    const icon = document.querySelector('link[rel~="icon"]');
    return {
      firstTag: first?.tagName,
      firstHttpEquiv: first?.getAttribute('http-equiv'),
      secondTag: second?.tagName,
      secondHasCharset: second?.hasAttribute('charset') ?? false,
      characterSet: document.characterSet,
      iconHref: icon?.getAttribute('href') ?? '',
    };
  });
  expect(structure.firstTag, `${label}: the first element of head`).toBe('META');
  expect(structure.firstHttpEquiv, `${label}: the first element of head is the policy meta`).toBe(
    'Content-Security-Policy',
  );
  expect(structure.secondTag, `${label}: the second element of head`).toBe('META');
  expect(structure.secondHasCharset, `${label}: the second element of head is the charset meta`).toBe(true);
  expect(structure.characterSet, `${label}: the page is read as UTF-8`).toBe('UTF-8');
  expect(structure.iconHref.startsWith('data:'), `${label}: the icon is a data address`).toBe(true);
  const iconLoad = await page.evaluate(
    (href) =>
      new Promise<string>((resolve) => {
        const image = new Image();
        image.onload = () => resolve('ok');
        image.onerror = () => resolve('error');
        image.src = href;
      }),
    structure.iconHref,
  );
  expect(iconLoad, `${label}: the icon still loads under the policy`).toBe('ok');
}

// ---------------------------------------------------------------------------------------------------------------------
// One representative per distinct policy, every control.
// ---------------------------------------------------------------------------------------------------------------------

/** Whether this engine delivers a violation event (or console line) for the control; WebKit gives none for wasm. */
function recorded(result: ControlResult, directive: string): boolean {
  return result.findings.some((finding) => namesDirective(finding, directive));
}

for (const rep of REPRESENTATIVES) {
  const grants = rep.grants;

  test.describe(`policy ${rep.label}: ${rep.id}`, () => {
    test('loads clean, with the policy first in the head and the charset second', async ({ page }) => {
      test.info().annotations.push({ type: 'stands for', description: `${rep.members.length} pages` });
      const probe = await armCspProbe(page);
      await openToolPage(page, rep.id);
      const written = await page.evaluate(
        () => document.head.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
      );
      expect(
        labelOf(parsePolicyText(written)),
        `the policy in the live page is the one the ${rep.label} group stands for (${written})`,
      ).toBe(rep.label);
      await expectStructure(page, rep.id);
      expect(probe.findings().map(describeFinding), `${rep.id} raised a violation while loading`).toEqual([]);
    });

    test('an outside fetch, XHR, beacon, WebSocket, EventSource and image are refused and recorded', async ({
      page,
    }) => {
      const probe = await armCspProbe(page);
      await openToolPage(page, rep.id);
      const seen = await withOutsideAddress(async (outside) => {
        const outcomes = await outsideRequestOutcomes(page, outside);
        for (const kind of OUTSIDE_KINDS) {
          const result = outcomes[kind];
          expect(result.outcome, `${rep.id}: an outside ${kind} was not refused (${result.detail})`).toBe('refused');
          expect(
            recorded(result, directiveForOutside(kind)),
            `${rep.id}: the probe did not record the refused ${kind} (${result.detail}; ${lines(result.findings)})`,
          ).toBe(true);
        }
      });
      expect(seen, `${rep.id}: the recording server saw a request`).toEqual([]);
      expect(probe.findings().length).toBeGreaterThan(0);
    });

    test('a worker started from an address never starts', async ({ page }) => {
      await armCspProbe(page);
      await openToolPage(page, rep.id);
      const result = await addressWorkerOutcome(page);
      expect(result.outcome, `${rep.id}: a worker from an address started (${result.detail})`).toBe('refused');
      // Every engine records this refusal (worker-src), so the control cannot pass by the worker simply staying quiet.
      expect(
        recorded(result, 'worker-src'),
        `${rep.id}: the refused address worker was not recorded (${result.detail}; ${lines(result.findings)})`,
      ).toBe(true);
    });

    test(`a blob worker is ${grants.blobWorkers ? 'allowed, and its own outside fetch fails' : 'refused'}`, async ({
      page,
    }) => {
      await armCspProbe(page);
      await openToolPage(page, rep.id);
      const seen = await withOutsideAddress(async (outside) => {
        const result = await blobWorkerOutcome(page, outside);
        if (grants.blobWorkers) {
          expect(result.outcome, `${rep.id}: the blob worker did not start (${result.detail})`).toBe('allowed');
          expect(result.inner, `${rep.id}: the worker's outside fetch was not refused (${result.detail})`).toBe(
            'failed',
          );
          // The failed fetch alone proves nothing against the deployed site (the address fails by name lookup there),
          // so the refusal must also be recorded: a worker event in Chromium and Firefox, a console line in WebKit.
          expect(
            recorded(result, 'connect-src'),
            `${rep.id}: the worker's refused fetch was not recorded (${result.detail}; ${lines(result.findings)})`,
          ).toBe(true);
        } else {
          expect(result.outcome, `${rep.id}: a blob worker started on a page with no worker grant`).toBe('refused');
          // Every engine records this refusal (worker-src), so the control cannot pass by the worker staying quiet.
          expect(
            recorded(result, 'worker-src'),
            `${rep.id}: the refused blob worker was not recorded (${result.detail}; ${lines(result.findings)})`,
          ).toBe(true);
        }
      });
      expect(seen, `${rep.id}: the recording server saw a request from a worker`).toEqual([]);
    });

    test(`code generation is ${grants.eval ? 'allowed' : 'refused'} and WebAssembly compile is ${grants.wasm ? 'allowed' : 'refused'}`, async ({
      page,
      browserName,
    }) => {
      await armCspProbe(page);
      await openToolPage(page, rep.id);
      // Eval first, on a fresh page, before any compile (WebKit can let eval through right after a compile).
      const generated = await evalOutcome(page);
      expect(generated.outcome, `${rep.id}: new Function (${generated.detail})`).toBe(
        grants.eval ? 'allowed' : 'refused',
      );
      if (!grants.eval) {
        expect(
          recorded(generated, 'script-src'),
          `${rep.id}: the refused code generation was not recorded (${lines(generated.findings)})`,
        ).toBe(true);
      }
      const compiled = await wasmCompileOutcome(page);
      expect(compiled.outcome, `${rep.id}: WebAssembly compile (${compiled.detail})`).toBe(
        grants.wasm ? 'allowed' : 'refused',
      );
      if (!grants.wasm && browserName !== 'webkit') {
        expect(
          recorded(compiled, 'script-src'),
          `${rep.id}: the refused compile was not recorded (${lines(compiled.findings)})`,
        ).toBe(true);
      }
    });

    test('an inline script injected by page code does not run', async ({ page }) => {
      await armCspProbe(page);
      await openToolPage(page, rep.id);
      const result = await inlineScriptOutcome(page);
      expect(result.outcome, `${rep.id}: an inline script ran (${result.detail})`).toBe('refused');
      expect(
        recorded(result, 'script-src'),
        `${rep.id}: the refusal was not recorded (${lines(result.findings)})`,
      ).toBe(true);
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The two frames: Mermaid (scripts allowed, nothing else) and the closed preview frame.
// ---------------------------------------------------------------------------------------------------------------------

test('the Mermaid frame draws under its hashes with no violation, and cannot fetch', async ({ page }) => {
  // Keep the page's own frame in the document after its run so the real frame can be asked to fetch.
  await page.addInitScript(() => {
    const original = Element.prototype.remove;
    Element.prototype.remove = function (this: Element) {
      if (this instanceof HTMLIFrameElement && this.getAttribute('sandbox') === 'allow-scripts') return;
      original.call(this);
    };
  });
  const probe = await armCspProbe(page);
  await openToolPage(page, 'mermaid-renderer');
  await page.locator('#f-source').fill('flowchart LR\n  A --> B');
  await page.locator('main div.toolbar button.button-primary').first().click();
  await expect(page.locator('section[aria-label="Output"] img').first()).toHaveAttribute(
    'alt',
    /^Mermaid flowchart diagram/,
    { timeout: 30_000 },
  );
  expect(probe.findings().map(describeFinding), 'drawing a diagram raised a violation').toEqual([]);

  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  expect(frame, 'the diagram frame is still in the document').toBeDefined();
  const before = probe.events.length;
  const seen = await withOutsideAddress(async (outside) => {
    const outcome = await frame!.evaluate(
      (address) =>
        fetch(`${address}from-the-frame`, { mode: 'no-cors' }).then(
          () => 'sent',
          () => 'failed',
        ),
      outside,
    );
    expect(outcome, 'the diagram frame fetched an outside address').toBe('failed');
    await page.waitForTimeout(500);
  });
  expect(seen, 'the recording server saw a request from the diagram frame').toEqual([]);
  const raised = probe.events.slice(before);
  expect(
    raised.some((finding) => finding.source === 'frame' && namesDirective(finding, 'connect-src')),
    `the probe recorded the frame's refused fetch (${lines(raised)})`,
  ).toBe(true);
});

test('a link clicked in the closed preview frame reaches nothing', async ({ page }) => {
  // No engine raises an event for this refusal (measured), so the proof is the recording server's silence. Against
  // the deployed site the link would go to an address that fails by name lookup with or without the policy, so the
  // test would prove nothing there and is skipped instead of passing.
  test.skip(deployed, 'needs the local recording server; against the deployed site the click proves nothing');
  const probe = await armCspProbe(page);
  await openToolPage(page, 'markdown-html');
  const seen = await withOutsideAddress(async (outside) => {
    await page.locator('#f-input').fill(`[go](${outside}clicked)`);
    const preview = page.frameLocator('iframe.preview-frame');
    const link = preview.locator('a').first();
    await expect(link).toHaveAttribute('href', `${outside}clicked`, { timeout: 15_000 });
    await link.click();
    await page.waitForTimeout(1200);
  });
  expect(seen, 'a link inside the closed preview frame reached the outside address').toEqual([]);
  expect(
    probe.findings().filter((finding) => finding.source === 'pageerror'),
    'the click raised a page error',
  ).toEqual([]);
});

// ---------------------------------------------------------------------------------------------------------------------
// The instrument can fail: the same controls on a page with no policy are allowed, and the server hears them.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Serves a bare page with no policy from a real local server and opens it. It is a real server on purpose: a page
 * answered by `route.fulfill` has no known address, so Chromium treats it as public and refuses its requests to the
 * local recording server ("Permission was denied ... loopback address space"), which would make the control prove nothing.
 */
async function withPageWithoutPolicy(page: Page, body: () => Promise<void>): Promise<void> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(
      '<!doctype html><html><head><meta charset="utf-8"><title>no policy</title></head><body><div id="holder"></div></body></html>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await body();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test.describe('positive controls: with no policy the same attempts succeed, so a refusal means something', () => {
  test.skip(deployed, 'needs a recording server the page can reach; an https page cannot reach plain http');

  test('outside requests, address worker, blob worker, eval, compile and inline script are all allowed', async ({
    page,
  }) => {
    const probe = await armCspProbe(page);
    const results: Record<string, ControlResult> = {};
    let seen: string[] = [];
    await withPageWithoutPolicy(page, async () => {
      seen = await withOutsideAddress(async (outside) => {
        const outcomes = await outsideRequestOutcomes(page, outside);
        for (const kind of OUTSIDE_KINDS) results[kind] = outcomes[kind];
        results.addressWorker = await addressWorkerOutcome(page);
        const blob = await blobWorkerOutcome(page, outside);
        results.blobWorker = blob;
        expect(blob.inner, `the blob worker's outside fetch goes through with no policy (${blob.detail})`).toBe('sent');
        results.eval = await evalOutcome(page);
        results.wasm = await wasmCompileOutcome(page);
        results.inline = await inlineScriptOutcome(page);
      });
    });
    for (const [name, result] of Object.entries(results)) {
      expect(result.outcome, `with no policy, ${name} must be allowed (${result.detail})`).toBe('allowed');
    }
    expect(seen.length, 'the recording server hears the requests when nothing refuses them').toBeGreaterThan(0);
    expect(probe.findings().map(describeFinding), 'a page with no policy raises no violation').toEqual([]);
  });

  test('a link in a closed preview frame reaches the server when no policy forbids it', async ({ page }) => {
    await armCspProbe(page);
    let seen: string[] = [];
    await withPageWithoutPolicy(page, async () => {
      seen = await withOutsideAddress(async (outside) => {
        await page.evaluate((address) => {
          const frame = document.createElement('iframe');
          frame.setAttribute('sandbox', '');
          frame.srcdoc = `<!doctype html><html><body><a id="go" href="${address}clicked">go</a></body></html>`;
          document.body.append(frame);
        }, outside);
        const link = page.frameLocator('iframe').locator('#go');
        await link.click();
        await page.waitForTimeout(1200);
      });
    });
    expect(seen.length, 'the same click with no policy does reach the server').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The six pages that are not tools.
// ---------------------------------------------------------------------------------------------------------------------

const SITE_PAGES = ['/', '/tools', '/catalog', '/privacy', '/about', '/404.html'] as const;

/**
 * Keeps the visit to the site: a click on a link to another site is answered with an empty page and noted, so the
 * test follows the link without leaving the machine.
 */
async function answerOtherSitesLocally(context: BrowserContext, followed: string[]): Promise<void> {
  const origin = new URL(baseUrl).origin;
  await context.route(
    (url) => url.origin !== origin && /^https?:$/.test(url.protocol),
    (route) => {
      followed.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>elsewhere</title>' });
    },
  );
}

for (const path of SITE_PAGES) {
  test(`${path}: the probe sees nothing while a filter is typed, categories are chosen, the theme is switched and each kind of link is followed`, async ({
    page,
    context,
  }) => {
    const followed: string[] = [];
    await answerOtherSitesLocally(context, followed);
    const probe = await armCspProbe(page);
    await page.goto(rel(path));
    await page.waitForLoadState('networkidle');
    await expectStructure(page, path);

    const search = page.locator('#tool-search');
    if (await search.count()) {
      await search.fill('jwt');
      await expect(page.locator('a.tool-card').first()).toBeVisible();
      await search.fill('');
      const chips = page.locator('.category-filters .chip');
      for (let index = 0; index < (await chips.count()); index += 1) await chips.nth(index).click();
    }

    const toggle = page.locator('button[aria-label^="Switch to"]').first();
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
    await toggle.click();

    // Each kind of link: a link inside the site (a new document), a link to the same page's main area, a link to
    // another site (answered locally above). The page is loaded again after each so the next click starts fresh.
    const kinds = [
      'a[href]:not([href^="http"]):not([href^="#"]):not([href^="mailto"])',
      'a[href^="#"]',
      'a[href^="http"]',
    ];
    for (const selector of kinds) {
      const link = page.locator(selector).first();
      if ((await link.count()) === 0) continue;
      await link.focus();
      await link.click({ noWaitAfter: false }).catch(() => undefined);
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      await page.goto(rel(path));
      await page.waitForLoadState('networkidle');
    }

    await page.waitForTimeout(500);
    expect(probe.findings().map(describeFinding), `${path} raised a violation`).toEqual([]);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The privacy page tells visitors the same true account of the page policy as the project files (HARD-08).
// ---------------------------------------------------------------------------------------------------------------------

test('the privacy page explains the policy of each page, what it blocks first and then what it cannot do', async ({
  page,
}) => {
  await page.goto(rel('/privacy'));
  const heading = page.getByRole('heading', { level: 2, name: 'Each page has its own content security policy' });
  await expect(heading).toBeVisible();
  expect((await heading.innerText()).includes(String.fromCodePoint(0x2014))).toBe(false);

  const text = await page.locator('.prose').innerText();
  const blocks = text.indexOf('What it blocks');
  const limits = text.indexOf('What it cannot do');
  expect(blocks, 'the blocked list is on the page').toBeGreaterThan(-1);
  expect(limits, 'the limits list is on the page').toBeGreaterThan(blocks);
  const section = text.slice(text.indexOf('Each page has its own content security policy'));
  for (const word of ['framing', 'navigating away', 'WebRTC', 'extensions']) {
    expect(section.includes(word), `the section mentions ${word}`).toBe(true);
  }
});
