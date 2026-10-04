import meta from './meta.json';

export { meta };

export { IdnConverterError } from './errors';
export {
  MAX_INPUT_CHARACTERS,
  MAX_LINES,
  MAX_NAME_CHARACTERS,
  MAX_SHOWN_CHARACTERS,
  checkSizes,
  countCharacters,
  visible,
  withCommas,
} from './limits';
export { BROWSER, PROFILES, STRICT } from './profiles';
export type { Profile, ProfileId } from './profiles';
export { FAMILY_WORDS, PROBLEM_FAMILIES, explainName } from './explain';
export type { ExplainDirection, LabelProblem, ProblemFamily } from './explain';
export { convertName, convertNames } from './convert';
export type { ConvertOptions, ConvertedName, Direction, ResolvedDirection } from './convert';
