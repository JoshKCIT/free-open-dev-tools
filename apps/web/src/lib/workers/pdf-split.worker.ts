/**
 * Reads the picked PDF in fixed-size slices (progress per slice, the first
 * half of the run), then organises it with `@fodt/pdf-split` (the second
 * half), and returns every output document -- all inside this worker, so
 * the tab that constructed it stays responsive and the file is never sent
 * anywhere.
 */
import { organizePdf, PdfSplitError, type OrganizeOperation, type OrganizeResult } from '@fodt/pdf-split';

export interface PdfSplitJobMessage {
  type: 'pdf-split-job';
  file: File;
  operation: OrganizeOperation;
  chunkSize: number;
  /**
   * Test-only: an artificial pause after each progress tick while
   * organising pages, so a browser test can reliably observe an in-flight
   * run and click Cancel before a real run over a few hundred pages (well
   * under a second) would otherwise ever give it the chance to. Absent
   * (every real run), this changes nothing -- the same established pattern
   * `image-converter.worker.ts`'s own `testStepDelayMs` uses.
   */
  testStepDelayMs?: number;
}

export type PdfSplitInboundMessage = PdfSplitJobMessage;

export interface PdfSplitProgressMessage {
  type: 'pdf-split-progress';
  fraction: number;
  detail: string;
}

export interface PdfSplitDoneMessage {
  type: 'pdf-split-done';
  files: { name: string; bytes: ArrayBuffer; pages: number[] }[];
  warnings: string[];
  sourcePageCount: number;
}

export interface PdfSplitErrorMessage {
  type: 'pdf-split-error';
  message: string;
  position?: number;
}

export type PdfSplitWorkerMessage = PdfSplitProgressMessage | PdfSplitDoneMessage | PdfSplitErrorMessage;

interface WorkerGlobal {
  postMessage(message: PdfSplitWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<PdfSplitInboundMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const FALLBACK_CHUNK_SIZE = 4 * 1024 * 1024;

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

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function handleJob(job: PdfSplitJobMessage): Promise<void> {
  try {
    const bytes = await readFileInSlices(job.file, job.chunkSize, (fraction, detail) => {
      workerGlobal.postMessage({ type: 'pdf-split-progress', fraction: fraction * 0.5, detail });
    });

    const result: OrganizeResult = await organizePdf(bytes, job.file.name, job.operation, {
      onProgress: async (fraction, detail) => {
        workerGlobal.postMessage({ type: 'pdf-split-progress', fraction: 0.5 + fraction * 0.5, detail });
        if (job.testStepDelayMs) await new Promise((resolve) => setTimeout(resolve, job.testStepDelayMs));
      },
    });

    const outFiles = result.files.map((f) => ({ name: f.name, bytes: ownedBuffer(f.bytes), pages: f.pages }));
    workerGlobal.postMessage(
      { type: 'pdf-split-done', files: outFiles, warnings: result.warnings, sourcePageCount: result.sourcePageCount },
      outFiles.map((f) => f.bytes),
    );
  } catch (err) {
    workerGlobal.postMessage({
      type: 'pdf-split-error',
      message: err instanceof Error ? err.message : 'This PDF could not be organised for an unknown reason.',
      position: err instanceof PdfSplitError ? err.position : undefined,
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob({ ...event.data, chunkSize: event.data.chunkSize > 0 ? event.data.chunkSize : FALLBACK_CHUNK_SIZE });
});
