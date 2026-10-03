import { test, expect, type Page } from '@playwright/test';

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
