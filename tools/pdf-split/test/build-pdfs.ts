/**
 * Test-only fixture builder for this package's own tests, built with the
 * real, installed `@cantoo/pdf-lib`. Written the same way
 * `tools/pdf-merge/test/build-pdfs.ts` is, not shared code.
 */
import { PDFDocument, StandardFonts, PDFName } from '@cantoo/pdf-lib';

export interface BuildPageSpec {
  text?: string;
  font?: 'TimesRoman' | 'Helvetica' | 'Courier';
}

const FONTS = {
  TimesRoman: StandardFonts.TimesRoman,
  Helvetica: StandardFonts.Helvetica,
  Courier: StandardFonts.Courier,
};

/** Builds a real, valid multi-page PDF with the given pages, through the real installed @cantoo/pdf-lib. */
export async function buildPdf(pages: BuildPageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fontCache = new Map<string, Awaited<ReturnType<typeof doc.embedFont>>>();
  for (const spec of pages) {
    const page = doc.addPage([612, 792]);
    if (spec.text) {
      const fontName = spec.font ?? 'TimesRoman';
      let f = fontCache.get(fontName);
      if (!f) {
        f = await doc.embedFont(FONTS[fontName]);
        fontCache.set(fontName, f);
      }
      page.drawText(spec.text, { x: 72, y: 700, size: 18, font: f });
    }
  }
  return doc.save();
}

/**
 * Builds a PDF whose pages have NO explicit `/Rotate` entry of their own:
 * the rotation is set once, on the shared Pages tree root, so every page
 * inherits it (ISO 32000-1 7.7.3.3) rather than declaring it directly --
 * confirmed directly this session that `@cantoo/pdf-lib`'s own `getRotation`
 * (`getInheritableAttribute`) and its `copyPages` (which bakes an inherited
 * attribute onto the copy before dropping the page's own `Parent`) both
 * handle this correctly.
 */
export async function buildPdfWithInheritedRotation(pageCount: number, rotateDegrees: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1}`, { x: 72, y: 700, size: 18, font });
  }
  const pagesNode = doc.catalog.Pages();
  pagesNode.set(PDFName.of('Rotate'), doc.context.obj(rotateDegrees));
  return doc.save();
}

/**
 * Builds a real encrypted PDF (`@cantoo/pdf-lib`'s own `PDFDocument.encrypt`).
 * Written the same way `tools/pdf-merge/test/build-pdfs.ts`'s own copy is,
 * not shared code: a tool folder never imports from outside itself, tests
 * included, so this small helper is duplicated rather than reached across.
 */
export async function buildEncryptedPdf(userPassword?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([612, 792]);
  page.drawText('Encrypted', { x: 72, y: 700, size: 18, font });
  doc.encrypt({ ownerPassword: 'owner-secret', userPassword });
  return doc.save();
}
