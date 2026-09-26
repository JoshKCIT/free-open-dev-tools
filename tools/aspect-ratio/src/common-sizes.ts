/**
 * Common aspect ratios and resolutions, as plain facts, each cited to the
 * standard that defines or popularised it.
 *
 * D-122 (orchestrator amendment, 2026-09-25) overrides this phase's original
 * plan of bundling Wikipedia's "List of common resolutions" table: that page
 * is licensed CC BY-SA 4.0, and a share-alike table would bind this file's
 * data to a copyleft licence, against this project's own promise that every
 * tool folder can be taken freely. Nothing here is copied from that or any
 * other table -- every row is this project's own words, citing the
 * standards body that defines it (ITU-R BT.709 / BT.2020 for HD and UHD
 * television, DCI's Digital Cinema System Specification for 2K/4K cinema,
 * VESA's Display Monitor Timing and Coordinated Video Timings standards for
 * common PC display resolutions).
 */

export interface StandardCitation {
  label: string;
  url: string;
  whatItDefines: string;
}

/**
 * The standards bodies and specifications every row below is cited to.
 * Confirmed reachable and fetched this session (recommendation index pages,
 * not the full paywalled/PDF text -- see testNotes in meta.json): ITU-R
 * BT.709 and BT.2020. DCI's own specification pages did not return readable
 * text this session (a JavaScript-rendered shell); its title and resolutions
 * are cited from established, publicly documented industry convention. VESA
 * confirmed its own Display Monitor Timing (DMT) and Coordinated Video
 * Timings (CVT) standards exist and are named on its own "Free Standards"
 * page; their full timing tables are a members-oriented PDF this session
 * could not fetch as text.
 */
export const COMMON_SIZES_SOURCE: StandardCitation[] = [
  {
    label:
      'ITU-R BT.709-6: Parameter values for the HDTV standards for production and international programme exchange',
    url: 'https://www.itu.int/rec/R-REC-BT.709/en',
    whatItDefines: 'HDTV, including the 16:9 picture aspect ratio and the 1280x720 and 1920x1080 formats',
  },
  {
    label:
      'ITU-R BT.2020-2: Parameter values for ultra-high-definition television systems for production and international programme exchange',
    url: 'https://www.itu.int/rec/R-REC-BT.2020/en',
    whatItDefines: 'UHDTV, including the 3840x2160 (UHDTV1) and 7680x4320 (UHDTV2) formats, both 16:9',
  },
  {
    label: 'Digital Cinema Initiatives (DCI), Digital Cinema System Specification',
    url: 'https://dcimovies.com/',
    whatItDefines:
      'digital cinema projection formats, including the 2048x1080 (2K) and 4096x2160 (4K) container resolutions and the 1.85:1 ("flat") and 2.39:1 ("scope") projected aspect ratios',
  },
  {
    label: 'VESA Display Monitor Timing (DMT) and Coordinated Video Timings (CVT) standards',
    url: 'https://vesa.org/vesa-standards/',
    whatItDefines: 'common computer display resolutions, including the 16:10 sizes WXGA, WXGA+, WSXGA+ and WUXGA',
  },
];

export interface RatioEntry {
  name: string;
  ratio: { w: number; h: number };
  commonUses: string;
}

export const COMMON_RATIOS: readonly RatioEntry[] = [
  { name: '1:1 (Square)', ratio: { w: 1, h: 1 }, commonUses: 'Social media posts, avatars, album art' },
  { name: '4:3', ratio: { w: 4, h: 3 }, commonUses: 'Standard-definition television and early computer displays' },
  { name: '3:2', ratio: { w: 3, h: 2 }, commonUses: '35mm still photography and some tablet and laptop screens' },
  {
    name: '16:10',
    ratio: { w: 16, h: 10 },
    commonUses: 'Widescreen computer displays under VESA’s DMT and CVT standards (WXGA, WXGA+, WSXGA+, WUXGA)',
  },
  {
    name: '16:9',
    ratio: { w: 16, h: 9 },
    commonUses: 'HDTV and UHDTV under ITU-R BT.709 and BT.2020, and most modern monitors and phones in landscape',
  },
  {
    name: '21:9 (Ultrawide)',
    ratio: { w: 21, h: 9 },
    commonUses: 'Ultrawide monitors and cinematic video, a display-industry convention rather than a numbered standard',
  },
  {
    name: '9:16 (Portrait)',
    ratio: { w: 9, h: 16 },
    commonUses: 'Phone screens in portrait and short-form vertical video',
  },
  {
    name: '1.85:1 (Flat)',
    ratio: { w: 1.85, h: 1 },
    commonUses: 'The wider of DCI’s two standard theatrical projection formats',
  },
  {
    name: '2.39:1 (Scope)',
    ratio: { w: 2.39, h: 1 },
    commonUses: 'DCI’s anamorphic "cinemascope" theatrical projection format',
  },
];

export interface ResolutionEntry {
  name: string;
  width: number;
  height: number;
  ratio: { w: number; h: number };
}

export const COMMON_RESOLUTIONS: readonly ResolutionEntry[] = [
  { name: '720p (HD)', width: 1280, height: 720, ratio: { w: 16, h: 9 } },
  { name: '1080p (Full HD)', width: 1920, height: 1080, ratio: { w: 16, h: 9 } },
  { name: '1440p (QHD)', width: 2560, height: 1440, ratio: { w: 16, h: 9 } },
  { name: '4K UHD (UHDTV1)', width: 3840, height: 2160, ratio: { w: 16, h: 9 } },
  { name: '8K UHD (UHDTV2)', width: 7680, height: 4320, ratio: { w: 16, h: 9 } },
  { name: 'DCI 2K', width: 2048, height: 1080, ratio: { w: 1.8963, h: 1 } },
  { name: 'DCI 4K', width: 4096, height: 2160, ratio: { w: 1.8963, h: 1 } },
  { name: 'WXGA', width: 1280, height: 800, ratio: { w: 16, h: 10 } },
  { name: 'WXGA+', width: 1440, height: 900, ratio: { w: 16, h: 10 } },
  { name: 'WSXGA+', width: 1680, height: 1050, ratio: { w: 16, h: 10 } },
  { name: 'WUXGA', width: 1920, height: 1200, ratio: { w: 16, h: 10 } },
];
