/**
 * Reads every picked PDF in fixed-size slices (progress per slice, the
 * first half of the run), then merges them with `@fodt/pdf-merge` (the
 * second half), and returns the merged bytes and the report of which pages
 * came from where -- all inside this worker, so the tab that constructed it
 * stays responsive and the files are never sent anywhere. Every byte-level
 * decision lives in the tool package; this file only owns reading the
 * picked `File`s and the message protocol back to the page.
 */
import { mergePdfs, PdfMergeError, type MergeResult, type MergeOptions } from '@fodt/pdf-merge';

export interface PdfMergeJobMessage {
  type: 'pdf-merge-job';
  files: File[];
  /** One page-list string per file, aligned by index; empty means every page. */
  pages: string[];
  options: MergeOptions;
  chunkSize: number;
}

export type PdfMergeInboundMessage = PdfMergeJobMessage;

export interface PdfMergeProgressMessage {
  type: 'pdf-merge-progress';
  fraction: number;
  detail: string;
}

export interface PdfMergeDoneMessage {
  type: 'pdf-merge-done';
  bytes: ArrayBuffer;
  pageCount: number;
  parts: MergeResult['parts'];
  warnings: string[];
}

export interface PdfMergeErrorMessage {
  type: 'pdf-merge-error';
  message: string;
  /** The input file this problem belongs to, when a PdfMergeError named one. */
  fileName?: string;
  /** 1-based character offset into that file's own page-list text, when the problem is a page-list error. */
  position?: number;
}

export type PdfMergeWorkerMessage = PdfMergeProgressMessage | PdfMergeDoneMessage | PdfMergeErrorMessage;

interface WorkerGlobal {
  postMessage(message: PdfMergeWorkerMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<PdfMergeInboundMessage>) => void): void;
}

const workerGlobal = self as unknown as WorkerGlobal;

const FALLBACK_CHUNK_SIZE = 4 * 1024 * 1024;

/** Reads a `File` in fixed-size slices with `Blob.stream()` (BQ's own required shape), reporting progress after each slice. */
async function readFileInSlices(
  file: File,
  chunkSize: number,
  onSliceRead: (bytesRead: number) => void,
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
    onSliceRead(offset);
  }
  return out;
}

async function handleJob(job: PdfMergeJobMessage): Promise<void> {
  try {
    const totalBytes = job.files.reduce((sum, f) => sum + f.size, 0) || 1;
    let bytesReadSoFar = 0;
    const inputs: { name: string; bytes: Uint8Array; pages?: string }[] = [];
    for (let i = 0; i < job.files.length; i++) {
      const file = job.files[i]!;
      const bytes = await readFileInSlices(file, job.chunkSize, (readInFile) => {
        const fraction = ((bytesReadSoFar + readInFile) / totalBytes) * 0.5;
        workerGlobal.postMessage({
          type: 'pdf-merge-progress',
          fraction,
          detail: `Reading ${file.name}`,
        });
      });
      bytesReadSoFar += file.size;
      inputs.push({ name: file.name, bytes, pages: job.pages[i] });
    }

    const result = await mergePdfs(inputs, job.options, {
      onProgress: (fraction, detail) => {
        workerGlobal.postMessage({ type: 'pdf-merge-progress', fraction: 0.5 + fraction * 0.5, detail });
      },
    });

    const owned = result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength,
    ) as ArrayBuffer;
    workerGlobal.postMessage(
      {
        type: 'pdf-merge-done',
        bytes: owned,
        pageCount: result.pageCount,
        parts: result.parts,
        warnings: result.warnings,
      },
      [owned],
    );
  } catch (err) {
    workerGlobal.postMessage({
      type: 'pdf-merge-error',
      message: err instanceof Error ? err.message : 'These PDFs could not be merged for an unknown reason.',
      fileName: err instanceof PdfMergeError ? err.fileName : undefined,
      position: err instanceof PdfMergeError ? err.position : undefined,
    });
  }
}

workerGlobal.addEventListener('message', (event) => {
  void handleJob({ ...event.data, chunkSize: event.data.chunkSize > 0 ? event.data.chunkSize : FALLBACK_CHUNK_SIZE });
});
