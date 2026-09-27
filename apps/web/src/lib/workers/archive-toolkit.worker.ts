/**
 * Runs `@fodt/archive-toolkit`'s `extractArchive` or `createZip` entirely
 * inside this worker, so the tab that constructed it stays responsive and
 * the picked file or files are never sent anywhere. Extraction builds a
 * `RandomAccessReader` over the picked `File`'s own `slice()`, so a large
 * archive is never read into memory whole before this package even starts
 * (BP); creation reads every picked file's full bytes up front, since ZIP
 * writing needs each file's complete content to compress it.
 */
import {
  extractArchive,
  createZip,
  ArchiveError,
  ARCHIVE_LIMITS,
  type RandomAccessReader,
  type ArchiveLimits,
} from '@fodt/archive-toolkit';

export interface ArchiveToolkitExtractJobMessage {
  type: 'archive-toolkit-extract-job';
  file: File;
  /** Test-only: overrides the package's own default limits for a lowered-limit bomb test. Absent in production. */
  testLimits?: ArchiveLimits;
  /** Test-only: overrides how many bytes are read from the file per progress tick. Absent in production. */
  testChunkSize?: number;
  /** Test-only: an artificial pause after each chunk read, so a browser test can reliably observe an in-flight run and click Cancel before a real run over a few megabytes (well under a second) would otherwise ever give it the chance to. Absent in production, the same established pattern `pdf-split.worker.ts`'s own `testStepDelayMs` uses. */
  testStepDelayMs?: number;
}

export interface ArchiveToolkitCreateJobMessage {
  type: 'archive-toolkit-create-job';
  files: File[];
  method: 'store' | 'deflate';
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  keepTimes: boolean;
  zipName: string;
}

export type ArchiveToolkitInboundMessage = ArchiveToolkitExtractJobMessage | ArchiveToolkitCreateJobMessage;

export interface ArchiveToolkitProgressMessage {
  type: 'archive-toolkit-progress';
  fraction: number;
  detail: string;
}

export interface ArchiveToolkitExtractDoneMessage {
  type: 'archive-toolkit-extract-done';
  kind: 'zip' | 'tar' | 'gzip';
  entries: {
    path: string;
    type: string;
    size: number;
    packedSize?: number;
    modified?: string;
    linkTarget?: string;
    status: string;
    reason?: string;
  }[];
  files: { name: string; bytes: ArrayBuffer }[];
  warnings: string[];
}

export interface ArchiveToolkitCreateDoneMessage {
  type: 'archive-toolkit-create-done';
  zipName: string;
  bytes: ArrayBuffer;
  entries: { name: string; size: number; packedSize: number; modified: string }[];
}

export interface ArchiveToolkitErrorMessage {
  type: 'archive-toolkit-error';
  message: string;
}

export type ArchiveToolkitWorkerMessage =
  | ArchiveToolkitProgressMessage
  | ArchiveToolkitExtractDoneMessage
  | ArchiveToolkitCreateDoneMessage
  | ArchiveToolkitErrorMessage;

interface WorkerGlobal {
  postMessage(message: ArchiveToolkitWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ArchiveToolkitInboundMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

/** A RandomAccessReader over a picked File's own slices, so a large archive is never resident in memory whole (BP). */
function fileReader(file: File, testStepDelayMs?: number): RandomAccessReader {
  return {
    size: file.size,
    async read(offset: number, length: number): Promise<Uint8Array> {
      const end = Math.min(file.size, offset + length);
      if (offset >= end) return new Uint8Array(0);
      const buffer = await file.slice(offset, end).arrayBuffer();
      if (testStepDelayMs) await new Promise((resolve) => setTimeout(resolve, testStepDelayMs));
      return new Uint8Array(buffer);
    },
  };
}

/** Merges any test-only overrides on top of the package's own default limits, for a lowered-limit bomb test or a smaller feed-chunk size that makes progress and Cancel observable in a Playwright run. */
function resolveLimits(job: ArchiveToolkitExtractJobMessage): ArchiveLimits {
  return {
    ...ARCHIVE_LIMITS,
    ...(job.testLimits ?? {}),
    ...(job.testChunkSize ? { feedChunkBytes: job.testChunkSize } : {}),
  };
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function handleExtract(job: ArchiveToolkitExtractJobMessage): Promise<void> {
  try {
    const reader = fileReader(job.file, job.testStepDelayMs);
    const result = await extractArchive(
      reader,
      job.file.name,
      { limits: resolveLimits(job) },
      {
        onProgress: (fraction, detail) => {
          workerGlobal.postMessage({ type: 'archive-toolkit-progress', fraction, detail });
        },
      },
    );
    const outFiles = result.files.map((f) => ({ name: f.name, bytes: ownedBuffer(f.bytes) }));
    workerGlobal.postMessage(
      {
        type: 'archive-toolkit-extract-done',
        kind: result.kind,
        entries: result.entries,
        files: outFiles,
        warnings: result.warnings,
      },
      outFiles.map((f) => f.bytes),
    );
  } catch (err) {
    workerGlobal.postMessage({
      type: 'archive-toolkit-error',
      message:
        err instanceof ArchiveError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'This archive could not be read for an unknown reason.',
    });
  }
}

async function handleCreate(job: ArchiveToolkitCreateJobMessage): Promise<void> {
  try {
    const total = job.files.length;
    const files = [];
    for (let i = 0; i < total; i++) {
      const file = job.files[i]!;
      const bytes = new Uint8Array(await file.arrayBuffer());
      files.push({ name: file.name, bytes });
      workerGlobal.postMessage({
        type: 'archive-toolkit-progress',
        fraction: ((i + 1) / total) * 0.5,
        detail: `Read ${i + 1} of ${total}`,
      });
    }
    const result = await createZip(
      files,
      { method: job.method, level: job.level, keepTimes: job.keepTimes },
      {
        onProgress: (fraction, detail) => {
          workerGlobal.postMessage({ type: 'archive-toolkit-progress', fraction: 0.5 + fraction * 0.5, detail });
        },
      },
    );
    const zipBytes = result.files[0]!.bytes;
    const buffer = ownedBuffer(zipBytes);
    workerGlobal.postMessage(
      { type: 'archive-toolkit-create-done', zipName: job.zipName, bytes: buffer, entries: result.entries },
      [buffer],
    );
  } catch (err) {
    workerGlobal.postMessage({
      type: 'archive-toolkit-error',
      message:
        err instanceof ArchiveError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'This ZIP could not be created for an unknown reason.',
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  if (event.data.type === 'archive-toolkit-extract-job') void handleExtract(event.data);
  else void handleCreate(event.data);
});
