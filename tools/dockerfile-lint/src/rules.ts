/**
 * A hand-written rule set for common Dockerfile mistakes, cited to Docker's
 * own documentation: the Dockerfile reference, Docker's built-in build
 * checks (`docker build --check`, docs.docker.com/reference/build-checks/)
 * and the "Building best practices" guide. Ten of the rules below share
 * their id with one of Docker's own named build checks, quoted from that
 * page's own table; the rest are numbered `DF001`.. and, where a well-known
 * linter checks the same idea, name it only as `inSpiritOf` -- a taxonomy
 * reference, never a source of rule text. Every explanation here is written
 * in this project's own words.
 */
import type { ParsedDockerfile, ParsedInstruction } from './parse';

export type RuleSeverity = 'error' | 'warning';

export interface RuleDefinition {
  id: string;
  title: string;
  explanation: string;
  docsUrl: string;
  severity: RuleSeverity;
  /** A well-known linter's id for the same idea, cited by name only -- never a source of text (D-101, hadolint is GPL-3.0). */
  inSpiritOf?: string;
}

export interface RuleFinding {
  line: number;
  endLine: number;
  column: number;
  /** The instruction keyword this finding is about, used as the finding's `path` (AP). */
  path: string;
  ruleId: string;
  severity: RuleSeverity;
  message: string;
  docsUrl: string;
  inSpiritOf?: string;
}

const DOCKERFILE_REFERENCE_URL = 'https://docs.docker.com/reference/dockerfile/';
const BUILD_CHECKS_URL = 'https://docs.docker.com/reference/build-checks/';
const BEST_PRACTICES_URL = 'https://docs.docker.com/build/building/best-practices/';

export const RULES: readonly RuleDefinition[] = [
  {
    id: 'DF001',
    title: 'Base image has no explicit tag',
    explanation:
      'A FROM instruction with no tag or digest resolves to whatever "latest" currently points to on the registry, so the same Dockerfile can build a different image tomorrow. Naming an exact tag (or a digest) makes the build reproducible.',
    docsUrl: DOCKERFILE_REFERENCE_URL,
    severity: 'warning',
    inSpiritOf: 'DL3006',
  },
  {
    id: 'DF002',
    title: 'Base image is pinned to "latest"',
    explanation:
      'Pinning to the literal tag "latest" has the same reproducibility problem as no tag at all: it moves over time and is not guaranteed to point at the same image twice.',
    docsUrl: DOCKERFILE_REFERENCE_URL,
    severity: 'warning',
    inSpiritOf: 'DL3007',
  },
  {
    id: 'DF003',
    title: 'The image runs as root',
    explanation:
      'When no USER instruction sets a non-root user, or the last one sets "root" (or uid 0) explicitly, the container runs its process as root by default -- more privilege than most applications need.',
    docsUrl: DOCKERFILE_REFERENCE_URL,
    severity: 'warning',
    inSpiritOf: 'DL3002',
  },
  {
    id: 'DF004',
    title: 'ADD used for a plain local file',
    explanation:
      "ADD and COPY are functionally similar for a local path, but ADD's extra behaviours (auto-extracting a recognised archive, fetching a remote URL) are easy to trigger by accident. COPY is the more predictable choice when the source is just a local file or directory.",
    docsUrl: BEST_PRACTICES_URL,
    severity: 'warning',
    inSpiritOf: 'DL3020',
  },
  {
    id: 'DF005',
    title: 'apt-get install without -y',
    explanation:
      'Without -y (or --yes), apt-get install waits for interactive confirmation, which has nothing to answer it inside a build and will hang or fail.',
    docsUrl: DOCKERFILE_REFERENCE_URL,
    severity: 'warning',
    inSpiritOf: 'DL3014',
  },
  {
    id: 'DF006',
    title: 'apt-get install without --no-install-recommends',
    explanation:
      'Without --no-install-recommends, apt-get pulls in every package Debian marks as merely recommended, growing the image with packages the build may never use.',
    docsUrl: BEST_PRACTICES_URL,
    severity: 'warning',
    inSpiritOf: 'DL3015',
  },
  {
    id: 'DF007',
    title: 'apt-get lists not cleaned up in the same RUN',
    explanation:
      "apt-get update writes a package index under /var/lib/apt/lists that is only useful during the install step. Removing it in the same RUN keeps that data out of the image's layers instead of committing it and cleaning it up in a later, separate layer where the earlier layer still holds the bytes.",
    docsUrl: BEST_PRACTICES_URL,
    severity: 'warning',
    inSpiritOf: 'DL3009',
  },
  {
    id: 'DF008',
    title: 'apt-get upgrade or dist-upgrade in a build',
    explanation:
      'Upgrading every package in a build step depends on whatever versions happen to be current on the registry mirror at build time, which makes the resulting image different each time the Dockerfile is built without any change to the Dockerfile itself.',
    docsUrl: DOCKERFILE_REFERENCE_URL,
    severity: 'warning',
    inSpiritOf: 'DL3005',
  },
  {
    id: 'DF009',
    title: 'cd used instead of WORKDIR',
    explanation:
      "A cd inside a RUN command only changes the working directory for that one RUN's shell; it has no effect on later instructions. WORKDIR sets the working directory for every instruction that follows, including CMD and ENTRYPOINT.",
    docsUrl: DOCKERFILE_REFERENCE_URL,
    severity: 'warning',
    inSpiritOf: 'DL3003',
  },
  {
    id: 'DF010',
    title: 'sudo used inside RUN',
    explanation:
      'sudo has unpredictable TTY and signal-forwarding behaviour inside a container build, and a build already runs as whatever user the Dockerfile has set -- there is no privilege boundary for sudo to cross.',
    docsUrl: BEST_PRACTICES_URL,
    severity: 'warning',
    inSpiritOf: 'DL3004',
  },
  {
    id: 'DF011',
    title: 'COPY --from names no earlier stage',
    explanation:
      "A --from value that is not an earlier stage's name or index (and is not this stage itself) cannot resolve to anything at build time; Docker rejects the build the moment it tries to run this instruction.",
    docsUrl: DOCKERFILE_REFERENCE_URL,
    severity: 'error',
  },
  {
    id: 'WorkdirRelativePath',
    title: 'Relative WORKDIR without an absolute one set first',
    explanation:
      "A relative WORKDIR is resolved against whatever directory came before it. If nothing set an absolute working directory earlier in this stage, that starting point is the base image's own default, which can change whenever the base image changes.",
    docsUrl: BUILD_CHECKS_URL,
    severity: 'warning',
  },
  {
    id: 'MaintainerDeprecated',
    title: 'MAINTAINER is deprecated',
    explanation: 'The MAINTAINER instruction is deprecated; a LABEL is the documented way to record an image author.',
    docsUrl: BUILD_CHECKS_URL,
    severity: 'warning',
  },
  {
    id: 'MultipleInstructionsDisallowed',
    title: 'More than one CMD, ENTRYPOINT or HEALTHCHECK in a stage',
    explanation:
      'Only the last CMD, ENTRYPOINT or HEALTHCHECK in a stage takes effect; an earlier one in the same stage is silently discarded.',
    docsUrl: BUILD_CHECKS_URL,
    severity: 'warning',
  },
  {
    id: 'JSONArgsRecommended',
    title: 'Shell form used for CMD or ENTRYPOINT',
    explanation:
      "Shell form runs the command through /bin/sh -c, which becomes process 1 and does not automatically forward signals (such as the one a container's own stop sends) to the real program. The JSON array form runs the program directly.",
    docsUrl: BUILD_CHECKS_URL,
    severity: 'warning',
  },
  {
    id: 'ExposeInvalidFormat',
    title: 'EXPOSE port or protocol is invalid',
    explanation:
      'A port must be a number from 1 to 65535, and the optional protocol after the slash must be tcp or udp.',
    docsUrl: DOCKERFILE_REFERENCE_URL,
    severity: 'error',
  },
  {
    id: 'ExposeProtoCasing',
    title: 'EXPOSE protocol is not lowercase',
    explanation: 'The protocol after the slash in an EXPOSE port is conventionally written lowercase (tcp, udp).',
    docsUrl: BUILD_CHECKS_URL,
    severity: 'warning',
  },
  {
    id: 'DuplicateStageName',
    title: 'Stage name reused',
    explanation:
      'Two stages sharing one name make a later FROM <name> or COPY --from=<name> ambiguous about which stage it means.',
    docsUrl: BUILD_CHECKS_URL,
    severity: 'error',
  },
  {
    id: 'StageNameCasing',
    title: 'Stage name is not lowercase',
    explanation:
      'Stage names are conventionally written lowercase, matching how every other Dockerfile identifier in this project is cased.',
    docsUrl: BUILD_CHECKS_URL,
    severity: 'warning',
  },
  {
    id: 'LegacyKeyValueFormat',
    title: 'Legacy ENV key-value form',
    explanation:
      'ENV also accepts the older "ENV key value" form with a single space instead of an equals sign. It still works, but the ENV key=value form is unambiguous about where the key ends and the value begins.',
    docsUrl: BUILD_CHECKS_URL,
    severity: 'warning',
  },
  {
    id: 'SecretsUsedInArgOrEnv',
    title: 'Sensitive-looking name set via ARG or ENV',
    explanation:
      'A build argument becomes visible in the build history, and an environment variable is visible to anything that can inspect the running container. Neither is a safe place for a password, token or key.',
    docsUrl: BUILD_CHECKS_URL,
    severity: 'warning',
  },
  {
    id: 'UndefinedArgInFrom',
    title: 'FROM uses an ARG with no declared default',
    explanation:
      'A FROM instruction can reference a build argument, but only one declared with ARG before the first FROM in the file. If that ARG has no default value and the visitor building the image does not supply one, FROM resolves to an empty, invalid image reference.',
    docsUrl: BUILD_CHECKS_URL,
    severity: 'error',
  },
] as const;

const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule] as const));

function finding(
  rule: RuleDefinition,
  instruction: ParsedInstruction,
  message: string,
  columnOverride?: number,
): RuleFinding {
  return {
    line: instruction.line,
    endLine: instruction.endLine,
    column: columnOverride ?? instruction.column,
    path: instruction.keyword,
    ruleId: rule.id,
    severity: rule.severity,
    message,
    docsUrl: rule.docsUrl,
    inSpiritOf: rule.inSpiritOf,
  };
}

function rule(id: string): RuleDefinition {
  const found = RULE_BY_ID.get(id);
  if (!found) throw new Error(`Unknown rule id "${id}".`);
  return found;
}

interface StageInfo {
  index: number;
  name?: string;
  fromInstruction: ParsedInstruction;
  startInstructionIndex: number;
  endInstructionIndex: number;
}

/** Groups instructions into stages, one per FROM, running to (but not including) the next FROM. */
function collectStages(instructions: ParsedInstruction[]): StageInfo[] {
  const stages: StageInfo[] = [];
  instructions.forEach((instruction, index) => {
    if (instruction.keyword.toUpperCase() !== 'FROM') return;
    const parts = instruction.args.trim().split(/\s+/).filter(Boolean);
    const name = parts.length >= 3 && parts[1]!.toUpperCase() === 'AS' ? parts[2] : undefined;
    if (stages.length > 0) stages[stages.length - 1]!.endInstructionIndex = index;
    stages.push({
      index: stages.length,
      name,
      fromInstruction: instruction,
      startInstructionIndex: index,
      endInstructionIndex: instructions.length,
    });
  });
  return stages;
}

function baseImageRef(instruction: ParsedInstruction): string | undefined {
  const parts = instruction.args.trim().split(/\s+/).filter(Boolean);
  return parts[0];
}

const APT_GET_INSTALL = /\bapt-get\s+install\b/i;
const APT_GET_UPGRADE = /\bapt-get\s+(dist-)?upgrade\b/i;
const CD_COMMAND = /(^|&&|;|\|\|)\s*cd\s+\S/i;
const SUDO_COMMAND = /\bsudo\b/i;
const APT_LIST_CLEANUP = /rm\s+-rf\s+\/var\/lib\/apt\/lists/i;
const SECRET_NAME_PATTERN = /password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key/i;

export function lintInstructions(parsed: ParsedDockerfile): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const { instructions } = parsed;
  const stages = collectStages(instructions);
  const stageNamesSoFar = new Map<string, number>();
  const globalArgDefaults = new Map<string, boolean>();
  let sawFirstFrom = false;

  for (const instruction of instructions) {
    const upper = instruction.keyword.toUpperCase();

    if (upper === 'ARG' && !sawFirstFrom) {
      const argText = instruction.args.trim();
      const eq = argText.indexOf('=');
      const argName = (eq === -1 ? argText : argText.slice(0, eq)).trim();
      if (argName) globalArgDefaults.set(argName, eq !== -1);
    }

    if (upper === 'FROM') {
      sawFirstFrom = true;
      const image = baseImageRef(instruction);
      const parts = instruction.args.trim().split(/\s+/).filter(Boolean);
      const stageName = parts.length >= 3 && parts[1]!.toUpperCase() === 'AS' ? parts[2] : undefined;
      const priorStageNames = new Set(stageNamesSoFar.keys());

      if (image && !priorStageNames.has(image) && !/^\$\{?[A-Za-z_]/.test(image)) {
        if (!image.includes(':') && !image.includes('@')) {
          findings.push(
            finding(
              rule('DF001'),
              instruction,
              `The base image "${image}" has no explicit tag, so it resolves to "latest" today and possibly something else tomorrow.`,
            ),
          );
        } else if (/:latest(@|$)/.test(image)) {
          findings.push(
            finding(
              rule('DF002'),
              instruction,
              `The base image "${image}" is pinned to the "latest" tag, which moves over time.`,
            ),
          );
        }
      }

      const argRefs = new Set<string>();
      for (const match of instruction.args.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) argRefs.add(match[1]!);
      for (const argName of argRefs) {
        if (!globalArgDefaults.get(argName)) {
          findings.push(
            finding(
              rule('UndefinedArgInFrom'),
              instruction,
              `This FROM instruction uses "${argName}", which was not declared with ARG and a default value before the first FROM instruction, so it would resolve to an empty, invalid image reference unless the build supplies one.`,
            ),
          );
        }
      }

      if (stageName) {
        if (stageNamesSoFar.has(stageName)) {
          findings.push(
            finding(
              rule('DuplicateStageName'),
              instruction,
              `The stage name "${stageName}" is already used earlier in this file.`,
            ),
          );
        }
        if (stageName !== stageName.toLowerCase()) {
          findings.push(
            finding(rule('StageNameCasing'), instruction, `The stage name "${stageName}" should be lowercase.`),
          );
        }
        stageNamesSoFar.set(
          stageName,
          stages.findIndex((s) => s.fromInstruction === instruction),
        );
      }
    }

    if (upper === 'ADD') {
      const args = instruction.args.trim();
      const tokens = args.split(/\s+/).filter(Boolean);
      const sources = tokens.slice(0, -1);
      const isRemoteOrArchive = sources.some(
        (s) => /^https?:\/\//i.test(s) || /\.(tar(\.(gz|bz2|xz))?|tgz|zip)$/i.test(s),
      );
      if (sources.length > 0 && !isRemoteOrArchive) {
        findings.push(
          finding(
            rule('DF004'),
            instruction,
            'This ADD copies only local files; COPY is the more predictable instruction for that.',
          ),
        );
      }
    }

    if (upper === 'RUN') {
      const args = instruction.args;
      if (APT_GET_INSTALL.test(args)) {
        if (!/\s(-y|--yes|--assume-yes)\b/.test(args)) {
          findings.push(
            finding(
              rule('DF005'),
              instruction,
              'This apt-get install has no -y (or --yes), so it will wait on a prompt no build can answer.',
            ),
          );
        }
        if (!/--no-install-recommends\b/.test(args)) {
          findings.push(
            finding(
              rule('DF006'),
              instruction,
              'This apt-get install has no --no-install-recommends, so it pulls in every recommended package too.',
            ),
          );
        }
        if (!APT_LIST_CLEANUP.test(args)) {
          findings.push(
            finding(
              rule('DF007'),
              instruction,
              'This RUN does not remove /var/lib/apt/lists afterwards, so the package index stays in this layer.',
            ),
          );
        }
      }
      if (APT_GET_UPGRADE.test(args)) {
        findings.push(
          finding(
            rule('DF008'),
            instruction,
            'This RUN upgrades every installed package, which depends on whatever versions are current on the mirror at build time.',
          ),
        );
      }
      if (CD_COMMAND.test(args)) {
        findings.push(
          finding(
            rule('DF009'),
            instruction,
            'This RUN uses cd to change directory; that only affects this one RUN. Use WORKDIR to change it for every instruction that follows.',
          ),
        );
      }
      if (SUDO_COMMAND.test(args)) {
        findings.push(
          finding(
            rule('DF010'),
            instruction,
            'This RUN uses sudo, which has unpredictable behaviour inside a build and crosses no real privilege boundary here.',
          ),
        );
      }
    }

    if (upper === 'COPY') {
      const fromFlag = instruction.flags.find((f) => f.name === 'from');
      // A bare, single-token value could be a stage name or index; anything
      // holding "/", "." or ":" is an external image reference (registry
      // namespace, host or tag) and is never a stage name, so it is not
      // checked here (this tool cannot tell whether that image exists).
      if (fromFlag && fromFlag.value && !/[/.:]/.test(fromFlag.value)) {
        const value = fromFlag.value;
        const currentStage = stages.find(
          (s) =>
            instructions.indexOf(instruction) >= s.startInstructionIndex &&
            instructions.indexOf(instruction) < s.endInstructionIndex,
        );
        const currentIndex = currentStage?.index ?? -1;
        const asNumber = /^\d+$/.test(value) ? Number(value) : undefined;
        const isCurrentStage = value === currentStage?.name || asNumber === currentIndex;
        const isKnownEarlierName = stageNamesSoFar.has(value) && stageNamesSoFar.get(value)! < currentIndex;
        const isKnownEarlierIndex = asNumber !== undefined && asNumber >= 0 && asNumber < currentIndex;
        if (isCurrentStage) {
          findings.push(
            finding(
              rule('DF011'),
              instruction,
              `This COPY --from="${value}" names this same stage, which has not finished building yet.`,
            ),
          );
        } else if (!isKnownEarlierName && !isKnownEarlierIndex) {
          findings.push(
            finding(rule('DF011'), instruction, `This COPY --from="${value}" names no earlier stage in this file.`),
          );
        }
      }
    }

    if (upper === 'MAINTAINER') {
      findings.push(
        finding(
          rule('MaintainerDeprecated'),
          instruction,
          'MAINTAINER is deprecated; use a LABEL to record an image author instead.',
        ),
      );
    }

    if ((upper === 'CMD' || upper === 'ENTRYPOINT') && instruction.form === 'shell') {
      findings.push(
        finding(
          rule('JSONArgsRecommended'),
          instruction,
          `This ${upper} uses shell form; the JSON array form avoids an intermediate shell that would not forward signals.`,
        ),
      );
    }

    if (upper === 'EXPOSE') {
      for (const token of instruction.args.trim().split(/\s+/).filter(Boolean)) {
        const [portPart, protoPart] = token.split('/');
        const portOk = /^\d+$/.test(portPart ?? '') && Number(portPart) >= 1 && Number(portPart) <= 65535;
        if (!portOk) {
          findings.push(
            finding(
              rule('ExposeInvalidFormat'),
              instruction,
              `The EXPOSE port "${token}" is not a number from 1 to 65535.`,
            ),
          );
          continue;
        }
        if (protoPart !== undefined) {
          const lower = protoPart.toLowerCase();
          if (lower !== 'tcp' && lower !== 'udp') {
            findings.push(
              finding(
                rule('ExposeInvalidFormat'),
                instruction,
                `The EXPOSE protocol "${protoPart}" is neither tcp nor udp.`,
              ),
            );
          } else if (protoPart !== lower) {
            findings.push(
              finding(
                rule('ExposeProtoCasing'),
                instruction,
                `The EXPOSE protocol "${protoPart}" should be written lowercase.`,
              ),
            );
          }
        }
      }
    }

    if (upper === 'ENV') {
      const args = instruction.args.trim();
      if (args.length > 0 && !args.includes('=')) {
        findings.push(
          finding(
            rule('LegacyKeyValueFormat'),
            instruction,
            'This ENV uses the legacy "key value" form with no equals sign.',
          ),
        );
      }
    }

    if (upper === 'ARG' || upper === 'ENV') {
      const args = instruction.args.trim();
      const eq = args.indexOf('=');
      const name = (eq === -1 ? args.split(/\s+/)[0] : args.slice(0, eq)) ?? '';
      if (SECRET_NAME_PATTERN.test(name)) {
        findings.push(
          finding(
            rule('SecretsUsedInArgOrEnv'),
            instruction,
            `The name "${name}" looks like it holds a secret; ${upper} is visible in the build history or the running container.`,
          ),
        );
      }
    }
  }

  // WORKDIR relative-path check, tracked per stage.
  for (const stage of stages) {
    let sawAbsolute = false;
    for (let i = stage.startInstructionIndex; i < stage.endInstructionIndex; i++) {
      const instruction = instructions[i]!;
      if (instruction.keyword.toUpperCase() !== 'WORKDIR') continue;
      const path = instruction.args.trim();
      const isAbsolute = /^(\/|[A-Za-z]:[\\/])/.test(path);
      if (!isAbsolute && !sawAbsolute) {
        findings.push(
          finding(
            rule('WorkdirRelativePath'),
            instruction,
            `This WORKDIR "${path}" is relative, and no earlier WORKDIR in this stage set an absolute starting point.`,
          ),
        );
      }
      if (isAbsolute) sawAbsolute = true;
    }
  }

  // Multiple CMD/ENTRYPOINT/HEALTHCHECK per stage.
  for (const stage of stages) {
    for (const kw of ['CMD', 'ENTRYPOINT', 'HEALTHCHECK']) {
      const inStage = instructions
        .slice(stage.startInstructionIndex, stage.endInstructionIndex)
        .filter((instr) => instr.keyword.toUpperCase() === kw);
      for (let i = 1; i < inStage.length; i++) {
        findings.push(
          finding(
            rule('MultipleInstructionsDisallowed'),
            inStage[i]!,
            `This stage already has an earlier ${kw}; only the last one takes effect.`,
          ),
        );
      }
    }
  }

  // Last USER in the final stage.
  if (stages.length > 0) {
    const finalStage = stages[stages.length - 1]!;
    const usersInStage = instructions
      .slice(finalStage.startInstructionIndex, finalStage.endInstructionIndex)
      .filter((instr) => instr.keyword.toUpperCase() === 'USER');
    const lastUser = usersInStage[usersInStage.length - 1];
    if (!lastUser) {
      findings.push(
        finding(
          rule('DF003'),
          finalStage.fromInstruction,
          'No USER instruction sets a non-root user in the final stage, so the image runs as root by default.',
        ),
      );
    } else {
      const value = lastUser.args.trim().toLowerCase();
      if (value === 'root' || value === '0' || value.startsWith('root:') || value.startsWith('0:')) {
        findings.push(
          finding(
            rule('DF003'),
            lastUser,
            `The last USER in the final stage is "${lastUser.args.trim()}", which runs the image as root.`,
          ),
        );
      }
    }
  }

  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}
