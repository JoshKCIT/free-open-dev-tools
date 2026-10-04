import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { COMPOSE_SPEC_SCHEMA } from './compose-spec-schema';
import { hasInterpolation } from './interpolation';
import { visible } from './limits';

/** One thing the Compose Specification schema does not accept. */
export interface ComposeProblem {
  /** Where in the document, as a JSON pointer such as /services/web/ports/0, made safe to show. */
  readonly path: string;
  /** What is wrong, in the schema's own words, never holding a value from the document. */
  readonly message: string;
}

export interface ComposeValidation {
  readonly valid: boolean;
  /** The first problems found, at most 20. */
  readonly errors: ComposeProblem[];
  /**
   * How many places the schema would have refused only because a value holds a variable (such as $NAME) that Compose fills
   * in later. They are not judged and are not in `errors`. Left out of the result when there are none.
   */
  readonly notJudged?: number;
}

/** The most problems listed; an invalid document can hold hundreds. */
const MAX_PROBLEMS = 20;

let compiled: ValidateFunction | null = null;

/** The schema, compiled once on first use (compiling takes about a tenth of a second) and reused. */
function validator(): ValidateFunction {
  if (compiled === null) {
    const ajv = new Ajv2020({ allErrors: true, strict: false, logger: false, ownProperties: true, verbose: true });
    compiled = ajv.compile(COMPOSE_SPEC_SCHEMA as object);
  }
  return compiled;
}

function nameOfProblem(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  const named = params['unevaluatedProperty'] ?? params['additionalProperty'] ?? params['missingProperty'];
  return typeof named === 'string' ? ` (${visible(named)})` : '';
}

/**
 * Checks a Compose document against the bundled Compose Specification JSON schema. The result lists where each problem
 * is and what the schema says about it; a value from the document is never repeated beyond 40 escaped characters.
 */
export function validateComposeDocument(document: unknown): ComposeValidation {
  const check = validator();
  const valid = check(document) as boolean;
  if (valid) return { valid: true, errors: [] };
  const seen = new Set<string>();
  const errors: ComposeProblem[] = [];
  // Places whose value holds a variable: the schema judges the unfilled text, which says nothing about what Compose will read.
  const notJudged = new Set<string>();
  for (const error of (check.errors ?? []) as ErrorObject[]) {
    if (typeof error.data === 'string' && hasInterpolation(error.data)) {
      notJudged.add(error.instancePath);
      continue;
    }
    const problem = {
      path: visible(error.instancePath === '' ? '/' : error.instancePath, 80),
      message: `${error.message ?? 'is not valid'}${nameOfProblem(error)}`,
    };
    const key = `${problem.path}\n${problem.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push(problem);
    if (errors.length === MAX_PROBLEMS) break;
  }
  const left = notJudged.size > 0 ? { notJudged: notJudged.size } : {};
  return { valid: errors.length === 0, errors, ...left };
}
