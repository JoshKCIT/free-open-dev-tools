/**
 * The word bank this tool draws from.
 *
 * Derived from the standard "Lorem ipsum dolor sit amet, consectetur
 * adipiscing elit..." passage -- itself a scrambled excerpt of Cicero's "De
 * finibus bonorum et malorum" (45 BC), which is in the public domain.
 *
 * Fetched live (not typed from memory), following the transclusion chain the
 * Wikipedia article's "Example text" section actually renders through:
 *   - https://en.wikipedia.org/w/index.php?title=Lorem_ipsum&action=raw
 *     (2026-09-24, revision 1376495366) -- the article itself; its "Example
 *     text" section invokes {{Loremipsum|1|...}}, a template, not inline text.
 *   - https://en.wikipedia.org/w/index.php?title=Template:Lorem_ipsum&action=raw
 *     -- the template, which invokes Module:Lorem ipsum.
 *   - https://en.wikipedia.org/w/index.php?title=Module:Lorem_ipsum/data&action=raw
 *     -- the Lua data module holding the literal passage text. Its first
 *     entry is the standard paragraph:
 *     "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
 *     eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad
 *     minim veniam, quis nostrud exercitation ullamco laboris nisi ut
 *     aliquip ex ea commodo consequat. Duis aute irure dolor in
 *     reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
 *     pariatur. Excepteur sint occaecat cupidatat non proident, sunt in
 *     culpa qui officia deserunt mollit anim id est laborum."
 *
 * That paragraph was lower-cased, its periods and commas stripped, split on
 * whitespace, de-duplicated and sorted to produce the list below: 63 unique
 * words.
 */
export const LOREM_WORDS: readonly string[] = [
  'ad',
  'adipiscing',
  'aliqua',
  'aliquip',
  'amet',
  'anim',
  'aute',
  'cillum',
  'commodo',
  'consectetur',
  'consequat',
  'culpa',
  'cupidatat',
  'deserunt',
  'do',
  'dolor',
  'dolore',
  'duis',
  'ea',
  'eiusmod',
  'elit',
  'enim',
  'esse',
  'est',
  'et',
  'eu',
  'ex',
  'excepteur',
  'exercitation',
  'fugiat',
  'id',
  'in',
  'incididunt',
  'ipsum',
  'irure',
  'labore',
  'laboris',
  'laborum',
  'lorem',
  'magna',
  'minim',
  'mollit',
  'nisi',
  'non',
  'nostrud',
  'nulla',
  'occaecat',
  'officia',
  'pariatur',
  'proident',
  'qui',
  'quis',
  'reprehenderit',
  'sed',
  'sint',
  'sit',
  'sunt',
  'tempor',
  'ullamco',
  'ut',
  'velit',
  'veniam',
  'voluptate',
];
