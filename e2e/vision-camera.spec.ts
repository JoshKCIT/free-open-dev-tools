import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * Behavioural proof of the QR Code & Barcode Reader's camera (phase 15, D-196, D-202 e and research C7 to C9): the camera
 * opens only when Camera is chosen AND Run is pressed, a code shown to it is read, the live view lives inside the Output
 * panel with the label Live camera view, and every way out -- a code was read, Cancel, an edit, the page being left, the 15
 * second start limit, the 30 second session limit -- stops every camera track and removes the view in the same turn. A QR
 * code carrying a canary string is read from frames and the canary is shown in the page and found nowhere else: in no
 * request, no storage, no cookie, no console message, no page error, not in the address and not in the title.
 *
 * What each engine can prove differs by necessity, so the tests skip, never fail, where an engine lacks what a test needs.
 * Chromium and mobile Chrome run a real fake camera device that shows a picture of a QR code (a one frame .y4m file built
 * here from the module matrix, so there is no binary fixture). Firefox runs its own fake device, which shows a test
 * pattern with no code, and otherwise a scripted camera: a canvas stream carrying the QR code, with every track's stop
 * wrapped. What each test can prove is asked of the engine: the pinned WebKit on Windows has no camera interface at all
 * (no navigator.mediaDevices), so there only the plain message is tested and the stream tests skip. WebKit on Linux has
 * getUserMedia; it is not given a scripted stream (see suppliesStreams), so the test that the camera starts only on Run
 * proves its rules there on the page's plain message for a refused camera, and the stream tests skip.
 *
 * The scripted getUserMedia is put on MediaDevices.prototype, not on the navigator.mediaDevices object: WebKit (seen on
 * Linux) throws away the script wrapper of navigator.mediaDevices when it is garbage collected and makes a fresh one on the
 * next read, and a function set on the old wrapper is gone with it (the page then reached the real getUserMedia and the
 * call was never counted). The prototype lives as long as the page does.
 *
 * The browser flags for the fake devices go through `playwright.<engine>.launch()` inside the test, not through
 * `test.use({ launchOptions })` (which Playwright refuses inside a describe because it forces a new worker) and not
 * through playwright.config.ts (a shared file this phase never edits).
 *
 * A spec of its own, with its own helpers copied in shape from e2e/security-secrets.spec.ts and
 * e2e/security-workers.spec.ts, because a shared test helper would make every importing spec run whole for every tool.
 * The page's test record (window.__FODT_CAMERA_TEST__) is created here before the page loads and is absent on a real
 * visit. Limits are crossed with Playwright's page.clock, never with a slow input.
 */
const rel = (path: string) => path.replace(/^\//, '');

declare global {
  interface Window {
    /** What the page noted about every camera track, created by installCameraHook. */
    __FODT_CAMERA_TEST__?: { events: { kind: string; states: string[] }[] };
    /** How many times the replaced getUserMedia was called. */
    __fodtCameraCalls?: number;
    /** True once the hook has replaced getUserMedia (so a missing hook is told apart from a missing call). */
    __fodtCameraHooked?: boolean;
    /** Whether the hook will hand the page a real canvas stream (false: it counts the call and refuses it). */
    __fodtCameraStreams?: boolean;
    /** The page time of the first call of the held camera. */
    __fodtCameraCallAt?: number;
    /** Hands the held camera its stream. */
    __fodtReleaseCamera?: () => void;
    /** The page time at which the first worker said it was ready. */
    __fodtWorkerReadyAt?: number;
    /** Installed in the listening page of installReportingCamera: hands a camera event to the test. */
    __fodtReportTrack?: (kind: string) => void;
  }
}

const STREAM_TEXT = 'FODT-CAMERA-STREAM';
const CANARY = 'FODT-CAMERA-CANARY-7Q2';

/**
 * Module matrices of two QR codes (1 is a dark module), level M, made once with the qrcode 1.5.4 library from the reader
 * folder:
 *   cd tools/qr-barcode-reader && node -e "const Q=require('qrcode');for(const t of ['FODT-CAMERA-STREAM',
 *   'FODT-CAMERA-CANARY-7Q2']){const q=Q.create(t,{errorCorrectionLevel:'M'});const n=q.modules.size;
 *   for(let r=0;r<n;r++){let s='';for(let c=0;c<n;c++)s+=q.modules.data[r*n+c];console.log(s)}}"
 */
const MATRIX_STREAM = [
  '111111101101101111111',
  '100000101101101000001',
  '101110100101101011101',
  '101110101101001011101',
  '101110100101001011101',
  '100000100111101000001',
  '111111101010101111111',
  '000000001111100000000',
  '101101110111101001011',
  '101010011100111011111',
  '000111100001011001000',
  '001010010010000111101',
  '001111110100111100101',
  '000000001101011100100',
  '111111101110110001010',
  '100000101001100111010',
  '101110100010100000000',
  '101110101111000010010',
  '101110101100001010100',
  '100000100101111010000',
  '111111101011011100010',
];

const MATRIX_CANARY = [
  '1111111000000010001111111',
  '1000001011111100001000001',
  '1011101000100001001011101',
  '1011101000100100001011101',
  '1011101011110100101011101',
  '1000001001101011001000001',
  '1111111010101010101111111',
  '0000000001001001000000000',
  '1010101000100000100010010',
  '1011100100100101000110110',
  '1111111101101010000011110',
  '1110100111110111111110110',
  '0001101111000010101001111',
  '0101010001110010010001001',
  '1010101100100100000110100',
  '0101000000010001011010001',
  '1000101110101001111110100',
  '0000000010111100100010111',
  '1111111001111011101010001',
  '1000001000101110100010101',
  '1011101011110010111110100',
  '1011101001010011101011010',
  '1011101011100101001010001',
  '1000001000110000001001111',
  '1111111010101000100011101',
];

function outputArea(page: Page) {
  return page.locator('section[aria-label="Output"]');
}

function liveView(page: Page) {
  return page.locator('video[aria-label="Live camera view"]');
}

function runButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Run', exact: true });
}

function cancelButtonOf(page: Page) {
  return page.getByRole('button', { name: 'Cancel', exact: true });
}

async function openReader(page: Page): Promise<void> {
  await page.goto(rel('/tools/qr-barcode-reader'));
  await page.getByRole('button', { name: 'Reset', exact: true }).waitFor();
}

/** Picks a source radio and checks it stayed (the pages are prerendered, so a choice made at once can be undone). */
async function setSource(page: Page, value: 'file' | 'camera'): Promise<void> {
  const radio = page.locator(`input[name="source"][value="${value}"]`);
  await expect(async () => {
    await radio.check();
    await expect(radio).toBeChecked({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

/** Page time in milliseconds, read from the page itself so it follows the page clock. */
async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => Date.now());
}

/** Creates the page's test record before any page script runs. */
async function installCameraHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__FODT_CAMERA_TEST__ = { events: [] };
  });
}

/**
 * Whether the running test's engine is asked to supply scripted camera streams. Every engine that can make a canvas
 * stream is, except WebKit: its canvas stream playing in a video element could not be proven here (the web process of
 * WebKit for Linux ended when one was shown, in the setup this was tried in), and an unproven stream must not decide
 * whether a release is blocked. Where a stream is not supplied the hook counts the call and refuses it, and the test
 * proves the same rules on the page's plain message instead.
 */
function suppliesStreams(): boolean {
  return test.info().project.use.defaultBrowserType !== 'webkit';
}

/**
 * Replaces getUserMedia (where the browser has it) with a camera that shows a picture drawn on a canvas: the QR code of
 * `matrix` on white, or plain white for `null`. Every call is counted, and every track's stop is wrapped to end the
 * drawing timer. A browser without mediaDevices is left as it is. A browser that cannot make a canvas stream gets a
 * camera that is counted and then refused with "not found", which the page shows as its plain message.
 *
 * The function goes on MediaDevices.prototype where that interface exists, so a navigator.mediaDevices object the browser
 * makes again later (WebKit does after a garbage collection) still uses it; only a browser without the interface gets it
 * on the object itself.
 */
async function installScriptedCamera(page: Page, matrix: string[] | null): Promise<void> {
  await page.addInitScript(
    ({ rows, streams }) => {
      const holder: { getUserMedia?: unknown } | undefined =
        typeof MediaDevices !== 'undefined' && typeof MediaDevices.prototype.getUserMedia === 'function'
          ? MediaDevices.prototype
          : (navigator.mediaDevices ?? undefined);
      if (!holder || typeof holder.getUserMedia !== 'function') return;
      window.__fodtCameraCalls = 0;
      window.__fodtCameraHooked = true;
      const canStream = () => streams && typeof HTMLCanvasElement.prototype.captureStream === 'function';
      window.__fodtCameraStreams = canStream();
      const replacement = async () => {
        window.__fodtCameraCalls = (window.__fodtCameraCalls ?? 0) + 1;
        if (!canStream()) {
          throw new DOMException('This browser cannot make a canvas stream for the test.', 'NotFoundError');
        }
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const g = canvas.getContext('2d')!;
        const draw = () => {
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, 640, 480);
          if (rows) {
            const total = rows.length + 8;
            const scale = Math.floor(440 / total);
            const left = Math.floor((640 - total * scale) / 2);
            const top = Math.floor((480 - total * scale) / 2);
            g.fillStyle = '#000000';
            rows.forEach((row, r) => {
              for (let c = 0; c < row.length; c++) {
                if (row[c] === '1') g.fillRect(left + (c + 4) * scale, top + (r + 4) * scale, scale, scale);
              }
            });
          }
        };
        draw();
        // Redrawn so the stream keeps producing frames.
        const timer = setInterval(draw, 100);
        const stream = canvas.captureStream(10);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            clearInterval(timer);
            stop();
          };
        }
        return stream;
      };
      Object.defineProperty(holder, 'getUserMedia', { value: replacement, configurable: true, writable: true });
    },
    { rows: matrix, streams: suppliesStreams() },
  );
}

/**
 * Replaces getUserMedia with a camera that never answers until the test calls window.__fodtReleaseCamera(): as a
 * permission prompt nobody answers. The first call's page time is kept in window.__fodtCameraCallAt. Installed on
 * MediaDevices.prototype for the reason given at installScriptedCamera.
 */
async function installHeldCamera(page: Page): Promise<void> {
  await page.addInitScript((streams) => {
    const holder: { getUserMedia?: unknown } | undefined =
      typeof MediaDevices !== 'undefined' && typeof MediaDevices.prototype.getUserMedia === 'function'
        ? MediaDevices.prototype
        : (navigator.mediaDevices ?? undefined);
    if (!holder || typeof holder.getUserMedia !== 'function') return;
    window.__fodtCameraCalls = 0;
    window.__fodtCameraHooked = true;
    window.__fodtCameraStreams = streams && typeof HTMLCanvasElement.prototype.captureStream === 'function';
    let release: (() => void) | null = null;
    const replacement = () => {
      window.__fodtCameraCalls = (window.__fodtCameraCalls ?? 0) + 1;
      if (window.__fodtCameraCallAt === undefined) window.__fodtCameraCallAt = Date.now();
      return new Promise<MediaStream>((resolve) => {
        release = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 48;
          canvas.getContext('2d')!.fillRect(0, 0, 64, 48);
          resolve(canvas.captureStream(5));
        };
      });
    };
    Object.defineProperty(holder, 'getUserMedia', { value: replacement, configurable: true, writable: true });
    window.__fodtReleaseCamera = () => release?.();
  }, suppliesStreams());
}

/** Keeps the page time at which the first worker reported ready, so a limit that starts then can be bracketed. */
async function installWorkerReadyProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        this.addEventListener('message', (event) => {
          const type = (event.data as { type?: unknown } | null)?.type;
          if (typeof type === 'string' && type.endsWith('-ready') && window.__fodtWorkerReadyAt === undefined) {
            window.__fodtWorkerReadyAt = Date.now();
          }
        });
      }
    } as typeof Worker;
  });
}

/**
 * Like installScriptedCamera (a blank canvas stream), but every stream and every call of a track's stop() is also announced
 * on a BroadcastChannel, and a second page of the same context and origin hears the announcements and hands them to the
 * test. A page that is being left cannot report to the test itself (a function exposed to Chromium is not delivered during
 * pagehide, while a BroadcastChannel message is, in Chromium, Firefox and WebKit), so the second page stays open and
 * reports for it. Only the page's own call of stop() on a track is announced: the browser ending a page's tracks by itself
 * is not.
 */
async function installReportingCamera(page: Page, reports: string[]): Promise<void> {
  const listener = await page.context().newPage();
  await listener.exposeFunction('__fodtReportTrack', (kind: string) => {
    reports.push(kind);
  });
  await listener.goto(rel('/about'));
  await listener.evaluate(() => {
    const channel = new BroadcastChannel('fodt-camera-test');
    channel.onmessage = (event) => window.__fodtReportTrack?.(String(event.data));
  });
  await page.addInitScript((streams) => {
    const holder: { getUserMedia?: unknown } | undefined =
      typeof MediaDevices !== 'undefined' && typeof MediaDevices.prototype.getUserMedia === 'function'
        ? MediaDevices.prototype
        : (navigator.mediaDevices ?? undefined);
    if (!holder || typeof holder.getUserMedia !== 'function') return;
    window.__fodtCameraCalls = 0;
    window.__fodtCameraHooked = true;
    const canStream = () => streams && typeof HTMLCanvasElement.prototype.captureStream === 'function';
    window.__fodtCameraStreams = canStream();
    const channel = new BroadcastChannel('fodt-camera-test');
    const replacement = async () => {
      window.__fodtCameraCalls = (window.__fodtCameraCalls ?? 0) + 1;
      if (!canStream())
        throw new DOMException('This browser cannot make a canvas stream for the test.', 'NotFoundError');
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 48;
      const g = canvas.getContext('2d')!;
      const draw = () => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, 64, 48);
      };
      draw();
      const timer = setInterval(draw, 100);
      const stream = canvas.captureStream(10);
      channel.postMessage('start');
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          clearInterval(timer);
          channel.postMessage('stop');
          stop();
        };
      }
      return stream;
    };
    Object.defineProperty(holder, 'getUserMedia', { value: replacement, configurable: true, writable: true });
  }, suppliesStreams());
}

/**
 * Makes the reader's background worker fail, from before any page script runs. With `error`, the first worker raises an
 * error event as soon as it is built (a worker whose module cannot be evaluated does). With `silent`, the page never hears
 * the worker's ready message (as if the module never finished loading), and the page time of the swallowed message is kept in
 * window.__fodtWorkerReadyAt.
 */
async function installFailingReaderWorker(page: Page, mode: 'error' | 'silent'): Promise<void> {
  await page.addInitScript((how) => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        if (how === 'error') {
          setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'probe' })), 0);
          return;
        }
        const add = this.addEventListener.bind(this) as (...args: unknown[]) => void;
        this.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, opts?: unknown) => {
          if (type !== 'message' || typeof listener !== 'function') {
            add(type, listener, opts);
            return;
          }
          add(
            type,
            (event: MessageEvent) => {
              const kind = (event.data as { type?: unknown } | null)?.type;
              if (typeof kind === 'string' && kind.endsWith('-ready')) {
                window.__fodtWorkerReadyAt = Date.now();
                return;
              }
              listener.call(this, event);
            },
            opts,
          );
        }) as typeof this.addEventListener;
      }
    } as typeof Worker;
  }, mode);
}

/** Everything the recorder has seen since it was started. */
interface Recording {
  requests: { url: string; method: string; postData: string }[];
  consoleTexts: string[];
  pageErrors: string[];
}

/** Starts recording every request (address, method and body), console message and page error from now on. */
function recordEverything(page: Page): Recording {
  const recording: Recording = { requests: [], consoleTexts: [], pageErrors: [] };
  page.on('request', (request) => {
    recording.requests.push({ url: request.url(), method: request.method(), postData: request.postData() ?? '' });
  });
  page.on('console', (message) => recording.consoleTexts.push(message.text()));
  page.on('pageerror', (error) => recording.pageErrors.push(error.message));
  return recording;
}

/** Whether a piece of text holds any marker, as written or percent-encoded. */
function holdsAny(text: string, markers: string[]): boolean {
  return markers.some((marker) => text.includes(marker) || text.includes(encodeURIComponent(marker)));
}

/**
 * Asserts the marker went nowhere. Requests: each goes to the page's own origin or is a data or blob address, and none
 * holds a marker in its address or body. Messages: no console message or page error holds a marker. Everything else: the
 * page address, the document title, cookies, localStorage and sessionStorage hold none, no IndexedDB database or Cache
 * Storage entry exists, and the private file system root has no entries (each only where the browser offers the
 * interface). The list of markers must not be empty, so a silent pass is impossible.
 */
async function assertNothingLeft(page: Page, recording: Recording, markers: string[]): Promise<void> {
  expect(markers.length, 'there is no marker to look for').toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  for (const request of recording.requests) {
    const own =
      request.url.startsWith('data:') || request.url.startsWith('blob:') || request.url.startsWith(`${origin}/`);
    expect(own, `a request left the page's own origin: ${request.method} ${request.url.slice(0, 80)}`).toBe(true);
    expect(holdsAny(request.url, markers), `a request address holds the marker: ${request.url.slice(0, 80)}`).toBe(
      false,
    );
    expect(holdsAny(request.postData, markers), `a request body holds the marker: ${request.url.slice(0, 80)}`).toBe(
      false,
    );
  }
  for (const text of [...recording.consoleTexts, ...recording.pageErrors]) {
    expect(holdsAny(text, markers), 'a console message or page error holds the marker').toBe(false);
  }
  expect(holdsAny(page.url(), markers), 'the page address holds the marker').toBe(false);
  expect(holdsAny(await page.title(), markers), 'the document title holds the marker').toBe(false);
  expect(holdsAny(JSON.stringify(await page.context().cookies()), markers), 'a cookie holds the marker').toBe(false);

  const inPage = await page.evaluate(async () => {
    const read = (store: Storage): string => {
      const entries: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i) ?? '';
        entries.push(`${key}=${store.getItem(key) ?? ''}`);
      }
      return entries.join('\n');
    };
    const result = {
      local: read(window.localStorage),
      session: read(window.sessionStorage),
      databases: [] as string[],
      caches: [] as string[],
      privateFiles: [] as string[],
    };
    const indexed = window.indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> };
    if (typeof indexed.databases === 'function') {
      result.databases = (await indexed.databases()).map((db) => db.name ?? '(unnamed)');
    }
    if (typeof window.caches !== 'undefined') result.caches = await window.caches.keys();
    const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
    if (typeof storage?.getDirectory === 'function') {
      try {
        const root = await storage.getDirectory();
        // Iterating a directory handle is not in every TypeScript library the project builds with.
        const entries = (root as unknown as { keys: () => AsyncIterable<string> }).keys();
        for await (const name of entries) result.privateFiles.push(name);
      } catch {
        // A browser that refuses the private file system to this page has nothing stored in it by this page.
      }
    }
    return result;
  });
  expect(holdsAny(inPage.local, markers), 'localStorage holds the marker').toBe(false);
  expect(holdsAny(inPage.session, markers), 'sessionStorage holds the marker').toBe(false);
  expect(inPage.databases, 'an IndexedDB database exists').toEqual([]);
  expect(inPage.caches, 'a Cache Storage entry exists').toEqual([]);
  expect(inPage.privateFiles, 'the private file system holds entries').toEqual([]);
}

/** What the page noted about camera tracks, boiled down to the numbers a test compares. */
async function trackSummary(page: Page): Promise<{ started: number; ended: number; late: number; allEnded: boolean }> {
  const events = await page.evaluate(() => window.__FODT_CAMERA_TEST__!.events);
  const finished = events.filter((e) => e.kind === 'session-end' || e.kind === 'late-stream-stopped');
  return {
    started: events.filter((e) => e.kind === 'stream-started').length,
    ended: events.filter((e) => e.kind === 'session-end').length,
    late: events.filter((e) => e.kind === 'late-stream-stopped').length,
    allEnded: finished.every((e) => e.states.length > 0 && e.states.every((s) => s === 'ended')),
  };
}

/**
 * One 640 by 480 I420 frame of a QR code on white, as the bytes of a .y4m file (header, one FRAME line, the Y plane, the
 * U plane and the V plane), which is what Chromium's fake camera device can be told to show.
 */
function y4mFromMatrix(rows: string[]): Buffer {
  const width = 640;
  const height = 480;
  const total = rows.length + 8;
  const scale = Math.floor(440 / total);
  const left = Math.floor((width - total * scale) / 2);
  const top = Math.floor((height - total * scale) / 2);
  const luma = Buffer.alloc(width * height, 255);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r]!.length; c++) {
      if (rows[r]![c] !== '1') continue;
      for (let y = 0; y < scale; y++) {
        const start = (top + (r + 4) * scale + y) * width + left + (c + 4) * scale;
        luma.fill(0, start, start + scale);
      }
    }
  }
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
  return Buffer.concat([
    Buffer.from('YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420jpeg\nFRAME\n', 'ascii'),
    luma,
    chroma,
    chroma,
  ]);
}

/** Picks Camera and presses Run on the open page. */
async function chooseCameraAndRun(page: Page): Promise<void> {
  await setSource(page, 'camera');
  await runButtonOf(page).click();
}

/** Opens the page, picks Camera and presses Run. */
async function startCamera(page: Page): Promise<void> {
  await openReader(page);
  await chooseCameraAndRun(page);
}

/** What this engine offers a test: the camera interface itself, and the means to build a stream for it from a canvas. */
async function cameraSupport(page: Page): Promise<{ hasCamera: boolean; canStream: boolean }> {
  return page.evaluate(() => ({
    hasCamera: typeof navigator.mediaDevices?.getUserMedia === 'function',
    canStream: window.__fodtCameraStreams === true,
  }));
}

/**
 * Opens the page for a test that needs a scripted camera stream. The test is skipped, with the reason, only where the
 * engine itself cannot supply one: no camera interface, or no canvas streams. The engine's name decides nothing.
 */
async function openScriptedReader(page: Page): Promise<void> {
  await openReader(page);
  const support = await cameraSupport(page);
  test.skip(
    !support.hasCamera || !support.canStream,
    'this browser has no camera interface or cannot make a canvas stream, so a camera cannot be scripted',
  );
  expect(
    await page.evaluate(() => window.__fodtCameraHooked === true),
    'the scripted getUserMedia was not installed on this page',
  ).toBe(true);
}

/**
 * Freezes the page clock a little after `seen` and returns how much page time a timer that began between `earliest` and
 * `seen` has used up at that point: at least `atLeast` and at most `atMost`. Page time stands still from here until
 * `page.clock.runFor` moves it, so a limit is crossed to the millisecond, not at the speed of the machine.
 */
async function freezeClock(page: Page, earliest: number, seen: number): Promise<{ atLeast: number; atMost: number }> {
  const pausedAt = seen + 2_000;
  await page.clock.pauseAt(pausedAt);
  return { atLeast: pausedAt - seen, atMost: pausedAt - earliest };
}

test('qr-barcode-reader: a browser with no camera interface shows a plain message and starts nothing', async ({
  page,
}) => {
  // Chromium and Firefox have the interface, so it is removed for this page; the pinned WebKit never had it.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'mediaDevices', { get: () => undefined, configurable: true });
  });
  await installCameraHook(page);
  await startCamera(page);
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    'This browser cannot open a camera from a web page.',
  );
  await expect(page.locator('video')).toHaveCount(0);
  expect(await page.evaluate(() => window.__FODT_CAMERA_TEST__!.events)).toEqual([]);
});

const CAMERA_DENIED_TEXT = 'The camera could not be opened: access was refused or no camera was found.';

/**
 * The camera starts only when Camera is chosen AND Run is pressed, in whatever way the engine lets the test supply a
 * camera. Where the engine has no camera interface, Run gives the plain message and starts nothing. Where it has one and a
 * stream can be made, Run calls getUserMedia exactly once, the view shows, and Cancel ends it with every track ended. Where
 * it has one but no stream can be made, Run still calls getUserMedia exactly once and the page shows its plain message,
 * with no view and no track. Every branch also proves that choosing the source, back and forth, calls nothing.
 */
async function proveCameraStartsOnlyOnRun(page: Page): Promise<void> {
  await installCameraHook(page);
  await openReader(page);
  const { hasCamera, canStream } = await cameraSupport(page);
  if (hasCamera) {
    expect(
      await page.evaluate(() => window.__fodtCameraHooked === true),
      'the counting getUserMedia was not installed on this page',
    ).toBe(true);
  }
  const calls = () => page.evaluate(() => window.__fodtCameraCalls ?? 0);

  // Choosing the source, and changing it back and forth, never opens the camera.
  await setSource(page, 'camera');
  await page.waitForTimeout(700);
  expect(await calls()).toBe(0);
  await expect(page.locator('video')).toHaveCount(0);
  await setSource(page, 'file');
  await setSource(page, 'camera');
  await page.waitForTimeout(300);
  expect(await calls()).toBe(0);

  await runButtonOf(page).click();
  if (!hasCamera) {
    // A browser with no camera interface (the pinned WebKit on Windows): the plain message, and nothing starts.
    await expect(outputArea(page).locator('.issue-list')).toContainText(
      'This browser cannot open a camera from a web page.',
    );
    await expect(page.locator('video')).toHaveCount(0);
    expect(await trackSummary(page)).toEqual({ started: 0, ended: 0, late: 0, allEnded: true });
    return;
  }
  await expect.poll(calls).toBe(1);
  if (!canStream) {
    // The camera interface is there but the test cannot make a stream: it is asked once, refuses, and the page says so.
    await expect(outputArea(page).locator('.issue-list')).toContainText(CAMERA_DENIED_TEXT);
    await expect(page.locator('video')).toHaveCount(0);
    expect(await trackSummary(page)).toEqual({ started: 0, ended: 0, late: 0, allEnded: true });
    await page.waitForTimeout(300);
    expect(await calls()).toBe(1);
    return;
  }
  await expect(liveView(page)).toBeVisible();
  await cancelButtonOf(page).click();
  await expect(liveView(page)).toHaveCount(0);
  expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
  expect(await calls()).toBe(1);
}

test('qr-barcode-reader: the camera starts only when Run is pressed in camera mode', async ({ page }) => {
  await installScriptedCamera(page, null);
  await proveCameraStartsOnlyOnRun(page);
});

test('qr-barcode-reader: the camera starts only when Run is pressed, also where the test cannot make a stream', async ({
  page,
}) => {
  // Takes canvas streams away from the page, as in an engine that has the camera interface but no way to script a stream.
  await page.addInitScript(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { value: undefined, configurable: true });
  });
  await installScriptedCamera(page, null);
  await proveCameraStartsOnlyOnRun(page);
});

test('qr-barcode-reader: a QR code shown to a fake camera is read, the view is removed and every camera track ends', async ({
  playwright,
  browserName,
  baseURL,
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'the fake camera device flags exist only in Chromium and mobile Chrome');
  const picture = testInfo.outputPath('qr-frame.y4m');
  writeFileSync(picture, y4mFromMatrix(MATRIX_STREAM));
  const browser = await playwright.chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${picture}`,
    ],
  });
  try {
    const device = testInfo.project.name === 'mobile-chrome' ? playwright.devices['Pixel 7'] : {};
    const context = await browser.newContext({ ...device, permissions: ['camera'], baseURL });
    const page = await context.newPage();
    await installCameraHook(page);
    const recording = recordEverything(page);
    await startCamera(page);
    await expect(liveView(page)).toBeVisible({ timeout: 20_000 });
    await expect(outputArea(page)).toContainText(STREAM_TEXT, { timeout: 30_000 });
    await expect(liveView(page)).toHaveCount(0);
    expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
    await assertNothingLeft(page, recording, [STREAM_TEXT]);
  } finally {
    await browser.close();
  }
});

test('qr-barcode-reader: a scripted camera stream carrying a QR code is read and every track ends', async ({
  page,
}) => {
  await installScriptedCamera(page, MATRIX_STREAM);
  await installCameraHook(page);
  await openScriptedReader(page);
  await chooseCameraAndRun(page);
  await expect(outputArea(page)).toContainText(STREAM_TEXT, { timeout: 30_000 });
  await expect(liveView(page)).toHaveCount(0);
  expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
});

test('qr-barcode-reader: Cancel stops the camera at once, removes the view and ends every track', async ({ page }) => {
  await installScriptedCamera(page, null);
  await installCameraHook(page);
  await openScriptedReader(page);
  await chooseCameraAndRun(page);
  await expect(liveView(page)).toBeVisible();
  await expect.poll(async () => (await trackSummary(page)).started).toBe(1);

  await cancelButtonOf(page).click();
  // At once: the view is gone and the track has ended within a second of the press.
  await expect(liveView(page)).toHaveCount(0, { timeout: 1_000 });
  expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
  await expect(outputArea(page)).toContainText('Cancelled before finishing');

  // A second session, ended by switching the source to Image file (an edit abandons the run): the view goes and every
  // track ends too (research Pitfall 7: the view sits inside a panel React renders).
  await runButtonOf(page).click();
  await expect(liveView(page)).toBeVisible();
  await expect.poll(async () => (await trackSummary(page)).started).toBe(2);
  await setSource(page, 'file');
  await expect(liveView(page)).toHaveCount(0, { timeout: 1_000 });
  expect(await trackSummary(page)).toEqual({ started: 2, ended: 2, late: 0, allEnded: true });
});

test('qr-barcode-reader: really leaving the page, by a navigation, stops the camera and ends every track', async ({
  page,
}) => {
  // The page is gone after a navigation, so what it did is announced to a second page of the same site while it happens (see
  // installReportingCamera). Only the page's own call of stop() on a track is announced: the browser ending a page's tracks
  // by itself is not. The old form of this test dispatched a made-up pagehide event, which proves the listener exists but not
  // that a real departure fires it.
  const reports: string[] = [];
  await installReportingCamera(page, reports);
  await installCameraHook(page);
  await openScriptedReader(page);
  await chooseCameraAndRun(page);
  await expect(liveView(page)).toBeVisible();
  await expect.poll(() => reports.filter((kind) => kind === 'start').length).toBe(1);

  await page.goto('about:blank');
  await expect.poll(() => reports.filter((kind) => kind === 'stop').length, { timeout: 5_000 }).toBe(1);
  expect(reports).toEqual(['start', 'stop']);
});

test('qr-barcode-reader: with no code in view the camera stops after 30 seconds with a plain message', async ({
  page,
}) => {
  await installScriptedCamera(page, null);
  await installCameraHook(page);
  await installWorkerReadyProbe(page);
  await page.clock.install();
  await openScriptedReader(page);
  const pressedAt = await pageNow(page);
  await chooseCameraAndRun(page);
  await expect(liveView(page)).toBeVisible();

  // The 30 second timer starts when the camera's stream arrives, which is after Run was pressed and before the reader
  // worker is ready. Page time is frozen a little after the worker is ready, then moved by exact amounts: still running
  // while no more than 29.5 seconds can have passed on the timer (counted from the press), stopped once at least 30.1
  // seconds have (counted from the moment the worker was seen ready).
  await expect.poll(() => page.evaluate(() => window.__fodtWorkerReadyAt ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  const used = await freezeClock(page, pressedAt, await pageNow(page));
  const limit = 30_000;

  const early = Math.max(0, limit - 500 - used.atMost);
  await page.clock.runFor(early);
  await expect(liveView(page)).toBeVisible();
  await expect(outputArea(page)).not.toContainText('Stopped after');
  expect((await trackSummary(page)).ended).toBe(0);

  await page.clock.runFor(Math.max(1, limit + 100 - used.atLeast - early));
  await expect(outputArea(page).locator('.issue-list')).toContainText('Stopped after 30 seconds', { timeout: 5_000 });
  await expect(liveView(page)).toHaveCount(0);
  expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
});

test('qr-barcode-reader: a camera that never answers is given up after 15 seconds and a late stream is stopped at once', async ({
  page,
}) => {
  await installHeldCamera(page);
  await installCameraHook(page);
  await page.clock.install();
  await openScriptedReader(page);
  await chooseCameraAndRun(page);
  await expect.poll(() => page.evaluate(() => window.__fodtCameraCalls ?? 0)).toBe(1);
  await expect(cancelButtonOf(page)).toBeVisible();

  // The start timer began a moment before the page asked for the camera. Page time is frozen a little after that call,
  // then moved by exact amounts: no message while no more than 14.5 seconds can have passed, the message once at least
  // 15.1 seconds have.
  const callAt = await page.evaluate(() => window.__fodtCameraCallAt!);
  const used = await freezeClock(page, callAt - 5, await pageNow(page));
  const limit = 15_000;

  const early = Math.max(0, limit - 500 - used.atMost);
  await page.clock.runFor(early);
  await expect(outputArea(page)).not.toContainText('did not start');
  await expect(page.locator('video')).toHaveCount(0);

  await page.clock.runFor(Math.max(1, limit + 100 - used.atLeast - early));
  await expect(outputArea(page).locator('.issue-list')).toContainText('The camera did not start within 15 seconds.', {
    timeout: 5_000,
  });

  // A stream that arrives after the page gave up is stopped at once and never shown.
  await page.evaluate(() => window.__fodtReleaseCamera!());
  await expect.poll(async () => (await trackSummary(page)).late).toBe(1);
  expect(await trackSummary(page)).toEqual({ started: 0, ended: 0, late: 1, allEnded: true });
  await expect(page.locator('video')).toHaveCount(0);
});

test('qr-barcode-reader: the canary read from camera frames never reaches a request, storage, the console, the title or the address', async ({
  page,
}) => {
  await installScriptedCamera(page, MATRIX_CANARY);
  await installCameraHook(page);
  const recording = recordEverything(page);
  await openScriptedReader(page);
  await chooseCameraAndRun(page);
  // The canary is read from the frames and shown in the page ...
  await expect(outputArea(page)).toContainText(CANARY, { timeout: 30_000 });
  await expect(liveView(page)).toHaveCount(0);
  expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
  // ... and is found nowhere else.
  await assertNothingLeft(page, recording, [CANARY]);
});

test('qr-barcode-reader: the Firefox fake camera device starts and every track ends on Cancel', async ({
  playwright,
  browserName,
  baseURL,
}) => {
  test.skip(browserName !== 'firefox', 'the fake device preferences exist only in Firefox');
  const browser = await playwright.firefox.launch({
    firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true },
  });
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await installCameraHook(page);
    await startCamera(page);
    await expect(liveView(page)).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await trackSummary(page)).started).toBe(1);
    await cancelButtonOf(page).click();
    await expect(liveView(page)).toHaveCount(0, { timeout: 1_000 });
    expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
  } finally {
    await browser.close();
  }
});

test('qr-barcode-reader: Cancel while the permission prompt is open stops a stream that arrives afterwards and shows no view', async ({
  page,
}) => {
  await installHeldCamera(page);
  await installCameraHook(page);
  await openScriptedReader(page);
  await chooseCameraAndRun(page);
  await expect.poll(() => page.evaluate(() => window.__fodtCameraCalls ?? 0)).toBe(1);
  await expect(cancelButtonOf(page)).toBeVisible();
  await cancelButtonOf(page).click();
  await expect(outputArea(page)).toContainText('Cancelled before finishing');
  await expect(page.locator('video')).toHaveCount(0);

  // The prompt is answered now: the stream that arrives is stopped at once, and no view or session starts for it.
  await page.evaluate(() => window.__fodtReleaseCamera!());
  await expect.poll(async () => (await trackSummary(page)).late).toBe(1);
  expect(await trackSummary(page)).toEqual({ started: 0, ended: 0, late: 1, allEnded: true });
  await page.waitForTimeout(300);
  await expect(page.locator('video')).toHaveCount(0);
  await expect(outputArea(page)).toContainText('Cancelled before finishing');
});

test('qr-barcode-reader: switching the source while the permission prompt is open stops a stream that arrives afterwards', async ({
  page,
}) => {
  await installHeldCamera(page);
  await installCameraHook(page);
  await openScriptedReader(page);
  await chooseCameraAndRun(page);
  await expect.poll(() => page.evaluate(() => window.__fodtCameraCalls ?? 0)).toBe(1);
  // An edit abandons the run, as Cancel does.
  await setSource(page, 'file');
  await expect(page.locator('video')).toHaveCount(0);

  await page.evaluate(() => window.__fodtReleaseCamera!());
  await expect.poll(async () => (await trackSummary(page)).late).toBe(1);
  expect(await trackSummary(page)).toEqual({ started: 0, ended: 0, late: 1, allEnded: true });
  await page.waitForTimeout(300);
  await expect(page.locator('video')).toHaveCount(0);
  expect(await page.evaluate(() => window.__fodtCameraCalls ?? 0)).toBe(1);
});

test('qr-barcode-reader: a reader worker that fails to start ends the camera at once with its plain message and every track ends', async ({
  page,
}) => {
  await installScriptedCamera(page, null);
  await installFailingReaderWorker(page, 'error');
  await installCameraHook(page);
  await openScriptedReader(page);
  await chooseCameraAndRun(page);
  await expect(outputArea(page).locator('.issue-list')).toContainText('The background task could not start.', {
    timeout: 15_000,
  });
  await expect(page.locator('video')).toHaveCount(0);
  expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
});

test('qr-barcode-reader: a reader worker that never reports ready is given up after 10 seconds, and the camera and every track end', async ({
  page,
}) => {
  await installScriptedCamera(page, null);
  await installFailingReaderWorker(page, 'silent');
  await installCameraHook(page);
  await page.clock.install();
  await openScriptedReader(page);
  const pressedAt = await pageNow(page);
  await chooseCameraAndRun(page);
  await expect(liveView(page)).toBeVisible();

  // The worker's 10 second start limit begins when it is built, after the stream arrived and the view played: after
  // Run was pressed and before the ready message that the page was never allowed to hear. Page time is frozen a little
  // after that, then moved by exact amounts: no message while no more than 9.5 seconds can have passed, the message once
  // at least 10.1 seconds have.
  await expect.poll(() => page.evaluate(() => window.__fodtWorkerReadyAt ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(150);
  const used = await freezeClock(page, pressedAt, await pageNow(page));
  const limit = 10_000;

  const early = Math.max(0, limit - 500 - used.atMost);
  await page.clock.runFor(early);
  await expect(outputArea(page)).not.toContainText('did not start');
  expect((await trackSummary(page)).ended).toBe(0);

  await page.clock.runFor(Math.max(1, limit + 100 - used.atLeast - early));
  await expect(outputArea(page).locator('.issue-list')).toContainText(
    'The background task did not start within 10 seconds. Reload the page and try again.',
    { timeout: 5_000 },
  );
  await expect(liveView(page)).toHaveCount(0);
  expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
});

test('qr-barcode-reader: a camera view that cannot play ends the camera with its plain message and every track ends', async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () =>
      Promise.reject(new DOMException('The probe refuses to play.', 'NotAllowedError'));
  });
  await installScriptedCamera(page, null);
  await installCameraHook(page);
  await openScriptedReader(page);
  await chooseCameraAndRun(page);
  await expect(outputArea(page).locator('.issue-list')).toContainText('The camera could not be started.', {
    timeout: 15_000,
  });
  await expect(page.locator('video')).toHaveCount(0);
  expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
});

test('qr-barcode-reader: a camera view that never starts playing still stops after 30 seconds from the moment the stream arrived', async ({
  page,
}) => {
  // The view's play() never settles, as a camera that opens but never delivers a frame. Nothing after play() runs, so the
  // limit can only be the one armed when the stream arrived.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => new Promise<void>(() => undefined);
  });
  await installScriptedCamera(page, null);
  await installCameraHook(page);
  await page.clock.install();
  await openScriptedReader(page);
  const pressedAt = await pageNow(page);
  await chooseCameraAndRun(page);
  await expect.poll(async () => (await trackSummary(page)).started).toBe(1);
  await expect(liveView(page)).toBeVisible();

  // Page time is frozen a little after the stream arrived, then moved by exact amounts: still running while no more than
  // 29.5 seconds can have passed on the timer (counted from the press), stopped once at least 30.1 seconds have (counted
  // from the moment the arrival was seen).
  const used = await freezeClock(page, pressedAt, await pageNow(page));
  const limit = 30_000;

  const early = Math.max(0, limit - 500 - used.atMost);
  await page.clock.runFor(early);
  await expect(liveView(page)).toBeVisible();
  await expect(outputArea(page)).not.toContainText('Stopped after');
  expect((await trackSummary(page)).ended).toBe(0);

  await page.clock.runFor(Math.max(1, limit + 100 - used.atLeast - early));
  await expect(outputArea(page).locator('.issue-list')).toContainText('Stopped after 30 seconds', { timeout: 5_000 });
  await expect(liveView(page)).toHaveCount(0);
  expect(await trackSummary(page)).toEqual({ started: 1, ended: 1, late: 0, allEnded: true });
});
