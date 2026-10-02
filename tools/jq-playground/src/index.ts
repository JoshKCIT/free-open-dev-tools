import meta from './meta.json';
import type { loadJq } from 'jq-wasm/inline';

export { meta };

/**
 * The loaded jq-wasm engine, handed in by the caller. This package only imports its type: the engine's WebAssembly
 * sits inside the jq-wasm module, and the page's background worker is the one place that loads it, so the engine is
 * never part of a page chunk and a copy of this folder works with whichever copy of jq-wasm the caller installed.
 */
export type JqEngine = Awaited<ReturnType<typeof loadJq>>;

/** The largest input accepted, in UTF-8 bytes (5 MiB). */
export const MAX_INPUT_BYTES = 5242880;
/** Output beyond this many UTF-8 bytes (1 MiB) is cut. */
export const MAX_OUTPUT_BYTES = 1048576;

type ErrorPart = 'input' | 'filter' | 'arguments' | 'run';

/**
 * A problem with what was pasted, in jq's own words. `part` says where it is: the JSON input, the filter, the
 * arguments object, or the run itself. A compile error carries the filter's line and column as jq counts them (the
 * column counts bytes); `output` holds whatever the filter had produced before it failed.
 */
export class JqPlaygroundError extends Error {
  readonly part?: ErrorPart;
  readonly line?: number;
  readonly column?: number;
  readonly output: string;

  constructor(message: string, part?: ErrorPart, detail: { line?: number; column?: number; output?: string } = {}) {
    super(message);
    this.name = 'JqPlaygroundError';
    this.part = part;
    this.line = detail.line;
    this.column = detail.column;
    this.output = detail.output ?? '';
  }
}

export interface JqOptions {
  compact: boolean;
  raw: boolean;
  slurp: boolean;
  sortKeys: boolean;
  nullInput: boolean;
  ascii: boolean;
  indent: '2' | '4' | 'tab';
  /** A JSON object whose members become `--argjson name value` pairs. Blank means none. */
  args: string;
}

export interface JqResult {
  /** jq's standard output, exactly as jq wrote it, cut at `MAX_OUTPUT_BYTES`. */
  output: string;
  truncated: boolean;
  /** What debug, stderr and halt_error wrote. */
  stderr: string;
  exitCode: number;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function utf8Length(text: string, limit: number): number {
  // A UTF-16 unit is at most three UTF-8 bytes, so a text that short cannot be over the limit and is not encoded.
  return text.length * 3 <= limit ? 0 : new TextEncoder().encode(text).length;
}

/** Refuses input over 5 MiB, counted in UTF-8 bytes. The page calls this before it starts a worker, and `runJq` again. */
export function checkInputSize(input: string): void {
  const bytes = utf8Length(input, MAX_INPUT_BYTES);
  if (bytes > MAX_INPUT_BYTES) {
    throw new JqPlaygroundError(
      `This input is ${bytes.toLocaleString('en-US')} bytes. The limit is 5 MiB (${MAX_INPUT_BYTES.toLocaleString('en-US')} bytes) because the engine copies the input into memory while it runs.`,
      'input',
    );
  }
}

/** The members of a JSON object text that is already known to be valid, each value as the text that was written. */
function objectMembers(text: string): { key: string; raw: string }[] {
  const members: { key: string; raw: string }[] = [];
  const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  let i = text.indexOf('{') + 1;
  const skipSpace = () => {
    while (isSpace(text[i])) i++;
  };
  const stringEnd = (start: number): number => {
    let j = start + 1;
    while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    return j + 1;
  };
  for (;;) {
    skipSpace();
    if (text[i] === '}') return members;
    if (text[i] === ',') {
      i++;
      continue;
    }
    const keyEnd = stringEnd(i);
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    i = keyEnd;
    skipSpace();
    i++; // the colon
    skipSpace();
    const start = i;
    if (text[i] === '"') {
      i = stringEnd(i);
    } else if (text[i] === '{' || text[i] === '[') {
      let depth = 0;
      do {
        const c = text[i];
        if (c === '"') {
          i = stringEnd(i);
          continue;
        }
        if (c === '{' || c === '[') depth++;
        if (c === '}' || c === ']') depth--;
        i++;
      } while (depth > 0);
    } else {
      while (i < text.length && text[i] !== ',' && text[i] !== '}' && !isSpace(text[i])) i++;
    }
    members.push({ key, raw: text.slice(start, i) });
  }
}

/** One `--argjson name value` pair per member of the arguments object, each value passed exactly as written. */
function argumentFlags(argsText: string): string[] {
  const text = argsText.trim();
  if (text === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'not JSON';
    throw new JqPlaygroundError(`The arguments are not valid JSON: ${reason}`, 'arguments');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new JqPlaygroundError('The arguments must be a JSON object such as {"name": "value"}.', 'arguments');
  }
  // The last of two equal names wins, as it does in JSON.parse.
  const byName = new Map<string, string>();
  for (const { key, raw } of objectMembers(text)) {
    if (!NAME.test(key)) {
      throw new JqPlaygroundError(
        `The argument name "${key}" is not a jq variable name. Use letters, digits and underscores, starting with a letter or an underscore.`,
        'arguments',
      );
    }
    byName.set(key, raw);
  }
  const flags: string[] = [];
  for (const [name, raw] of byName) flags.push('--argjson', name, raw);
  return flags;
}

function optionFlags(options: JqOptions): string[] {
  const flags: string[] = [];
  if (options.compact) flags.push('-c');
  else if (options.indent === 'tab') flags.push('--tab');
  else if (options.indent === '4') flags.push('--indent', '4');
  if (options.raw) flags.push('-r');
  if (options.slurp) flags.push('-s');
  if (options.sortKeys) flags.push('-S');
  if (options.nullInput) flags.push('-n');
  if (options.ascii) flags.push('-a');
  return flags;
}

/** Cuts output at `MAX_OUTPUT_BYTES` UTF-8 bytes, never inside a character. */
function capOutput(stdout: string): { output: string; truncated: boolean } {
  if (stdout.length * 3 <= MAX_OUTPUT_BYTES) return { output: stdout, truncated: false };
  const bytes = new TextEncoder().encode(stdout);
  if (bytes.length <= MAX_OUTPUT_BYTES) return { output: stdout, truncated: false };
  let end = MAX_OUTPUT_BYTES;
  // A byte 0b10xxxxxx continues a character that began earlier: back up to where that character began.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return { output: new TextDecoder().decode(bytes.subarray(0, end)), truncated: true };
}

interface StderrReading {
  /** Lines jq wrote about itself, without the `jq: ` that starts them. */
  messages: string[];
  /** Everything else: what debug, stderr and halt_error wrote. */
  diagnostics: string;
}

function readStderr(stderr: string): StderrReading {
  const messages: string[] = [];
  const rest: string[] = [];
  for (const line of stderr.split('\n')) {
    if (line.startsWith('jq: ')) messages.push(line.slice(4));
    else rest.push(line);
  }
  // A compile error is followed by an excerpt of the filter and a caret line, then jq's count of compile errors; the
  // excerpt lines are indented and belong to the message, not to the diagnostics.
  const compileAt = messages.findIndex((m) => /^error: /.test(m) && !/^error \(at /.test(m));
  const diagnostics =
    compileAt >= 0 ? '' : rest.filter((line, index, all) => !(line === '' && index === all.length - 1)).join('\n');
  return { messages, diagnostics: diagnostics.replace(/\n+$/, '') };
}

/** The message of a compile error with the line and column jq reports, and how many follow it. */
function compileProblem(messages: string[], output: string): JqPlaygroundError {
  const first =
    messages.find((m) => /^error: /.test(m) && !/^error \(at /.test(m)) ?? 'error: the filter did not compile';
  const text = first.replace(/^error: /, '');
  const where = /^(.*?), line (\d+)(?:, column (\d+))?:$/.exec(text);
  const total = messages.map((m) => /^(\d+) compile errors?$/.exec(m)).find((m) => m !== null);
  const more = total ? Number(total[1]) - 1 : 0;
  let message = where ? (where[1] ?? text) : text;
  if (more > 0) message += ` (${more} more compile ${more === 1 ? 'error' : 'errors'} follow)`;
  return new JqPlaygroundError(message, 'filter', {
    line: where ? Number(where[2]) : undefined,
    column: where?.[3] ? Number(where[3]) : undefined,
    output,
  });
}

/** A run-time error with the stdin location removed: jq's message for the value that failed. */
function runProblem(messages: string[], output: string): JqPlaygroundError {
  const failures = messages.filter((m) => /^error \(at [^)]*\)/.test(m));
  const clean = (m: string) => {
    const rest = m.replace(/^error \(at [^)]*\)/, '');
    return rest.startsWith(': ') ? rest.slice(2) : `error${rest}`;
  };
  let message = clean(failures[0] ?? '');
  if (failures.length > 1) {
    const more = failures.length - 1;
    message += ` (${more} more ${more === 1 ? 'error' : 'errors'} followed)`;
  }
  return new JqPlaygroundError(message, 'run', { output });
}

/**
 * Runs `filter` over `input` with the jq engine and returns jq's output. Returns null for a blank filter. Input over
 * 5 MiB is refused before the engine is asked for anything. A compile error, a run-time error, input that is not
 * JSON and a bad arguments object are thrown as `JqPlaygroundError`; a failure of the engine itself, such as running
 * out of memory, is thrown as it came and described by `engineFailureMessage`. The caller never needs to parse the
 * output: it is jq's own text, kept as text, so a number jq printed is shown exactly as jq printed it.
 */
export function runJq(engine: JqEngine, input: string, filter: string, options: JqOptions): JqResult | null {
  if (filter.trim() === '') return null;
  checkInputSize(input);
  const argFlags = argumentFlags(options.args);
  // The final -- ends jq's options, so a filter that starts with a dash is still a filter.
  const result = engine.raw(input, filter, [...optionFlags(options), ...argFlags, '--']);

  const { messages, diagnostics } = readStderr(result.stderr);
  const { output, truncated } = capOutput(result.stdout);

  if (messages.some((m) => /^error: /.test(m) && !/^error \(at /.test(m))) throw compileProblem(messages, output);
  if (messages.some((m) => /^error \(at /.test(m))) throw runProblem(messages, output);
  const other = messages.find((m) => !/^\d+ compile errors?$/.test(m));
  if (other !== undefined) {
    throw new JqPlaygroundError(other, /^parse error/.test(other) ? 'input' : 'run', { output });
  }
  return { output, truncated, stderr: diagnostics, exitCode: result.exitCode };
}

/** A plain sentence for a failure of the engine itself, as opposed to a problem with the filter. */
export function engineFailureMessage(err: unknown): string {
  const text = err instanceof Error ? `${err.name} ${err.message}` : '';
  if (/RuntimeError|Aborted|out of memory|memory access|Invalid array length|allocation/i.test(text)) {
    return 'This filter ran out of memory.';
  }
  return err instanceof Error && err.message ? err.message : 'The background task failed for an unknown reason.';
}
