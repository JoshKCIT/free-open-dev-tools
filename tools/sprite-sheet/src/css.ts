/**
 * The CSS text for a sprite sheet: one base rule that shows the sheet, and one rule per sprite that moves the sheet so
 * only that sprite shows. Only fixed property names and whole numbers are written, and a class name is checked before it
 * is written, so no file name can ever put anything else into the CSS.
 */
import { SpriteSheetError, type SpritePlan } from './layout';

/** The name the sheet is downloaded as, and the address the CSS asks for it by. */
export const SHEET_FILE_NAME = 'sprite.png';

const SHEET_TOKEN = `url(${SHEET_FILE_NAME})`;

const DATA_PREFIX = 'data:image/png;base64,';

/** A class name made by `spriteClassName`: lower case letters, digits and hyphens only, 1 to 40 characters. */
function isSafeClassName(name: string): boolean {
  if (name.length < 1 || name.length > 40) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45;
    if (!ok) return false;
  }
  return true;
}

function isWholeNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/** A background position: the sheet moves left and up, so a sprite at x is at -x; zero has no unit. */
function offset(n: number): string {
  return n === 0 ? '0' : `-${n}px`;
}

/**
 * The CSS for a plan, ending with a newline. A plan with no sprites gives an empty text. Each sprite's rule is
 * `.sprite-<name>`, with `background-position`, `width` and `height`; the base rule `.sprite` holds what every sprite
 * shares, so an element with both classes shows its own part of the sheet.
 */
export function spriteCss(plan: SpritePlan): string {
  if (plan.placements.length === 0) return '';
  const rules: string[] = [
    [
      '.sprite {',
      '  display: inline-block;',
      `  background-image: ${SHEET_TOKEN};`,
      '  background-repeat: no-repeat;',
      '}',
    ].join('\n'),
  ];
  for (const p of plan.placements) {
    if (!isSafeClassName(p.className)) {
      throw new SpriteSheetError('A class name holds a character other than a to z, 0 to 9 and a hyphen.');
    }
    if (![p.x, p.y, p.width, p.height].every(isWholeNumber)) {
      throw new SpriteSheetError('A sprite has a position or size that is not a whole number of pixels.');
    }
    rules.push(
      [
        `.sprite-${p.className} {`,
        `  background-position: ${offset(p.x)} ${offset(p.y)};`,
        `  width: ${p.width}px;`,
        `  height: ${p.height}px;`,
        '}',
      ].join('\n'),
    );
  }
  return `${rules.join('\n\n')}\n`;
}

/** True for `data:image/png;base64,` followed by base64 characters only. */
function isPngDataAddress(address: string): boolean {
  if (!address.startsWith(DATA_PREFIX)) return false;
  let padding = 0;
  for (let i = DATA_PREFIX.length; i < address.length; i++) {
    const c = address.charCodeAt(i);
    if (c === 61) {
      padding++;
      if (padding > 2) return false;
    } else if (padding > 0) {
      return false;
    } else {
      const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47;
      if (!ok) return false;
    }
  }
  return true;
}

/**
 * The same CSS with `url(sprite.png)` replaced by a `url(data:image/png;base64,...)` address of the sheet, so the rules
 * can be shown on a page that does not hold the file. Nothing else changes. Refuses CSS that does not hold the sheet's
 * address exactly once, and an address that is not a PNG data address.
 */
export function spritePreviewCss(css: string, dataUrl: string): string {
  if (!isPngDataAddress(dataUrl)) {
    throw new SpriteSheetError('The sheet address must be a data address of a PNG picture.');
  }
  const at = css.indexOf(SHEET_TOKEN);
  if (at < 0 || css.indexOf(SHEET_TOKEN, at + SHEET_TOKEN.length) >= 0) {
    throw new SpriteSheetError('The CSS must name the sheet file exactly once.');
  }
  return `${css.slice(0, at)}url(${dataUrl})${css.slice(at + SHEET_TOKEN.length)}`;
}
