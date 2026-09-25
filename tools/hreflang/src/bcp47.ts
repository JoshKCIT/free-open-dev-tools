/**
 * A hand-rolled BCP 47 (RFC 5646) language tag checker, written as a scanner
 * over hyphen-separated subtags per the section 2.1 ABNF (Figure 1):
 *
 *   Language-Tag  = langtag / privateuse / grandfathered
 *   langtag       = language ["-" script] ["-" region] *("-" variant)
 *                   *("-" extension) ["-" privateuse]
 *   language      = 2*3ALPHA ["-" extlang] / 4ALPHA / 5*8ALPHA
 *   extlang       = 3ALPHA *2("-" 3ALPHA)
 *   script        = 4ALPHA
 *   region        = 2ALPHA / 3DIGIT
 *   variant       = 5*8alphanum / (DIGIT 3alphanum)
 *   extension     = singleton 1*("-" (2*8alphanum))
 *   singleton     = DIGIT / %x41-57 / %x59-5A / %x61-77 / %x79-7A  (not x/X)
 *   privateuse    = "x" 1*("-" (1*8alphanum))
 *
 * "well-formed" and "valid" are the two classes of conformance RFC 5646
 * section 2.2.9 defines: well-formed means it matches this ABNF; valid
 * additionally requires every primary language, extended language, script,
 * region and variant subtag to be registered in the IANA Language Subtag
 * Registry as of the bundled snapshot's date, no duplicate variant, and no
 * duplicate extension singleton.
 *
 * The 26 grandfathered tags (Figure 1's 'irregular' and 'regular'
 * productions) are transcribed here literally from the RFC text, because
 * they are, in the RFC's own words, "a fixed list that can never change"
 * (section 2.1) -- not derived from the registry, even though the
 * registry's own 26 Type: grandfathered records happen to name the same 26
 * tags.
 */
import { lookupSubtag, lookupTag, REGISTRY_FILE_DATE } from './iana-language-subtag-registry';

// RFC 5646 Figure 1: tags that do not match the 'langtag' production and
// would otherwise be invalid.
const IRREGULAR_GRANDFATHERED = [
  'en-GB-oed',
  'i-ami',
  'i-bnn',
  'i-default',
  'i-enochian',
  'i-hak',
  'i-klingon',
  'i-lux',
  'i-mingo',
  'i-navajo',
  'i-pwn',
  'i-tao',
  'i-tay',
  'i-tsu',
  'sgn-BE-FR',
  'sgn-BE-NL',
  'sgn-CH-DE',
];

// RFC 5646 Figure 1: tags that (appear to) match the 'langtag' production,
// but whose subtags either do not individually appear in the registry or
// appear with a different semantic meaning.
const REGULAR_GRANDFATHERED = [
  'art-lojban',
  'cel-gaulish',
  'no-bok',
  'no-nyn',
  'zh-guoyu',
  'zh-hakka',
  'zh-min',
  'zh-min-nan',
  'zh-xiang',
];

const GRANDFATHERED_CANONICAL = new Map(
  [...IRREGULAR_GRANDFATHERED, ...REGULAR_GRANDFATHERED].map((t) => [t.toLowerCase(), t]),
);

const ALPHA = /^[A-Za-z]+$/;
const ALPHANUM = /^[A-Za-z0-9]+$/;

function isSingleton(seg: string): boolean {
  // DIGIT / A-W / Y-Z / a-w / y-z -- everything alphanumeric except 'x'/'X'.
  return seg.length === 1 && ALPHANUM.test(seg) && seg.toLowerCase() !== 'x';
}

function isVariant(seg: string): boolean {
  if (seg.length >= 5 && seg.length <= 8 && ALPHANUM.test(seg)) return true;
  if (seg.length === 4 && /^[0-9]/.test(seg) && ALPHANUM.test(seg.slice(1))) return true;
  return false;
}

export interface ExtensionSubtag {
  singleton: string;
  subtags: string[];
}

export interface LanguageTagParts {
  /** Present only for one of the 26 fixed grandfathered tags. */
  grandfathered?: string;
  language?: string;
  extlangs?: string[];
  script?: string;
  region?: string;
  variants?: string[];
  extensions?: ExtensionSubtag[];
  privateuse?: string[];
}

export interface LanguageTagCheck {
  wellFormed: boolean;
  valid: boolean;
  /** The tag rewritten per section 2.1.1's case conventions. Empty when not well-formed. */
  canonical: string;
  problems: string[];
  warnings: string[];
  parts: LanguageTagParts;
  /** Set when the input used '_' where '-' was meant, and the hyphenated form is well-formed. */
  suggestion?: string;
}

function titlecase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1).toLowerCase();
}

function canonicalOf(parts: LanguageTagParts): string {
  if (parts.grandfathered) return parts.grandfathered;
  if (parts.privateuse && !parts.language) {
    return ['x', ...parts.privateuse.map((p) => p.toLowerCase())].join('-');
  }
  const out: string[] = [];
  if (parts.language) out.push(parts.language.toLowerCase());
  for (const e of parts.extlangs ?? []) out.push(e.toLowerCase());
  if (parts.script) out.push(titlecase(parts.script));
  if (parts.region) out.push(parts.region.toUpperCase());
  for (const v of parts.variants ?? []) out.push(v.toLowerCase());
  for (const ext of parts.extensions ?? []) {
    out.push(ext.singleton.toLowerCase());
    for (const s of ext.subtags) out.push(s.toLowerCase());
  }
  if (parts.privateuse) {
    out.push('x');
    for (const p of parts.privateuse) out.push(p.toLowerCase());
  }
  return out.join('-');
}

/**
 * Parses a tag against the ordinary 'langtag' ABNF production only (not
 * privateuse-alone or grandfathered). Returns null when it does not match.
 */
function parseLangtag(segments: string[]): LanguageTagParts | null {
  let i = 0;
  const first = segments[i];
  if (first === undefined) return null;

  let language: string;
  const extlangs: string[] = [];
  if (ALPHA.test(first) && first.length >= 2 && first.length <= 3) {
    language = first;
    i++;
    // Up to 3 extlang subtags are well-formed per the ABNF, even though
    // RFC 5646 section 2.2.2 rule 4 makes the 2nd and 3rd always invalid.
    while (extlangs.length < 3 && segments[i] !== undefined && segments[i]!.length === 3 && ALPHA.test(segments[i]!)) {
      extlangs.push(segments[i]!);
      i++;
    }
  } else if (ALPHA.test(first) && first.length === 4) {
    language = first; // reserved for future use
    i++;
  } else if (ALPHA.test(first) && first.length >= 5 && first.length <= 8) {
    language = first; // registered language subtag
    i++;
  } else {
    return null;
  }

  let script: string | undefined;
  if (segments[i] !== undefined && segments[i]!.length === 4 && ALPHA.test(segments[i]!)) {
    script = segments[i];
    i++;
  }

  let region: string | undefined;
  if (segments[i] !== undefined) {
    const seg = segments[i]!;
    if ((seg.length === 2 && ALPHA.test(seg)) || (seg.length === 3 && /^[0-9]{3}$/.test(seg))) {
      region = seg;
      i++;
    }
  }

  const variants: string[] = [];
  while (segments[i] !== undefined && isVariant(segments[i]!)) {
    variants.push(segments[i]!);
    i++;
  }

  const extensions: ExtensionSubtag[] = [];
  while (segments[i] !== undefined && isSingleton(segments[i]!)) {
    const singleton = segments[i]!;
    i++;
    const subtags: string[] = [];
    while (
      segments[i] !== undefined &&
      segments[i]!.length >= 2 &&
      segments[i]!.length <= 8 &&
      ALPHANUM.test(segments[i]!)
    ) {
      subtags.push(segments[i]!);
      i++;
    }
    if (subtags.length === 0) return null; // singleton with nothing following it
    extensions.push({ singleton, subtags });
  }

  let privateuse: string[] | undefined;
  if (segments[i] !== undefined && segments[i]!.toLowerCase() === 'x') {
    i++;
    const parts: string[] = [];
    while (
      segments[i] !== undefined &&
      segments[i]!.length >= 1 &&
      segments[i]!.length <= 8 &&
      ALPHANUM.test(segments[i]!)
    ) {
      parts.push(segments[i]!);
      i++;
    }
    if (parts.length === 0) return null;
    privateuse = parts;
  }

  if (i !== segments.length) return null; // leftover segments that fit nothing

  return {
    language,
    extlangs: extlangs.length ? extlangs : undefined,
    script,
    region,
    variants: variants.length ? variants : undefined,
    extensions: extensions.length ? extensions : undefined,
    privateuse,
  };
}

function parsePrivateuseOnly(segments: string[]): LanguageTagParts | null {
  if (segments[0]?.toLowerCase() !== 'x') return null;
  const parts = segments.slice(1);
  if (parts.length === 0) return null;
  for (const p of parts) {
    if (p.length < 1 || p.length > 8 || !ALPHANUM.test(p)) return null;
  }
  return { privateuse: parts };
}

function hasDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const v of values) {
    const lower = v.toLowerCase();
    if (seen.has(lower)) return v;
    seen.add(lower);
  }
  return null;
}

/**
 * Checks a single BCP 47 (RFC 5646) language tag for well-formedness and,
 * against the bundled IANA Language Subtag Registry snapshot, validity.
 * Never throws -- always returns a report.
 */
export function checkLanguageTag(rawTag: string): LanguageTagCheck {
  const warnings: string[] = [];
  const input = rawTag.trim();

  if (input.length === 0) {
    return {
      wellFormed: false,
      valid: false,
      canonical: '',
      problems: ['Empty input is not a language tag.'],
      warnings,
      parts: {},
    };
  }

  let suggestion: string | undefined;
  if (input.includes('_')) {
    const hyphenated = input.replace(/_/g, '-');
    const test = checkLanguageTagInner(hyphenated);
    if (test.wellFormed) suggestion = hyphenated;
  }

  const result = checkLanguageTagInner(input);
  if (suggestion) {
    result.suggestion = suggestion;
    if (!result.wellFormed) {
      result.problems.push(
        `This is not well-formed as written. Did you mean "${suggestion}" (hyphens, not underscores)?`,
      );
    }
  }
  return result;
}

function checkLanguageTagInner(input: string): LanguageTagCheck {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (/\s/.test(input)) {
    return {
      wellFormed: false,
      valid: false,
      canonical: '',
      problems: ['A language tag cannot contain whitespace (RFC 5646 section 2.1).'],
      warnings,
      parts: {},
    };
  }

  const segments = input.split('-');
  if (segments.some((s) => s.length === 0)) {
    return {
      wellFormed: false,
      valid: false,
      canonical: '',
      problems: ['A language tag cannot have an empty subtag (two hyphens in a row, or a leading/trailing hyphen).'],
      warnings,
      parts: {},
    };
  }
  if (segments.some((s) => s.length > 8)) {
    return {
      wellFormed: false,
      valid: false,
      canonical: '',
      problems: ['Every subtag has a maximum length of eight characters (RFC 5646 section 2.1).'],
      warnings,
      parts: {},
    };
  }

  const lower = input.toLowerCase();
  if (GRANDFATHERED_CANONICAL.has(lower)) {
    const canonical = GRANDFATHERED_CANONICAL.get(lower)!;
    const parts: LanguageTagParts = { grandfathered: canonical };
    const registryRecord = lookupTag(canonical);
    if (registryRecord?.deprecated) {
      const replacement = registryRecord.preferredValue
        ? ` The registry's Preferred-Value is "${registryRecord.preferredValue}".`
        : '';
      warnings.push(`"${canonical}" is a deprecated grandfathered tag.${replacement}`);
    }
    return { wellFormed: true, valid: true, canonical, problems, warnings, parts };
  }

  let parts = parseLangtag(segments);
  if (!parts) parts = parsePrivateuseOnly(segments);

  if (!parts) {
    return {
      wellFormed: false,
      valid: false,
      canonical: '',
      problems: [`"${input}" does not match the RFC 5646 language tag grammar.`],
      warnings,
      parts: {},
    };
  }

  const wellFormed = true;
  const canonical = canonicalOf(parts);

  // A tag that is entirely private use (Language-Tag = privateuse) has no
  // registry-checkable subtags at all; it is valid by definition.
  if (!parts.language) {
    return { wellFormed, valid: true, canonical, problems, warnings, parts };
  }

  let valid = true;

  const languageRecord = lookupSubtag('language', parts.language);
  if (!languageRecord) {
    valid = false;
    problems.push(`"${parts.language}" is not a registered primary language subtag.`);
  } else if (languageRecord.deprecated) {
    // Deprecated still means "appears in the registry" (RFC 5646 section
    // 2.2.9's own definition of valid), so this does not clear `valid` --
    // only a subtag absent from the registry entirely does that.
    const replacement = languageRecord.preferredValue ? ` Use "${languageRecord.preferredValue}" instead.` : '';
    warnings.push(`The language subtag "${parts.language}" is deprecated.${replacement}`);
  }

  if (parts.extlangs && parts.extlangs.length > 0) {
    if (parts.extlangs.length > 1) {
      valid = false;
      problems.push(
        'RFC 5646 section 2.2.2 rule 4: only one extended language subtag is ever valid; the second and third positions are permanently reserved and invalid.',
      );
    }
    for (const extlang of parts.extlangs) {
      const record = lookupSubtag('extlang', extlang);
      if (!record) {
        valid = false;
        problems.push(`"${extlang}" is not a registered extended language subtag.`);
      } else {
        const prefixOk = record.prefixes.some((p) => p.toLowerCase() === parts!.language!.toLowerCase());
        if (!prefixOk) {
          valid = false;
          problems.push(
            `The extended language subtag "${extlang}" is only registered with the prefix ${record.prefixes.map((p) => `"${p}"`).join(' or ')}, not "${parts!.language}".`,
          );
        }
        if (record.deprecated) {
          warnings.push(`The extended language subtag "${extlang}" is deprecated.`);
        }
      }
    }
  }

  if (parts.script) {
    const record = lookupSubtag('script', parts.script);
    if (!record) {
      valid = false;
      problems.push(`"${parts.script}" is not a registered script subtag.`);
    } else if (record.deprecated) {
      const replacement = record.preferredValue ? ` Use "${record.preferredValue}" instead.` : '';
      warnings.push(`The script subtag "${parts.script}" is deprecated.${replacement}`);
    }
    if (languageRecord?.suppressScript && languageRecord.suppressScript.toLowerCase() === parts.script.toLowerCase()) {
      warnings.push(
        `The script subtag "${parts.script}" adds no distinguishing value here: the registry lists it as the Suppress-Script for "${parts.language}".`,
      );
    }
  }

  if (parts.region) {
    const record = lookupSubtag('region', parts.region);
    if (!record) {
      valid = false;
      problems.push(`"${parts.region}" is not a registered region subtag.`);
    } else if (record.deprecated) {
      const replacement = record.preferredValue ? ` Use "${record.preferredValue}" instead.` : '';
      warnings.push(`The region subtag "${parts.region}" is deprecated.${replacement}`);
    }
  }

  if (parts.variants && parts.variants.length > 0) {
    const dup = hasDuplicate(parts.variants);
    if (dup) {
      valid = false;
      problems.push(`The variant subtag "${dup}" is repeated; RFC 5646 section 2.2.5 rule 5 forbids that.`);
    }
    for (const variant of parts.variants) {
      const record = lookupSubtag('variant', variant);
      if (!record) {
        valid = false;
        problems.push(`"${variant}" is not a registered variant subtag.`);
        continue;
      }
      if (record.deprecated) {
        const replacement = record.preferredValue ? ` Use "${record.preferredValue}" instead.` : '';
        warnings.push(`The variant subtag "${variant}" is deprecated.${replacement}`);
      }
      if (record.prefixes.length > 0 && parts.language) {
        const built = [
          parts.language,
          ...(parts.extlangs ?? []),
          ...(parts.script ? [parts.script] : []),
          ...(parts.region ? [parts.region] : []),
        ]
          .join('-')
          .toLowerCase();
        const prefixOk = record.prefixes.some(
          (p) => built === p.toLowerCase() || built.startsWith(p.toLowerCase() + '-') || built === p.toLowerCase(),
        );
        if (!prefixOk) {
          warnings.push(
            `The variant "${variant}" is registered with a recommended prefix (${record.prefixes.map((p) => `"${p}"`).join(', ')}) that this tag does not start with (RFC 5646 section 2.2.5: Prefix is a recommendation, not a requirement).`,
          );
        }
      }
    }
  }

  if (parts.extensions && parts.extensions.length > 0) {
    const singletons = parts.extensions.map((e) => e.singleton);
    const dup = hasDuplicate(singletons);
    if (dup) {
      valid = false;
      problems.push(`The extension singleton "${dup}" is repeated; RFC 5646 section 2.2.6 rule 3 forbids that.`);
    }
  }

  return { wellFormed, valid, canonical, problems, warnings, parts };
}

export { REGISTRY_FILE_DATE };
