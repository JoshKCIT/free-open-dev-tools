import meta from './meta.json';
import { assertSingleLine } from './safe-value';
import { decide, type Rule } from './match';

export { meta };

const MAX_INPUT_LENGTH = 5_000_000;
/** RFC 9309 section 2.5: "The parsing limit MUST be at least 500 kibibytes." */
const SIZE_WARNING_BYTES = 500 * 1024;

export class RobotsTxtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RobotsTxtError';
  }
}

export interface RobotsRule extends Rule {
  line: number;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface RobotsSitemap {
  url: string;
  line: number;
}

export interface RobotsOtherRecord {
  key: string;
  value: string;
  line: number;
  note: string;
}

export interface RobotsProblem {
  line: number;
  message: string;
}

export interface ParsedRobotsTxt {
  groups: RobotsGroup[];
  sitemaps: RobotsSitemap[];
  otherRecords: RobotsOtherRecord[];
  problems: RobotsProblem[];
}

/** RFC 9309 section 2.2.1: only uppercase and lowercase letters, underscores and hyphens, or the literal "*". */
function invalidProductTokenMessage(token: string, line: number): string | null {
  if (token === '*') return null;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45;
    if (!ok) {
      return `Line ${line}: the user-agent value "${token}" contains a character RFC 9309 does not allow in a product token (only letters, underscores and hyphens, or a bare *).`;
    }
  }
  return null;
}

function stripComment(line: string): string {
  const idx = line.indexOf('#');
  return idx === -1 ? line : line.slice(0, idx);
}

/**
 * RFC 9309 section 2: lines are split on CRLF, LF or CR; "#" starts a line
 * comment; keys are compared case-insensitively; consecutive user-agent
 * lines start (or continue building) a group; a rule before any
 * user-agent line is a problem and ignored (section 2.2.2: "The crawler
 * SHOULD ignore 'disallow' and 'allow' rules that are not in any group");
 * a sitemap or other (non-RFC) record never terminates a group (section
 * 2.2.4: "a Sitemaps record MUST NOT terminate a group").
 */
export function parseRobotsTxt(text: string): ParsedRobotsTxt {
  if (text.length > MAX_INPUT_LENGTH) {
    throw new RobotsTxtError(
      'This robots.txt is larger than 5 MB, so it was refused rather than risk freezing the tab.',
    );
  }

  const problems: RobotsProblem[] = [];
  if (new TextEncoder().encode(text).length > SIZE_WARNING_BYTES) {
    problems.push({
      line: 0,
      message:
        'This file is larger than the 500 KiB parsing limit RFC 9309 section 2.5 requires crawlers to support; some crawlers may stop reading partway through.',
    });
  }

  const groups: RobotsGroup[] = [];
  const sitemaps: RobotsSitemap[] = [];
  const otherRecords: RobotsOtherRecord[] = [];

  let currentGroup: RobotsGroup | null = null;
  let groupOpenForAgents = false;

  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const withoutComment = stripComment(lines[i]!);
    const trimmed = withoutComment.trim();
    if (trimmed === '') continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      problems.push({ line: lineNumber, message: `Line ${lineNumber} has no colon, so it was ignored.` });
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    const lowerKey = key.toLowerCase();

    if (lowerKey === 'user-agent') {
      if (!value) {
        problems.push({
          line: lineNumber,
          message: `Line ${lineNumber}: a User-agent line with no value was ignored.`,
        });
        continue;
      }
      const tokenProblem = invalidProductTokenMessage(value, lineNumber);
      if (tokenProblem) problems.push({ line: lineNumber, message: tokenProblem });
      if (!groupOpenForAgents || currentGroup === null) {
        currentGroup = { agents: [], rules: [] };
        groups.push(currentGroup);
      }
      currentGroup.agents.push(value);
      groupOpenForAgents = true;
    } else if (lowerKey === 'allow' || lowerKey === 'disallow') {
      if (currentGroup === null) {
        problems.push({
          line: lineNumber,
          message: `Line ${lineNumber}: a rule appeared before any User-agent line, so RFC 9309 says it should be ignored.`,
        });
      } else {
        currentGroup.rules.push({ type: lowerKey, pattern: value, line: lineNumber });
      }
      groupOpenForAgents = false;
    } else if (lowerKey === 'sitemap') {
      if (!value) {
        problems.push({ line: lineNumber, message: `Line ${lineNumber}: a Sitemap line with no value was ignored.` });
      } else {
        sitemaps.push({ url: value, line: lineNumber });
      }
    } else {
      otherRecords.push({
        key,
        value,
        line: lineNumber,
        note:
          lowerKey === 'crawl-delay'
            ? 'crawl-delay is not part of RFC 9309; crawlers that honour it are free to interpret it however they choose.'
            : 'This record is not part of RFC 9309; RFC 9309 section 2.2.4 says a crawler may interpret it, or may not.',
      });
    }
  }

  return { groups, sitemaps, otherRecords, problems };
}

export interface CheckPathResult {
  allowed: boolean;
  rule: RobotsRule | null;
  line: number | null;
  groupAgents: string[] | null;
  reason: string;
}

/**
 * RFC 9309 section 2.2.1: case-insensitive matching finds every group whose
 * user-agent line matches `productToken`; when more than one matches, the
 * groups are combined; with no matching group, the "*" group is used if
 * present; otherwise no rules apply, and everything is allowed.
 */
export function checkPath(parsed: ParsedRobotsTxt, productToken: string, pathOrUrl: string): CheckPathResult {
  let path = pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) {
    try {
      const url = new URL(pathOrUrl);
      path = url.pathname + url.search;
    } catch {
      // Not a URL after all; fall through and treat the text as a path.
    }
  }
  if (!path.startsWith('/')) path = `/${path}`;

  const lowerToken = productToken.trim().toLowerCase();

  let matchingGroups = parsed.groups.filter((g) => g.agents.some((a) => a.toLowerCase() === lowerToken));
  let usedStar = false;
  if (matchingGroups.length === 0) {
    matchingGroups = parsed.groups.filter((g) => g.agents.some((a) => a === '*'));
    usedStar = matchingGroups.length > 0;
  }

  if (path === '/robots.txt') {
    return {
      allowed: true,
      rule: null,
      line: null,
      groupAgents: matchingGroups.length > 0 ? matchingGroups.flatMap((g) => g.agents) : null,
      reason: 'The /robots.txt path itself is always allowed, as RFC 9309 section 2.2.2 states.',
    };
  }

  if (matchingGroups.length === 0) {
    return {
      allowed: true,
      rule: null,
      line: null,
      groupAgents: null,
      reason: 'No group names this crawler and there is no * group, so RFC 9309 section 2.2.1 says no rules apply.',
    };
  }

  const rules = matchingGroups.flatMap((g) => g.rules);
  const groupAgents = matchingGroups.flatMap((g) => g.agents);
  const { allowed, rule } = decide<RobotsRule>(path, rules);

  if (rule === null) {
    return {
      allowed: true,
      rule: null,
      line: null,
      groupAgents,
      reason: usedStar
        ? 'No rule in the * group matches this path, so RFC 9309 section 2.2.2 says it is allowed.'
        : 'No rule in the matching group matches this path, so RFC 9309 section 2.2.2 says it is allowed.',
    };
  }

  return {
    allowed,
    rule,
    line: rule.line,
    groupAgents,
    reason: `Line ${rule.line} (${rule.type === 'allow' ? 'Allow' : 'Disallow'}: ${rule.pattern}) is the most specific matching rule.`,
  };
}

export interface BuildGroupInput {
  agents: string[];
  rules: { type: 'allow' | 'disallow'; pattern: string }[];
}

export interface BuildRobotsTxtInput {
  groups: BuildGroupInput[];
  sitemaps: string[];
}

export interface BuildRobotsTxtResult {
  text: string;
  problems: RobotsProblem[];
}

/**
 * Every value passes `assertSingleLine` first (a line break could add a
 * fresh rule the visitor never asked for); product tokens follow RFC
 * 9309 section 2.2.1; a path must start with "/" or "*" (an empty
 * Disallow value is allowed and means allow everything, per the RFC's
 * own worked examples); a Sitemap line must be an absolute http or https
 * URL, matching the sitemaps.org protocol's own robots.txt section.
 */
export function buildRobotsTxt(input: BuildRobotsTxtInput): BuildRobotsTxtResult {
  const lines: string[] = [];

  for (const group of input.groups) {
    if (group.agents.length === 0) continue;
    for (const agent of group.agents) {
      const value = assertSingleLine(agent, 'User-agent');
      const tokenProblem = invalidProductTokenMessage(value, 0);
      if (tokenProblem) {
        throw new RobotsTxtError(
          `The user-agent value "${value}" contains a character RFC 9309 does not allow in a product token (only letters, underscores and hyphens, or a bare *).`,
        );
      }
      lines.push(`User-agent: ${value}`);
    }
    for (const rule of group.rules) {
      const label = rule.type === 'allow' ? 'Allow' : 'Disallow';
      const pattern = assertSingleLine(rule.pattern, label);
      if (pattern !== '' && pattern[0] !== '/' && pattern[0] !== '*') {
        throw new RobotsTxtError(`A ${label} path must start with / or *, so "${pattern}" was refused.`);
      }
      lines.push(`${label}: ${pattern}`);
    }
    lines.push('');
  }

  for (const url of input.sitemaps) {
    const value = assertSingleLine(url, 'Sitemap');
    let isAbsoluteHttp = false;
    try {
      const parsed = new URL(value);
      isAbsoluteHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      isAbsoluteHttp = false;
    }
    if (!isAbsoluteHttp) {
      throw new RobotsTxtError(`A Sitemap line must be an absolute http or https URL, so "${value}" was refused.`);
    }
    lines.push(`Sitemap: ${value}`);
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const text = lines.length > 0 ? `${lines.join('\n')}\n` : '';

  return { text, problems: [] };
}
