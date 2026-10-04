import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';

/**
 * Behavioural proof, for the developer tools of phase 16, that the page gives the same answers as an independent
 * oracle in every browser: each test enters recorded cases on the page the way a visitor would and compares what the
 * page shows, row by row, with what the oracle computes in the test process. Read in four browser projects: chromium,
 * firefox, webkit and mobile-chrome (the Pixel 7 emulation).
 *
 * The oracle for the Semantic Version Range Checker & Sorter is npm's own semver package, version 7.8.5, loaded here
 * from the tool folder's own node_modules (an independent run of the package in the test process, never the page's
 * build), so a wrong option wiring, a lost value or a hidden field that leaks into a result shows up as a difference.
 * The plans that follow append one test per tool to this file: the docker run converter (16-04), the web app manifest
 * builder (16-05), the IDN converter (16-06) and the date calculator (16-08).
 *
 * A spec of its own, with its own helpers copied in shape from e2e/security-secrets.spec.ts and e2e/dev-workers.spec.ts,
 * because a shared test helper would make every importing spec run whole for every tool.
 */
const rel = (path: string) => path.replace(/^\//, '');

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

async function openTool(page: Page, id: string): Promise<void> {
  await page.goto(rel(`/tools/${id}`));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/**
 * Fills a field and checks the value stayed. The pages are prerendered, so a field filled in the first moments after
 * load can be cleared again when the page finishes starting; the fill is repeated until it holds.
 */
async function fillAndHold(page: Page, name: string, value: string): Promise<void> {
  const field = page.locator(`#f-${name}`);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

interface SemverOptions {
  loose?: boolean;
  includePrerelease?: boolean;
}

/** The parts of npm's semver package the test uses, from the package folder of the tool (not from the page). */
interface SemverOracle {
  satisfies: (version: string, range: string, options: SemverOptions) => boolean;
  valid: (version: string, options: SemverOptions) => string | null;
  maxSatisfying: (versions: string[], range: string, options: SemverOptions) => string | null;
  minVersion: (range: string, options: SemverOptions) => { version: string } | null;
  compare: (a: string, b: string, options: SemverOptions) => number;
  Range: new (range: string, options: SemverOptions) => { range: string };
}

const semverRequire = createRequire(new URL('../tools/semver-checker/package.json', import.meta.url));
const semver = semverRequire('semver') as SemverOracle;
const semverVersion = (semverRequire('semver/package.json') as { version: string }).version;

interface Batch {
  range: string;
  loose: boolean;
  includePrerelease: boolean;
  versions: string[];
}

/**
 * The recorded checks: 6 batches of 5 versions, 30 (range, version, options) checks in all, chosen at and around the
 * boundaries of caret, tilde, hyphen, x and alternative ranges, with pre-releases, build metadata, loose forms and a
 * line that is not a version. Only inputs are recorded here; every expected answer is computed by the oracle.
 */
const BATCHES: Batch[] = [
  {
    range: '^1.2.3',
    loose: false,
    includePrerelease: false,
    versions: ['1.2.2', '1.2.3', '1.9.9', '2.0.0', '2.0.0-alpha'],
  },
  {
    range: '^1.2.3',
    loose: false,
    includePrerelease: true,
    versions: ['1.2.4-beta.1', '1.2.3-beta.2', '1.3.0', '2.0.0-0', '1.2.2-9'],
  },
  {
    range: '~1.2.3-beta.1 || >=4.0.0 <5.0.0',
    loose: false,
    includePrerelease: false,
    versions: ['1.2.3-beta.2', '1.2.4-beta.1', '1.2.9', '4.5.6', '5.0.0'],
  },
  {
    range: '1.2.3 - 2.3.4',
    loose: false,
    includePrerelease: false,
    versions: ['1.2.3', '2.3.4', '2.3.5', '1.2.3-pre', '0.0.0'],
  },
  {
    range: '>1.x || <=0.5',
    loose: true,
    includePrerelease: false,
    versions: ['=1.5.0', 'v2.0.0', '0.5.0', '0.5.1', '1.0.0beta'],
  },
  {
    range: '*',
    loose: true,
    includePrerelease: true,
    versions: ['0.0.0', '1.0.0-beta', 'not-a-version', '1.2', '2.0.0+build.5'],
  },
];

/** What the oracle says a page should show for one batch: the answer for each line and the summary values. */
function expectedFor(batch: Batch) {
  const options: SemverOptions = { loose: batch.loose, includePrerelease: batch.includePrerelease };
  const rows = batch.versions.map((version, index) => [
    String(index + 1),
    version,
    semver.valid(version, options) === null
      ? 'not a valid version'
      : semver.satisfies(version, batch.range, options)
        ? 'satisfies'
        : 'does not satisfy',
  ]);
  const validVersions = batch.versions.filter((version) => semver.valid(version, options) !== null);
  return {
    rows,
    normalized: new semver.Range(batch.range, options).range || '*',
    highest: semver.maxSatisfying(validVersions, batch.range, options) ?? 'none of the pasted versions satisfy it',
    lowest: semver.minVersion(batch.range, options)?.version ?? 'none, this range allows no version',
  };
}

/** What the page shows in check mode: the summary pairs and every row of the result table. */
async function readCheck(page: Page): Promise<{ pairs: Record<string, string>; rows: string[][] }> {
  return outputArea(page).evaluate((section) => {
    const pairs: Record<string, string> = {};
    for (const term of Array.from(section.querySelectorAll('dl.kv dt'))) {
      pairs[term.textContent ?? ''] = term.nextElementSibling?.textContent ?? '';
    }
    const rows = Array.from(section.querySelectorAll('table tbody tr')).map((tr) =>
      Array.from(tr.children).map((cell) => cell.textContent ?? ''),
    );
    return { pairs, rows };
  });
}

test('semver-checker: the page gives the same answers as node-semver in every browser', async ({ page }) => {
  expect(semverVersion, 'the oracle is the package version the tool pins').toBe('7.8.5');
  expect(BATCHES.flatMap((batch) => batch.versions).length).toBe(30);

  await openTool(page, 'semver-checker');
  await page.locator('input[name="mode"][value="check"]').click();

  for (const batch of BATCHES) {
    const expected = expectedFor(batch);
    await page.locator('#f-loose').setChecked(batch.loose);
    await page.locator('#f-includePrerelease').setChecked(batch.includePrerelease);
    await fillAndHold(page, 'range', batch.range);
    await fillAndHold(page, 'versions', batch.versions.join('\n'));

    // The page answers a moment after the last change, so the whole answer is read again until it is the oracle's.
    await expect(async () => {
      const shown = await readCheck(page);
      expect(
        shown.rows,
        `${batch.range} (loose ${batch.loose}, include pre-releases ${batch.includePrerelease})`,
      ).toEqual(expected.rows);
      expect(shown.pairs['Normalised range']).toBe(expected.normalized);
      expect(shown.pairs['Highest satisfying']).toBe(expected.highest);
      expect(shown.pairs['Lowest version the range allows']).toBe(expected.lowest);
    }).toPass({ timeout: 10_000 });
  }
});

test('semver-checker: a range and an include pre-releases tick left in check mode never change what sort mode shows', async ({
  page,
}) => {
  const pasted = ['1.10.0', '1.2.0', '1.0.0+b', '1.0.0+a', 'latest', '1.2.0-rc.1', '2.0.0-beta.11', '2.0.0-beta.2'];
  // The oracle: valid lines ordered by precedence with a stable sort, in the test process.
  const options: SemverOptions = { loose: false };
  const expectedSorted = pasted
    .filter((line) => semver.valid(line, options) !== null)
    .sort((a, b) => semver.compare(a, b, options));

  async function sortedOutput(withLeftovers: boolean): Promise<string> {
    await openTool(page, 'semver-checker');
    if (withLeftovers) {
      // A range the page cannot read and a ticked option, both set while the mode shows them.
      await page.locator('input[name="mode"][value="check"]').click();
      await fillAndHold(page, 'range', 'FODT-MARKER-4417');
      await page.locator('#f-includePrerelease').setChecked(true);
    }
    await page.locator('input[name="mode"][value="sort"]').click();
    await expect(page.locator('#f-range')).toHaveCount(0);
    await fillAndHold(page, 'versions', pasted.join('\n'));
    await expect(outputArea(page).locator('pre').first()).toHaveText(expectedSorted.join('\n'), { timeout: 10_000 });
    return outputArea(page).innerText();
  }

  const fresh = await sortedOutput(false);
  const afterLeftovers = await sortedOutput(true);
  expect(afterLeftovers).toBe(fresh);
  expect(fresh).not.toContain('not a valid range');
});

/**
 * The ten recorded docker run commands of the docker run to Compose Converter and the YAML each one becomes. They are
 * the same literals tools/docker-run-to-compose/test/convert.test.ts asserts, and docker compose config accepted every
 * one of them offline (tools/docker-run-to-compose/test/fixtures/acceptance.json). The oracle here is that record: the
 * page, running in each browser, must write exactly this text.
 */
const DOCKER_RECORDED: { command: string; yaml: string }[] = [
  {
    command: 'docker run --rm -p 8080:80 nginx',
    yaml: ['services:', '  nginx:', '    image: "nginx"', '    ports:', '      - "8080:80"'].join('\n') + '\n',
  },
  {
    command:
      'docker run -d --name web -p 8080:80 -v $(pwd):/usr/share/nginx/html:ro --restart unless-stopped nginx:1.27',
    yaml:
      [
        'services:',
        '  web:',
        '    image: "nginx:1.27"',
        '    container_name: "web"',
        '    ports:',
        '      - "8080:80"',
        '    volumes:',
        '      - ".:/usr/share/nginx/html:ro"',
        '    restart: "unless-stopped"',
      ].join('\n') + '\n',
  },
  {
    command:
      'docker run -d --name db -e POSTGRES_PASSWORD=example -e POSTGRES_DB=app -v pgdata:/var/lib/postgresql/data -p 127.0.0.1:5432:5432 postgres:16',
    yaml:
      [
        'services:',
        '  db:',
        '    image: "postgres:16"',
        '    container_name: "db"',
        '    environment:',
        '      - "POSTGRES_PASSWORD=example"',
        '      - "POSTGRES_DB=app"',
        '    volumes:',
        '      - "pgdata:/var/lib/postgresql/data"',
        '    ports:',
        '      - "127.0.0.1:5432:5432"',
        'volumes:',
        '  pgdata: {}',
      ].join('\n') + '\n',
  },
  {
    command: 'docker run --network appnet --network-alias api -e API_KEY=$API_KEY -p 3000:3000 ghcr.io/example/api:2.1',
    yaml:
      [
        'services:',
        '  api:',
        '    image: "ghcr.io/example/api:2.1"',
        '    environment:',
        '      - "API_KEY=$API_KEY"',
        '    ports:',
        '      - "3000:3000"',
        '    networks:',
        '      appnet:',
        '        aliases:',
        '          - "api"',
        'networks:',
        '  appnet:',
        '    external: true',
      ].join('\n') + '\n',
  },
  {
    command: 'docker run -m 512m --cpus 1.5 --pids-limit 100 --memory-swap 1g --name worker busybox sleep 3600',
    yaml:
      [
        'services:',
        '  worker:',
        '    image: "busybox"',
        '    mem_limit: "512m"',
        '    cpus: 1.5',
        '    pids_limit: 100',
        '    memswap_limit: "1g"',
        '    container_name: "worker"',
        '    command:',
        '      - "sleep"',
        '      - "3600"',
      ].join('\n') + '\n',
  },
  {
    command:
      "docker run --name web --health-cmd 'curl -f http://localhost/ || exit 1' --health-interval 30s --health-timeout 5s --health-retries 3 nginx",
    yaml:
      [
        'services:',
        '  web:',
        '    image: "nginx"',
        '    container_name: "web"',
        '    healthcheck:',
        '      test:',
        '        - "CMD-SHELL"',
        '        - "curl -f http://localhost/ || exit 1"',
        '      interval: "30s"',
        '      timeout: "5s"',
        '      retries: 3',
      ].join('\n') + '\n',
  },
  {
    command:
      'docker run -d \\\n  --name cache \\\n  --restart=always \\\n  -p 6379:6379 \\\n  -v redis-data:/data \\\n  redis:7 redis-server --appendonly yes',
    yaml:
      [
        'services:',
        '  cache:',
        '    image: "redis:7"',
        '    container_name: "cache"',
        '    restart: "always"',
        '    ports:',
        '      - "6379:6379"',
        '    volumes:',
        '      - "redis-data:/data"',
        '    command:',
        '      - "redis-server"',
        '      - "--appendonly"',
        '      - "yes"',
        'volumes:',
        '  redis-data: {}',
      ].join('\n') + '\n',
  },
  {
    command:
      'docker run --ulimit nofile=1024:2048 --ulimit nproc=65535 --sysctl net.core.somaxconn=1024 --storage-opt size=1G --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 alpine',
    yaml:
      [
        'services:',
        '  alpine:',
        '    image: "alpine"',
        '    ulimits:',
        '      nofile:',
        '        soft: 1024',
        '        hard: 2048',
        '      nproc: 65535',
        '    sysctls:',
        '      - "net.core.somaxconn=1024"',
        '    storage_opt:',
        '      size: "1G"',
        '    logging:',
        '      driver: "json-file"',
        '      options:',
        '        max-size: "10m"',
        '        max-file: "3"',
      ].join('\n') + '\n',
  },
  {
    command:
      'docker run --mount type=volume,source=data,target=/data,volume-nocopy --mount type=bind,source=$(pwd)/conf,target=/etc/app,readonly --tmpfs /run alpine',
    yaml:
      [
        'services:',
        '  alpine:',
        '    image: "alpine"',
        '    volumes:',
        '      - type: "volume"',
        '        source: "data"',
        '        target: "/data"',
        '        volume:',
        '          nocopy: true',
        '      - type: "bind"',
        '        source: "./conf"',
        '        target: "/etc/app"',
        '        read_only: true',
        '    tmpfs:',
        '      - "/run"',
        'volumes:',
        '  data: {}',
      ].join('\n') + '\n',
  },
  {
    command:
      "docker run -it --entrypoint /bin/sh --workdir /work -u 1000:1000 -e MODE=production -e 'GREETING=hello world' alpine -c 'echo $HOME'",
    yaml:
      [
        'services:',
        '  alpine:',
        '    image: "alpine"',
        '    stdin_open: true',
        '    tty: true',
        '    working_dir: "/work"',
        '    user: "1000:1000"',
        '    environment:',
        '      - "MODE=production"',
        '      - "GREETING=hello world"',
        '    entrypoint:',
        '      - "/bin/sh"',
        '    command:',
        '      - "-c"',
        '      - "echo $$HOME"',
      ].join('\n') + '\n',
  },
];

/** The YAML the page shows: the text of the first code block of the output, exactly as written. */
async function readYaml(page: Page): Promise<string> {
  return outputArea(page)
    .locator('pre.output')
    .first()
    .evaluate((element) => element.textContent ?? '');
}

test('docker-run-to-compose: the page output for the recorded commands equals the unit-tested YAML in every browser', async ({
  page,
}) => {
  expect(DOCKER_RECORDED).toHaveLength(10);
  await openTool(page, 'docker-run-to-compose');

  for (const recorded of DOCKER_RECORDED) {
    await fillAndHold(page, 'command', recorded.command);
    // The page answers a moment after the last change, so the YAML is read again until it is the recorded one.
    await expect(async () => {
      expect(await readYaml(page), recorded.command).toBe(recorded.yaml);
    }).toPass({ timeout: 10_000 });
    await expect(outputArea(page).locator('.note-success')).toHaveText(
      'The service is valid against the Compose Specification schema.',
    );
  }
});

test('docker-run-to-compose: an image, an address or a command named in the paste is never requested or run', async ({
  page,
}) => {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(request.url ?? '');
    response.statusCode = 204;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const named = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await openTool(page, 'docker-run-to-compose');

    // Everything a visitor can make the page name: an image on a registry that is this server, a variable value, an env
    // file, a label file, a mount source and the words of the command itself.
    const command = [
      'docker run -d',
      `-e CALLBACK=http://${named}/env`,
      `--env-file http://${named}/envfile`,
      `--label-file http://${named}/labels`,
      `-v http://${named}/volume:/data`,
      `${named}/team/app:1`,
      `curl http://${named}/command`,
    ].join(' ');
    await fillAndHold(page, 'command', command);
    await expect(async () => {
      expect(await readYaml(page)).toContain(`image: "${named}/team/app:1"`);
    }).toPass({ timeout: 10_000 });

    // A substitution that would fetch the same address is refused, never run.
    await fillAndHold(page, 'command', `docker run -e A=$(curl http://${named}/substitution) nginx`);
    await expect(outputArea(page)).toContainText('A $( starts a command substitution, which is never run here.');
    await fillAndHold(page, 'command', `docker run nginx | curl http://${named}/pipe`);
    await expect(outputArea(page)).toContainText('is a shell operator, so the command was refused.');

    // Give any request that was going to happen time to arrive, then count.
    await page.waitForTimeout(1_500);
    expect(seen, 'the recording server saw no request').toEqual([]);
    expect(
      requested.filter((url) => url.includes(named)),
      'the page requested nothing the paste named',
    ).toEqual([]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/**
 * The Web App Manifest Builder. The oracle for what a browser makes of a manifest is Chromium's own processed manifest
 * (Page.getAppManifest over a DevTools protocol session, Chromium as launched by this Playwright), and for the language
 * tags it is each engine's own Intl.getCanonicalLocales. The manifests are built on the page the way a visitor builds
 * them, served from a Node server this test starts, linked from a second page and read back; Chromium's own messages are
 * never copied. Chromium does not expose the purposes of an icon, so a purpose is compared by whether the icon is kept,
 * and the purposes themselves are asserted against the literals of the W3C draft's rules.
 */
interface ManifestCase {
  name: string;
  /** Text fields to fill, by field name; everything else keeps the page default. */
  fields: Record<string, string>;
  theme?: string;
  background?: string;
  display?: string;
  icons?: string[][];
  shortcuts?: string[][];
}

/** A grid field: adds or removes rows to match, then types every cell (empty cells clear the defaults). */
async function setGrid(page: Page, label: string, rows: string[][], columns: number): Promise<void> {
  const group = page.getByRole('group', { name: label, exact: true });
  const body = group.locator('tbody tr');
  while ((await body.count()) < rows.length) await group.getByRole('button', { name: 'Add row', exact: true }).click();
  while ((await body.count()) > rows.length) {
    await group.getByRole('button', { name: 'Remove last row', exact: true }).click();
  }
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < columns; c++) {
      const cell = body.nth(r).locator('input').nth(c);
      const value = rows[r]?.[c] ?? '';
      await expect(async () => {
        await cell.fill(value);
        await expect(cell).toHaveValue(value, { timeout: 500 });
      }).toPass({ timeout: 10_000 });
    }
  }
}

interface ManifestRow {
  written: string;
  processed: string;
  status: string;
}

/** The table "How a browser reads it" as a list of rows keyed by member (icons[1], shortcuts[2], and so on). */
async function readManifestRows(page: Page): Promise<Map<string, ManifestRow>> {
  const rows = await outputArea(page)
    .locator('table tbody tr')
    .evaluateAll((trs) => trs.map((tr) => Array.from(tr.children).map((cell) => cell.textContent ?? '')));
  const byMember = new Map<string, ManifestRow>();
  for (const [member = '', written = '', processed = '', status = ''] of rows) {
    byMember.set(member, { written, processed, status });
  }
  return byMember;
}

/** The JSON the page offers, as text: the first code block of the output. */
async function readManifestJson(page: Page): Promise<string> {
  return outputArea(page)
    .locator('pre.output')
    .first()
    .evaluate((element) => element.textContent ?? '');
}

/** Builds one manifest on the page and waits until the output belongs to it (the name is filled last, and is unique). */
async function buildOnPage(page: Page, id: string, spec: ManifestCase, manifestUrl: string, pageUrl: string) {
  await openTool(page, id);
  await fillAndHold(page, 'manifestUrl', manifestUrl);
  await fillAndHold(page, 'pageUrl', pageUrl);
  for (const [field, value] of Object.entries(spec.fields)) await fillAndHold(page, field, value);
  if (spec.display !== undefined) await page.locator('#f-display').selectOption(spec.display);
  for (const [label, value] of [
    ['Theme colour value', spec.theme],
    ['Background colour value', spec.background],
  ] as const) {
    if (value === undefined) continue;
    const box = page.getByLabel(label, { exact: true });
    await expect(async () => {
      await box.fill(value);
      await expect(box).toHaveValue(value, { timeout: 500 });
    }).toPass({ timeout: 10_000 });
  }
  if (spec.icons) await setGrid(page, 'Icons', spec.icons, 4);
  if (spec.shortcuts) await setGrid(page, 'Shortcuts', spec.shortcuts, 2);
  await fillAndHold(page, 'name', spec.name);
  await expect(async () => {
    expect((JSON.parse(await readManifestJson(page)) as { name?: string }).name).toBe(spec.name);
  }).toPass({ timeout: 10_000 });
  return { json: await readManifestJson(page), rows: await readManifestRows(page) };
}

/** What Chromium reports for a colour as `rgba(r,g,b,a)`, as red, green, blue and alpha to three decimals. */
function chromiumColour(css: string | undefined): number[] | null {
  if (css === undefined) return null;
  const match = /^rgba\((\d+),(\d+),(\d+),([0-9.]+)\)$/.exec(css);
  if (!match) throw new Error('unexpected colour from Chromium');
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(Number(match[4]).toFixed(3))];
}

/** What the page shows for a colour member: `rgba(r, g, b, a)` as the same four numbers, or null when none was kept. */
function pageColour(row: ManifestRow | undefined): number[] | null {
  const match = /^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/.exec(row?.processed ?? '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] : null;
}

/** Chromium's enumeration names (kStandalone, kMinimalUi) as the manifest's own words. */
function fromChromiumEnum(name: string): string {
  return name
    .replace(/^k/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

interface ChromiumManifest {
  startUrl?: string;
  scope?: string;
  id?: string;
  themeColor?: string;
  backgroundColor?: string;
  display?: string;
  displayOverrides?: string[];
  icons?: { url: string; sizes: string; type: string }[];
  shortcuts?: { name: string; url: string }[];
}

/** The nine manifests: inputs only. Every expected answer comes from Chromium, except the purposes (the draft's rules). */
function manifestCases(): ManifestCase[] {
  const png = (src: string, sizes: string, purpose = ''): string[] => [src, sizes, 'image/png', purpose];
  return [
    {
      name: 'Case 1 basic',
      fields: { startUrl: '/app/start.html', scope: '/app/', id: 'x', shortName: 'R' },
      display: 'fullscreen',
      theme: 'aliceblue',
      background: '#FFF',
    },
    {
      name: 'Case 2 start address on another origin and a colour that is not one',
      fields: { startUrl: 'https://evil.example/', scope: '/' },
      theme: 'not-a-color',
    },
    { name: 'Case 3 scope that does not contain the start address', fields: { startUrl: '/a/b.html', scope: '/c/' } },
    { name: 'Case 4 id with a query and a fragment', fields: { startUrl: '/my-app/start', id: 'foo?x=y#frag' } },
    {
      name: 'Case 5 icon sizes and purposes',
      fields: {},
      icons: [
        png('a.png', '48x48 96x96', 'maskable any'),
        ['b.png', 'any', '', ''],
        ['c.png', '048x048', '', ''],
        ['d.png', '', '', 'fizzbuzz'],
        ['e.png', '', '', 'monochrome fizzbuzz'],
        ['', '', '', ''],
        ['f.png', '10x10x10', '', ''],
      ],
    },
    {
      name: 'Case 6 display_override with an unknown token',
      fields: { displayOverride: 'window-controls-overlay, minimal-ui, bogus' },
      display: 'standalone',
    },
    { name: 'Case 7 modern colour syntax', fields: {}, theme: 'rgb(1 2 3 / 50%)', background: 'hsl(120deg 100% 50%)' },
    { name: 'Case 8 named and short hex colours', fields: {}, theme: 'rebeccapurple', background: '#abcd' },
    {
      name: 'Case 9 shortcuts',
      fields: { startUrl: '/', scope: '/' },
      shortcuts: [
        ['Play', '/play'],
        ['Far', 'https://x.example/'],
        ['', '/noname'],
        ['Subscriptions', '/subscriptions?sort=desc'],
      ],
    },
  ];
}

test('web-manifest-builder: Chromium processes the built manifest to the same start URL, scope, id, colours and icons', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'only Chromium exposes its processed manifest through CDP');
  test.setTimeout(240_000);
  const cases = manifestCases();
  expect(cases).toHaveLength(9);

  let current = '{}';
  const server = createServer((request, response) => {
    if ((request.url ?? '').startsWith('/app/manifest.webmanifest')) {
      response.setHeader('content-type', 'application/manifest+json');
      response.end(current);
    } else {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><title>t</title><link rel="manifest" href="manifest.webmanifest">');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const spec of cases) {
      const built = await buildOnPage(
        page,
        'web-manifest-builder',
        spec,
        `${origin}/app/manifest.webmanifest`,
        `${origin}/app/start.html`,
      );
      // The manifest the visitor would download is what Chromium is given.
      current = built.json;
      const second = await page.context().newPage();
      try {
        const cdp = await page.context().newCDPSession(second);
        await cdp.send('Page.enable');
        await second.goto(`${origin}/app/start.html`);
        const answer = (await cdp.send('Page.getAppManifest')) as unknown as { manifest: ChromiumManifest };
        const chromium = answer.manifest;
        const rows = built.rows;
        const label = spec.name;

        expect(rows.get('start_url')?.processed, `${label}: start URL`).toBe(chromium.startUrl);
        expect(rows.get('scope')?.processed, `${label}: scope`).toBe(chromium.scope);
        expect(rows.get('id')?.processed, `${label}: id`).toBe(chromium.id);
        expect(pageColour(rows.get('theme_color')), `${label}: theme colour`).toEqual(
          chromiumColour(chromium.themeColor),
        );
        expect(pageColour(rows.get('background_color')), `${label}: background colour`).toEqual(
          chromiumColour(chromium.backgroundColor),
        );
        // display: Chromium says kUndefined when the member is not set; the draft's default is browser.
        const chromiumDisplay = fromChromiumEnum(chromium.display ?? 'kUndefined');
        expect(rows.get('display')?.processed.split(' ')[0], `${label}: display`).toBe(
          chromiumDisplay === 'undefined' ? 'browser' : chromiumDisplay,
        );
        if (chromium.displayOverrides) {
          expect(rows.get('display_override')?.processed, `${label}: display_override`).toBe(
            chromium.displayOverrides.map(fromChromiumEnum).join(', '),
          );
        }

        // Icons: the same icons survive, in the same order, with the same sizes and types. Chromium writes any as 0x0.
        const pageIcons = Array.from(rows.entries())
          .filter(([member, row]) => member.startsWith('icons[') && row.status === 'read')
          .map(([, row]) => {
            const match = /^(\S+) \(sizes: (.*); type: (.*); purpose: (.*)\)$/.exec(row.processed);
            if (!match) throw new Error(`unexpected icon row: ${row.processed}`);
            const sizes = match[2] === 'none' ? '' : (match[2] ?? '').replace(/\bany\b/, '0x0');
            return { url: match[1], sizes, type: match[3] === 'none' ? '' : match[3], purpose: match[4] };
          });
        expect(
          pageIcons.map(({ url, sizes, type }) => ({ url, sizes, type })),
          `${label}: icons`,
        ).toEqual(chromium.icons ?? []);
        if (spec.name.startsWith('Case 5')) {
          // The draft's purpose rules: maskable any stays both, any is the default, an unknown keyword is dropped, and
          // an icon whose purpose holds nothing known is not kept (d.png is absent from both lists).
          expect(pageIcons.map((icon) => [icon.url?.split('/').pop(), icon.purpose])).toEqual([
            ['a.png', 'maskable any'],
            ['b.png', 'any'],
            ['c.png', 'any'],
            ['e.png', 'monochrome'],
            ['f.png', 'any'],
          ]);
        }

        const pageShortcuts = Array.from(rows.entries())
          .filter(([member, row]) => member.startsWith('shortcuts[') && row.status === 'read')
          .map(([, row]) => ({ name: row.written, url: row.processed }));
        expect(pageShortcuts, `${label}: shortcuts`).toEqual(chromium.shortcuts ?? []);
      } finally {
        await second.close();
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** Twenty language tags: well formed, ill formed, written in other cases, and ones the RFC and ECMAScript see differently. */
const LANGUAGE_TAGS = [
  'en-us',
  'EN-latn-us',
  'zh-hans-cn',
  'de',
  'fr',
  'ja',
  'sr-Latn',
  'es-419',
  'en',
  'e_',
  'e',
  'en_US',
  'de-419-DE',
  'a-DE',
  'ar-a-aaa-b-bbb-a-ccc',
  'i-enochian',
  'zh-cmn-Hans-CN',
  'x-whatever',
  'sl-rozaj-biske',
  'az-Arab-x-AZE-derbend',
];

test('web-manifest-builder: the BCP 47 check agrees with this browser Intl.getCanonicalLocales', async ({ page }) => {
  expect(LANGUAGE_TAGS).toHaveLength(20);
  await openTool(page, 'web-manifest-builder');
  let refused = 0;
  let canonicalised = 0;
  for (const tag of LANGUAGE_TAGS) {
    // The engine's own answer, from inside the same browser: the canonical form, or null when it throws.
    const expected = await page.evaluate((text) => {
      try {
        return Intl.getCanonicalLocales(text)[0] ?? null;
      } catch {
        return null;
      }
    }, tag);
    await fillAndHold(page, 'lang', tag);
    await expect(async () => {
      const rows = await readManifestRows(page);
      const lang = rows.get('lang');
      expect(lang?.written, tag).toBe(tag);
      if (expected === null) {
        expect(lang?.status, `${tag} is refused by this engine`).toBe('ignored');
      } else {
        expect(lang?.processed, `${tag} in canonical form`).toBe(expected);
        expect(lang?.status).toBe('read');
      }
    }).toPass({ timeout: 10_000 });
    if (expected === null) refused++;
    else if (expected !== tag) canonicalised++;
  }
  // The list holds both kinds, so the comparison is not vacuous in any engine.
  expect(refused).toBeGreaterThanOrEqual(8);
  expect(canonicalised).toBeGreaterThanOrEqual(3);
});

test('web-manifest-builder: icon and shortcut addresses are never requested', async ({ page }) => {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(request.url ?? '');
    response.statusCode = 204;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const named = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    // Every address a visitor can type: the manifest, the page, the start address, the id, the scope, each icon and each shortcut.
    const spec: ManifestCase = {
      name: 'Case recording',
      fields: {
        startUrl: `http://${named}/app/start.html`,
        id: `http://${named}/app/id`,
        scope: `http://${named}/app/`,
      },
      icons: [
        [`http://${named}/icons/icon-192.png`, '192x192', 'image/png', ''],
        [`http://${named}/icons/icon.svg`, 'any', 'image/svg+xml', ''],
      ],
      shortcuts: [['Play', `http://${named}/app/play`]],
    };
    const built = await buildOnPage(
      page,
      'web-manifest-builder',
      spec,
      `http://${named}/app/manifest.webmanifest`,
      `http://${named}/app/start.html`,
    );
    // The page really processed the addresses it was given.
    expect(built.rows.get('icons[1]')?.processed).toContain(`http://${named}/icons/icon-192.png`);
    expect(built.rows.get('shortcuts[1]')?.processed).toBe(`http://${named}/app/play`);
    expect(built.rows.get('start_url')?.status).toBe('read');

    // Give any request that was going to happen time to arrive, then count.
    await page.waitForTimeout(1_500);
    expect(seen, 'the recording server saw no request').toEqual([]);
    expect(
      requested.filter((url) => url.includes(named)),
      'the page requested nothing a field named',
    ).toEqual([]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/**
 * The IDN & Punycode Converter: the oracle is Unicode's own conformance data, IdnaTestV2.txt 17.0.0, vendored under
 * tools/idn-converter/test/fixtures/idna (see UPSTREAM.md there). Sixty of its rows, chosen by a fixed seed, are typed on
 * the page in batches of twenty, once going to ASCII (the file's toAsciiN column) and once going to Unicode (its toUnicode
 * column), with the strict profile. For each row the page must show the file's expected form, or say the name is not valid
 * when the file lists a status code. The file is read here by a small reader of its own (columns, escapes, the blank rules).
 */
const IDNA_FILE = new URL('../tools/idn-converter/test/fixtures/idna/IdnaTestV2.txt', import.meta.url);
const IDNA_BACKSLASH = String.fromCharCode(92);

interface IdnaRow {
  line: number;
  source: string;
  toUnicode: string;
  toUnicodeError: boolean;
  toAsciiN: string;
  toAsciiNError: boolean;
  /** The status codes of the toAsciiN column, as the file lists them. */
  toAsciiNCodes: string[];
}

function idnaUnescape(text: string): string {
  if (text === '""') return '';
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === IDNA_BACKSLASH && text[i + 1] === 'u') {
      out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
      i += 6;
    } else if (text[i] === IDNA_BACKSLASH && text[i + 1] === 'x' && text[i + 2] === '{') {
      const close = text.indexOf('}', i);
      out += String.fromCodePoint(parseInt(text.slice(i + 3, close), 16));
      i = close + 1;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

/** Rows of the file: a blank toUnicode column is the source, a blank toAsciiN column is the toUnicode value, and a blank status inherits as the file's header says. */
function readIdnaRows(): IdnaRow[] {
  const rows: IdnaRow[] = [];
  const lines = readFileSync(IDNA_FILE, 'utf8').split('\n');
  lines.forEach((raw, index) => {
    const hash = raw.indexOf('#');
    const line = hash >= 0 ? raw.slice(0, hash) : raw;
    if (line.trim() === '') return;
    const columns = line.split(';').map((column) => column.replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''));
    while (columns.length < 7) columns.push('');
    const source = idnaUnescape(columns[0] ?? '');
    const toUnicode = columns[1] === '' ? source : idnaUnescape(columns[1] ?? '');
    const unicodeStatus = columns[2] === '' || columns[2] === '[]' ? '' : (columns[2] ?? '');
    const asciiStatus = columns[4] === '' ? unicodeStatus : columns[4] === '[]' ? '' : (columns[4] ?? '');
    rows.push({
      line: index + 1,
      source,
      toUnicode,
      toUnicodeError: unicodeStatus !== '',
      toAsciiN: columns[3] === '' ? toUnicode : idnaUnescape(columns[3] ?? ''),
      toAsciiNError: asciiStatus !== '',
      toAsciiNCodes: asciiStatus
        .slice(1, -1)
        .split(',')
        .map((code) => code.trim())
        .filter((code) => code !== ''),
    });
  });
  return rows;
}

function idnaSeeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How the page shows a name or a result: hidden and direction-changing characters as an escape (the page's own rule, written again here from the page's description). */
function idnaShown(text: string): string {
  const hidden: [number, number][] = [
    [0x0, 0x1f],
    [0x7f, 0x9f],
    [0xa0, 0xa0],
    [0xad, 0xad],
    [0x34f, 0x34f],
    [0x61c, 0x61c],
    [0x115f, 0x1160],
    [0x1680, 0x1680],
    [0x17b4, 0x17b5],
    [0x180b, 0x180f],
    [0x2000, 0x200f],
    [0x2028, 0x202f],
    [0x205f, 0x206f],
    [0x3000, 0x3000],
    [0x3164, 0x3164],
    [0xd800, 0xdfff],
    [0xfe00, 0xfe0f],
    [0xfeff, 0xfeff],
    [0xffa0, 0xffa0],
    [0xfff9, 0xfffb],
    [0xfffe, 0xffff],
    [0x1d173, 0x1d17a],
    [0xe0000, 0xe0fff],
  ];
  let shown = '';
  for (const ch of text) {
    const point = ch.codePointAt(0) ?? 0;
    shown += hidden.some(([low, high]) => point >= low && point <= high)
      ? `${IDNA_BACKSLASH}u{${point.toString(16).toUpperCase()}}`
      : ch;
  }
  return shown;
}

const IDNA_REASONS = ['processing', 'hyphen', 'std3', 'length', 'bidi', 'joiner'];

/** The one kind of reason a row's status codes give, or a mix: V2 and V3 hyphens, U1 STD3, A4 length, B bidi, C joiners, anything else processing. */
function idnaReason(codes: string[]): string {
  const kinds = new Set(
    codes.map((code) =>
      code === 'V2' || code === 'V3'
        ? 'hyphen'
        : code === 'U1'
          ? 'std3'
          : code === 'A4_1' || code === 'A4_2'
            ? 'length'
            : code.startsWith('B')
              ? 'bidi'
              : code.startsWith('C')
                ? 'joiner'
                : 'processing',
    ),
  );
  if (kinds.has('processing')) return 'processing';
  return kinds.size === 1 ? ([...kinds][0] ?? '') : 'mixed';
}

/** Sixty rows, chosen by a fixed seed, from those that can be typed as one line of the page and shown whole in a table cell. */
function idnaTypeable(text: string): boolean {
  const characters = Array.from(text);
  if (characters.length > 80) return false;
  return characters.every((ch) => {
    const point = ch.codePointAt(0) ?? 0;
    return point !== 0 && point !== 10 && point !== 13 && !(point >= 0xd800 && point <= 0xdfff);
  });
}

function idnaChosenRows(): IdnaRow[] {
  const eligible = readIdnaRows().filter(
    (row) =>
      row.source !== '' &&
      row.source === row.source.trim() &&
      idnaTypeable(row.source) &&
      idnaTypeable(row.toUnicode) &&
      idnaTypeable(row.toAsciiN),
  );
  const random = idnaSeeded(20261004);
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const held = eligible[i];
    eligible[i] = eligible[j] as IdnaRow;
    eligible[j] = held as IdnaRow;
  }
  // Thirty rows the file accepts, and thirty it refuses: five for each kind of reason it gives (a name that cannot be
  // processed, only hyphens, only STD3 characters, only length, only bidirectional rules, only joiners), because most of the
  // file's refusals combine several reasons and would hide a missing check. Taken in turn so every batch has both.
  const accepted = eligible.filter((row) => !row.toAsciiNError).slice(0, 30);
  const refused = IDNA_REASONS.flatMap((reason) =>
    eligible.filter((row) => row.toAsciiNError && idnaReason(row.toAsciiNCodes) === reason).slice(0, 5),
  );
  return accepted.flatMap((row, index) => [row, refused[index] as IdnaRow]);
}

test('idn-converter: the page converts IdnaTestV2 rows the same way in every browser', async ({ page }) => {
  const rows = idnaChosenRows();
  expect(rows).toHaveLength(60);
  // Not vacuous: the sixty rows hold names the file accepts and names it refuses, in both directions.
  expect(rows.filter((row) => !row.toAsciiNError).length).toBe(30);
  expect(rows.filter((row) => row.toAsciiNError).length).toBe(30);
  expect(rows.filter((row) => !row.toUnicodeError).length).toBeGreaterThanOrEqual(20);
  expect(rows.filter((row) => row.toUnicodeError).length).toBeGreaterThanOrEqual(20);

  await openTool(page, 'idn-converter');
  for (const direction of ['to-ascii', 'to-unicode'] as const) {
    await page.locator(`input[name="direction"][value="${direction}"]`).click();
    for (let start = 0; start < rows.length; start += 20) {
      const batch = rows.slice(start, start + 20);
      await fillAndHold(page, 'names', batch.map((row) => row.source).join('\n'));
      // The page answers a moment after the last change, so the whole table is read again until it is the file's.
      await expect(async () => {
        const shown = await outputArea(page)
          .locator('table tbody tr')
          .evaluateAll((trs) => trs.map((tr) => Array.from(tr.children).map((cell) => cell.textContent ?? '')));
        expect(shown, `${direction}, rows ${start + 1} to ${start + 20}`).toHaveLength(batch.length);
        batch.forEach((row, index) => {
          const cells = shown[index] ?? [];
          const refused = direction === 'to-ascii' ? row.toAsciiNError : row.toUnicodeError;
          const wanted = direction === 'to-ascii' ? row.toAsciiN : row.toUnicode;
          const where = `${direction}, line ${row.line} of the file: ${idnaShown(row.source)}`;
          expect(cells[0], where).toBe(String(index + 1));
          expect(cells[1], where).toBe(idnaShown(row.source));
          if (refused) {
            expect(cells[direction === 'to-ascii' ? 2 : 3], where).toBe('not converted');
            expect(cells[4], where).toMatch(/^not valid: [1-9]/);
          } else {
            expect(cells[direction === 'to-ascii' ? 2 : 3], where).toBe(idnaShown(wanted));
            expect(cells[4], where).toBe('valid');
          }
        });
      }).toPass({ timeout: 15_000 });
    }
  }
});

/** The block whose label starts with the text, and its text, as the visitor can copy it. */
function idnBlock(page: Page, label: string) {
  return outputArea(page).locator('.output-block', { has: page.locator('.output-label', { hasText: label }) });
}

test('idn-converter: the copied and downloaded list holds the real names, joiner characters included', async ({
  page,
}) => {
  // Two valid names that hold a zero width non-joiner (U+200C) and a zero width joiner (U+200D), as xn-- names. The
  // expected text is built from code points at run time, never typed as a character or as escape text.
  const persian = String.fromCodePoint(0x646, 0x627, 0x645, 0x647, 0x200c, 0x627, 0x6cc) + '.example';
  const devanagari = String.fromCodePoint(0x915, 0x94d, 0x200d, 0x937) + '.example';
  const escapeText = String.fromCharCode(92) + 'u{';
  await openTool(page, 'idn-converter');
  await page.locator('input[name="direction"][value="to-unicode"]').click();
  await fillAndHold(page, 'names', 'xn--mgba3gch31f060k.example\nxn--11b2ezcw70k.example');

  const list = idnBlock(page, 'Converted names, one per line');
  await expect(list).toBeVisible({ timeout: 15_000 });
  const expected = `${persian}\n${devanagari}`;
  // What is shown in the list block is the real text, so it is also what Copy hands over.
  await expect(async () => {
    expect(await list.locator('pre').textContent()).toBe(expected);
  }).toPass({ timeout: 10_000 });

  // The Download button of the same block writes the same bytes.
  const downloadPromise = page.waitForEvent('download');
  await list.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('domains.txt');
  const path = await download.path();
  expect(readFileSync(path, 'utf8')).toBe(expected);
  expect(readFileSync(path, 'utf8').includes(escapeText)).toBe(false);

  // The escape-annotated forms are still shown, in the table, for reading; the block that is not to be copied says so.
  const cells = await readTableCells(page);
  expect(cells[0]?.[3]).toBe(
    `${String.fromCodePoint(0x646, 0x627, 0x645, 0x647)}${escapeText}200C}${String.fromCodePoint(0x627, 0x6cc)}.example`,
  );
  expect(cells[1]?.[3]).toBe(
    `${String.fromCodePoint(0x915, 0x94d)}${escapeText}200D}${String.fromCodePoint(0x937)}.example`,
  );
  await expect(outputArea(page).locator('.output-label', { hasText: 'Each name in both forms' })).toContainText(
    'do not copy',
  );
});

// --- Date & Duration Calculator (16-08): ISO week numbers and ISO 8601 durations against this browser's Temporal ---

/** The parts of Temporal the date calculator tests use. Temporal ships in Chromium, Firefox and WebKit; Node 22 has none. */
interface TemporalPlainDate {
  yearOfWeek: number;
  weekOfYear: number;
  dayOfWeek: number;
  subtract(duration: { days: number }): { toString(): string };
}

interface TemporalDuration {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  microseconds: number;
  nanoseconds: number;
  toString(): string;
}

interface TemporalApi {
  PlainDate: { from(source: string | { year: number; month: number; day: number }): TemporalPlainDate };
  Duration: { from(source: string): TemporalDuration };
}

async function hasTemporal(page: Page): Promise<boolean> {
  return page.evaluate(() => typeof (globalThis as unknown as { Temporal?: unknown }).Temporal !== 'undefined');
}

/** Whether a year is a leap year, written here again from the Gregorian rule (the page's code is not used). */
function weekLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function weekDateText(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 2,000 dates from a fixed seed: 1,200 anywhere from 0001 to 9999, 600 in the eight days from 28 December to 4 January
 * (where the week-numbering year and the calendar year differ) of a year from 1900 to 2100, 195 from 1990 to 2040, and
 * five that are known to be awkward.
 */
function weekSeededDates(): string[] {
  const random = idnaSeeded(20261004);
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const monthLength = (year: number, month: number) =>
    month === 2 && weekLeapYear(year) ? 29 : (lengths[month - 1] ?? 31);
  const anywhere = (low: number, high: number): string => {
    const year = low + Math.floor(random() * (high - low + 1));
    const month = 1 + Math.floor(random() * 12);
    const day = 1 + Math.floor(random() * monthLength(year, month));
    return weekDateText(year, month, day);
  };
  const dates: string[] = ['0001-01-01', '9999-12-31', '2021-01-03', '2020-12-31', '2024-12-30'];
  for (let i = 0; i < 1200; i++) dates.push(anywhere(1, 9999));
  for (let i = 0; i < 600; i++) {
    const year = 1900 + Math.floor(random() * 201);
    const offset = Math.floor(random() * 8);
    dates.push(offset < 4 ? weekDateText(year, 12, 28 + offset) : weekDateText(year + 1, 1, offset - 3));
  }
  for (let i = 0; i < 195; i++) dates.push(anywhere(1990, 2040));
  return dates;
}

async function readTableCells(page: Page): Promise<string[][]> {
  return outputArea(page)
    .locator('table tbody tr')
    .evaluateAll((trs) => trs.map((tr) => Array.from(tr.children).map((cell) => cell.textContent ?? '')));
}

test('date-diff: ISO week numbers agree with this browser Temporal for 2,000 seeded dates', async ({ page }) => {
  await openTool(page, 'date-diff');
  test.skip(!(await hasTemporal(page)), 'This browser has no Temporal, so there is no second opinion to compare with.');
  const dates = weekSeededDates();
  expect(dates).toHaveLength(2000);

  // What Temporal says, asked in the same page: the week-numbering year, the week, the weekday, the Monday that starts
  // the week, and the number of weeks of that year (the week of 28 December, which is always in the last week).
  const expected = await page.evaluate((list) => {
    const temporal = (globalThis as unknown as { Temporal: TemporalApi }).Temporal;
    return list.map((text) => {
      const day = temporal.PlainDate.from(text);
      const monday = day.subtract({ days: day.dayOfWeek - 1 }).toString();
      const weeks = temporal.PlainDate.from({ year: day.yearOfWeek, month: 12, day: 28 }).weekOfYear;
      return [day.yearOfWeek, day.weekOfYear, day.dayOfWeek, monday, weeks] as [number, number, number, string, number];
    });
  }, dates);

  // Values typed for the other modes are kept while hidden and must not change the week table.
  await page.locator('input[name="mode"][value="business"]').click();
  await fillAndHold(page, 'start', '2024-01-01');
  await fillAndHold(page, 'end', '2024-12-31');
  await fillAndHold(page, 'holidays', '2024-01-03\n2024-01-04');
  await fillAndHold(page, 'weekend', 'Fri, Sat');
  await page.locator('input[name="mode"][value="weeks"]').click();
  await fillAndHold(page, 'dates', dates.join('\n'));

  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  await expect(async () => {
    const rows = await readTableCells(page);
    expect(rows).toHaveLength(dates.length);
    const wrong: string[] = [];
    rows.forEach((cells, index) => {
      const [weekYear, week, weekday, monday, weeks] = expected[index] as [number, number, number, string, number];
      const written = `${String(weekYear).padStart(4, '0')}-W${String(week).padStart(2, '0')}-${weekday}`;
      const same =
        cells[0] === String(index + 1) &&
        cells[1] === dates[index] &&
        cells[2] === written &&
        cells[3] === String(weekYear) &&
        cells[4] === String(week) &&
        cells[5] === `${weekday} ${names[weekday - 1]}` &&
        cells[6] === monday &&
        cells[7] === String(weeks);
      if (!same)
        wrong.push(`${dates[index]}: page ${cells.slice(1).join(' | ')}; Temporal ${written} ${monday} ${weeks}`);
    });
    expect(wrong.slice(0, 5)).toEqual([]);
  }).toPass({ timeout: 30_000 });
});

/** The text of a time part value times a factor, in nanoseconds, from decimal text with up to nine fraction digits. */
function nanosecondsOf(text: string, factor: bigint): bigint {
  const [whole = '0', fraction = ''] = text.split('.');
  return BigInt(whole + fraction.padEnd(9, '0')) * factor;
}

function secondsText(nanoseconds: bigint): string {
  const whole = nanoseconds / 1_000_000_000n;
  const rest = (nanoseconds % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return rest === '' ? whole.toString() : `${whole}.${rest}`;
}

test('date-diff: parsed durations agree with this browser Temporal.Duration', async ({ page }) => {
  await openTool(page, 'date-diff');
  test.skip(!(await hasTemporal(page)), 'This browser has no Temporal, so there is no second opinion to compare with.');

  // Twelve recorded durations: every part, weeks alone and with days, zero, a decimal fraction on seconds (dot and comma)
  // and on hours, a long time part, and large calendar parts. Only inputs are recorded; every answer comes from Temporal.
  const durations = [
    'P1Y2M3W4DT5H6M7.5S',
    'PT0S',
    'P1W',
    'P2Y',
    'PT36H',
    'PT0.123456789S',
    'PT1.5H',
    'P10DT30M',
    'P1W2D',
    'PT0,5S',
    'P999999999Y',
    'PT1000000H',
  ];
  expect(durations).toHaveLength(12);
  const expected = await page.evaluate((list) => {
    const temporal = (globalThis as unknown as { Temporal: TemporalApi }).Temporal;
    return list.map((text) => {
      const duration = temporal.Duration.from(text);
      return {
        years: duration.years,
        months: duration.months,
        weeks: duration.weeks,
        days: duration.days,
        hours: duration.hours,
        minutes: duration.minutes,
        seconds: duration.seconds,
        milliseconds: duration.milliseconds,
        microseconds: duration.microseconds,
        nanoseconds: duration.nanoseconds,
        // The same duration after the page's canonical text has been read by Temporal again.
        text: duration.toString(),
      };
    });
  }, durations);

  await page.locator('input[name="mode"][value="duration"]').click();
  for (const [index, text] of durations.entries()) {
    await fillAndHold(page, 'isoDuration', text);
    const want = expected[index]!;
    await expect(async () => {
      const cells = await readTableCells(page);
      const part = (name: string) => cells.find((row) => row[0] === name)?.[1] ?? '';
      expect(cells).toHaveLength(8);
      expect(part('Years'), text).toBe(String(want.years));
      expect(part('Months'), text).toBe(String(want.months));
      expect(part('Weeks'), text).toBe(String(want.weeks));
      expect(part('Days'), text).toBe(String(want.days));
      // Hours, minutes and seconds are compared as one exact amount of time in nanoseconds: Temporal turns a fraction of
      // an hour into minutes and a fraction of a second into milliseconds, microseconds and nanoseconds.
      const pageTime =
        nanosecondsOf(part('Hours'), 3_600n) + nanosecondsOf(part('Minutes'), 60n) + nanosecondsOf(part('Seconds'), 1n);
      const temporalTime =
        BigInt(want.hours) * 3_600_000_000_000n +
        BigInt(want.minutes) * 60_000_000_000n +
        BigInt(want.seconds) * 1_000_000_000n +
        BigInt(want.milliseconds) * 1_000_000n +
        BigInt(want.microseconds) * 1_000n +
        BigInt(want.nanoseconds);
      expect(pageTime, text).toBe(temporalTime);
      expect(part('Hours, minutes and seconds in seconds'), text).toBe(secondsText(temporalTime));
      // The canonical text the page writes is read back by Temporal as the same duration.
      const canonical = (await outputArea(page).locator('pre.output').first().textContent()) ?? '';
      const again = await page.evaluate((source) => {
        const temporal = (globalThis as unknown as { Temporal: TemporalApi }).Temporal;
        return temporal.Duration.from(source).toString();
      }, canonical);
      expect(again, `${text} written as ${canonical}`).toBe(want.text);
    }).toPass({ timeout: 10_000 });
  }

  // Durations that both refuse: no part, a T with nothing after it, wrong order, a letter in the wrong half, a fraction
  // before the last part. Temporal throws for each, and so does the page. A repeated letter (P1Y1Y) is left out: ISO 8601
  // allows each letter once and Firefox and WebKit refuse it, but Chromium 153 reads P1Y1Y as P1Y (recorded in the plan
  // summary); the page refuses it, as its unit tests show.
  const refused = ['P', 'PT', 'P1DT', 'P1D1Y', 'PT1M2H', 'P1H', 'PT1D', 'P1.5Y2M', 'PT1.5H30M'];
  const thrown = await page.evaluate((list) => {
    const temporal = (globalThis as unknown as { Temporal: TemporalApi }).Temporal;
    return list.map((text) => {
      try {
        temporal.Duration.from(text);
        return false;
      } catch {
        return true;
      }
    });
  }, refused);
  expect(thrown).toEqual(refused.map(() => true));
  for (const text of refused) {
    await fillAndHold(page, 'isoDuration', text);
    await expect(outputArea(page).locator('ul.issue-list'), text).toBeVisible();
    await expect(outputArea(page).locator('table'), text).toHaveCount(0);
  }

  // Where the page departs from Temporal, by the specification it follows: ISO 8601-1 section 5.5.2.4 lets the lowest
  // order component carry a decimal fraction, days included, and RFC 3339 Appendix A has no sign. Temporal accepts a
  // fraction only on hours, minutes and seconds, and accepts a leading sign. Both facts are checked in this browser.
  const departures = await page.evaluate(() => {
    const temporal = (globalThis as unknown as { Temporal: TemporalApi }).Temporal;
    let fractionOfDay: string;
    try {
      temporal.Duration.from('P0,5D');
      fractionOfDay = 'accepted';
    } catch {
      fractionOfDay = 'refused';
    }
    return { fractionOfDay, negativeDays: temporal.Duration.from('-P1D').days };
  });
  expect(departures).toEqual({ fractionOfDay: 'refused', negativeDays: -1 });
  await fillAndHold(page, 'isoDuration', 'P0,5D');
  await expect(async () => {
    const cells = await readTableCells(page);
    expect(cells.find((row) => row[0] === 'Days')?.[1]).toBe('0.5');
    expect(((await outputArea(page).locator('pre.output').first().textContent()) ?? '').trim()).toBe('P0.5D');
  }).toPass({ timeout: 10_000 });
  await fillAndHold(page, 'isoDuration', '-P1D');
  await expect(outputArea(page).locator('ul.issue-list')).toContainText('A sign is not accepted');
});
