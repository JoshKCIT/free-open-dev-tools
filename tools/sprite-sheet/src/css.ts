/** Stub: the CSS writer arrives in the next commit. */
import type { SpritePlan } from './layout';

export const SHEET_FILE_NAME = 'sprite.png';

export function spriteCss(_plan: SpritePlan): string {
  throw new Error('not implemented');
}

export function spritePreviewCss(_css: string, _dataUrl: string): string {
  throw new Error('not implemented');
}
