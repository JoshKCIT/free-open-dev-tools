/**
 * Reads the words of a docker run command the way docker's own command line does (the Go flag library's rules, with
 * interspersed options turned off, as cli/command/container/run.go sets): options end at the first word that is not an
 * option, which is the image, and every later word belongs to the command, even one that starts with a dash. `--` ends
 * the options too. A long option takes its value as `--name value` or `--name=value`; a short option can be bundled
 * (`-itd`) and takes the rest of its word as its value (`-p8080:80`, `-p=8080:80`) or else the next word; a true or false
 * option never takes the next word, only `=value` (`--rm=false`).
 *
 * Every name is looked up in a Map, so a pasted `__proto__` is an unknown option like any other.
 */
import { DockerRunError } from './errors';
import { hasInterpolation } from './interpolation';
import { visible } from './limits';
import { closestOption, optionByName, type DockerRunOption } from './options';
import { readDockerCommand, type CommandWord } from './tokenize';

/** One option read from the command. */
export interface ParsedOption {
  readonly option: DockerRunOption;
  /** What was given after the option, or null for a true or false option written bare (which means true). */
  readonly value: string | null;
  /** Where the word that holds the option starts in the pasted text. */
  readonly line: number;
  readonly column: number;
}

/** An option the Docker command line does not have. */
export interface UnknownOption {
  /** The name as typed, with its dashes. */
  readonly name: string;
  /** The same, made safe to show: control characters written out and long names cut. */
  readonly shown: string;
  /** The closest known long option, or null when none is close. */
  readonly closest: string | null;
  readonly line: number;
  readonly column: number;
}

export interface ParsedRun {
  readonly options: ParsedOption[];
  readonly image: string;
  /** Where the image word starts in the pasted text. */
  readonly imageLine: number;
  readonly imageColumn: number;
  /** The words after the image, all of them. */
  readonly command: string[];
  readonly unknown: UnknownOption[];
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/** A decimal number such as 12, -1 or 1.5, with nothing else in it. */
function isDecimal(text: string): boolean {
  let i = text[0] === '-' ? 1 : 0;
  let digits = 0;
  while (isDigit(text[i])) {
    i++;
    digits++;
  }
  if (text[i] === '.') {
    i++;
    while (isDigit(text[i])) {
      i++;
      digits++;
    }
  }
  return digits > 0 && i === text.length;
}

/** A size as docker reads it: a number and an optional k, m, g, t or p with an optional i and b, such as 512m, 1g or 64MiB. */
export function isSize(text: string): boolean {
  let i = text[0] === '-' ? 1 : 0;
  let digits = 0;
  while (isDigit(text[i])) {
    i++;
    digits++;
  }
  if (text[i] === '.') {
    i++;
    while (isDigit(text[i])) {
      i++;
      digits++;
    }
  }
  if (digits === 0) return false;
  const unit = text.slice(i).toLowerCase();
  if (unit === '') return true;
  const letters = unit[0];
  let rest = unit;
  if (letters !== undefined && 'kmgtp'.includes(letters)) rest = unit.slice(1);
  if (rest.startsWith('i')) rest = rest.slice(1);
  if (rest.startsWith('b')) rest = rest.slice(1);
  return rest === '' && unit !== 'i';
}

const DURATION_UNITS = new Set([
  'ns',
  'us',
  String.fromCodePoint(0xb5) + 's',
  String.fromCodePoint(0x3bc) + 's',
  'ms',
  's',
  'm',
  'h',
]);

/** A duration as Go reads it: 0, or one or more numbers each followed by ns, us, ms, s, m or h, such as 30s or 1m30s. */
function isGoDuration(text: string): boolean {
  let i = text[0] === '-' || text[0] === '+' ? 1 : 0;
  if (text.slice(i) === '0') return true;
  let components = 0;
  while (i < text.length) {
    let digits = 0;
    while (isDigit(text[i])) {
      i++;
      digits++;
    }
    if (text[i] === '.') {
      i++;
      while (isDigit(text[i])) {
        i++;
        digits++;
      }
    }
    if (digits === 0) return false;
    const unitStart = i;
    while (i < text.length && !isDigit(text[i]) && text[i] !== '.') i++;
    if (!DURATION_UNITS.has(text.slice(unitStart, i))) return false;
    components++;
  }
  return components > 0;
}

const BOOLEANS = new Set(['1', 't', 'T', 'TRUE', 'true', 'True', '0', 'f', 'F', 'FALSE', 'false', 'False']);

/** True when a given value is one docker would accept for the option. */
function valueIsWellFormed(option: DockerRunOption, value: string): boolean {
  switch (option.value) {
    case 'none':
      return BOOLEANS.has(value);
    case 'number':
      return isDecimal(value);
    case 'size':
      return isSize(value);
    case 'duration':
      return isGoDuration(value);
    default:
      return true;
  }
}

const EXPECTED: Record<'none' | 'number' | 'size' | 'duration', string> = {
  none: 'true or false (for example --NAME=false)',
  number: 'a number',
  size: 'a size such as 512m or 1g',
  duration: 'a duration such as 30s, 1m30s or 500ms',
};

function checkValue(option: DockerRunOption, value: string | null, word: CommandWord): void {
  // A value with a variable in it (a number written as a variable name, say) is for Compose to fill in, so it is not judged here.
  if (value === null || hasInterpolation(value) || valueIsWellFormed(option, value)) return;
  const kind =
    option.value === 'none' || option.value === 'number' || option.value === 'size' || option.value === 'duration'
      ? option.value
      : 'number';
  throw new DockerRunError(
    `The value given to --${option.name} is not ${EXPECTED[kind].split('NAME').join(option.name)}.`,
    word.line,
    word.column,
  );
}

function missingValue(option: DockerRunOption, word: CommandWord): DockerRunError {
  return new DockerRunError(
    `--${option.name} needs a value, but the command ends right after it.`,
    word.line,
    word.column,
  );
}

function toWord(entry: string | CommandWord, index: number): CommandWord {
  return typeof entry === 'string' ? { text: entry, line: 1, column: index + 1 } : entry;
}

/**
 * Reads the options, the image and the command out of the words of a `docker run` or `docker container run` command.
 * Throws a `DockerRunError` for anything else, for a command with no image, for an option with no value and for a value
 * docker would refuse (a size that is not a size, a duration with no unit). Options docker does not have are listed in
 * `unknown`, with the closest known name, and reading goes on.
 */
export function parseDockerRun(entries: readonly (string | CommandWord)[]): ParsedRun {
  const words = entries.map(toWord);
  const first = words[0];
  if (first === undefined) throw new DockerRunError('Paste a docker run command.', 1, 1);
  if (first.text !== 'docker') {
    throw new DockerRunError(
      'This page reads docker run commands, so the command must start with docker run.',
      first.line,
      first.column,
    );
  }
  let at = 1;
  if (words[1]?.text === 'container') at = 2;
  const run = words[at];
  if (run === undefined || run.text !== 'run') {
    const where = run ?? words[at - 1] ?? first;
    throw new DockerRunError(
      'This page reads docker run commands, so the word after docker must be run (or container run).',
      where.line,
      where.column,
    );
  }

  const options: ParsedOption[] = [];
  const unknown: UnknownOption[] = [];
  let i = at + 1;
  while (i < words.length) {
    const word = words[i]!;
    const text = word.text;
    if (text === '--') {
      i += 1;
      break;
    }
    if (text.length < 2 || text[0] !== '-') break;

    if (text.startsWith('--')) {
      const equals = text.indexOf('=');
      const name = equals >= 0 ? text.slice(2, equals) : text.slice(2);
      const option = optionByName.get(`--${name}`);
      if (option === undefined) {
        unknown.push({
          name: `--${name}`,
          shown: visible(`--${name}`),
          closest: closestOption(name),
          line: word.line,
          column: word.column,
        });
        i += 1;
        continue;
      }
      let value: string | null;
      if (option.value === 'none') {
        value = equals >= 0 ? text.slice(equals + 1) : null;
        i += 1;
      } else if (equals >= 0) {
        value = text.slice(equals + 1);
        i += 1;
      } else {
        const next = words[i + 1];
        if (next === undefined) throw missingValue(option, word);
        value = next.text;
        i += 2;
      }
      checkValue(option, value, word);
      options.push({ option, value, line: word.line, column: word.column });
      continue;
    }

    // A bundle of short options, such as -itd or -p8080:80.
    let k = 1;
    let usedNext = false;
    while (k < text.length) {
      const letter = String.fromCodePoint(text.codePointAt(k) ?? 0);
      const option = optionByName.get(`-${letter}`);
      if (option === undefined) {
        unknown.push({
          name: `-${letter}`,
          shown: visible(`-${letter}`),
          closest: null,
          line: word.line,
          column: word.column,
        });
        break;
      }
      const rest = text.slice(k + letter.length);
      let value: string | null;
      let stop = false;
      if (rest.length >= 2 && rest[0] === '=') {
        value = rest.slice(1);
        stop = true;
      } else if (option.value === 'none') {
        value = null;
      } else if (rest.length > 0) {
        value = rest;
        stop = true;
      } else {
        const next = words[i + 1];
        if (next === undefined) throw missingValue(option, word);
        value = next.text;
        usedNext = true;
        stop = true;
      }
      checkValue(option, value, word);
      options.push({ option, value, line: word.line, column: word.column });
      if (stop) break;
      k += letter.length;
    }
    i += usedNext ? 2 : 1;
  }

  const image = words[i];
  if (image === undefined) {
    const last = words[words.length - 1] ?? first;
    throw new DockerRunError('A docker run command needs an image after its options.', last.line, last.column);
  }
  return {
    options,
    image: image.text,
    imageLine: image.line,
    imageColumn: image.column,
    command: words.slice(i + 1).map((entry) => entry.text),
    unknown,
  };
}

/** Reads a pasted docker run command: splits it into words (never running anything), then reads its options. */
export function parseDockerCommand(text: string): ParsedRun & { readonly usesPwd: boolean } {
  const read = readDockerCommand(text);
  return { ...parseDockerRun(read.words), usesPwd: read.usesPwd };
}
