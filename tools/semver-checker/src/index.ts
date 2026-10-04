import meta from './meta.json';

export { meta };

export { SemverCheckerError } from './errors';
export {
  MAX_ALTERNATIVES,
  MAX_INPUT_CHARACTERS,
  MAX_LINES,
  MAX_RANGE_CHARACTERS,
  MAX_VERSION_CHARACTERS,
  checkSizes,
  withCommas,
} from './limits';
export { MAX_SHOWN_CHARACTERS, splitVersionLines, visible } from './lines';
export { checkVersions } from './check';
export type { CheckOptions, CheckResult, CheckResultText, CheckRow } from './check';
export { sortVersions } from './sort';
export type { InvalidLine, SortOptions, SortResult, SortedVersion } from './sort';
export { explainRange } from './explain';
export type { ExplainedAlternative, ExplainedComparator, RangeExplanation } from './explain';
