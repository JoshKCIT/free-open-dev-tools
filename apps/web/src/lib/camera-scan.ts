/**
 * A page-local camera session for the QR Code & Barcode Reader: it opens the camera only when a run asks it to (the
 * visitor chose Camera and pressed Run), shows the live view inside the Output panel while it looks for a code, reads one
 * frame at a time in the reader worker, and ends the camera on EVERY way out -- a code was read, Cancel, an edit or a new
 * run (both abort the run), the page being left, the 15 second start limit, the 30 second session limit, or any error.
 * The session limit is one timer armed the moment the camera's stream arrives, so the camera is always stopped within 30
 * seconds of opening however long the view takes to play or the reader's worker takes to start.
 * Ending means every track is stopped, the view is removed and the worker is closed, all in the same turn as the event
 * that ended it, so a new camera can never be requested while an old one is still running.
 *
 * Nothing here records, encodes or keeps a frame. Each frame is drawn to ONE reused canvas, at most 1280 pixels wide,
 * read as pixels and handed to the worker; the pixels are never turned into a file, a data address or a video.
 *
 * `getUserMedia` is raced against a 15 second limit because a permission prompt nobody answers never settles on its own
 * in every engine (the shared privacy harness would otherwise wait on it forever in Firefox). A stream that arrives after
 * the limit has been given up on is stopped at once.
 *
 * The view is a plain element added at the top of the Output panel's body and removed again in the same place that
 * stops the tracks. Nothing in the shared page shell changes: the panel keeps rendering its own children around it.
 *
 * A test-only record: when a browser test has set `window.__FODT_CAMERA_TEST__` before the page loads, the state of every
 * track is noted when a stream arrives and again once it has been stopped, so a test can prove that no track outlived its
 * session. Absent -- every real visit -- nothing is recorded.
 */
import { MAX_FRAME_WIDTH, type CodeResult } from '@fodt/qr-barcode-reader';
import type { ReaderSession } from './run-qr-barcode-reader-in-worker';
import type { RunContext } from './tool-ui';

export const CAMERA_START_LIMIT_MS = 15000;

export const CAMERA_SESSION_LIMIT_MS = 30000;

export const CAMERA_FRAME_INTERVAL_MS = 150;

export const CAMERA_UNSUPPORTED_MESSAGE = 'This browser cannot open a camera from a web page.';

export const CAMERA_START_LIMIT_MESSAGE =
  'The camera did not start within 15 seconds. Allow camera access when the browser asks, or pick an image file instead.';

export const CAMERA_DENIED_MESSAGE = 'The camera could not be opened: access was refused or no camera was found.';

export const CAMERA_SESSION_LIMIT_MESSAGE =
  'Stopped after 30 seconds without finding a code. Hold the code closer and steadier, then press Run again.';

const CAMERA_FAILED_MESSAGE = 'The camera could not be started.';

const CAMERA_VIEW_MESSAGE = 'The live camera view could not be shown on this page.';

const CAMERA_CANCELLED_MESSAGE = 'The run was cancelled.';

const CAMERA_PAGE_LEFT_MESSAGE = 'The camera was stopped because the page was left.';

export class CameraScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CameraScanError';
  }
}

declare global {
  interface Window {
    /** Set by a browser test before the page loads; records the state of every camera track. Absent on a real visit. */
    __FODT_CAMERA_TEST__?: { events: { kind: string; states: string[] }[] };
  }
}

function note(kind: string, tracks: MediaStreamTrack[]): void {
  window.__FODT_CAMERA_TEST__?.events.push({ kind, states: tracks.map((track) => track.readyState) });
}

function stopTracks(stream: MediaStream): MediaStreamTrack[] {
  const tracks = stream.getTracks();
  for (const track of tracks) track.stop();
  return tracks;
}

type Outcome = { ok: true; results: CodeResult[] } | { ok: false; error: Error };

/**
 * Opens the camera and resolves with the codes of the first frame that holds any. Rejects with a CameraScanError (or the
 * reader's own error) with a fixed plain sentence for every other ending. `openSession` starts the reader worker.
 */
export function scanWithCamera(
  ctx: RunContext,
  openSession: (ctx: RunContext) => Promise<ReaderSession>,
): Promise<CodeResult[]> {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!devices || typeof devices.getUserMedia !== 'function') {
    return Promise.reject(new CameraScanError(CAMERA_UNSUPPORTED_MESSAGE));
  }
  if (ctx.signal.aborted) return Promise.reject(new CameraScanError(CAMERA_CANCELLED_MESSAGE));
  const host = document.querySelector('section[aria-label="Output"] .panel-body');
  if (!host) return Promise.reject(new CameraScanError(CAMERA_VIEW_MESSAGE));

  return new Promise<CodeResult[]>((resolve, reject) => {
    // Aborts the reader worker's own start when this session ends first (its helper listens to this signal).
    const inner = new AbortController();
    let finished = false;
    let stream: MediaStream | null = null;
    let container: HTMLElement | null = null;
    let video: HTMLVideoElement | null = null;
    let session: ReaderSession | null = null;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    let limitTimer: ReturnType<typeof setTimeout> | undefined;
    let frameTimer: ReturnType<typeof setInterval> | undefined;
    let busy = false;

    /** Stops everything, once, in the turn that asks for it. */
    const cleanup = () => {
      clearTimeout(startTimer);
      clearTimeout(limitTimer);
      clearInterval(frameTimer);
      window.removeEventListener('pagehide', onPageHide);
      ctx.signal.removeEventListener('abort', onCancel);
      inner.abort();
      let tracks: MediaStreamTrack[] = [];
      if (stream) {
        tracks = stopTracks(stream);
        stream = null;
      }
      if (video) video.srcObject = null;
      container?.remove();
      container = null;
      video = null;
      session?.close();
      session = null;
      if (tracks.length > 0) note('session-end', tracks);
    };

    const end = (outcome: Outcome) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (outcome.ok) resolve(outcome.results);
      else reject(outcome.error);
    };

    const onCancel = () => end({ ok: false, error: new CameraScanError(CAMERA_CANCELLED_MESSAGE) });
    const onPageHide = () => end({ ok: false, error: new CameraScanError(CAMERA_PAGE_LEFT_MESSAGE) });
    const fail = (err: unknown) =>
      end({ ok: false, error: err instanceof Error ? err : new CameraScanError(CAMERA_FAILED_MESSAGE) });

    ctx.signal.addEventListener('abort', onCancel, { once: true });
    window.addEventListener('pagehide', onPageHide);

    // One canvas, reused for every frame, never added to the document.
    const canvas = document.createElement('canvas');
    const drawing = canvas.getContext('2d', { willReadFrequently: true });

    const tick = async () => {
      if (finished || busy || !session || !video || !drawing) return;
      const source = video;
      if (source.readyState < 2 || source.videoWidth === 0) return;
      busy = true;
      try {
        const scale = Math.min(1, MAX_FRAME_WIDTH / source.videoWidth);
        const width = Math.max(1, Math.round(source.videoWidth * scale));
        const height = Math.max(1, Math.round(source.videoHeight * scale));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        drawing.drawImage(source, 0, 0, width, height);
        const frame = drawing.getImageData(0, 0, width, height);
        const results = await session.read({ data: frame.data, width, height });
        if (!finished && results.length > 0) end({ ok: true, results });
      } catch (err) {
        fail(err);
      } finally {
        busy = false;
      }
    };

    const start = async () => {
      // The permission wait is bounded: a prompt nobody answers is given up on after the start limit.
      startTimer = setTimeout(() => {
        end({ ok: false, error: new CameraScanError(CAMERA_START_LIMIT_MESSAGE) });
      }, CAMERA_START_LIMIT_MS);
      let arrived: MediaStream;
      try {
        arrived = await devices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        throw new CameraScanError(
          name === 'NotAllowedError' || name === 'NotFoundError' ? CAMERA_DENIED_MESSAGE : CAMERA_FAILED_MESSAGE,
        );
      }
      clearTimeout(startTimer);
      if (finished) {
        // The run was given up on while the camera was starting: the late stream is stopped at once.
        note('late-stream-stopped', stopTracks(arrived));
        return;
      }
      stream = arrived;
      note('stream-started', stream.getTracks());
      // The one overall limit of the session, armed now: a view whose play() never settles, or a worker that is slow to
      // start, cannot keep the camera on past it.
      limitTimer = setTimeout(() => {
        end({ ok: false, error: new CameraScanError(CAMERA_SESSION_LIMIT_MESSAGE) });
      }, CAMERA_SESSION_LIMIT_MS);

      const element = document.createElement('video');
      element.muted = true;
      element.playsInline = true;
      element.setAttribute('aria-label', 'Live camera view');
      element.style.width = '100%';
      element.style.maxWidth = '360px';
      element.style.display = 'block';
      element.style.borderRadius = '6px';
      element.style.background = '#000';
      element.srcObject = stream;
      const box = document.createElement('div');
      box.append(element);
      host.prepend(box);
      video = element;
      container = box;
      try {
        await element.play();
      } catch {
        throw new CameraScanError(CAMERA_FAILED_MESSAGE);
      }
      if (finished) return;

      const opened = await openSession({ ...ctx, signal: inner.signal });
      if (finished) {
        opened.close();
        return;
      }
      session = opened;
      frameTimer = setInterval(() => void tick(), CAMERA_FRAME_INTERVAL_MS);
    };

    start().catch(fail);
  });
}
