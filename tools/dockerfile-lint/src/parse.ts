/**
 * Hand-written, line-oriented Dockerfile parser. Reads a Dockerfile the way
 * the Dockerfile reference (docs.docker.com/reference/dockerfile/) describes
 * the grammar: parser directives at the very top, `\`-continued (or, after an
 * `# escape=` directive, backtick-continued) logical lines, exec-form JSON
 * arrays versus shell-form free text, and here-documents consumed to their
 * terminator. Never executes anything it reads; this module only recognises
 * shape.
 */

/** A `# name=value` parser directive found at the top of the file, before any instruction, blank line or ordinary comment. */
export interface ParserDirective {
  name: string;
  value: string;
  line: number;
}

/** A `--flag` or `--flag=value` token found before an instruction's arguments. */
export interface ParsedFlag {
  name: string;
  value: string | null;
}

export type InstructionForm = 'exec' | 'shell' | 'none';

export interface ParsedInstruction {
  /** The instruction keyword exactly as typed (case preserved; compare case-insensitively). */
  keyword: string;
  /** 1-based line of the instruction's first physical line. */
  line: number;
  /** 1-based line of the instruction's last physical line (continuations and here-documents included). */
  endLine: number;
  /** 1-based column of the keyword's first character. */
  column: number;
  flags: ParsedFlag[];
  /** Everything after the keyword and its flags, continuation-joined, trimmed. */
  args: string;
  form: InstructionForm;
  /** The continuation-joined text of the whole logical line, keyword included. */
  raw: string;
}

export interface ParseProblem {
  line: number;
  column?: number;
  /** The instruction keyword this problem was found on, when it belongs to one (used as the finding's `path`, AP). */
  path?: string;
  message: string;
}

export interface ParsedDockerfile {
  directives: ParserDirective[];
  instructions: ParsedInstruction[];
  problems: ParseProblem[];
}

/**
 * The instruction list from the Dockerfile reference's own left-hand
 * navigation (docs.docker.com/reference/dockerfile/): FROM, RUN, CMD, LABEL,
 * MAINTAINER (deprecated), EXPOSE, ENV, ADD, COPY, ENTRYPOINT, VOLUME, USER,
 * WORKDIR, ARG, ONBUILD, STOPSIGNAL, HEALTHCHECK, SHELL.
 */
export const KNOWN_INSTRUCTIONS: ReadonlySet<string> = new Set([
  'FROM',
  'RUN',
  'CMD',
  'LABEL',
  'MAINTAINER',
  'EXPOSE',
  'ENV',
  'ADD',
  'COPY',
  'ENTRYPOINT',
  'VOLUME',
  'USER',
  'WORKDIR',
  'ARG',
  'ONBUILD',
  'STOPSIGNAL',
  'HEALTHCHECK',
  'SHELL',
]);

/** Instructions whose argument text may be written in exec (JSON array) or shell (free text) form. */
const EXEC_OR_SHELL_KEYWORDS: ReadonlySet<string> = new Set(['RUN', 'CMD', 'ENTRYPOINT', 'SHELL']);

const DIRECTIVE_PATTERN = /^\s*#\s*([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*?)\s*$/;
const COMMENT_PATTERN = /^\s*#/;
const HEREDOC_PATTERN = /<<(-)?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

interface DirectiveScanResult {
  directives: ParserDirective[];
  bodyStart: number;
}

/**
 * Reads parser directives from the very top of the file. Per the reference:
 * "Parser directives must be at the very top of a Dockerfile... Once a
 * comment, empty line or builder instruction has been processed, Docker no
 * longer looks for parser directives" -- so scanning stops at the first line
 * that is blank or is not itself a `# name=value` directive, and that line
 * is left for ordinary parsing (it may be a plain comment or the first
 * instruction).
 */
function scanDirectives(lines: string[]): DirectiveScanResult {
  const directives: ParserDirective[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (isBlank(line)) break;
    const match = DIRECTIVE_PATTERN.exec(line);
    if (!match) break;
    directives.push({ name: match[1]!.toLowerCase(), value: match[2]!, line: i + 1 });
  }
  return { directives, bodyStart: i };
}

/**
 * The escape parser directive changes the continuation character from the
 * default `\` to `` ` `` -- documented for Windows containers, where `\` is
 * also a path separator. Any other declared value is ignored in favour of
 * the default, since the reference only ever shows `\` or `` ` ``.
 */
function resolveEscapeChar(directives: ParserDirective[]): string {
  const escapeDirective = directives.find((d) => d.name === 'escape');
  return escapeDirective && escapeDirective.value.trim() === '`' ? '`' : '\\';
}

/**
 * True when `line`, ignoring trailing horizontal whitespace, ends with an
 * odd run of the escape character -- an even run means the trailing escape
 * characters escape each other and the line does not continue.
 */
function endsWithEscape(line: string, escapeChar: string): boolean {
  const trimmed = line.replace(/[ \t]+$/, '');
  if (trimmed.length === 0 || !trimmed.endsWith(escapeChar)) return false;
  let run = 0;
  for (let i = trimmed.length - 1; i >= 0 && trimmed[i] === escapeChar; i--) run++;
  return run % 2 === 1;
}

function stripTrailingEscape(line: string): string {
  return line
    .replace(/[ \t]+$/, '')
    .slice(0, -1)
    .replace(/[ \t]+$/, '');
}

export interface LogicalLine {
  startLine: number;
  endLine: number;
  text: string;
  /** True when this line opened at least one here-document whose terminator was never found before end of file. */
  unterminatedHeredoc: boolean;
}

/**
 * Joins `\`-continued (or escape-directive-continued) physical lines into
 * logical lines, then extends any logical line that opens a here-document
 * (`<<WORD`, `<<-WORD`) to its terminator line. A comment or blank physical
 * line met mid-continuation is skipped rather than ending the continuation:
 * the reference's own example shows `RUN echo hello \` followed by a
 * `# comment` line followed by `world` behaving exactly like
 * `RUN echo hello \` followed directly by `world` -- "Comments don't support
 * line continuation characters" and are simply removed first.
 */
export function buildLogicalLines(lines: string[], escapeChar: string, startIndex: number): LogicalLine[] {
  const out: LogicalLine[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line) || COMMENT_PATTERN.test(line)) {
      i++;
      continue;
    }

    let text = line;
    const startLine = i + 1;
    let endLine = i + 1;

    while (endsWithEscape(text, escapeChar)) {
      const head = stripTrailingEscape(text);
      i++;
      while (i < lines.length && (isBlank(lines[i]!) || COMMENT_PATTERN.test(lines[i]!))) i++;
      if (i >= lines.length) {
        text = head;
        break;
      }
      text = `${head} ${lines[i]!.trim()}`;
      endLine = i + 1;
    }

    HEREDOC_PATTERN.lastIndex = 0;
    const terminators: { strip: boolean; word: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = HEREDOC_PATTERN.exec(text)) !== null) {
      terminators.push({ strip: Boolean(match[1]), word: match[3]! });
    }

    let consumedByHeredoc = false;
    let unterminatedHeredoc = false;
    for (const term of terminators) {
      consumedByHeredoc = true;
      i++;
      let found = false;
      while (i < lines.length) {
        const bodyLine = lines[i]!;
        const compared = term.strip ? bodyLine.replace(/^[ \t]+/, '') : bodyLine;
        endLine = i + 1;
        if (compared === term.word) {
          found = true;
          i++;
          break;
        }
        i++;
      }
      if (!found) unterminatedHeredoc = true;
    }

    out.push({ startLine, endLine, text, unterminatedHeredoc });
    if (!consumedByHeredoc) i++;
  }

  return out;
}

/** Parses one logical line's text into keyword, flags, form and remaining arguments. Returns null for text with no keyword (never happens for a non-blank logical line, but keeps the type honest). */
function parseInstructionText(text: string, startLine: number, endLine: number): ParsedInstruction | null {
  const headMatch = /^(\s*)(\S+)(?:\s+([^]*))?$/.exec(text);
  if (!headMatch) return null;
  const leadingWs = headMatch[1] ?? '';
  const keyword = headMatch[2]!;
  let rest = (headMatch[3] ?? '').trim();
  const column = leadingWs.length + 1;

  const flags: ParsedFlag[] = [];
  for (;;) {
    const flagMatch = /^--([A-Za-z][A-Za-z0-9-]*)(?:=(\S*))?\s*/.exec(rest);
    if (!flagMatch) break;
    flags.push({ name: flagMatch[1]!, value: flagMatch[2] ?? null });
    rest = rest.slice(flagMatch[0].length);
  }

  let form: InstructionForm = 'none';
  if (EXEC_OR_SHELL_KEYWORDS.has(keyword.toUpperCase())) {
    form = rest.trimStart().startsWith('[') ? 'exec' : 'shell';
  }

  return { keyword, line: startLine, endLine, column, flags, args: rest, form, raw: text };
}

/** Refuses input this large before parsing rather than risk freezing the tab. */
export const MAX_DOCKERFILE_BYTES = 1024 * 1024;

/**
 * Parses `text` as a Dockerfile: parser directives, then every instruction
 * with its continuation- and here-document-joined line range, flags, exec-
 * or-shell form and remaining arguments. Never throws; problems the
 * Dockerfile reference itself would call a mistake (an instruction before
 * the first `FROM` other than `ARG`, an unrecognised instruction keyword, a
 * malformed exec-form JSON array, or an unterminated here-document) are
 * collected in `problems` instead.
 */
export function parseDockerfile(text: string): ParsedDockerfile {
  const lines = splitLines(text);
  const { directives, bodyStart } = scanDirectives(lines);
  const escapeChar = resolveEscapeChar(directives);
  const logicalLines = buildLogicalLines(lines, escapeChar, bodyStart);

  const instructions: ParsedInstruction[] = [];
  const problems: ParseProblem[] = [];
  let sawFrom = false;

  for (const logical of logicalLines) {
    const instruction = parseInstructionText(logical.text, logical.startLine, logical.endLine);
    if (!instruction) continue;
    const upper = instruction.keyword.toUpperCase();

    if (!sawFrom && upper !== 'FROM' && upper !== 'ARG') {
      problems.push({
        line: instruction.line,
        column: instruction.column,
        path: instruction.keyword,
        message: `"${instruction.keyword}" appears before the first FROM instruction; the Dockerfile reference allows only ARG there.`,
      });
    }
    if (upper === 'FROM') sawFrom = true;

    if (!KNOWN_INSTRUCTIONS.has(upper)) {
      problems.push({
        line: instruction.line,
        column: instruction.column,
        path: instruction.keyword,
        message: `"${instruction.keyword}" is not an instruction the Dockerfile reference defines.`,
      });
    }

    if (instruction.form === 'exec') {
      try {
        const parsedArray: unknown = JSON.parse(instruction.args);
        if (!Array.isArray(parsedArray) || !parsedArray.every((item) => typeof item === 'string')) {
          problems.push({
            line: instruction.line,
            column: instruction.column,
            path: instruction.keyword,
            message: `This ${upper} instruction's JSON array form must contain only strings.`,
          });
        }
      } catch (err) {
        problems.push({
          line: instruction.line,
          column: instruction.column,
          path: instruction.keyword,
          message: `This ${upper} instruction's JSON array form is malformed and could not be parsed: ${err instanceof Error ? err.message : String(err)}.`,
        });
      }
    }

    if (logical.unterminatedHeredoc) {
      HEREDOC_PATTERN.lastIndex = 0;
      const terminatorWord = HEREDOC_PATTERN.exec(instruction.raw)?.[3];
      problems.push({
        line: instruction.line,
        column: instruction.column,
        path: instruction.keyword,
        message: `This here-document has no line containing only its terminator${terminatorWord ? ` "${terminatorWord}"` : ''}.`,
      });
    }

    instructions.push(instruction);
  }

  return { directives, instructions, problems };
}
