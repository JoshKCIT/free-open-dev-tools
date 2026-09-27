/**
 * The favicon set this tool always produces, the HTML `<link>` text and the
 * web app manifest that reference it, and the grapheme-counting rule for
 * text and emoji sources.
 *
 * Sources: the HTML Standard's own `link` element section (`rel=icon`, the
 * `sizes` attribute -- fetched and quoted in this package's `meta.json`
 * `standards` entry); Apple's Human Interface Guidelines / developer
 * documentation for `apple-touch-icon` (a 180 by 180 PNG, always opaque);
 * the W3C Web Application Manifest specification's `icons` member; Chrome's
 * own install-icon guidance (192 and 512 pixel icons) via web.dev.
 */
import { FaviconError } from './ico';

export type FaviconPurpose = 'ico' | 'icon' | 'apple-touch-icon' | 'manifest-icon';

export interface FaviconSetEntry {
  name: string;
  size: number;
  mediaType: string;
  purpose: FaviconPurpose;
}

/**
 * The six files this tool always writes. `favicon.ico` itself carries the
 * 16, 32 and 48 pixel sizes in one multi-size container; the standalone PNG
 * entries here are separate files a page also links directly.
 */
export const FAVICON_SET: FaviconSetEntry[] = [
  { name: 'favicon.ico', size: 48, mediaType: 'image/x-icon', purpose: 'ico' },
  { name: 'favicon-16x16.png', size: 16, mediaType: 'image/png', purpose: 'icon' },
  { name: 'favicon-32x32.png', size: 32, mediaType: 'image/png', purpose: 'icon' },
  { name: 'apple-touch-icon.png', size: 180, mediaType: 'image/png', purpose: 'apple-touch-icon' },
  { name: 'android-chrome-192x192.png', size: 192, mediaType: 'image/png', purpose: 'manifest-icon' },
  { name: 'android-chrome-512x512.png', size: 512, mediaType: 'image/png', purpose: 'manifest-icon' },
];

/** Every size an ICO container this tool builds actually holds, smallest first. */
export const ICO_SIZES: number[] = [16, 32, 48];

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeJsonString(value: string): string {
  return JSON.stringify(value);
}

/**
 * The `<link>` elements for the ICO, the two small PNGs, the Apple touch
 * icon and the manifest -- one line per `FAVICON_SET` entry that a page
 * actually links (the 192/512 manifest icons are referenced only from the
 * manifest itself, per the HTML Standard's own convention that a page need
 * not also list every manifest icon as its own `link rel=icon`).
 */
export function linkTags(): string {
  const lines = [
    `<link rel="icon" href="favicon.ico" sizes="16x16 32x32 48x48">`,
    `<link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">`,
    `<link rel="manifest" href="site.webmanifest">`,
  ];
  return lines.join('\n');
}

export interface ManifestOptions {
  appName: string;
  background: string;
  foreground: string;
}

/** The web app manifest text (W3C Web Application Manifest): name, short name, the 192 and 512 pixel icons, theme and background colours. */
export function manifestJson(options: ManifestOptions): string {
  const manifest = {
    name: options.appName,
    short_name: options.appName.slice(0, 12),
    icons: [
      { src: 'android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    theme_color: options.foreground,
    background_color: options.background,
    display: 'standalone',
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

/** Re-exported so a caller building HTML by hand can escape a value the same way `linkTags` itself would. */
export { escapeHtmlAttribute, escapeJsonString };

export type TextSourceMode = 'text' | 'emoji';

/**
 * Counts graphemes with `Intl.Segmenter`'s own `granularity: 'grapheme'`
 * (the ECMAScript Internationalization API), so a family emoji joined by
 * zero-width joiners counts as one grapheme, not several code points.
 * `text` sources take 1 to 3 graphemes; `emoji` sources take exactly 1.
 */
export function validateTextSource(mode: TextSourceMode, text: string): void {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = Array.from(segmenter.segment(text), (s) => s.segment);
  if (mode === 'text') {
    if (graphemes.length < 1 || graphemes.length > 3) {
      throw new FaviconError(`Text must be 1 to 3 characters; "${text}" is ${graphemes.length}.`);
    }
  } else {
    if (graphemes.length !== 1) {
      throw new FaviconError(`An emoji source must be exactly one character; "${text}" is ${graphemes.length}.`);
    }
  }
}
