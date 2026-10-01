/**
 * Keyword lists copied from the WHATWG HTML Living Standard (last updated 2026-09-29), fetched on the date in
 * SPEC_FETCHED. A later edition of the standard may differ.
 *
 * - TRACK_KINDS and TRACK_KIND_DEFAULTS: the keyword table of the kind attribute in 4.8.10 The track element,
 *   https://html.spec.whatwg.org/multipage/media.html#attr-track-kind
 * - PRELOAD_KEYWORDS: the keyword table of the preload attribute in 4.8.11.5 Loading the media resource,
 *   https://html.spec.whatwg.org/multipage/media.html#attr-media-preload
 * - LOADING_KEYWORDS: the keyword table of 2.5.7 Lazy loading attributes,
 *   https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-loading-attributes
 * - CORS_KEYWORDS: the keyword table of 2.5.4 CORS settings attributes,
 *   https://html.spec.whatwg.org/multipage/urls-and-fetching.html#cors-settings-attributes
 */
export const SPEC_LAST_UPDATED = '2026-09-29';
export const SPEC_FETCHED = '2026-10-01';

/** The five values of the kind attribute of a track element, in the order of the standard's table. */
export const TRACK_KINDS = ['subtitles', 'captions', 'descriptions', 'chapters', 'metadata'] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

/** The kind a track has when the attribute is missing and when its value is not a keyword (4.8.10). */
export const TRACK_KIND_DEFAULTS = { missingValue: 'subtitles', invalidValue: 'metadata' } as const;

/** The three values of the preload attribute (4.8.11.5). An empty value means auto. */
export const PRELOAD_KEYWORDS = ['auto', 'none', 'metadata'] as const;

/** The two values of a lazy loading attribute (2.5.7). A missing or invalid value means eager. */
export const LOADING_KEYWORDS = ['lazy', 'eager'] as const;

/** The two values of a CORS settings attribute (2.5.4). An empty or invalid value means anonymous. */
export const CORS_KEYWORDS = ['anonymous', 'use-credentials'] as const;
