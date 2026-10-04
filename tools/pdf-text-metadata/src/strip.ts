/**
 * Removing a PDF's metadata, and checking a copy for what is left.
 *
 * ISO 32000-1:2008 section 14.3.3 defines the document information dictionary, which the trailer's Info entry points to;
 * section 14.3.2 defines metadata streams (the Metadata entry of the catalog, a page, an image, a font and other
 * dictionaries); section 14.5 defines PieceInfo (application data) and LastModified; section 7.5.6 defines incremental
 * updates, which append a new revision and leave the earlier objects in the file.
 *
 * Why objects are deleted as well as keys: pdf-lib writes every object still in its context. After the Info entry and
 * the Metadata keys are deleted, the dictionary and the XMP stream they pointed to are still in the context if the file
 * held them, and so are the first revision's objects of an incrementally updated file, so a copy would still carry an
 * earlier author. The sweep deletes every object that cannot be reached from the Root, the Encrypt entry or the ID.
 *
 * This file imports only pdf-lib and the shared module, so the removal worker can import it by path without pulling
 * PDF.js into its bundle.
 */
import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFObject,
} from '@cantoo/pdf-lib';
import { checkExpansion } from './expansion';
import { PdfToolError } from './shared';

export { PdfToolError };

/** What a removal deleted. Counts are of entries and objects that held data; the file's own containers are not counted. */
export interface StripReport {
  /** True when the trailer named a document information dictionary. */
  info: boolean;
  /** Metadata entries deleted from dictionaries and stream dictionaries (each pointed to an XMP stream). */
  metadataStreams: number;
  /** PieceInfo entries deleted. */
  pieceInfo: number;
  /** LastModified entries deleted. */
  lastModified: number;
  /** Objects deleted because nothing led to them any more. */
  unreachable: number;
}

const METADATA = PDFName.of('Metadata');
const PIECE_INFO = PDFName.of('PieceInfo');
const LAST_MODIFIED = PDFName.of('LastModified');
const TYPE = PDFName.of('Type');
const CONTAINER_TYPES = [PDFName.of('XRef'), PDFName.of('ObjStm')];

/** Where pdf-lib is asked to load a file: its own Info stamp off, so loading never adds metadata. */
const LOAD_OPTIONS = { updateMetadata: false } as const;

/** The dictionary of a dictionary or a stream, or null for any other kind of object. */
function dictOf(object: PDFObject): PDFDict | null {
  if (object instanceof PDFStream) return object.dict;
  if (object instanceof PDFDict) return object;
  return null;
}

/** A cross-reference stream or an object stream: the file's own bookkeeping, rewritten when the file is saved. */
function isContainer(object: PDFObject): boolean {
  if (!(object instanceof PDFStream)) return false;
  const type = object.dict.get(TYPE);
  return CONTAINER_TYPES.some((name) => name === type);
}

/**
 * Calls `visit` on every dictionary (and the dictionary of every stream) inside `top`, including dictionaries written
 * inline inside other objects, without following references and without recursion.
 */
function eachDict(top: PDFObject, visit: (dict: PDFDict) => void): void {
  const stack: PDFObject[] = [top];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const dict = dictOf(node);
    if (dict !== null) {
      visit(dict);
      for (const value of dict.values()) if (!(value instanceof PDFRef)) stack.push(value);
    } else if (node instanceof PDFArray) {
      for (const value of node.asArray()) if (!(value instanceof PDFRef)) stack.push(value);
    }
  }
}

/**
 * The tags (such as `12 0 R`) of every object reachable from the Root, the Encrypt entry and the ID of the trailer,
 * following references, dictionaries, arrays and the dictionary of every stream. An explicit stack, so a file whose
 * references chain a hundred thousand deep cannot overflow the call stack; each object is visited once.
 */
export function reachableRefs(context: PDFContext): Set<string> {
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  const trailer = context.trailerInfo;
  for (const start of [trailer.Root, trailer.Encrypt, trailer.ID]) if (start) stack.push(start);
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node instanceof PDFRef) {
      if (seen.has(node.tag)) continue;
      seen.add(node.tag);
      const target = context.lookup(node);
      if (target) stack.push(target);
      continue;
    }
    const dict = dictOf(node);
    if (dict !== null) {
      for (const value of dict.values()) stack.push(value);
    } else if (node instanceof PDFArray) {
      for (const value of node.asArray()) stack.push(value);
    }
  }
  return seen;
}

/** Options of the loads this module does. */
export interface LoadOptions {
  /**
   * Leave out the check of how much the file's streams decode to. Only for bytes this package has just written itself
   * (a copy made by `stripMetadata`, whose streams were counted when the original was): the copy holds no object stream
   * and every other stream in it is one the original had.
   */
  skipExpansionCheck?: boolean;
}

async function load(bytes: Uint8Array, options: LoadOptions = {}): Promise<PDFDocument> {
  // Bound what the file decodes to before pdf-lib sees it: it decodes every object stream while it loads.
  if (!options.skipExpansionCheck) await checkExpansion(bytes);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, LOAD_OPTIONS);
  } catch (err) {
    if (err instanceof EncryptedPDFError) throw new PdfToolError('encrypted');
    throw new PdfToolError('damaged');
  }
  if (doc.isEncrypted) throw new PdfToolError('encrypted');
  // pdf-lib loads text that is not a PDF as a document with no objects, and recovers a catalog from a truncated file
  // whose page tree is cut short. A PDF has a Root that leads to a page tree, and every page the tree declares is there.
  const root = doc.context.trailerInfo.Root;
  const catalog = root ? doc.context.lookup(root) : undefined;
  const tree = catalog instanceof PDFDict ? catalog.lookup(PDFName.of('Pages')) : undefined;
  if (!(tree instanceof PDFDict)) throw new PdfToolError('damaged');
  const declared = tree.lookup(PDFName.of('Count'));
  let found: number;
  try {
    found = doc.getPageCount();
  } catch {
    throw new PdfToolError('damaged');
  }
  if (declared instanceof PDFNumber && found < declared.asNumber()) throw new PdfToolError('damaged');
  return doc;
}

/**
 * Writes a copy of the PDF without its document information dictionary, every Metadata, PieceInfo and LastModified entry
 * of any dictionary or stream dictionary, and every object nothing leads to any more (so the objects of an earlier saved
 * revision go too), saved without object streams. The file identifier, the pages, annotations, form data, attachments
 * and bookmarks are left as they were. An encrypted file is refused with kind `encrypted`, a file that cannot be read
 * with kind `damaged`, and one whose streams decode to more than the caps of `checkExpansion` (64 MiB for one stream, 256 MiB
 * in all) with kind `size`, before pdf-lib reads it; the messages never hold the file's name or content.
 */
export async function stripMetadata(bytes: Uint8Array): Promise<{ bytes: Uint8Array; report: StripReport }> {
  const doc = await load(bytes);
  const context = doc.context;
  const report: StripReport = { info: false, metadataStreams: 0, pieceInfo: 0, lastModified: 0, unreachable: 0 };

  if (context.trailerInfo.Info) {
    report.info = true;
    delete context.trailerInfo.Info;
  }

  for (const [, object] of context.enumerateIndirectObjects()) {
    eachDict(object, (dict) => {
      if (dict.delete(METADATA)) report.metadataStreams++;
      if (dict.delete(PIECE_INFO)) report.pieceInfo++;
      if (dict.delete(LAST_MODIFIED)) report.lastModified++;
    });
  }

  const live = reachableRefs(context);
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (live.has(ref.tag)) continue;
    context.delete(ref);
    if (!isContainer(object)) report.unreachable++;
  }

  let saved: Uint8Array;
  try {
    saved = await doc.save({
      useObjectStreams: false,
      addDefaultPage: false,
      updateFieldAppearances: false,
      objectsPerTick: 5000,
    });
  } catch {
    throw new PdfToolError('damaged');
  }
  return { bytes: saved, report };
}

/** At most this many lines are returned by `findMetadataLeft`; the last one says how many more there were. */
const MAX_LEFT = 100;

/**
 * Loads a copy again with pdf-lib and lists what is still there: a trailer Info entry, every dictionary that holds a
 * Metadata, PieceInfo or LastModified entry, and every object nothing leads to. An empty list means none was found. Each
 * line names the entry or the object (such as `Metadata entry in object 5 0 R`) and never holds any text from the file.
 * A copy that cannot be read throws `PdfToolError` with kind `damaged`; one whose streams decode to more than the caps of
 * `checkExpansion` throws kind `size`.
 */
export async function findMetadataLeft(bytes: Uint8Array, options: LoadOptions = {}): Promise<string[]> {
  const doc = await load(bytes, options);
  const context = doc.context;
  const found: string[] = [];
  if (context.trailerInfo.Info) found.push('Info entry in the trailer');

  const objects = context.enumerateIndirectObjects();
  for (const [ref, object] of objects) {
    eachDict(object, (dict) => {
      for (const [name, key] of [
        ['Metadata', METADATA],
        ['PieceInfo', PIECE_INFO],
        ['LastModified', LAST_MODIFIED],
      ] as const) {
        if (dict.has(key)) found.push(`${name} entry in object ${ref.tag}`);
      }
    });
  }

  const live = reachableRefs(context);
  for (const [ref, object] of objects) {
    if (!live.has(ref.tag) && !isContainer(object)) found.push(`Unreachable object ${ref.tag}`);
  }
  if (found.length <= MAX_LEFT) return found;
  const more = found.length - MAX_LEFT;
  return [...found.slice(0, MAX_LEFT), `${more} more not listed`];
}
