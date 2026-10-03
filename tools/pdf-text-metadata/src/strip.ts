/** Scaffold: the tests for this module are written first; the implementation follows in the next commit. */
import type { PDFContext } from '@cantoo/pdf-lib';
import { PdfToolError } from './shared';

export { PdfToolError };

export interface StripReport {
  info: boolean;
  metadataStreams: number;
  pieceInfo: number;
  lastModified: number;
  unreachable: number;
}

export function reachableRefs(_context: PDFContext): Set<string> {
  throw new Error('not implemented');
}

export function stripMetadata(_bytes: Uint8Array): Promise<{ bytes: Uint8Array; report: StripReport }> {
  return Promise.reject(new Error('not implemented'));
}

export function findMetadataLeft(_bytes: Uint8Array): Promise<string[]> {
  return Promise.reject(new Error('not implemented'));
}
