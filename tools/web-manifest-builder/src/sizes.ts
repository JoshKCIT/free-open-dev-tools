import { asciiLowercase, isAsciiDigits, splitAscii } from './ascii';

/**
 * Reads the sizes of an icon the way the HTML Standard reads the sizes attribute of link rel=icon, which the Image
 * Resource draft says to use: split on ASCII whitespace; the keyword any means a scalable icon; any other keyword must
 * hold exactly one x or X with a width before it and a height after it, each made of ASCII digits and not starting with
 * zero, or it does not represent a size. Sizes are returned with a lower case x, in the order written.
 */
export function parseIconSizes(text: string): { sizes: string[]; invalid: string[] } {
  const sizes: string[] = [];
  const invalid: string[] = [];
  for (const keyword of splitAscii(text)) {
    if (asciiLowercase(keyword) === 'any') {
      sizes.push('any');
      continue;
    }
    const lower = keyword.replace(/X/g, 'x');
    const first = lower.indexOf('x');
    if (first < 0) {
      invalid.push(keyword);
      continue;
    }
    // A second x ends up in the height, which is then not all digits, so exactly one x is required.
    const width = lower.slice(0, first);
    const height = lower.slice(first + 1);
    if (!isAsciiDigits(width) || !isAsciiDigits(height) || width.startsWith('0') || height.startsWith('0')) {
      invalid.push(keyword);
      continue;
    }
    sizes.push(`${width}x${height}`);
  }
  return { sizes, invalid };
}

/** The icon purposes list of the manifest draft. */
const ICON_PURPOSES: ReadonlySet<string> = new Set(['monochrome', 'maskable', 'any']);

/**
 * Determines the purpose of an icon from the text of its purpose member, as the manifest draft says: split on ASCII
 * whitespace, keep each keyword that is on the icon purposes list (as a set, so a repeated keyword is kept once), and
 * ignore the whole icon when no keyword is known. Keywords are compared exactly. When the member is missing or is not
 * text the purpose is any; that case is the caller's.
 */
export function parseIconPurpose(text: string): { kept: string[]; dropped: string[]; ignoredIcon: boolean } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const keyword of splitAscii(text)) {
    if (ICON_PURPOSES.has(keyword)) {
      if (!kept.includes(keyword)) kept.push(keyword);
    } else {
      dropped.push(keyword);
    }
  }
  return { kept, dropped, ignoredIcon: kept.length === 0 };
}
