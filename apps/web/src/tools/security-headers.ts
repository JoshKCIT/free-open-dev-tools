import {
  meta,
  buildSecurityHeaders,
  SecurityHeadersError,
  gradeCsp as gradePolicy,
  type CspGrade,
} from '@fodt/security-headers';
import { defineTool, str, bool, num, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const REFERRER_POLICY_OPTIONS = [
  { value: '', label: '(omit)' },
  { value: 'no-referrer', label: 'no-referrer' },
  { value: 'no-referrer-when-downgrade', label: 'no-referrer-when-downgrade' },
  { value: 'same-origin', label: 'same-origin' },
  { value: 'origin', label: 'origin' },
  { value: 'strict-origin', label: 'strict-origin' },
  { value: 'origin-when-cross-origin', label: 'origin-when-cross-origin' },
  { value: 'strict-origin-when-cross-origin', label: 'strict-origin-when-cross-origin' },
  { value: 'unsafe-url', label: 'unsafe-url' },
];

const COOP_OPTIONS = [
  { value: '', label: '(omit)' },
  { value: 'unsafe-none', label: 'unsafe-none' },
  { value: 'same-origin-allow-popups', label: 'same-origin-allow-popups' },
  { value: 'same-origin', label: 'same-origin' },
  { value: 'noopener-allow-popups', label: 'noopener-allow-popups' },
];

const COEP_OPTIONS = [
  { value: '', label: '(omit)' },
  { value: 'unsafe-none', label: 'unsafe-none' },
  { value: 'require-corp', label: 'require-corp' },
  { value: 'credentialless', label: 'credentialless' },
];

const CORP_OPTIONS = [
  { value: '', label: '(omit)' },
  { value: 'same-origin', label: 'same-origin' },
  { value: 'same-site', label: 'same-site' },
  { value: 'cross-origin', label: 'cross-origin' },
];

/** The grade note, the findings table and the scoring note, appended after the builder's blocks when Grade this policy is ticked. */
function gradeBlocks(grade: CspGrade): OutputBlock[] {
  if (grade.empty) return [{ kind: 'note', tone: 'info', value: 'Paste a policy to grade.' }];
  const blocks: OutputBlock[] = [];
  const tone = grade.grade === 'A' || grade.grade === 'B' ? 'success' : grade.grade === 'F' ? 'error' : 'warn';
  blocks.push({ kind: 'note', label: 'Grade', tone, value: `Grade ${grade.grade} (${grade.score} of 100)` });
  if (grade.notes.length > 0) {
    blocks.push({
      kind: 'note',
      tone: 'info',
      value: `${grade.notes.join(' ')} The headers above are built from that policy text.`,
    });
  }
  if (grade.findings.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', value: 'None of the rules found a weakness in this policy.' });
  } else {
    blocks.push({
      kind: 'table',
      label: 'Policy weaknesses',
      table: {
        headers: ['Severity', 'Directive', 'Finding', 'Why', 'Fix', 'Basis'],
        rows: grade.findings.map((f) => [f.severity, f.directive, f.finding, f.why, f.fix, f.basis]),
        mono: [1],
      },
    });
  }
  blocks.push({
    kind: 'note',
    tone: 'info',
    value:
      "How the grade is worked out: each rule that applies takes points off 100 (high 30, medium 15, low 5, info 0), A is 90 or more, B 75, C 60, D 40 and F below 40, and any high finding caps the grade at D. It is this page's own summary of the rules listed, not a statement that a policy is secure.",
  });
  return blocks;
}

export default defineTool({
  id: 'security-headers',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'csp',
      label: 'Content-Security-Policy',
      type: 'textarea',
      rows: 6,
      mono: true,
      default: "default-src 'self'\nobject-src 'none'\nbase-uri 'self'\nframe-ancestors 'none'",
    },
    {
      name: 'gradeCsp',
      label: 'Grade this policy',
      type: 'checkbox',
      default: false,
      help: 'Grades the policy above against listed rules from W3C Content Security Policy Level 3 and shows the fix for each weakness. A header line or a meta element can be pasted whole.',
    },
    {
      name: 'reportOnly',
      label: 'Report only (Content-Security-Policy-Report-Only)',
      type: 'checkbox',
      default: false,
    },
    { name: 'upgradeInsecure', label: 'Add upgrade-insecure-requests', type: 'checkbox', default: false },
    { name: 'hsts', label: 'Strict-Transport-Security (HSTS)', type: 'checkbox', default: true },
    {
      name: 'hstsMaxAge',
      label: 'HSTS max-age (seconds)',
      type: 'number',
      default: 31536000,
      min: 0,
      visible: (v) => bool(v, 'hsts', true),
    },
    {
      name: 'hstsIncludeSubDomains',
      label: 'includeSubDomains',
      type: 'checkbox',
      default: true,
      visible: (v) => bool(v, 'hsts', true),
    },
    {
      name: 'hstsPreload',
      label: 'preload (for submission to the HSTS preload list)',
      type: 'checkbox',
      default: false,
      visible: (v) => bool(v, 'hsts', true),
    },
    {
      name: 'referrerPolicy',
      label: 'Referrer-Policy',
      type: 'select',
      default: 'strict-origin-when-cross-origin',
      options: REFERRER_POLICY_OPTIONS,
    },
    { name: 'nosniff', label: 'X-Content-Type-Options: nosniff', type: 'checkbox', default: true },
    {
      name: 'permissions',
      label: 'Permissions-Policy (one feature=allowlist per line)',
      type: 'textarea',
      rows: 4,
      mono: true,
      default: 'camera=()\nmicrophone=()\ngeolocation=()',
    },
    { name: 'coop', label: 'Cross-Origin-Opener-Policy', type: 'select', default: '', options: COOP_OPTIONS },
    { name: 'coep', label: 'Cross-Origin-Embedder-Policy', type: 'select', default: '', options: COEP_OPTIONS },
    { name: 'corp', label: 'Cross-Origin-Resource-Policy', type: 'select', default: '', options: CORP_OPTIONS },
    { name: 'netlifyPath', label: 'Netlify path pattern', type: 'text', mono: true, default: '/*' },
  ],
  examples: [
    {
      label: 'A strict default policy with HSTS preload',
      values: { hstsPreload: true },
    },
  ],
  run(values): ToolResult {
    try {
      // Grading is off by default. When it is on and the paste carried a header name or a meta element, the builder is
      // given the policy text without it, so it does not report the header name as an unknown directive.
      const grading = bool(values, 'gradeCsp', false) ? gradePolicy(str(values, 'csp')) : null;
      const policyText = grading && grading.source !== 'policy' ? grading.policy : str(values, 'csp');
      const rawMaxAge = num(values, 'hstsMaxAge', 31536000);
      let maxAge = Math.trunc(rawMaxAge);
      const clampWarnings: string[] = [];
      if (maxAge < 0) {
        clampWarnings.push('HSTS max-age cannot be negative; it was clamped to 0.');
        maxAge = 0;
      }

      const result = buildSecurityHeaders({
        csp: policyText,
        reportOnly: bool(values, 'reportOnly', false),
        upgradeInsecure: bool(values, 'upgradeInsecure', false),
        hsts: bool(values, 'hsts', true)
          ? {
              maxAge,
              includeSubDomains: bool(values, 'hstsIncludeSubDomains', true),
              preload: bool(values, 'hstsPreload', false),
            }
          : null,
        referrerPolicy: str(values, 'referrerPolicy'),
        nosniff: bool(values, 'nosniff', true),
        permissions: str(values, 'permissions'),
        coop: str(values, 'coop'),
        coep: str(values, 'coep'),
        corp: str(values, 'corp'),
        path: str(values, 'netlifyPath', '/*'),
      });

      if (result.headers.length === 0) return { outputs: grading ? gradeBlocks(grading) : [] };

      const headerList = result.headers.map((h) => `${h.name}: ${h.value}`).join('\n');

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'Header list', language: 'text', value: headerList, download: 'headers.txt' },
        {
          kind: 'code',
          label: 'Apache (.htaccess or server config)',
          language: 'apache',
          value: result.apache,
          download: 'security-headers.conf',
        },
        {
          kind: 'code',
          label: 'nginx',
          language: 'nginx',
          value: result.nginx,
          download: 'security-headers.nginx.conf',
        },
        { kind: 'code', label: 'Netlify _headers', language: 'text', value: result.netlify, download: '_headers' },
      ];

      const allWarnings = [...clampWarnings, ...result.warnings];
      if (allWarnings.length > 0) {
        outputs.push({ kind: 'note', label: 'Notes', tone: 'warn', value: allWarnings.join('\n') });
      }

      if (grading) outputs.push(...gradeBlocks(grading));

      return { outputs };
    } catch (err) {
      if (err instanceof SecurityHeadersError) {
        return { outputs: [], errors: [{ message: err.message, line: err.line }] };
      }
      const message = err instanceof Error ? err.message : 'Could not process that input.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
