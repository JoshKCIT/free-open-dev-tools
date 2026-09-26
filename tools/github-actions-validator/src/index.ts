import meta from './meta.json';
import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import {
  readYaml,
  locatePointer,
  findingsFromAjvErrors,
  pointerToPath,
  YamlSourceError,
  type YamlFinding,
} from './yaml-source';
import { GITHUB_WORKFLOW_SCHEMA, GITHUB_WORKFLOW_SCHEMA_COMMIT } from './github-workflow-schema';
import { findExpressions, parseExpression } from './expressions';

export { meta, YamlSourceError };
export type { YamlFinding };
export {
  findExpressions,
  findExpressionSpans,
  parseExpression,
  EXPRESSION_FUNCTIONS,
  EXPRESSION_CONTEXTS,
} from './expressions';
export type { ExpressionContext, ExpressionProblem, ExpressionReference, ParseExpressionResult } from './expressions';

export interface WorkflowValidateResult {
  valid: boolean;
  findings: YamlFinding[];
  jobs: string[];
  events: string[];
  schemaCommit: string;
}

export class WorkflowValidatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowValidatorError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerFrom(tokens: (string | number)[]): string {
  if (tokens.length === 0) return '';
  return '/' + tokens.map((t) => escapeToken(String(t))).join('/');
}

/** Levenshtein edit distance, used only to suggest a close-enough name (capped search, never a hot path). */
function editDistance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }
  return dp[b.length]!;
}

function closeMatch(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(name, candidate);
    if (distance <= 2 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The event names the bundled schema's own `on` string/array form accepts
 * (its `definitions.event.enum`, quoted from GitHub's "Events that trigger
 * workflows" page -- https://docs.github.com/en/actions/reference/events-that-trigger-workflows,
 * fetched 2026-09-26), read from the bundled schema itself rather than
 * hand-copied so this list can never drift from what `on` actually accepts.
 */
function schemaEventNames(): string[] {
  const definitions = (GITHUB_WORKFLOW_SCHEMA as { definitions?: Record<string, unknown> }).definitions ?? {};
  const eventDef = definitions.event as { enum?: unknown[] } | undefined;
  return Array.isArray(eventDef?.enum) ? eventDef.enum.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * The keys the schema's `on` object form accepts -- every event name plus
 * `schedule`, which is a special top-level key (a cron array), never a bare
 * webhook event name on its own.
 */
function schemaOnObjectKeys(): string[] {
  const onSchema = (GITHUB_WORKFLOW_SCHEMA as { properties?: { on?: { oneOf?: unknown[] } } }).properties?.on;
  const objectBranch = onSchema?.oneOf?.[2] as { properties?: Record<string, unknown> } | undefined;
  return Object.keys(objectBranch?.properties ?? {});
}

interface OnCheckResult {
  findings: YamlFinding[];
  events: string[];
}

/**
 * Checks the top-level `on` value against the schema's own event names
 * directly (rather than letting Ajv's `oneOf` branch failures surface),
 * naming the exact bad event and suggesting a close match within edit
 * distance 2 -- friendlier than the raw "must match one of the accepted
 * forms" noise a `oneOf` failure produces for three branches at once.
 */
function checkOn(value: unknown, docIndex: number, source: ReturnType<typeof readYaml>): OnCheckResult {
  const findings: YamlFinding[] = [];
  const events: string[] = [];
  if (!isRecord(value) || !('on' in value)) return { findings, events };

  const on = value.on;
  const knownEvents = schemaEventNames();
  const knownObjectKeys = schemaOnObjectKeys();

  const reportBadEvent = (name: string, pointer: string, allowed: string[]) => {
    const pos = locatePointer(source, docIndex, pointer, { key: true });
    const suggestion = closeMatch(name, allowed);
    const message = suggestion
      ? `"${name}" is not an event this schema accepts here -- did you mean "${suggestion}"?`
      : `"${name}" is not an event this schema accepts here.`;
    findings.push({
      line: pos.line,
      column: pos.column,
      path: pointerToPath(pointer),
      pointer,
      keyword: 'event',
      severity: 'error',
      message,
    });
  };

  if (typeof on === 'string') {
    events.push(on);
    if (!knownEvents.includes(on)) reportBadEvent(on, '/on', knownEvents);
    return { findings, events };
  }

  if (Array.isArray(on)) {
    on.forEach((item, i) => {
      if (typeof item !== 'string') return;
      events.push(item);
      if (!knownEvents.includes(item)) reportBadEvent(item, pointerFrom(['on', i]), knownEvents);
    });
    return { findings, events };
  }

  if (isRecord(on)) {
    for (const key of Object.keys(on)) {
      events.push(key);
      if (!knownObjectKeys.includes(key)) reportBadEvent(key, pointerFrom(['on', key]), knownObjectKeys);
    }
    return { findings, events };
  }

  return { findings, events };
}

interface NeedsGraphResult {
  findings: YamlFinding[];
}

/** Reads a job's `needs` value (absent, a string, or an array of strings) as a plain string list. */
function needsList(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  return [];
}

/**
 * Job-graph checks the schema alone cannot express (JSON Schema has no way
 * to compare one property's value against a sibling mapping's key set): a
 * `needs` entry naming no job in this file (GitHub's own "jobs.<job_id>.needs"
 * documentation -- "identify any jobs that must complete successfully before
 * this job will run"), a cycle of `needs` among jobs (GitHub's own runs
 * refuse a workflow whose job dependency graph is not a DAG), and a step
 * `id` repeated within one job (GitHub's own "jobs.<job_id>.steps[*].id" --
 * "A unique identifier for the step").
 */
function jobGraphFindings(value: unknown, docIndex: number, source: ReturnType<typeof readYaml>): NeedsGraphResult {
  const findings: YamlFinding[] = [];
  if (!isRecord(value) || !isRecord(value.jobs)) return { findings };

  const jobs = value.jobs;
  const jobIds = Object.keys(jobs).filter((id) => isRecord(jobs[id]));
  const jobIdSet = new Set(jobIds);
  const dependsOn = new Map<string, string[]>();

  for (const jobId of jobIds) {
    const job = jobs[jobId] as Record<string, unknown>;
    const deps = needsList(job.needs);
    dependsOn.set(jobId, deps);

    for (const dep of deps) {
      if (jobIdSet.has(dep)) continue;
      const pointer = pointerFrom(['jobs', jobId, 'needs']);
      const pos = locatePointer(source, docIndex, pointer);
      findings.push({
        line: pos.line,
        column: pos.column,
        path: pointerToPath(pointer),
        pointer,
        keyword: 'needs',
        severity: 'error',
        message: `This job needs "${dep}", which names no job in this file.`,
      });
    }

    const steps = Array.isArray(job.steps) ? job.steps : [];
    const seenStepIds = new Map<string, number>();
    steps.forEach((step, index) => {
      if (!isRecord(step) || typeof step.id !== 'string') return;
      const id = step.id;
      if (seenStepIds.has(id)) {
        const pointer = pointerFrom(['jobs', jobId, 'steps', index, 'id']);
        const pos = locatePointer(source, docIndex, pointer, { key: true });
        findings.push({
          line: pos.line,
          column: pos.column,
          path: pointerToPath(pointer),
          pointer,
          keyword: 'step-id',
          severity: 'error',
          message: `Step id "${id}" is already used earlier in this job (first at step ${seenStepIds.get(id)! + 1}); step ids must be unique within a job.`,
        });
      } else {
        seenStepIds.set(id, index);
      }
    });
  }

  // Cycle detection: a standard three-colour depth-first search over the
  // `needs` graph. Reports each job once, at the first cycle discovered from
  // it, naming every job on the cycle.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(jobIds.map((id) => [id, WHITE]));
  const reported = new Set<string>();

  function visit(jobId: string, stack: string[]): void {
    color.set(jobId, GRAY);
    stack.push(jobId);
    for (const dep of dependsOn.get(jobId) ?? []) {
      if (!jobIdSet.has(dep)) continue;
      const depColor = color.get(dep);
      if (depColor === GRAY) {
        const cycleStart = stack.indexOf(dep);
        const cycle = stack.slice(cycleStart).concat(dep);
        const cycleKey = Array.from(new Set(cycle)).sort().join(',');
        if (!reported.has(cycleKey)) {
          reported.add(cycleKey);
          const pointer = pointerFrom(['jobs', jobId, 'needs']);
          const pos = locatePointer(source, docIndex, pointer);
          findings.push({
            line: pos.line,
            column: pos.column,
            path: pointerToPath(pointer),
            pointer,
            keyword: 'needs-cycle',
            severity: 'error',
            message: `These jobs need each other in a cycle: ${cycle.join(' needs ')}.`,
          });
        }
      } else if (depColor === WHITE) {
        visit(dep, stack);
      }
    }
    stack.pop();
    color.set(jobId, BLACK);
  }

  for (const jobId of jobIds) {
    if (color.get(jobId) === WHITE) visit(jobId, []);
  }

  return { findings };
}

/** Splits a pointer's own tokens back out (mirrors pointerFrom's own escaping). */
function pointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * Every `${{ }}` expression in the document (found by `findExpressions`,
 * which already handles a delimiter-less job/step `if`) is parsed with
 * `parseExpression` and turned into a finding per problem, at the exact
 * line and column inside the value, with the key path that holds it
 * (D-100, success criterion 2). Two further checks read each expression's
 * own context references, cited to the Contexts reference page
 * (https://docs.github.com/en/actions/learn-github-actions/contexts,
 * fetched 2026-09-26): a `steps.<id>` reference naming no step that runs
 * earlier in the same job (a step's own outputs do not exist yet for any
 * step before it, or for a job-level value, which runs before every step)
 * becomes a warning, and a `needs.<job>` reference naming a job the current
 * job does not itself list in `needs` (so that job's outputs were never
 * guaranteed to exist when this one runs) becomes a warning too.
 */
function expressionFindings(
  text: string,
  source: ReturnType<typeof readYaml>,
  docIndex: number,
  value: unknown,
): YamlFinding[] {
  const findings: YamlFinding[] = [];
  const entry = source.documents[docIndex];
  if (!entry) return findings;

  const jobs = isRecord(value) && isRecord(value.jobs) ? value.jobs : {};

  for (const found of findExpressions(text, entry.doc)) {
    const result = parseExpression(found.span.text);
    const pos = entry ? source.lineCounter.linePos(found.absoluteStart) : { line: 1, col: 1 };

    for (const problem of result.problems) {
      const errorPos = source.lineCounter.linePos(found.absoluteStart + problem.offset);
      findings.push({
        line: errorPos.line,
        column: errorPos.col,
        path: pointerToPath(found.pointer),
        pointer: found.pointer,
        keyword: 'expression',
        severity: 'error',
        message: problem.message,
      });
    }

    const tokens = pointerTokens(found.pointer);
    const jobId = tokens[0] === 'jobs' ? tokens[1] : undefined;
    const job = jobId !== undefined && isRecord(jobs[jobId]) ? (jobs[jobId] as Record<string, unknown>) : undefined;
    if (!job) continue;

    const stepIndex = tokens[2] === 'steps' && /^\d+$/.test(tokens[3] ?? '') ? Number(tokens[3]) : undefined;
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const earlierStepIds = new Set(
      steps
        .slice(0, stepIndex ?? steps.length)
        .filter((s): s is Record<string, unknown> => isRecord(s) && typeof s.id === 'string')
        .map((s) => s.id as string),
    );
    const ownNeeds = new Set(needsList(job.needs));

    for (const ref of result.references) {
      if (ref.context === 'steps') {
        const stepId = ref.path.split('.')[1];
        if (stepId && !earlierStepIds.has(stepId)) {
          findings.push({
            line: pos.line,
            column: pos.col,
            path: pointerToPath(found.pointer),
            pointer: found.pointer,
            keyword: 'steps-context',
            severity: 'warning',
            message: `This references the output of step "${stepId}", which is not a step that has already run in this job.`,
          });
        }
      }
      if (ref.context === 'needs') {
        const neededJob = ref.path.split('.')[1];
        if (neededJob && !ownNeeds.has(neededJob)) {
          findings.push({
            line: pos.line,
            column: pos.col,
            path: pointerToPath(found.pointer),
            pointer: found.pointer,
            keyword: 'needs-context',
            severity: 'warning',
            message: `This references job "${neededJob}", which this job does not list in its own needs, so that job's outputs are not guaranteed to exist yet.`,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Several schema properties (`timeout-minutes`, `continue-on-error`,
 * `environment`, and others) accept EITHER a plain value OR
 * `$ref: #/definitions/expressionSyntax`/`stringContainingExpressionSyntax`
 * (a `${{ }}` expression string) via `oneOf`. When the plain-value branch is
 * inline, its per-branch error keeps its `oneOf/<index>` schemaPath and the
 * shared `findingsFromAjvErrors` branch-merge groups it correctly; but the
 * `$ref`-based branch's error resolves to the REF TARGET's own schemaPath
 * (`#/definitions/expressionSyntax/pattern`, no `oneOf` segment at all -- the
 * same Ajv/$ref interaction `validateJobs`'s own comment describes for jobs),
 * so that error is never recognised as part of the group and survives
 * alongside the correctly-merged one, duplicating the same instancePath.
 * Once more than one raw error shares an instancePath AND a bare `oneOf`/
 * `anyOf` summary error is present for it (proving Ajv considered this a
 * branch choice, not two independent problems), only the summary itself is
 * kept -- safer than either duplicating branch noise or inventing a merged
 * message this tool cannot verify is accurate for a `$ref`'d branch it never
 * inspects the contents of.
 */
function collapseRefBranchNoise(errors: ErrorObject[]): ErrorObject[] {
  const byPath = new Map<string, ErrorObject[]>();
  for (const error of errors) {
    const list = byPath.get(error.instancePath) ?? [];
    list.push(error);
    byPath.set(error.instancePath, list);
  }
  const result: ErrorObject[] = [];
  for (const group of byPath.values()) {
    if (group.length <= 1) {
      result.push(...group);
      continue;
    }
    const summary = group.find(
      (e) => (e.keyword === 'oneOf' || e.keyword === 'anyOf') && /\/(oneOf|anyOf)$/.test(e.schemaPath),
    );
    result.push(summary ?? group[0]!);
    if (!summary) result.push(...group.slice(1));
  }
  return result;
}

/**
 * A workflow job is `oneOf(normalJob, reusableWorkflowCallJob)` in the
 * schema. Ajv's $ref resolution flattens each branch's own `schemaPath` down
 * to that branch's own root (`#/additionalProperties`, not
 * `#/oneOf/0/additionalProperties`), so the shared `findingsFromAjvErrors`
 * branch-merging logic -- built for compose-spec's inline-schema oneOf,
 * where schemaPath DOES keep the branch index -- cannot tell which of a
 * job's raw errors came from which branch. A single misspelled key (like
 * "step" for "steps") therefore fails BOTH branches at once and produces
 * five raw errors, not one. Rather than editing the canonical, byte-for-byte
 * `yaml-source.ts`, this tool decides each job's intended branch itself
 * (reusableWorkflowCallJob when the job has a `uses` key, normalJob
 * otherwise -- the two schemas are mutually exclusive on that key) and
 * validates each job directly against only that branch's own schema
 * fragment, via `ajv.getSchema('workflow#/definitions/<branch>')`. Every raw
 * error the whole-document pass produced under `/jobs/<id>` is dropped and
 * replaced by this per-job, single-branch validation, whose errors are never
 * ambiguous about which schema they came from.
 */
interface JobValidator {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}

function validateJobs(
  jobs: Record<string, unknown>,
  normalJobValidate: JobValidator,
  reusableJobValidate: JobValidator,
): ErrorObject[] {
  const errors: ErrorObject[] = [];
  for (const [jobId, job] of Object.entries(jobs)) {
    const usesReusable = isRecord(job) && typeof job.uses === 'string';
    const validateFn = usesReusable ? reusableJobValidate : normalJobValidate;
    const ok = validateFn(job);
    if (ok) continue;
    const jobErrors = validateFn.errors ?? [];
    const prefix = pointerFrom(['jobs', jobId]);
    for (const err of jobErrors) {
      errors.push({ ...err, instancePath: prefix + err.instancePath });
    }
  }
  return errors;
}

/**
 * Validates `text` (a GitHub Actions workflow file) against the pinned
 * SchemaStore workflow schema, plus this project's own event, job-graph and
 * step-id checks. Never throws for a structurally invalid document -- a
 * syntax error (thrown by `readYaml`) is the only way this function raises.
 *
 * GitHub's own documentation does not state whether its workflow parser
 * applies YAML merge keys (`<<`); no vendored SchemaStore or starter-workflow
 * fixture uses one either. This tool therefore reads workflows with
 * `merge: false` (yaml's own conservative default) and documents the
 * uncertainty in `meta.json`'s ambiguities rather than asserting untested
 * behaviour.
 */
export function validateWorkflow(text: string): WorkflowValidateResult {
  const source = readYaml(text, { merge: false });
  const entry = source.documents[0];
  const value = entry?.value;

  const ajv = new Ajv({ allErrors: true, strict: false, logger: false, ownProperties: true, verbose: true });
  let workflowValidate: JobValidator;
  let normalJobValidate: JobValidator;
  let reusableJobValidate: JobValidator;
  try {
    ajv.addSchema(GITHUB_WORKFLOW_SCHEMA as object, 'workflow');
    workflowValidate = ajv.getSchema('workflow#') as JobValidator;
    normalJobValidate = ajv.getSchema('workflow#/definitions/normalJob') as JobValidator;
    reusableJobValidate = ajv.getSchema('workflow#/definitions/reusableWorkflowCallJob') as JobValidator;
    if (!workflowValidate || !normalJobValidate || !reusableJobValidate) {
      throw new Error('One or more schema fragments could not be resolved.');
    }
  } catch (err) {
    throw new WorkflowValidatorError(
      err instanceof Error ? err.message : 'The GitHub Actions workflow schema could not be compiled.',
    );
  }

  const valid = workflowValidate(value) as boolean;
  const wholeDocumentErrors = (workflowValidate.errors ?? []) as ErrorObject[];
  // Drop every error the whole-document pass attributed to inside a specific
  // job; validateJobs below recomputes those precisely, one branch at a
  // time. Errors AT "/jobs" itself (for example a job id outside the
  // documented pattern, or the mapping having zero jobs) are unaffected.
  const nonJobErrors = wholeDocumentErrors.filter((e) => !/^\/jobs\/[^/]+/.test(e.instancePath));
  const jobErrors =
    isRecord(value) && isRecord(value.jobs) ? validateJobs(value.jobs, normalJobValidate, reusableJobValidate) : [];

  // The "on" value itself (instancePath "/on", whether the raw error is a
  // type/oneOf/enum mismatch on a bad bare value or an additionalProperties
  // error whose OWN instancePath is the "on" mapping for a bad object key --
  // Ajv's additionalProperties convention names the mapping that holds the
  // extra key, never the key itself) and a bad array item ("/on/0") are
  // replaced by checkOn's own friendlier message (see that function's own
  // comment for why). This is filtered on the RAW instancePath, before
  // findingsFromAjvErrors synthesises a display pointer for the
  // additionalProperties case, since that synthesis already points AT the
  // bad key and would no longer match this shape. A problem nested one
  // level deeper, inside a named event's own configuration object (for
  // example on.pull_request.ignore-paths, a typo SchemaStore's own negative
  // tests exercise), has a different instancePath ("/on/pull_request") and
  // is a genuine, unambiguous schema finding that stays.
  const onFilteredAjvErrors = [...nonJobErrors, ...jobErrors].filter((e) => !/^\/on(\/\d+)?$/.test(e.instancePath));
  const schemaFindings = findingsFromAjvErrors(source, 0, collapseRefBranchNoise(onFilteredAjvErrors));

  const { findings: onFindings, events } = checkOn(value, 0, source);
  const { findings: jobFindings } = jobGraphFindings(value, 0, source);
  const exprFindings = expressionFindings(text, source, 0, value);

  const findings = [...schemaFindings, ...onFindings, ...jobFindings, ...exprFindings].sort(
    (a, b) => a.line - b.line || a.column - b.column,
  );
  const jobs = isRecord(value) && isRecord(value.jobs) ? Object.keys(value.jobs) : [];
  const hasErrors = findings.some((f) => f.severity === 'error');

  return { valid: valid && !hasErrors, findings, jobs, events, schemaCommit: GITHUB_WORKFLOW_SCHEMA_COMMIT };
}
