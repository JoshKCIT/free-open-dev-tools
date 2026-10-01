/**
 * The link types that may be written in the rel attribute of an a element, and the keywords of its target attribute,
 * copied from the HTML Living Standard and the IANA Link Relations registry.
 *
 * - LINK_TYPES_ON_A: the rows of table "table-link-relations" (4.6.8 Link types, https://html.spec.whatwg.org/multipage/links.html)
 *   whose "a and area" column is not "not allowed", with that column as the effect and the table's own brief
 *   description. colspan and rowspan were expanded before reading.
 * - REGISTERED_EXTENSIONS: two values the Living Standard's table does not list, copied from the IANA Link Relations
 *   registry (https://www.iana.org/assignments/link-relations/link-relations.xml) with the date of their records.
 * - TARGET_KEYWORDS: the keywords of 7.3.1.7 Navigable target names (https://html.spec.whatwg.org/multipage/document-sequences.html).
 *
 * Generated once by a throwaway script from the fetched pages; edit it only by copying a newer edition of them.
 */

/** The "Last Updated" date printed on the fetched Living Standard page. */
export const SPEC_LAST_UPDATED = '2026-09-29';

/** The day the Living Standard page and the registry were copied. */
export const SPEC_FETCHED = '2026-10-01';

/** The "updated" date of the IANA Link Relations registry when it was copied. */
export const IANA_REGISTRY_UPDATED = '2026-06-12';

export type LinkEffect = 'Hyperlink' | 'Annotation';

export interface LinkType {
  value: string;
  effect: LinkEffect;
  description: string;
}

export interface RegisteredExtension {
  value: string;
  description: string;
  /** The date on the registry record. */
  recorded: string;
}

/** The 16 link types the Living Standard allows on an a element, in the order of its table. */
export const LINK_TYPES_ON_A: readonly LinkType[] = [
  { value: 'alternate', effect: 'Hyperlink', description: 'Gives alternate representations of the current document.' },
  {
    value: 'author',
    effect: 'Hyperlink',
    description: 'Gives a link to the author of the current document or article.',
  },
  { value: 'bookmark', effect: 'Hyperlink', description: 'Gives the permalink for the nearest ancestor section.' },
  {
    value: 'external',
    effect: 'Annotation',
    description: 'Indicates that the referenced document is not part of the same site as the current document.',
  },
  { value: 'help', effect: 'Hyperlink', description: 'Provides a link to context-sensitive help.' },
  {
    value: 'license',
    effect: 'Hyperlink',
    description:
      'Indicates that the main content of the current document is covered by the copyright license described by the referenced document.',
  },
  {
    value: 'next',
    effect: 'Hyperlink',
    description:
      'Indicates that the current document is a part of a series, and that the next document in the series is the referenced document.',
  },
  {
    value: 'nofollow',
    effect: 'Annotation',
    description:
      "Indicates that the current document's original author or publisher does not endorse the referenced document.",
  },
  {
    value: 'noopener',
    effect: 'Annotation',
    description:
      'Creates a top-level traversable with a non-auxiliary browsing context if the hyperlink would otherwise create one that was auxiliary (i.e., has an appropriate target attribute value).',
  },
  {
    value: 'noreferrer',
    effect: 'Annotation',
    description: 'No `Referer` (sic) header will be included. Additionally, has the same effect as noopener.',
  },
  {
    value: 'opener',
    effect: 'Annotation',
    description:
      'Creates an auxiliary browsing context if the hyperlink would otherwise create a top-level traversable with a non-auxiliary browsing context (i.e., has "_blank" as target attribute value).',
  },
  {
    value: 'prev',
    effect: 'Hyperlink',
    description:
      'Indicates that the current document is a part of a series, and that the previous document in the series is the referenced document.',
  },
  {
    value: 'privacy-policy',
    effect: 'Hyperlink',
    description:
      'Gives a link to information about the data collection and usage practices that apply to the current document.',
  },
  {
    value: 'search',
    effect: 'Hyperlink',
    description:
      'Gives a link to a resource that can be used to search through the current document and its related pages.',
  },
  {
    value: 'tag',
    effect: 'Hyperlink',
    description: 'Gives a tag (identified by the given address) that applies to the current document.',
  },
  {
    value: 'terms-of-service',
    effect: 'Hyperlink',
    description:
      "Gives a link to information about the agreements between the current document's provider and users who wish to use the current document.",
  },
];

/** Registered with IANA but not in the Living Standard's table. */
export const REGISTERED_EXTENSIONS: readonly RegisteredExtension[] = [
  {
    value: 'sponsored',
    description:
      'Refers to a resource that is within a context that is sponsored (such as advertising or another compensation agreement).',
    recorded: '2019-11-07',
  },
  {
    value: 'ugc',
    description: 'Refers to a resource that is within a context that is User Generated Content.',
    recorded: '2019-11-07',
  },
];

/** The keywords a target attribute may hold, besides a name of its own (7.3.1.7). */
export const TARGET_KEYWORDS = ['_blank', '_self', '_parent', '_top'] as const;
