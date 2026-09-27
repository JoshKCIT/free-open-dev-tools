/**
 * Test-only fixture builder for this package's own tests, built with the
 * real, installed `@cantoo/pdf-lib` (never a second, hand-rolled PDF writer
 * competing with the thing under test) plus one small hand-written JPEG
 * (ITU-T T.81 Annex B: a baseline SOF0 marker segment naming height, width
 * and component count is all an embedder needs to read; it does not decode
 * the entropy-coded scan data, confirmed directly against the installed
 * 2.11.1 `JpegEmbedder` source this session, so a JPEG with a minimal,
 * non-decodable scan is a legitimate embedding fixture here).
 */
import { PDFDocument, StandardFonts, PDFName, PDFString, rgb } from '@cantoo/pdf-lib';

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

/** A minimal baseline JPEG (SOI, one APP0, SOF0 naming width/height/3 components, DHT, SOS, one scan byte, EOI). */
export function buildMinimalJpeg(width: number, height: number): Uint8Array {
  const app0 = [
    0xff,
    0xe0,
    ...u16be(16),
    0x4a,
    0x49,
    0x46,
    0x49,
    0x46,
    0x00, // "JFIF\0"
    1,
    1,
    0,
    ...u16be(1),
    ...u16be(1),
    0,
    0,
  ];
  const sof0 = [0xff, 0xc0, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1];
  const dht = [0xff, 0xc4, ...u16be(19), 0x00, ...Array(16).fill(0)];
  const sos = [0xff, 0xda, ...u16be(12), 3, 1, 0, 2, 0, 3, 0, 0, 63, 0];
  const scanData = [0x00];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof0, ...dht, ...sos, ...scanData, 0xff, 0xd9]);
}

export interface BuildPageSpec {
  /** Drawn near the top of a US Letter page in the named standard font (default Times-Roman). */
  text?: string;
  font?: 'TimesRoman' | 'Helvetica' | 'Courier';
  /** A filled rectangle, 0-1 RGB. */
  fillColor?: [number, number, number];
  /** Embeds a hand-built JPEG at the given placement. */
  image?: { width: number; height: number; x: number; y: number; drawWidth: number; drawHeight: number };
}

export interface BuildPdfOptions {
  /** Sets the source document's own title (used to prove a merged/organised copy never carries a source title). */
  title?: string;
  /**
   * Adds a document-level opening JavaScript action (the catalog's own
   * `/OpenAction`) and a JavaScript name tree entry (ISO 32000-1 7.7.2's
   * own `Names`/`JavaScript`), through the low-level object API -- neither
   * is reachable through @cantoo/pdf-lib's own high-level page API, since
   * both are document-, not page-, level constructs.
   */
  javascript?: boolean;
}

const FONTS = {
  TimesRoman: StandardFonts.TimesRoman,
  Helvetica: StandardFonts.Helvetica,
  Courier: StandardFonts.Courier,
};

/** Builds a real, valid PDF with the given pages, through the real installed @cantoo/pdf-lib. */
export async function buildPdf(pages: BuildPageSpec[], options: BuildPdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const fontCache = new Map<string, Awaited<ReturnType<typeof doc.embedFont>>>([['TimesRoman', font]]);

  for (const spec of pages) {
    const page = doc.addPage([612, 792]);
    if (spec.fillColor) {
      const [r, g, b] = spec.fillColor;
      page.drawRectangle({ x: 50, y: 50, width: 200, height: 100, color: rgb(r, g, b) });
    }
    if (spec.text) {
      const fontName = spec.font ?? 'TimesRoman';
      let f = fontCache.get(fontName);
      if (!f) {
        f = await doc.embedFont(FONTS[fontName]);
        fontCache.set(fontName, f);
      }
      page.drawText(spec.text, { x: 72, y: 700, size: 18, font: f });
    }
    if (spec.image) {
      const jpegBytes = buildMinimalJpeg(spec.image.width, spec.image.height);
      const embedded = await doc.embedJpg(jpegBytes);
      page.drawImage(embedded, {
        x: spec.image.x,
        y: spec.image.y,
        width: spec.image.drawWidth,
        height: spec.image.drawHeight,
      });
    }
  }

  if (options.javascript) {
    const context = doc.context;
    const actionDict = context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('app.alert("hi")') });
    const actionRef = context.register(actionDict);
    doc.catalog.set(PDFName.of('OpenAction'), actionRef);
    const namesArray = context.obj([PDFString.of('EmbeddedJS'), actionRef]);
    const jsTree = context.obj({ Names: namesArray });
    const names = context.obj({ JavaScript: jsTree });
    doc.catalog.set(PDFName.of('Names'), names);
  }

  if (options.title) doc.setTitle(options.title);

  return doc.save();
}

/**
 * Builds a real encrypted PDF (`@cantoo/pdf-lib`'s own `PDFDocument.encrypt`,
 * confirmed directly against the installed 2.11.1 source this session:
 * `PDFDocument.load` throws its `EncryptedPDFError` for either shape below
 * unless called with `ignoreEncryption: true`, which this package never
 * passes). Omitting `userPassword` builds an owner-password-only document
 * (no password is needed to open it in a viewer that honours permissions,
 * but the document is still genuinely encrypted); passing one builds a
 * document a viewer refuses to open without it.
 */
export async function buildEncryptedPdf(userPassword?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([612, 792]);
  page.drawText('Encrypted', { x: 72, y: 700, size: 18, font });
  doc.encrypt({ ownerPassword: 'owner-secret', userPassword });
  return doc.save();
}
