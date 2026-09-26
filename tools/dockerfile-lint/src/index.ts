import meta from './meta.json';
import { parseDockerfile, MAX_DOCKERFILE_BYTES, type ParsedInstruction } from './parse';
import { lintInstructions, RULES, type RuleFinding } from './rules';

export { meta, RULES };
export type { RuleFinding };

export interface DockerfileFinding {
  line: number;
  endLine: number;
  column?: number;
  path: string;
  ruleId?: string;
  severity: 'error' | 'warning';
  message: string;
  docsUrl?: string;
  inSpiritOf?: string;
}

export interface DockerfileStage {
  index: number;
  line: number;
  name?: string;
  baseImage: string;
}

export interface LintDockerfileResult {
  findings: DockerfileFinding[];
  instructions: ParsedInstruction[];
  stages: DockerfileStage[];
}

export class DockerfileLintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DockerfileLintError';
  }
}

function stagesFrom(instructions: ParsedInstruction[]): DockerfileStage[] {
  const stages: DockerfileStage[] = [];
  let index = 0;
  for (const instruction of instructions) {
    if (instruction.keyword.toUpperCase() !== 'FROM') continue;
    const parts = instruction.args.trim().split(/\s+/).filter(Boolean);
    const name = parts.length >= 3 && parts[1]!.toUpperCase() === 'AS' ? parts[2] : undefined;
    stages.push({ index, line: instruction.line, name, baseImage: parts[0] ?? '' });
    index++;
  }
  return stages;
}

/**
 * Parses and lints `text` as a Dockerfile: every syntax problem the
 * Dockerfile reference itself would call a mistake, plus every rule in
 * `RULES`, sorted together by line. Refuses input over 1 MB before parsing
 * rather than risk freezing the tab.
 */
export function lintDockerfile(text: string): LintDockerfileResult {
  if (new TextEncoder().encode(text).length > MAX_DOCKERFILE_BYTES) {
    throw new DockerfileLintError(
      'This file is larger than 1 MB, so it was refused rather than risk freezing the tab.',
    );
  }

  const parsed = parseDockerfile(text);
  const ruleFindings = lintInstructions(parsed);

  const findings: DockerfileFinding[] = [
    ...parsed.problems.map((problem) => ({
      line: problem.line,
      endLine: problem.line,
      column: problem.column,
      path: problem.path ?? '',
      severity: 'error' as const,
      message: problem.message,
    })),
    ...ruleFindings.map((finding) => ({
      line: finding.line,
      endLine: finding.endLine,
      column: finding.column,
      path: finding.path,
      ruleId: finding.ruleId,
      severity: finding.severity,
      message: finding.message,
      docsUrl: finding.docsUrl,
      inSpiritOf: finding.inSpiritOf,
    })),
  ].sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));

  return { findings, instructions: parsed.instructions, stages: stagesFrom(parsed.instructions) };
}
