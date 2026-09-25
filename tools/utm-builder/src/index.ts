import meta from './meta.json';

export { meta };

export class UtmBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UtmBuilderError';
  }
}

/** One campaign parameter this tool offers, in the order the Google Analytics
 * documentation lists them. `required` marks the three parameters that page's
 * own text says you should always use: "When you add parameters to a URL,
 * you should always use utm_source, utm_medium, and utm_campaign."
 * (Google Analytics, "Collect campaign data with custom URLs"). */
export interface UtmParameterInfo {
  name: string;
  required: boolean;
}

export const UTM_PARAMETERS: UtmParameterInfo[] = [
  { name: 'utm_id', required: false },
  { name: 'utm_source', required: true },
  { name: 'utm_medium', required: true },
  { name: 'utm_campaign', required: true },
  { name: 'utm_source_platform', required: false },
  { name: 'utm_term', required: false },
  { name: 'utm_content', required: false },
  { name: 'utm_creative_format', required: false },
  { name: 'utm_marketing_tactic', required: false },
];

const UTM_PARAMETER_NAMES = new Set(UTM_PARAMETERS.map((p) => p.name));

export type CampaignParams = Partial<Record<string, string>>;

export interface BuildCampaignUrlOptions {
  /** Lower-cases every typed value before it is written. Default false. */
  lowercase?: boolean;
}

export interface BuildCampaignUrlResult {
  url: string;
  /** Parameter names newly written that were not present in the URL before. */
  added: string[];
  /** Parameter names that already existed in the URL and were overwritten. */
  replaced: string[];
  warnings: string[];
}

/**
 * Decodes a query pair's raw name text with the application/x-www-form-urlencoded
 * rules (`+` is a space, then percent-decode), used only to test whether a raw
 * pair's name is one of `UTM_PARAMETERS` -- never to rebuild the pair itself,
 * so a kept pair's original bytes are never touched.
 */
function decodeFormUrlEncodedName(rawName: string): string {
  try {
    return decodeURIComponent(rawName.replace(/\+/g, ' '));
  } catch {
    return rawName;
  }
}

/**
 * True when a non-empty URL fragment looks like a single-page-app route
 * rather than an ordinary in-page anchor: it starts with a slash, or it
 * carries its own query-like or key-value content.
 */
function looksLikeSpaRoute(hash: string): boolean {
  if (hash === '' || hash === '#') return false;
  const body = hash.slice(1);
  return body.startsWith('/') || body.includes('?') || body.includes('=');
}

/**
 * Attaches campaign parameters to a URL (D-91). Every existing query pair is
 * kept exactly as it appears in the URL, byte for byte; only a pair whose
 * decoded name is one of `UTM_PARAMETERS` is removed to make way for its new
 * value. New values are encoded with the WHATWG URL Standard's component
 * percent-encode set (the same set `encodeURIComponent` uses), then written
 * before the URL's fragment -- mutating `URL.search` and leaving `URL.hash`
 * untouched places new parameters there automatically, since a URL always
 * serialises as scheme://authority/path?query#fragment.
 */
export function buildCampaignUrl(
  urlInput: string,
  params: CampaignParams,
  options: BuildCampaignUrlOptions = {},
): BuildCampaignUrlResult {
  const { lowercase = false } = options;

  let url: URL;
  try {
    url = new URL(urlInput);
  } catch {
    throw new UtmBuilderError('That is not a URL the WHATWG URL Standard can parse.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UtmBuilderError(
      `This tool only builds campaign URLs for http or https links, and "${urlInput}" is neither.`,
    );
  }

  const warnings: string[] = [];

  const existingQueryText = url.search.startsWith('?') ? url.search.slice(1) : '';
  const rawPairs = existingQueryText === '' ? [] : existingQueryText.split('&');

  const existingUtmNames = new Set<string>();
  const keptPairs: string[] = [];
  for (const pair of rawPairs) {
    const eq = pair.indexOf('=');
    const rawName = eq === -1 ? pair : pair.slice(0, eq);
    const decodedName = decodeFormUrlEncodedName(rawName);
    if (UTM_PARAMETER_NAMES.has(decodedName)) {
      existingUtmNames.add(decodedName);
    } else {
      keptPairs.push(pair);
    }
  }

  if (existingUtmNames.size > 0) {
    warnings.push(
      'This URL already carried one or more campaign parameters. They have been replaced with the values entered here.',
    );
  }

  if (looksLikeSpaRoute(url.hash)) {
    warnings.push(
      'This URL has a fragment that looks like a single-page-app route. This tool always places campaign parameters before the fragment, so a route that reads its own parameters from the fragment would not see them.',
    );
  }

  const added: string[] = [];
  const replaced: string[] = [];
  const newPairs: string[] = [];

  for (const { name, required } of UTM_PARAMETERS) {
    const raw = params[name];
    if (raw === undefined || raw === null || raw.trim() === '') {
      if (required) {
        warnings.push(
          `"${name}" is one of the parameters Google Analytics says you should always use, and it was left empty.`,
        );
      }
      continue;
    }

    if (/[A-Z]/.test(raw)) {
      warnings.push(`"${name}" contains an upper-case letter ("${raw}").`);
    }

    const value = lowercase ? raw.toLowerCase() : raw;

    if (existingUtmNames.has(name)) replaced.push(name);
    else added.push(name);

    newPairs.push(`${name}=${encodeURIComponent(value)}`);
  }

  url.search = [...keptPairs, ...newPairs].join('&');

  // Reparse check (D-91): every typed value must come back exactly.
  const check = new URL(url.href);
  for (const { name } of UTM_PARAMETERS) {
    const raw = params[name];
    if (raw === undefined || raw === null || raw.trim() === '') continue;
    const expected = lowercase ? raw.toLowerCase() : raw;
    if (check.searchParams.get(name) !== expected) {
      throw new UtmBuilderError(`Building this URL did not reparse back to the value typed for "${name}".`);
    }
  }
  for (const pair of keptPairs) {
    if (!url.search.includes(pair)) {
      throw new UtmBuilderError('Building this URL did not keep every existing query pair.');
    }
  }

  return { url: url.href, added, replaced, warnings };
}
