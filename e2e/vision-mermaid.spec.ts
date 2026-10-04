import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Behavioural proof of the Mermaid Diagram Renderer (phase 15, VIS-11; D-196, D-202 a, research C1 and C2). Mermaid
 * cannot run in a worker and a busy frame holds the page that owns it, so the page draws each diagram in a NEW iframe
 * with `sandbox="allow-scripts"` and no `allow-same-origin`, whose own policy lets nothing load, checks the text before
 * any frame exists, and checks the drawn SVG before it is shown, exported or rasterised. This spec proves the claims
 * that need a real browser, in all four projects: every one of the 22 diagram types draws, the page requests nothing,
 * the diagram's own title and description reach the text alternative, a syntax error shows the parser's line and never
 * the diagram, the size caps refuse before any frame is made, and each run uses a fresh frame that is gone afterwards.
 *
 * Its own spec file, with its own helpers (copied in shape from e2e/security-secrets.spec.ts and
 * e2e/vision-workers.spec.ts, never imported), so the 22-type run and the hostile runs never rerun with the file specs.
 * No production hook exists: frames are observed from outside with a MutationObserver installed before the page runs.
 */
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    /**
     * What the observer saw. `added` lists every iframe the page put into its document, in order, by the sandbox
     * attribute it was given, whether its document begins with the policy, and its position; `removed` counts the
     * iframes taken out again. `hook` asks the observer to do something the moment a frame is added: `leave`
     * follows the site's home link (the page unmounts, which abandons the run) and `pagehide` dispatches a pagehide event.
     */
    __FODT_MERMAID_FRAMES__?: {
      added: { sandbox: string | null; policyFirst: boolean; position: number }[];
      removed: number;
      hook: 'none' | 'leave' | 'pagehide';
    };
    /** Counts the frames the page asked document.createElement for, installed by `countFrameRequests`. */
    __FODT_MERMAID_CREATED__?: number;
  }
}

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

async function openTool(page: Page): Promise<void> {
  await page.goto(rel('/tools/mermaid-renderer'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/**
 * Fills the diagram field and checks the value stayed. The pages are prerendered, so a field filled in the first moments
 * after load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillAndHold(page: Page, value: string): Promise<void> {
  const field = page.locator('#f-source');
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Starts recording every request the page makes from now on, and returns the live list. */
function recordRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  return requests;
}

/** Presses Run and waits until the run is over: the button says Working while a diagram is drawn and Run again after. */
async function runAndWait(page: Page): Promise<void> {
  await runButtonOf(page).click();
  await expect(runButtonOf(page)).toBeVisible({ timeout: 60_000 });
}

/** The number of iframes in the page's document right now. */
async function frameCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('iframe').length);
}

/**
 * Installs, before any page script runs, an observer of every iframe added to or removed from the document, so the
 * frames the page makes can be counted, inspected at the moment they are added and made to react.
 */
async function observeFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const record: NonNullable<Window['__FODT_MERMAID_FRAMES__']> = { added: [], removed: 0, hook: 'none' };
    window.__FODT_MERMAID_FRAMES__ = record;
    new MutationObserver((changes) => {
      for (const change of changes) {
        for (const node of Array.from(change.removedNodes)) {
          if (node instanceof HTMLIFrameElement) record.removed++;
        }
        for (const node of Array.from(change.addedNodes)) {
          if (!(node instanceof HTMLIFrameElement)) continue;
          record.added.push({
            sandbox: node.getAttribute('sandbox'),
            policyFirst: (node.getAttribute('srcdoc') ?? '').startsWith(
              "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:\">",
            ),
            position: record.added.length,
          });
          if (record.hook === 'pagehide') window.dispatchEvent(new Event('pagehide'));
          if (record.hook === 'leave') (document.querySelector('a.brand') as HTMLAnchorElement).click();
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

/** Counts every iframe the page asks `document.createElement` for, before any page script runs. */
async function countFrameRequests(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__FODT_MERMAID_CREATED__ = 0;
    const original = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      if (String(tag).toLowerCase() === 'iframe')
        window.__FODT_MERMAID_CREATED__ = (window.__FODT_MERMAID_CREATED__ ?? 0) + 1;
      return original(tag, options);
    }) as typeof document.createElement;
  });
}

/**
 * One small sample of each of the 22 diagram types Mermaid 11.17.2 draws, with the type name Mermaid writes on the
 * drawing (its aria-roledescription, which the page shortens and puts in the image's text alternative). Copied from
 * the folder's test fixtures as literals: a spec may not import a tool folder.
 */
const SAMPLES: { name: string; type: string; text: string }[] = [
  {
    name: 'flowchart',
    type: 'flowchart',
    text: 'flowchart TD\n  accTitle: Order flow\n  accDescr: How an order moves from the start to the end\n  A[Start] --> B{Is it?}\n  B -->|Yes| C[OK]\n  B -->|No| D[End]',
  },
  {
    name: 'sequence',
    type: 'sequence',
    text: 'sequenceDiagram\n  title Greeting\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi',
  },
  { name: 'class', type: 'classDiagram', text: 'classDiagram\n  Animal <|-- Duck\n  Animal : +int age' },
  { name: 'state', type: 'stateDiagram', text: 'stateDiagram-v2\n  [*] --> Still\n  Still --> Moving' },
  { name: 'entity relationship', type: 'er', text: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places' },
  {
    name: 'gantt',
    type: 'gantt',
    text: 'gantt\n  title A\n  dateFormat YYYY-MM-DD\n  section S\n  Task :a1, 2024-01-01, 30d',
  },
  {
    name: 'pie',
    type: 'pie',
    text: 'pie title Pets\n  accTitle: Pet share\n  accDescr: Dogs and cats compared\n  "Dogs" : 386\n  "Cats" : 85',
  },
  { name: 'journey', type: 'journey', text: 'journey\n  title My day\n  section Work\n    Make tea: 5: Me' },
  {
    name: 'git graph',
    type: 'gitGraph',
    text: 'gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev',
  },
  { name: 'mind map', type: 'mindmap', text: 'mindmap\n  root((mind))\n    Origins\n    Tools' },
  { name: 'timeline', type: 'timeline', text: 'timeline\n  title History\n  2002 : LinkedIn\n  2004 : Facebook' },
  {
    name: 'quadrant',
    type: 'quadrantChart',
    text: 'quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Low --> High\n  quadrant-1 We\n  A: [0.3, 0.6]',
  },
  {
    name: 'requirement',
    type: 'requirement',
    text: 'requirementDiagram\n  requirement test_req {\n    id: 1\n    text: the test text.\n    risk: high\n    verifymethod: test\n  }\n  element test_entity {\n    type: simulation\n  }\n  test_entity - satisfies -> test_req',
  },
  {
    name: 'C4',
    type: 'c4',
    text: 'C4Context\n  title System\n  Person(a, "User")\n  System(b, "Sys")\n  Rel(a, b, "Uses")',
  },
  { name: 'Sankey', type: 'sankey', text: 'sankey-beta\n\nA,B,10\nB,C,5' },
  {
    name: 'XY chart',
    type: 'xychart',
    text: 'xychart-beta\n  title "Sales"\n  x-axis [jan, feb]\n  y-axis "Rev" 0 --> 100\n  bar [10, 50]\n  line [10, 50]',
  },
  { name: 'block', type: 'block', text: 'block-beta\n  columns 2\n  a b' },
  { name: 'packet', type: 'packet', text: 'packet-beta\n  0-15: "Source Port"\n  16-31: "Destination Port"' },
  { name: 'Kanban', type: 'kanban', text: 'kanban\n  Todo\n    id1[Task 1]' },
  {
    name: 'architecture',
    type: 'architecture',
    text: 'architecture-beta\n  group api(cloud)[API]\n  service db(database)[Database] in api\n  service s(server)[Server] in api\n  db:L -- R:s',
  },
  { name: 'radar', type: 'radar', text: 'radar-beta\n  axis a, b, c\n  curve x{1,2,3}' },
  { name: 'treemap', type: 'treemap', text: 'treemap-beta\n"Root"\n    "Leaf": 10' },
];

test('mermaid-renderer: every diagram type renders inside the locked frame and the page requests nothing', async ({
  page,
}) => {
  test.setTimeout(240_000);
  expect(SAMPLES).toHaveLength(22);
  await observeFrames(page);
  await openTool(page);
  // Recorded only after the page and its own chunk have loaded, so this asserts nothing is requested while the
  // diagrams are drawn, checked and shown.
  const requests = recordRequests(page);
  // Text that merely looks like an address, a line break written as a tag, letters of several scripts and a title in
  // the frontmatter are drawn as text: the checks must not refuse them.
  const extras = [
    {
      name: 'an address written as a label',
      type: 'flowchart',
      text: 'flowchart LR\n  A["see https://example.com/x?a=1 and //host/path"] --> B',
    },
    {
      name: 'a tag and several scripts',
      type: 'flowchart',
      text: 'flowchart LR\n  A["first line<br/>second line"] --> B["Zoë ✓ 日本語 😀"]',
    },
    {
      name: 'frontmatter and a comment',
      type: 'flowchart',
      text: '---\ntitle: A heading\n---\n%% a comment\nflowchart LR\n  A --> B',
    },
  ];
  for (const sample of [...SAMPLES, ...extras]) {
    await fillAndHold(page, sample.text);
    await runAndWait(page);
    const image = outputArea(page).locator('img').first();
    await expect(image, sample.name).toHaveAttribute('alt', new RegExp(`^Mermaid ${sample.type} diagram`), {
      timeout: 30_000,
    });
    // The image really decoded, the SVG text is beside it, and no frame is left in the page.
    expect(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), sample.name).toBe(
      true,
    );
    await expect(outputArea(page).locator('pre')).toContainText('<svg', { timeout: 5_000 });
    expect(await frameCount(page), sample.name).toBe(0);
    await expect(outputArea(page).locator('.issue-list')).toHaveCount(0);
  }
  // One frame per run, each removed.
  const frames = await page.evaluate(() => window.__FODT_MERMAID_FRAMES__!);
  expect(frames.added).toHaveLength(SAMPLES.length + extras.length);
  expect(frames.removed).toBe(frames.added.length);
  // Nothing was requested but data and blob addresses (images shown from data addresses).
  expect(requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'))).toEqual([]);
});

test('mermaid-renderer: the diagram title and description reach the image text and the page', async ({ page }) => {
  await openTool(page);
  await fillAndHold(page, SAMPLES[0]!.text);
  await runAndWait(page);
  const image = outputArea(page).locator('img').first();
  await expect(image).toHaveAttribute(
    'alt',
    'Mermaid flowchart diagram: Order flow. How an order moves from the start to the end',
    { timeout: 30_000 },
  );
  // Listed as text beside the image, and present in the SVG text as the diagram's own title and description.
  const listed = outputArea(page).locator('.output-block').filter({ hasText: 'Title and description' });
  await expect(listed).toContainText('Title: Order flow');
  await expect(listed).toContainText('Description: How an order moves from the start to the end');
  const svgText = outputArea(page).locator('pre').first();
  await expect(svgText).toContainText('>Order flow</title>');
  await expect(svgText).toContainText('>How an order moves from the start to the end</desc>');

  // A pie chart carries its own pair too, and a diagram with neither has no such list.
  await fillAndHold(page, SAMPLES[6]!.text);
  await runAndWait(page);
  await expect(image).toHaveAttribute('alt', 'Mermaid pie diagram: Pet share. Dogs and cats compared', {
    timeout: 30_000,
  });
  await expect(outputArea(page)).toContainText('Title: Pet share');

  await fillAndHold(page, 'flowchart LR\n  A --> B');
  await runAndWait(page);
  await expect(image).toHaveAttribute('alt', 'Mermaid flowchart diagram', { timeout: 30_000 });
  await expect(outputArea(page)).not.toContainText('Title and description');

  // A title written in the frontmatter names the image too.
  await fillAndHold(page, '---\ntitle: Frontmatter heading\n---\nflowchart LR\n  A --> B');
  await runAndWait(page);
  await expect(image).toHaveAttribute('alt', 'Mermaid flowchart diagram: Frontmatter heading', { timeout: 30_000 });

  // A title with a colon in it is drawn, not refused as unreadable YAML, and the colon stays in the title.
  await fillAndHold(page, '---\ntitle: Plan: phase 1\n---\nflowchart LR\n  A --> B');
  await runAndWait(page);
  await expect(image).toHaveAttribute('alt', 'Mermaid flowchart diagram: Plan: phase 1', { timeout: 30_000 });
  await expect(outputArea(page).locator('.issue-list')).toHaveCount(0);
  await expect(outputArea(page).locator('pre').first()).toContainText('Plan: phase 1');
});

test('mermaid-renderer: a syntax error shows the parser line and none of the diagram text', async ({ page }) => {
  test.setTimeout(120_000);
  const marker = 'FODT-MARKER-Q7';
  const consoleMessages: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  await openTool(page);
  const issues = outputArea(page).locator('.issue-list');

  const cases: { name: string; text: string; message: RegExp }[] = [
    {
      name: 'a broken second line of a flowchart',
      text: `flowchart LR\n  A[${marker} --> B\n  B --> C`,
      message: /^Line 2: the diagram could not be read\. Expecting '/,
    },
    {
      name: 'a broken line after blank lines, comments and frontmatter counts the pasted lines',
      text: `\n\n---\ntitle: T\n---\n%% a comment\nflowchart LR\n  A --> B\n  C[${marker} -->`,
      message: /^Line 9: the diagram could not be read\. Expecting '/,
    },
    {
      name: 'a pie chart, which a different parser reads',
      text: `pie title Pets\n  "a" : 5\n  "b-${marker}" 7`,
      message: /^Line 3: the diagram could not be read\. Expecting token of type ':'$/,
    },
    {
      name: 'a pie chart the lexer cannot read',
      text: `pie\n  "a" : ${marker}`,
      message: /^Line 2: the diagram could not be read\.$/,
    },
    {
      name: 'a sequence diagram',
      text: `sequenceDiagram\n  Alice->>Bob: Hi\n  ${marker}`,
      message: /^Line 3: the diagram could not be read\. Expecting '/,
    },
    {
      name: 'a first line that names no diagram type',
      text: `hello ${marker}\n  A --> B`,
      message: /^The first line does not name a diagram type this page can draw/,
    },
    {
      name: 'a settings line',
      text: `flowchart LR\n  A --> B\n  %%{init: {"theme": "${marker}"}}%%`,
      message: /^Line 3: settings directives are not supported here\.$/,
    },
    {
      name: 'frontmatter beyond a title',
      text: `---\nconfig:\n  theme: ${marker}\n---\nflowchart LR\n  A --> B`,
      message: /^Line 2: only a title is allowed in the frontmatter\.$/,
    },
    {
      name: 'a click line',
      text: `flowchart LR\n  A --> B\n  click A href "https://example.com/${marker}"`,
      message: /^Line 3: click and link lines are not supported here/,
    },
    {
      name: 'an image shape',
      text: `flowchart LR\n  A@{ img: "https://example.com/${marker}.png", label: "x" }`,
      message: /^Line 2: image shapes are not supported here\.$/,
    },
    {
      name: 'math',
      text: `flowchart LR\n  A["$$${marker}$$"]`,
      message: /^Line 2: math is not supported here\.$/,
    },
  ];
  for (const c of cases) {
    await fillAndHold(page, c.text);
    await runAndWait(page);
    await expect(issues, c.name).toContainText('.', { timeout: 30_000 });
    const message = (await issues.innerText()).trim();
    expect(message, c.name).toMatch(c.message);
    // Never the diagram: not in the message, and no output block is drawn.
    expect(message, c.name).not.toContain(marker);
    expect(await outputArea(page).locator('img').count(), c.name).toBe(0);
    expect(await frameCount(page), c.name).toBe(0);
    expect((await outputArea(page).innerText()).includes(marker), c.name).toBe(false);
    // The message is capped.
    expect(message.length, c.name).toBeLessThanOrEqual(260);
  }

  // The marker reached nowhere else: not the address, the title, any storage, a cookie or the console.
  expect(page.url()).not.toContain(marker);
  expect(await page.title()).not.toContain(marker);
  const stored = await page.evaluate(() => ({
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage)),
    cookie: document.cookie,
  }));
  expect(stored.local + stored.session + stored.cookie).not.toContain(marker);
  expect(consoleMessages.filter((text) => text.includes(marker))).toEqual([]);
});

test('mermaid-renderer: a diagram over the size caps is refused before any frame is made', async ({ page }) => {
  test.setTimeout(120_000);
  await countFrameRequests(page);
  await observeFrames(page);
  await openTool(page);
  const issues = outputArea(page).locator('.issue-list');

  const tooLong = `flowchart LR\n  A["${'x'.repeat(20_000)}"] --> B`;
  await fillAndHold(page, tooLong);
  await runAndWait(page);
  await expect(issues).toContainText(
    `This diagram is ${tooLong.length} characters. The limit is 20,000 because a large diagram can freeze this page while it is drawn.`,
  );
  const tooManyLines = `flowchart LR\n${Array.from({ length: 300 }, () => '  A --> B').join('\n')}`;
  expect(tooManyLines.split('\n')).toHaveLength(301);
  await fillAndHold(page, tooManyLines);
  await runAndWait(page);
  await expect(issues).toContainText('This diagram has 301 lines. The limit is 300 because');
  // Neither refusal asked for a frame, and none exists.
  expect(await page.evaluate(() => window.__FODT_MERMAID_CREATED__)).toBe(0);
  expect(await page.evaluate(() => window.__FODT_MERMAID_FRAMES__!.added.length)).toBe(0);
  expect(await frameCount(page)).toBe(0);

  // One line fewer is accepted and drawn: the cap is on the 301st line, not a general slowness.
  const atTheCap = `flowchart LR\n${Array.from({ length: 299 }, (_, i) => `  N${i} --> N${i + 1}`).join('\n')}`;
  expect(atTheCap.split('\n')).toHaveLength(300);
  await fillAndHold(page, atTheCap);
  await runAndWait(page);
  await expect(outputArea(page).locator('img').first()).toHaveAttribute('alt', /^Mermaid flowchart diagram/, {
    timeout: 60_000,
  });
  expect(await page.evaluate(() => window.__FODT_MERMAID_CREATED__)).toBe(1);
  expect(await frameCount(page)).toBe(0);
});

test('mermaid-renderer: a fence or click line led by a blank the engine also reads is refused with its own message before any frame', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await countFrameRequests(page);
  await observeFrames(page);
  await openTool(page);
  const issues = outputArea(page).locator('.issue-list');
  // Built at run time: an em space, a vertical tab and an ideographic space are invisible in a source file.
  const emSpace = String.fromCodePoint(0x2003);
  const verticalTab = String.fromCodePoint(0x0b);
  const ideographic = String.fromCodePoint(0x3000);
  const settings = 'config:\n  look: handDrawn\n  themeCSS: "a"';
  const cases: { name: string; text: string; message: RegExp }[] = [
    {
      name: 'a fence ending in an em space',
      text: `---${emSpace}\n${settings}\n---\nflowchart LR\n  A --> B`,
      message: /^Line 2: only a title is allowed in the frontmatter\.$/,
    },
    {
      name: 'a fence ending in a vertical tab',
      text: `---${verticalTab}\n${settings}\n---\nflowchart LR\n  A --> B`,
      message: /^Line 2: only a title is allowed in the frontmatter\.$/,
    },
    {
      name: 'a click line led by an ideographic space',
      text: `flowchart LR\n  A --> B\n${ideographic}click A href "http://127.0.0.1:9/x"`,
      message: /^Line 3: click and link lines are not supported here/,
    },
    {
      name: 'a click line led by an em space',
      text: `flowchart LR\n  A --> B\n${emSpace}click A href "http://127.0.0.1:9/x"`,
      message: /^Line 3: click and link lines are not supported here/,
    },
    {
      name: 'a click line led by a vertical tab',
      text: `flowchart LR\n  A --> B\n${verticalTab}click A href "http://127.0.0.1:9/x"`,
      message: /^Line 3: click and link lines are not supported here/,
    },
  ];
  for (const c of cases) {
    await fillAndHold(page, c.text);
    await runAndWait(page);
    await expect(issues, c.name).toContainText('.', { timeout: 30_000 });
    expect((await issues.innerText()).trim(), c.name).toMatch(c.message);
    expect(await outputArea(page).locator('img').count(), c.name).toBe(0);
  }
  // Every one was stopped by the check made before any frame exists, not by the scrub of a drawn picture.
  expect(await page.evaluate(() => window.__FODT_MERMAID_CREATED__)).toBe(0);
  expect(await page.evaluate(() => window.__FODT_MERMAID_FRAMES__!.added.length)).toBe(0);
  expect(await frameCount(page)).toBe(0);
});

test('mermaid-renderer: one very long line of words is refused by the check made before any frame, naming the line', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await countFrameRequests(page);
  await observeFrames(page);
  await openTool(page);
  const issues = outputArea(page).locator('.issue-list');
  // About 3,000 words on one line (15,000 characters) is under both whole-diagram caps but overflows the engine's stack
  // in Chromium. The line cap refuses it here, so no frame is ever asked to draw it.
  const words = Array.from({ length: 3000 }, () => 'word').join(' ');
  await fillAndHold(page, `flowchart TD\n  A["${words}"] --> B`);
  await runAndWait(page);
  await expect(issues).toContainText('.', { timeout: 30_000 });
  const message = (await issues.innerText()).trim();
  expect(message).toMatch(/^Line 2: this line is \d+ characters\. The limit is 2,000 characters on one line because/);
  expect(message).not.toContain('word');
  expect(await outputArea(page).locator('img').count()).toBe(0);
  expect(await page.evaluate(() => window.__FODT_MERMAID_CREATED__)).toBe(0);
  expect(await page.evaluate(() => window.__FODT_MERMAID_FRAMES__!.added.length)).toBe(0);
  expect(await frameCount(page)).toBe(0);
});

test('mermaid-renderer: each Run uses a fresh frame that is gone afterwards', async ({ page }) => {
  test.setTimeout(120_000);
  await observeFrames(page);
  await openTool(page);

  // Two runs, two frames: each built with only allow-scripts and a document that begins with its policy, each removed.
  await fillAndHold(page, 'flowchart LR\n  A --> B');
  await runAndWait(page);
  await expect(outputArea(page).locator('img').first()).toHaveAttribute('alt', /^Mermaid flowchart diagram/, {
    timeout: 30_000,
  });
  await fillAndHold(page, 'sequenceDiagram\n  Alice->>Bob: Hi');
  await runAndWait(page);
  await expect(outputArea(page).locator('img').first()).toHaveAttribute('alt', /^Mermaid sequence diagram/, {
    timeout: 30_000,
  });
  const frames = await page.evaluate(() => window.__FODT_MERMAID_FRAMES__!);
  expect(frames.added).toEqual([
    { sandbox: 'allow-scripts', policyFirst: true, position: 0 },
    { sandbox: 'allow-scripts', policyFirst: true, position: 1 },
  ]);
  expect(frames.removed).toBe(2);
  expect(await frameCount(page)).toBe(0);

  // Leaving the page while the frame is starting abandons the run, and the frame goes with it. The observer follows the
  // site's home link the moment the frame is added, so the tool page unmounts before the engine has started.
  await fillAndHold(page, 'flowchart LR\n  C --> D');
  await page.evaluate(() => {
    window.__FODT_MERMAID_FRAMES__!.hook = 'leave';
  });
  await runButtonOf(page).click();
  await expect.poll(() => page.evaluate(() => window.__FODT_MERMAID_FRAMES__!.removed), { timeout: 30_000 }).toBe(3);
  expect(await frameCount(page)).toBe(0);
  expect(await page.evaluate(() => window.__FODT_MERMAID_FRAMES__!.added.length)).toBe(3);
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.__FODT_MERMAID_FRAMES__!.hook = 'none';
  });
  await page.goBack();
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();

  // A pagehide while the frame is starting removes it too, and a later run works.
  await page.evaluate(() => {
    window.__FODT_MERMAID_FRAMES__!.hook = 'pagehide';
  });
  await fillAndHold(page, 'flowchart LR\n  E --> F');
  await runAndWait(page);
  await expect.poll(() => page.evaluate(() => window.__FODT_MERMAID_FRAMES__!.removed), { timeout: 30_000 }).toBe(4);
  await expect(outputArea(page).locator('img')).toHaveCount(0);
  expect(await frameCount(page)).toBe(0);
  await page.evaluate(() => {
    window.__FODT_MERMAID_FRAMES__!.hook = 'none';
  });
  await runAndWait(page);
  await expect(outputArea(page).locator('img').first()).toHaveAttribute('alt', /^Mermaid flowchart diagram/, {
    timeout: 30_000,
  });
  expect(await page.evaluate(() => window.__FODT_MERMAID_FRAMES__!.added.length)).toBe(5);
  expect(await page.evaluate(() => window.__FODT_MERMAID_FRAMES__!.removed)).toBe(5);
  expect(await frameCount(page)).toBe(0);
});

/**
 * Runs `body` with the address of a local HTTP server that records every request it receives, then waits a moment for a
 * stray request to land, and returns what the server saw. A diagram that names this server in an image, a link, a
 * style or a font would show up here if the engine, the frame or the page requested it. Written here, the shape copied
 * from e2e/security-secrets.spec.ts.
 */
async function withRecordingServer(body: (address: string) => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await body(`http://127.0.0.1:${port}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return seen;
}

/**
 * 19 hostile diagrams. `{ADDRESS}` stands for the local recording server. Each is refused before drawing, fails to
 * parse, or is drawn and checked, and none may make a single request. `outcome` is what the page does with it today:
 * a refusal by the check made before any frame exists, a parse error the engine reports, or a drawing.
 */
const ATTACKS: { name: string; text: string; outcome: 'refused' | 'parse-error' | 'drawn' }[] = [
  {
    name: 'an image in a label',
    text: `flowchart LR\n  A["<img src='{ADDRESS}/img-label.png'>"]`,
    outcome: 'drawn',
  },
  {
    name: 'a fill that names an address',
    text: `flowchart LR\n  A --> B\n  style A fill:url({ADDRESS}/x.svg#a),background:url({ADDRESS}/bg.png)`,
    outcome: 'parse-error',
  },
  {
    name: 'a class definition that names an address',
    text: `flowchart LR\n  A --> B\n  classDef x fill:url({ADDRESS}/cd.png),stroke:red\n  class A x`,
    outcome: 'parse-error',
  },
  {
    name: 'a theme style with an import and an address',
    text: `%%{init: {"themeCSS": "@import url({ADDRESS}/css-import.css); .node{background:url({ADDRESS}/css-bg.png)}"}}%%\nflowchart LR\n  A-->B`,
    outcome: 'refused',
  },
  {
    name: 'a font family that names an address',
    text: `%%{init: {"fontFamily": "x; background:url({ADDRESS}/ff.png)"}}%%\nflowchart LR\n  A-->B`,
    outcome: 'refused',
  },
  {
    name: 'a theme style in the frontmatter',
    text: `---\nconfig:\n  themeCSS: "@import url({ADDRESS}/fm.css);"\n---\nflowchart LR\n  A-->B`,
    outcome: 'refused',
  },
  {
    name: 'a click line with an address',
    text: `flowchart LR\n  A-->B\n  click A href "{ADDRESS}/click" _blank`,
    outcome: 'refused',
  },
  {
    name: 'an image shape',
    text: `flowchart LR\n  A@{ img: "{ADDRESS}/node-img.png", label: "x", pos: "t", w: 60, h: 60, constraint: "on" }`,
    outcome: 'refused',
  },
  {
    name: 'an icon from an unregistered pack',
    text: `flowchart LR\n  A@{ icon: "logos:aws", form: "square", label: "x" }`,
    outcome: 'drawn',
  },
  {
    name: 'a markdown image in a label',
    text: 'flowchart LR\n  A["`![img]({ADDRESS}/md.png)`"]',
    outcome: 'drawn',
  },
  {
    name: 'an image in a sequence participant',
    text: `sequenceDiagram\n  participant A as <img src="{ADDRESS}/seq.png">\n  A->>A: x`,
    outcome: 'drawn',
  },
  {
    name: 'a link line in a sequence diagram',
    text: `sequenceDiagram\n  participant A\n  link A: Dash @ {ADDRESS}/link\n  A->>A: x`,
    outcome: 'refused',
  },
  { name: 'math in a label', text: 'flowchart LR\n  A["$$x^2 + a/b$$"]', outcome: 'refused' },
  {
    name: 'an icon in an architecture diagram',
    text: `architecture-beta\n  service s(logos:aws)[S]\n  service t(server)[T]\n  s:R -- L:t`,
    outcome: 'drawn',
  },
  {
    name: 'font icons in labels',
    text: 'flowchart LR\n  A["fa:fa-car Car"] --> B["fab:fa-github G"]',
    outcome: 'drawn',
  },
  {
    name: 'a link in a label',
    text: `flowchart LR\n  A["<a href='{ADDRESS}/a'>x</a>"]`,
    outcome: 'drawn',
  },
  { name: 'a script in a label', text: 'flowchart LR\n  A["<script>window.top.x=1</script>x"]', outcome: 'drawn' },
  { name: 'an error handler in a label', text: 'flowchart LR\n  A["<img src=x onerror=alert(1)>"]', outcome: 'drawn' },
  {
    name: 'an svg image in a label',
    text: `flowchart LR\n  A["<svg><image href='{ADDRESS}/svgimg.png'></svg>"]`,
    outcome: 'drawn',
  },
];

test('mermaid-renderer: hostile diagrams are refused or drawn without a single request reaching a local server', async ({
  page,
}) => {
  test.setTimeout(240_000);
  expect(ATTACKS).toHaveLength(19);
  await observeFrames(page);
  const seen = await withRecordingServer(async (address) => {
    await openTool(page);
    // Recorded only after the page and its own chunk have loaded.
    const requests = recordRequests(page);
    const issues = outputArea(page).locator('.issue-list');
    const results: string[] = [];
    for (const attack of ATTACKS) {
      await fillAndHold(page, attack.text.split('{ADDRESS}').join(address));
      await runAndWait(page);
      if (attack.outcome === 'drawn') {
        const image = outputArea(page).locator('img').first();
        await expect(image, attack.name).toHaveAttribute('alt', /^Mermaid /, { timeout: 30_000 });
        // What was drawn holds no element that loads or runs anything, and no address in an attribute.
        const svg = await outputArea(page).locator('pre').first().innerText();
        expect(svg, attack.name).not.toMatch(/<(script|image|img|a|iframe|link|use)[\s>/]/i);
        // Tag-scoped: a label may show the words of an attack as text, which is not an attribute.
        expect(svg, attack.name).not.toMatch(/<[^<>]*\son[a-z]+\s*=/i);
        expect(svg, attack.name).not.toMatch(/<[^<>]*\s(xlink:)?href\s*=\s*["'](?!#)/i);
        expect(svg, attack.name).not.toMatch(/url\(\s*["']?(?!#)/i);
        expect(svg, attack.name).not.toContain('@import');
        results.push(`${attack.name}: drawn`);
      } else {
        await expect(issues, attack.name).toBeVisible({ timeout: 30_000 });
        const message = (await issues.innerText()).trim();
        if (attack.outcome === 'refused') {
          expect(message, attack.name).toMatch(
            /^Line \d+: (settings directives|only a title|click and link lines|image shapes|math) /,
          );
        } else {
          expect(message, attack.name).toMatch(/^Line \d+: the diagram could not be read\./);
        }
        expect(await outputArea(page).locator('img').count(), attack.name).toBe(0);
        results.push(`${attack.name}: ${attack.outcome}`);
      }
      expect(await frameCount(page), attack.name).toBe(0);
    }
    expect(results).toHaveLength(19);
    // The page itself requested nothing but data and blob addresses.
    expect(requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:'))).toEqual([]);
  });
  // The server every one of the 19 diagrams names saw no request at all.
  expect(seen).toEqual([]);
  // One frame was made for each diagram that got past the check made before drawing.
  const frames = await page.evaluate(() => window.__FODT_MERMAID_FRAMES__!);
  expect(frames.added).toHaveLength(ATTACKS.filter((attack) => attack.outcome !== 'refused').length);
  expect(frames.removed).toBe(frames.added.length);
});

test('mermaid-renderer: the recording server sees a request a plain page makes, so its silence means something', async ({
  page,
}) => {
  const control = await withRecordingServer(async (address) => {
    await openTool(page);
    await page.evaluate((target) => fetch(target, { mode: 'no-cors' }).then(() => undefined), `${address}/control`);
  });
  expect(control).toEqual(['GET /control']);
  // And an image the page's own document asks for is seen too, as the engine's images would be without the frame's policy.
  const image = await withRecordingServer(async (address) => {
    await openTool(page);
    await page.evaluate(
      (target) =>
        new Promise<void>((resolve) => {
          const probe = new Image();
          probe.onload = () => resolve();
          probe.onerror = () => resolve();
          probe.src = target;
        }),
      `${address}/control-image.png`,
    );
  });
  expect(image.length).toBeGreaterThan(0);
  expect(new Set(image)).toEqual(new Set(['GET /control-image.png']));
});

/** The width and height written in a PNG's header, and the signature that says it is a PNG. */
function pngHeader(bytes: Buffer): { signature: boolean; width: number; height: number } {
  const signature = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { signature, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('mermaid-renderer: PNG export draws the diagram at the chosen scale and offers diagram.png', async ({ page }) => {
  test.setTimeout(180_000);
  await countFrameRequests(page);
  await openTool(page);
  // The scale field belongs to PNG: it is not there for SVG.
  await expect(page.locator('#f-scale')).toHaveCount(0);
  await page.locator('input[name="format"][value="png"]').click();
  await expect(page.locator('#f-scale')).toBeVisible();

  const cases = [
    { scale: 2, name: 'flowchart', text: SAMPLES[0]!.text },
    { scale: 1, name: 'sequence diagram', text: SAMPLES[1]!.text },
    { scale: 3, name: 'pie chart', text: SAMPLES[6]!.text },
    // A journey diagram holds foreign objects, which some browsers refuse to read back from a canvas when they come
    // from a blob address; from a data address they must work.
    { scale: 1, name: 'journey', text: SAMPLES[7]!.text },
    { scale: 4, name: 'flowchart at scale 4', text: SAMPLES[0]!.text },
  ];
  for (const c of cases) {
    await fillAndHold(page, c.text);
    await page.locator('#f-scale').fill(String(c.scale));
    await runAndWait(page);
    await expect(outputArea(page).locator('li').filter({ hasText: 'diagram.png' }), c.name).toBeVisible({
      timeout: 30_000,
    });
    // The size the SVG states for itself, times the scale, rounded up, is the size of the PNG.
    const svgText = await outputArea(page).locator('pre').first().innerText();
    const box = /viewBox="([^"]*)"/
      .exec(svgText)?.[1]
      ?.split(/[\s,]+/)
      .map(Number);
    expect(box, c.name).toHaveLength(4);
    const width = Math.ceil(box![2]! * c.scale);
    const height = Math.ceil(box![3]! * c.scale);
    await expect(outputArea(page), c.name).toContainText(`PNG size ${width} × ${height} px`);

    const downloading = page.waitForEvent('download');
    await outputArea(page)
      .locator('li')
      .filter({ hasText: 'diagram.png' })
      .getByRole('button', { name: 'Download' })
      .click();
    const download = await downloading;
    expect(download.suggestedFilename(), c.name).toBe('diagram.png');
    const bytes = readFileSync((await download.path())!);
    expect(pngHeader(bytes), c.name).toEqual({ signature: true, width, height });

    // Decoded again by the browser, the picture has the stated size and is not one flat colour.
    const decoded = await page.evaluate(async (base64) => {
      const raw = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colours = new Set<number>();
      for (let i = 0; i < pixels.length && colours.size < 8; i += 4) {
        colours.add((pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!);
      }
      return { width: bitmap.width, height: bitmap.height, colours: colours.size };
    }, bytes.toString('base64'));
    expect(decoded.width, c.name).toBe(width);
    expect(decoded.height, c.name).toBe(height);
    expect(decoded.colours, c.name).toBeGreaterThan(2);
    expect(await frameCount(page), c.name).toBe(0);
  }

  // A scale outside 1 to 4 is refused with the field's name and range before any frame is made.
  const before = await page.evaluate(() => window.__FODT_MERMAID_CREATED__);
  for (const bad of ['5', '0', '2.5', '-1000000']) {
    await page.locator('#f-scale').fill(bad);
    await runAndWait(page);
    await expect(outputArea(page).locator('.issue-list'), bad).toContainText(
      'PNG scale must be a whole number from 1 to 4.',
    );
  }
  expect(await page.evaluate(() => window.__FODT_MERMAID_CREATED__)).toBe(before);
});

test('mermaid-renderer: a PNG over the size cap keeps the SVG and says why the PNG is missing', async ({ page }) => {
  test.setTimeout(120_000);
  await openTool(page);
  await page.locator('input[name="format"][value="png"]').click();
  await page.locator('#f-scale').fill('4');
  // About 40 boxes in a row: wide enough that four times its width is far over the 8,192 pixel side limit.
  const row = Array.from({ length: 40 }, (_, i) => `  N${i}[Step number ${i}] --> N${i + 1}[Step number ${i + 1}]`);
  await fillAndHold(page, `flowchart LR\n${row.join('\n')}`);
  await runAndWait(page);
  const output = outputArea(page);
  // The SVG outputs are still there: the picture, its text and the SVG stats.
  await expect(output.locator('img').first()).toHaveAttribute('alt', /^Mermaid flowchart diagram/, { timeout: 30_000 });
  await expect(output.locator('pre').first()).toContainText('<svg');
  await expect(output).toContainText('SVG size');
  // The PNG message stands as a warning, not as an input problem, and there is no PNG to download.
  await expect(output.locator('.note-warn')).toContainText(
    /The PNG would be \d+ by \d+ pixels\. The limit is 16,000,000 pixels and 8,192 on a side; choose a smaller scale\./,
  );
  await expect(output.locator('.issue-list')).toHaveCount(0);
  await expect(output.locator('li').filter({ hasText: 'diagram.png' })).toHaveCount(0);
  await expect(output).not.toContainText('PNG size');

  // A smaller scale gives the PNG, and the warning is gone.
  await page.locator('#f-scale').fill('1');
  await runAndWait(page);
  await expect(output.locator('li').filter({ hasText: 'diagram.png' })).toBeVisible({ timeout: 30_000 });
  await expect(output.locator('.note-warn')).toHaveCount(0);
});
