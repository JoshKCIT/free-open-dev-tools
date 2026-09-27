/**
 * Reads a picked photo in fixed-size slices (progress per slice), reads its
 * metadata, removes what it can, and returns both the original reading and
 * the stripped copy -- all inside this worker, so the tab that constructed
 * it stays responsive and the file is never sent anywhere. Every byte-level
 * decision (which segment or chunk to keep or drop, what still remains
 * after removal) lives in the tool package (@fodt/exif-viewer); this file
 * only owns reading the picked `File` and the message protocol back to the
 * page.
 */
import {
  readMetadata,
  stripMetadata,
  outputFileName,
  type ReadMetadataResult,
  type StripMetadataResult,
} from '@fodt/exif-viewer';

export interface ExifViewerJobMessage {
  type: 'exif-viewer-job';
  file: File;
  options: { keepColourProfile: boolean; keepOrientation: boolean };
  /** Bytes read per slice. Always supplied by the page; see run-exif-viewer-in-worker.ts's own default. */
  chunkSize: number;
}

export type ExifViewerInboundMessage = ExifViewerJobMessage;

export interface ExifViewerProgressMessage {
  type: 'exif-viewer-progress';
  fraction: number;
  detail: string;
}

export interface ExifViewerDoneMessage {
  type: 'exif-viewer-done';
  original: ReadMetadataResult;
  removed: StripMetadataResult['removed'];
  kept: string[];
  warnings: string[];
  strippedBytes: ArrayBuffer;
  fileName: string;
}

export interface ExifViewerErrorMessage {
  type: 'exif-viewer-error';
  /** A plain description. Never the file's own contents. */
  message: string;
}

export type ExifViewerWorkerMessage = ExifViewerProgressMessage | ExifViewerDoneMessage | ExifViewerErrorMessage;

/**
 * This project's tsconfig gives every file the DOM library (for the
 * browser types tool pages need) but not the worker library, so
 * TypeScript resolves the ambient global in this file to a window-shaped
 * global rather than the worker's own global scope it actually is at
 * runtime (the same narrowing every worker in this project uses).
 */
interface WorkerGlobal {
  postMessage(message: ExifViewerWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ExifViewerInboundMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const FALLBACK_CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * Reads a `File` in fixed-size slices with `Blob.stream()` (BQ's own
 * required shape for this tool: "the worker reads the File with stream()
 * in chunks"), reporting progress after each slice. Slicing before
 * streaming -- rather than streaming the whole file in one call -- is what
 * lets a test shrink the read granularity to something small enough to
 * observe an in-flight run and click Cancel, the same purpose this
 * project's other chunk-size test hooks serve for their own readers.
 */
async function readFileInSlices(
  file: File,
  chunkSize: number,
  onProgress: (fraction: number, detail: string) => void,
): Promise<Uint8Array> {
  const total = file.size;
  const out = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    const end = Math.min(offset + chunkSize, total);
    const reader = file.slice(offset, end).stream().getReader();
    let sliceOffset = offset;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.set(value, sliceOffset);
      sliceOffset += value.length;
    }
    offset = end;
    const fraction = total === 0 ? 1 : offset / total;
    onProgress(fraction, `${Math.round(fraction * 100)}% read`);
  }
  return out;
}

async function handleJob(job: ExifViewerJobMessage): Promise<void> {
  try {
    const bytes = await readFileInSlices(job.file, job.chunkSize, (fraction, detail) => {
      // Reading is the first half of the work; metadata reading and removal
      // (both fast, byte-level operations with nothing further to report
      // progress on) make up the second half.
      workerGlobal.postMessage({ type: 'exif-viewer-progress', fraction: fraction * 0.5, detail });
    });

    const original = await readMetadata(bytes);
    workerGlobal.postMessage({ type: 'exif-viewer-progress', fraction: 0.75, detail: 'Read the metadata' });

    const stripped = await stripMetadata(bytes, job.options);
    workerGlobal.postMessage({ type: 'exif-viewer-progress', fraction: 1, detail: 'Removed the metadata' });

    const strippedBytes = stripped.bytes;
    const owned = strippedBytes.buffer.slice(
      strippedBytes.byteOffset,
      strippedBytes.byteOffset + strippedBytes.byteLength,
    ) as ArrayBuffer;

    workerGlobal.postMessage(
      {
        type: 'exif-viewer-done',
        original,
        removed: stripped.removed,
        kept: stripped.kept,
        warnings: stripped.warnings,
        strippedBytes: owned,
        fileName: outputFileName(job.file.name),
      },
      [owned],
    );
  } catch (err) {
    workerGlobal.postMessage({
      type: 'exif-viewer-error',
      message: `Could not read '${job.file.name}': ${err instanceof Error ? err.message : 'this file could not be read for an unknown reason.'}`,
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob({ ...event.data, chunkSize: event.data.chunkSize > 0 ? event.data.chunkSize : FALLBACK_CHUNK_SIZE });
});
