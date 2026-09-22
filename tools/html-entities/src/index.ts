import {
  decodeHTML,
  decodeHTMLStrict,
  decodeXML,
  encodeHTML,
  encodeNonAsciiHTML,
  encodeXML,
  escapeAttribute,
  escapeText,
  escapeUTF8,
} from 'entities';
import meta from './meta.json';

export { meta };

export type EncodeStrategy =
  /** Escape only what is dangerous in markup: & < > " '. Everything else stays. */
  | 'minimal'
  /** Escape the minimal set, plus every character above ASCII. For old transports. */
  | 'non-ascii'
  /** Escape everything that has a named reference. Large output, maximum safety. */
  | 'all-named'
  /** Escape the five XML predefined entities only. */
  | 'xml'
  /** The set that is safe inside a double-quoted attribute value. */
  | 'attribute';

export type DecodeStrategy =
  /** HTML5 rules, including legacy references that have no semicolon. */
  | 'html'
  /** Require a semicolon, as XML does. Rejects the legacy forms. */
  | 'strict'
  /** Only the five predefined XML entities. */
  | 'xml';

export interface EncodeOptions {
  strategy?: EncodeStrategy;
  /** Use numeric references such as &#38; rather than named ones such as &amp;. */
  numeric?: boolean;
  /** With `numeric`, emit hexadecimal (&#x26;) rather than decimal (&#38;). */
  hexadecimal?: boolean;
}

const MINIMAL: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function toNumeric(text: string, hexadecimal: boolean, shouldEscape: (ch: string) => boolean): string {
  let out = '';
  for (const ch of text) {
    if (!shouldEscape(ch)) {
      out += ch;
      continue;
    }
    const code = ch.codePointAt(0)!;
    out += hexadecimal ? `&#x${code.toString(16)};` : `&#${code};`;
  }
  return out;
}

export function encode(text: string, options: EncodeOptions = {}): string {
  const { strategy = 'minimal', numeric = false, hexadecimal = false } = options;

  if (numeric) {
    const predicate =
      strategy === 'non-ascii' || strategy === 'all-named'
        ? (ch: string) => ch in MINIMAL || ch.codePointAt(0)! > 127
        : (ch: string) => ch in MINIMAL;
    return toNumeric(text, hexadecimal, predicate);
  }

  switch (strategy) {
    case 'minimal':
      // escapeUTF8 covers & < > " ' and leaves everything else alone, which is
      // what you want when the document is already UTF-8. The one adjustment is
      // the apostrophe: &apos; is valid in XML and HTML5 but was never defined
      // in HTML 4, whereas the numeric form has always been understood.
      return escapeUTF8(text).replace(/&apos;/g, '&#39;');
    case 'non-ascii':
      return encodeNonAsciiHTML(text);
    case 'all-named':
      return encodeHTML(text);
    case 'xml':
      return encodeXML(text);
    case 'attribute':
      return escapeAttribute(text).replace(/&apos;/g, '&#39;');
    default:
      return escapeText(text);
  }
}

export function decode(text: string, strategy: DecodeStrategy = 'html'): string {
  switch (strategy) {
    case 'strict':
      return decodeHTMLStrict(text);
    case 'xml':
      return decodeXML(text);
    default:
      return decodeHTML(text);
  }
}

export interface EntityReport {
  /** Every distinct entity reference found, with what it decodes to. */
  found: { reference: string; decoded: string; codePoints: string; kind: 'named' | 'decimal' | 'hexadecimal' }[];
  /** References that look like entities but are not recognised. */
  unrecognised: string[];
  /** References that HTML5 accepts without a closing semicolon. */
  missingSemicolon: string[];
}

const REFERENCE = /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);?/g;

/** Lists what is actually in the text, which is usually the question being asked. */
export function inspect(text: string): EntityReport {
  const found = new Map<string, EntityReport['found'][number]>();
  const unrecognised: string[] = [];
  const missingSemicolon: string[] = [];

  for (const match of text.matchAll(REFERENCE)) {
    const reference = match[0];
    const body = match[1]!;
    const hasSemicolon = reference.endsWith(';');
    const decoded = decodeHTML(hasSemicolon ? reference : reference + ';');

    const kind: 'named' | 'decimal' | 'hexadecimal' =
      body.startsWith('#x') || body.startsWith('#X') ? 'hexadecimal' : body.startsWith('#') ? 'decimal' : 'named';

    if (decoded === (hasSemicolon ? reference : reference + ';')) {
      if (!unrecognised.includes(reference)) unrecognised.push(reference);
      continue;
    }

    if (!hasSemicolon && !missingSemicolon.includes(reference)) missingSemicolon.push(reference);

    if (!found.has(reference)) {
      found.set(reference, {
        reference,
        decoded,
        codePoints: Array.from(decoded)
          .map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
          .join(' '),
        kind,
      });
    }
  }

  return { found: [...found.values()], unrecognised, missingSemicolon };
}

/** True when encoding then decoding returns the original text exactly. */
export function roundTrips(text: string, options: EncodeOptions = {}): boolean {
  return decode(encode(text, options)) === text;
}

/** The entities that matter most often, for a reference table. */
export const COMMON_ENTITIES: { character: string; named: string; decimal: string; name: string }[] = [
  { character: '&', named: '&amp;', decimal: '&#38;', name: 'Ampersand' },
  { character: '<', named: '&lt;', decimal: '&#60;', name: 'Less than' },
  { character: '>', named: '&gt;', decimal: '&#62;', name: 'Greater than' },
  { character: '"', named: '&quot;', decimal: '&#34;', name: 'Double quote' },
  { character: "'", named: '&apos;', decimal: '&#39;', name: 'Apostrophe (not valid in HTML 4)' },
  { character: ' ', named: '&nbsp;', decimal: '&#160;', name: 'Non-breaking space' },
  { character: '©', named: '&copy;', decimal: '&#169;', name: 'Copyright' },
  { character: '®', named: '&reg;', decimal: '&#174;', name: 'Registered trademark' },
  { character: '™', named: '&trade;', decimal: '&#8482;', name: 'Trademark' },
  { character: '–', named: '&ndash;', decimal: '&#8211;', name: 'En dash' },
  { character: '—', named: '&mdash;', decimal: '&#8212;', name: 'Em dash' },
  { character: '‘', named: '&lsquo;', decimal: '&#8216;', name: 'Left single quote' },
  { character: '’', named: '&rsquo;', decimal: '&#8217;', name: 'Right single quote' },
  { character: '“', named: '&ldquo;', decimal: '&#8220;', name: 'Left double quote' },
  { character: '”', named: '&rdquo;', decimal: '&#8221;', name: 'Right double quote' },
  { character: '…', named: '&hellip;', decimal: '&#8230;', name: 'Horizontal ellipsis' },
  { character: '€', named: '&euro;', decimal: '&#8364;', name: 'Euro' },
  { character: '£', named: '&pound;', decimal: '&#163;', name: 'Pound' },
  { character: '°', named: '&deg;', decimal: '&#176;', name: 'Degree' },
  { character: '×', named: '&times;', decimal: '&#215;', name: 'Multiplication sign' },
  { character: '→', named: '&rarr;', decimal: '&#8594;', name: 'Right arrow' },
  { character: '♥', named: '&hearts;', decimal: '&#9829;', name: 'Heart suit' },
];
