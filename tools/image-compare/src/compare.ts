export class ImageCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageCompareError';
  }
}

export const DEFAULT_THRESHOLD = 0.1;

export interface Size {
  width: number;
  height: number;
}

export interface CompareResult {
  differing: number;
  total: number;
  diff: Uint8ClampedArray;
}

export function checkThreshold(value: number): number {
  void value;
  throw new Error('not implemented');
}

export function planCompare(
  a: Size,
  b: Size,
  mismatch: 'refuse' | 'pad',
): { width: number; height: number; padded: boolean } {
  void a;
  void b;
  void mismatch;
  throw new Error('not implemented');
}

export function padPixels(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number,
): Uint8ClampedArray {
  void src;
  void width;
  void height;
  void toWidth;
  void toHeight;
  throw new Error('not implemented');
}

export function compareImages(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  options: { threshold: number; includeAA: boolean },
): CompareResult {
  void a;
  void b;
  void width;
  void height;
  void options;
  throw new Error('not implemented');
}

export function shareText(differing: number, total: number): string {
  void differing;
  void total;
  throw new Error('not implemented');
}
