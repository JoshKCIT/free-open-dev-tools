/**
 * Grades a pasted Content-Security-Policy against a stated rule set. Every rule names the section of W3C Content
 * Security Policy Level 3 (https://www.w3.org/TR/CSP3/, Working Draft of 16 September 2026) it rests on, or says that it
 * is this page's own rule. The grade is this page's own summary of those rules; it is never a statement that a policy is
 * secure.
 *
 * The policy is read by the existing `parseCspDirectives` (not edited here). Effective source lists follow CSP Level 3
 * section 6.8.3 ("Get fetch directive fallback list"). Directive and rule lookups use `Map`s, so a directive named
 * `__proto__`, `constructor` or `toString` is only an unknown directive.
 */
import { parseCspDirectives, type CspDirective } from './csp';

export type CspSeverity = 'high' | 'medium' | 'low' | 'info';
export type CspGradeLetter = 'A' | 'B' | 'C' | 'D' | 'F';

/** One rule of the table: what it says when it fires. */
export interface CspRule {
  id: string;
  severity: CspSeverity;
  /** What is wrong, in one sentence. */
  finding: string;
  /** Why it matters. */
  why: string;
  /** The fix. */
  fix: string;
  /** The CSP Level 3 section the rule rests on, or the statement that it is this page's own rule. */
  basis: string;
}

export interface CspFinding {
  rule: string;
  severity: CspSeverity;
  directive: string;
  finding: string;
  why: string;
  fix: string;
  basis: string;
}

export interface CspGrade {
  grade: CspGradeLetter;
  score: number;
  findings: CspFinding[];
  source: 'policy' | 'header' | 'report-only header' | 'meta';
  policy: string;
  /** True when there was nothing to grade; the grade and score then carry no meaning. */
  empty: boolean;
}

/** Points taken off 100 by the first finding of each rule that fires. This is the page's own summary policy. */
export const CSP_SEVERITY_WEIGHTS: ReadonlyMap<CspSeverity, number> = new Map<CspSeverity, number>([
  ['high', 30],
  ['medium', 15],
  ['low', 5],
  ['info', 0],
]);

// The rules, in table order. Findings are listed by severity and then by this order.
export const CSP_RULES: readonly CspRule[] = [
  {
    id: 'script-unrestricted',
    severity: 'high',
    finding: 'Scripts are not restricted: the policy has no script-src, script-src-elem or default-src.',
    why: 'Any script from anywhere may run, so the policy does nothing against an injected script.',
    fix: "Add default-src 'self', or a script-src that names where scripts may come from.",
    basis:
      'CSP Level 3 section 6: developers SHOULD include directives that regulate sources of script and plugins, either both script-src and object-src or a default-src',
  },
  {
    id: 'script-unsafe-inline',
    severity: 'high',
    finding: "'unsafe-inline' allows inline scripts and javascript: URLs, and nothing overrides it.",
    why: 'Inline script and javascript: URLs run, which is what an injected script needs.',
    fix: "Remove 'unsafe-inline' and allow scripts by nonce or hash.",
    basis:
      "CSP Level 3 section 6: developers SHOULD NOT include 'unsafe-inline' or data: as valid sources; section 6.7.3.2 (does a source list allow all inline behavior)",
  },
  {
    id: 'object-src',
    severity: 'medium',
    finding: "Plugin content is not blocked: object-src is missing or is not 'none'.",
    why: 'Plugin content (object and embed) is not restricted, and it can run code.',
    fix: "Add object-src 'none'.",
    basis:
      'CSP Level 3 section 6: developers SHOULD include directives that regulate sources of script and plugins (section 6.1.9 object-src)',
  },
];

const RULE_BY_ID: ReadonlyMap<string, CspRule> = new Map(CSP_RULES.map((r) => [r.id, r]));
const RULE_ORDER: ReadonlyMap<string, number> = new Map(CSP_RULES.map((r, i) => [r.id, i]));
const SEVERITY_ORDER: ReadonlyMap<CspSeverity, number> = new Map<CspSeverity, number>([
  ['high', 0],
  ['medium', 1],
  ['low', 2],
  ['info', 3],
]);

// CSP Level 3 section 6.8.3, "Get fetch directive fallback list", in the order the section gives. A name that is not
// listed (base-uri, form-action, frame-ancestors, sandbox, report-uri, report-to) has no fallback.
const FALLBACK: ReadonlyMap<string, readonly string[]> = new Map([
  ['script-src-elem', ['script-src-elem', 'script-src', 'default-src']],
  ['script-src-attr', ['script-src-attr', 'script-src', 'default-src']],
  ['style-src-elem', ['style-src-elem', 'style-src', 'default-src']],
  ['style-src-attr', ['style-src-attr', 'style-src', 'default-src']],
  ['worker-src', ['worker-src', 'child-src', 'script-src', 'default-src']],
  ['connect-src', ['connect-src', 'default-src']],
  ['manifest-src', ['manifest-src', 'default-src']],
  ['object-src', ['object-src', 'default-src']],
  ['frame-src', ['frame-src', 'child-src', 'default-src']],
  ['media-src', ['media-src', 'default-src']],
  ['font-src', ['font-src', 'default-src']],
  ['img-src', ['img-src', 'default-src']],
]);

type SourceIndex = ReadonlyMap<string, readonly string[]>;

/** Name to source tokens; the first occurrence of a directive wins (CSP Level 3, parsing a serialized policy). */
function indexDirectives(directives: readonly CspDirective[]): SourceIndex {
  const index = new Map<string, readonly string[]>();
  for (const d of directives) {
    if (!index.has(d.name)) index.set(d.name, d.value === '' ? [] : d.value.split(' '));
  }
  return index;
}

function effectiveIn(index: SourceIndex, name: string): { directive: string; sources: string[] } | null {
  for (const candidate of FALLBACK.get(name) ?? [name]) {
    const list = index.get(candidate);
    if (list) return { directive: candidate, sources: [...list] };
  }
  return null;
}

/**
 * The source list that governs `name`: the most specific directive that is present in the order of CSP Level 3 section
 * 6.8.3, or null when none is. base-uri, form-action and frame-ancestors never fall back to default-src.
 */
export function effectiveSources(
  directives: readonly CspDirective[],
  name: string,
): { directive: string; sources: string[] } | null {
  return effectiveIn(indexDirectives(directives), name);
}

function hasKeyword(list: readonly string[], keyword: string): boolean {
  return list.some((t) => t.toLowerCase() === keyword);
}

function isNonceOrHash(token: string): boolean {
  const t = token.toLowerCase();
  return t.startsWith("'nonce-") || t.startsWith("'sha256-") || t.startsWith("'sha384-") || t.startsWith("'sha512-");
}

function finding(id: string, directive: string): CspFinding {
  const rule = RULE_BY_ID.get(id);
  if (!rule) throw new Error(`Unknown rule ${id}`);
  return {
    rule: rule.id,
    severity: rule.severity,
    directive,
    finding: rule.finding,
    why: rule.why,
    fix: rule.fix,
    basis: rule.basis,
  };
}

function compareFindings(a: CspFinding, b: CspFinding): number {
  const bySeverity = (SEVERITY_ORDER.get(a.severity) ?? 9) - (SEVERITY_ORDER.get(b.severity) ?? 9);
  if (bySeverity !== 0) return bySeverity;
  const byRule = (RULE_ORDER.get(a.rule) ?? 999) - (RULE_ORDER.get(b.rule) ?? 999);
  if (byRule !== 0) return byRule;
  if (a.directive !== b.directive) return a.directive < b.directive ? -1 : 1;
  if (a.finding !== b.finding) return a.finding < b.finding ? -1 : 1;
  return 0;
}

function letterFor(score: number, anyHigh: boolean): CspGradeLetter {
  const letter: CspGradeLetter = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  // Any high finding caps the grade at D.
  return anyHigh && (letter === 'A' || letter === 'B' || letter === 'C') ? 'D' : letter;
}

function evaluate(index: SourceIndex): CspFinding[] {
  const found: CspFinding[] = [];

  const script = effectiveIn(index, 'script-src-elem');
  if (!script) {
    found.push(finding('script-unrestricted', 'script-src'));
  } else {
    const list = script.sources;
    const modern = list.some(isNonceOrHash);
    const strict = hasKeyword(list, "'strict-dynamic'");
    if (hasKeyword(list, "'unsafe-inline'") && !modern && !strict) {
      found.push(finding('script-unsafe-inline', script.directive));
    }
  }

  const object = effectiveIn(index, 'object-src');
  if (!object) found.push(finding('object-src', 'object-src'));
  else if (!hasKeyword(object.sources, "'none'")) found.push(finding('object-src', object.directive));

  return found;
}

export function gradeCsp(text: string): CspGrade {
  const policy = text;
  const empty = policy.trim() === '';
  const parsed = parseCspDirectives(policy);
  const findings = empty ? [] : evaluate(indexDirectives(parsed.directives));
  findings.sort(compareFindings);

  // Each rule that fires counts once, however many findings it lists.
  const fired = new Map<string, CspSeverity>();
  for (const f of findings) fired.set(f.rule, f.severity);
  let score = 100;
  for (const severity of fired.values()) score -= CSP_SEVERITY_WEIGHTS.get(severity) ?? 0;
  score = Math.max(0, score);

  return {
    grade: empty
      ? 'F'
      : letterFor(
          score,
          findings.some((f) => f.severity === 'high'),
        ),
    score: empty ? 0 : score,
    findings,
    source: 'policy',
    policy,
    empty,
  };
}
