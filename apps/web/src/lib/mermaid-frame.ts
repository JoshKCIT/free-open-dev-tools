/**
 * The page-side helper that draws a Mermaid diagram in a frame no other code can reach, and turns a drawn SVG into a
 * PNG on a page canvas.
 *
 * Why a frame and not a worker: the engine needs a document (it fails in a worker with "document is not defined"), so
 * it runs in an iframe. Why this frame: strict security level alone let five constructions reach another origin in
 * measurements, so the frame is the layer that makes the page's promise true. It is built with `sandbox="allow-scripts"`
 * and nothing else (no `allow-same-origin`, so its origin is opaque and it cannot reach the page's storage or its
 * DOM), and its own document carries a policy that lets nothing load: `default-src 'none'; script-src 'unsafe-inline';
 * style-src 'unsafe-inline'; img-src data:` (see the folder's `frame-doc.ts`). A NEW frame is made for every run and
 * removed when the run ends for any reason: the answer, an error, a limit, an abort or `pagehide`.
 *
 * The page accepts a message only when `event.source` is that frame's own window, and what the frame sends is only an
 * SVG string or a position and a clause of the parser's message; the SVG goes through the folder's scrub before
 * anything shows, exports or rasterises it.
 *
 * Limits: a frame that is busy blocks the page that holds it, in every browser measured, so no timer here can stop
 * drawing. The size caps in the folder (20,000 characters, 300 lines) are what bound it. The two limits below only
 * catch a frame that never answers at all: one that never reports ready, and one that never replies to a run.
 *
 * The Mermaid bundle is read as a string with `?raw` from the folder's own node_modules, by relative path, so it is
 * part of this page's own chunk and nothing is fetched.
 */
import bundle from '../../../../tools/mermaid-renderer/node_modules/mermaid/dist/mermaid.min.js?raw';
import { FRAME_HEIGHT_PX, FRAME_WIDTH_PX, buildFrameDocument, pngSize, withPixelSize } from '@fodt/mermaid-renderer';
import type { RunContext } from './tool-ui';

/** A frame that has not said it is ready after this long is given up on. It cannot stop a frame that is busy. */
export const MERMAID_READY_LIMIT_MS = 10000;

/** A frame that has not answered a run after this long is given up on. It cannot stop a frame that is busy. */
export const MERMAID_REPLY_LIMIT_MS = 30000;

const READY_MESSAGE = 'The diagram engine did not start within 10 seconds. Reload the page and try again.';
const REPLY_MESSAGE = 'The diagram engine did not answer. Reload the page and try again.';
const PNG_MESSAGE = 'This diagram could not be turned into a PNG.';

/** What the engine said about a diagram it could not draw: the parser's line, what it expected, an unknown type. */
export interface EngineDetail {
  line?: number;
  expecting?: string;
  unknownType?: boolean;
}

/** Why a diagram was not drawn by the frame: a fixed sentence, or the engine's own refusal in `detail`. */
export class MermaidFrameError extends Error {
  readonly detail?: EngineDetail;

  constructor(message: string, detail?: EngineDetail) {
    super(message);
    this.name = 'MermaidFrameError';
    if (detail !== undefined) this.detail = detail;
  }
}

/** The shape of a message from the frame, checked before any field is read. */
function readMessage(
  data: unknown,
): { kind: string; id?: number; svg?: string; line?: number; expecting?: string; unknownType?: boolean } | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.kind !== 'string') return undefined;
  return {
    kind: record.kind,
    id: typeof record.id === 'number' ? record.id : undefined,
    svg: typeof record.svg === 'string' ? record.svg : undefined,
    line: typeof record.line === 'number' ? record.line : undefined,
    expecting: typeof record.expecting === 'string' ? record.expecting : undefined,
    unknownType: record.unknownType === true,
  };
}

/**
 * Draws one diagram in a new locked frame and resolves with the SVG text the engine wrote (not yet checked: the caller
 * passes it through `scrubSvg`). Rejects with a `MermaidFrameError` for a diagram the engine could not draw or a frame
 * that did not answer, and with an error when the run is aborted. The frame is removed in every case.
 */
export function renderInFrame(text: string, theme: string, ctx: RunContext): Promise<string> {
  if (ctx.signal.aborted) return Promise.reject(new Error('The run was cancelled before it started.'));

  return new Promise<string>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    // Out of sight but laid out: the engine measures text and, for some diagrams, the width of its document.
    frame.style.width = `${FRAME_WIDTH_PX}px`;
    frame.style.height = `${FRAME_HEIGHT_PX}px`;
    frame.style.border = '0';
    frame.style.position = 'fixed';
    frame.style.left = '-10000px';
    frame.style.top = '0';
    frame.style.visibility = 'hidden';
    const requestId = 1;
    let settled = false;
    let replyTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      clearTimeout(replyTimer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', onPageHide);
      ctx.signal.removeEventListener('abort', onAbort);
      frame.remove();
      outcome();
    };
    const onAbort = () => finish(() => reject(new Error('The run was cancelled.')));
    const onPageHide = () => finish(() => reject(new Error('The page was closed.')));
    const onMessage = (event: MessageEvent) => {
      // Only the frame this run made may answer: anything else, from another frame or window, is ignored.
      if (event.source !== frame.contentWindow) return;
      const message = readMessage(event.data);
      if (message === undefined) return;
      if (message.kind === 'ready') {
        clearTimeout(readyTimer);
        replyTimer = setTimeout(
          () => finish(() => reject(new MermaidFrameError(REPLY_MESSAGE))),
          MERMAID_REPLY_LIMIT_MS,
        );
        frame.contentWindow?.postMessage({ kind: 'render', id: requestId, text, theme }, '*');
        return;
      }
      if (message.id !== requestId) return;
      if (message.kind === 'done' && message.svg !== undefined) {
        const svg = message.svg;
        finish(() => resolve(svg));
      } else if (message.kind === 'error') {
        const detail: EngineDetail = {};
        if (message.line !== undefined) detail.line = message.line;
        if (message.expecting !== undefined) detail.expecting = message.expecting;
        if (message.unknownType) detail.unknownType = true;
        finish(() => reject(new MermaidFrameError('The diagram could not be drawn.', detail)));
      }
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', onPageHide);
    ctx.signal.addEventListener('abort', onAbort);
    // The start limit cannot stop a frame that is busy; it only catches one that never says it is ready.
    const readyTimer = setTimeout(
      () => finish(() => reject(new MermaidFrameError(READY_MESSAGE))),
      MERMAID_READY_LIMIT_MS,
    );
    frame.srcdoc = buildFrameDocument(bundle);
    document.body.appendChild(frame);
  });
}

/** The text as UTF-8 bytes written in base64, in pieces so a large SVG does not overflow the call stack. */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** A `data:` address for an SVG the page has already checked, for an image block (an image runs no script). */
export function svgDataAddress(svg: string): string {
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}

/**
 * Turns a checked SVG into PNG bytes on a canvas that is never attached to the page: the SVG is given a fixed pixel
 * size (the SVG's own size times `scale`, refused over 16,000,000 pixels or 8,192 a side), loaded as an `<img>` from a
 * `data:` address (an image loaded this way runs no script and loads nothing else), painted over white and read back as
 * a PNG. Rejects with a `MermaidFrameError` when the browser cannot draw it.
 */
export async function svgToPng(svg: string, scale: number): Promise<Uint8Array> {
  const { width, height } = pngSize(svg, scale);
  const sized = withPixelSize(svg, width, height);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new MermaidFrameError(PNG_MESSAGE));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new MermaidFrameError(PNG_MESSAGE);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob === null) throw new MermaidFrameError(PNG_MESSAGE);
  return new Uint8Array(await blob.arrayBuffer());
}
