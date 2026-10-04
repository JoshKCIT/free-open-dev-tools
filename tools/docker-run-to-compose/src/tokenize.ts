/**
 * A POSIX-shell-and-Bash word splitter for docker commands that never runs anything.
 *
 * Grounded in the POSIX Shell Command Language section 2.2 "Quoting"
 * (https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html) for single quotes, double quotes,
 * backslash escaping and line continuation, and in the Bash Reference Manual's "ANSI-C Quoting" section
 * (https://www.gnu.org/software/bash/manual/bash.html) for the escapes inside a dollar-and-single-quote string.
 *
 * Docker commands carry dollar signs that Compose understands, so this splitter differs from a splitter that refuses
 * every dollar sign:
 *  - `$NAME`, `${NAME}` and the forms `${NAME:-text}`, `${NAME-text}`, `${NAME:?text}`, `${NAME?text}`, `${NAME:+text}`
 *    and `${NAME+text}` stay in the word as written, because Compose fills in the same forms from its environment;
 *  - `$(pwd)` and `$(PWD)` become `.`, the folder that holds the Compose file;
 *  - a dollar sign that is a plain character (from single quotes, a backslash, ANSI-C quoting, or one with no name
 *    after it) is written `$$`, which is how a Compose file spells a literal dollar sign;
 *  - every other command substitution, every backtick, every shell special variable and every unquoted `| ; & < > ( )`
 *    is refused with its line and column.
 * An unterminated quote and a line that ends like a Windows cmd.exe or PowerShell continuation are refused too. Nothing
 * here evaluates, runs or looks anything up: it only decides which characters make which words.
 */
import { DockerRunError } from './errors';
import { checkSize } from './limits';

/** One word of the command, with where it starts in the pasted text (both counted from 1). */
export interface CommandWord {
  readonly text: string;
  readonly line: number;
  readonly column: number;
}

/** What reading a command gave: its words, and whether `$(pwd)` was read as `.` anywhere. */
export interface ReadCommand {
  readonly words: CommandWord[];
  readonly usesPwd: boolean;
}

const UNQUOTED_OPERATORS = new Set(['|', ';', '&', '<', '>', '(', ')']);
/** The characters after a dollar sign that make a shell special variable: positional, status, process id and the like. */
const SPECIAL_PARAMETERS = '@*#?-$!';

function isNameStart(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_');
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isNameCharacter(ch: string | undefined): boolean {
  return isNameStart(ch) || isDigit(ch);
}

function isHexDigit(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'));
}

function isOctalDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '7';
}

class DockerTokenizer {
  private readonly text: string;
  private i = 0;
  private line = 1;
  private column = 1;
  private readonly words: CommandWord[] = [];
  private current = '';
  private inWord = false;
  private wordLine = 1;
  private wordColumn = 1;
  private usesPwd = false;

  constructor(input: string) {
    this.text = input;
  }

  private fail(message: string, line: number = this.line, column: number = this.column): never {
    throw new DockerRunError(message, line, column);
  }

  private peek(offset = 0): string | undefined {
    return this.text[this.i + offset];
  }

  private advance(): string {
    const ch = this.text[this.i]!;
    this.i++;
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  /** Marks a word as started, at the given place, unless one is already under way. */
  private begin(line: number, column: number): void {
    if (!this.inWord) {
      this.inWord = true;
      this.wordLine = line;
      this.wordColumn = column;
    }
  }

  /** Adds a plain character to the word. A plain dollar sign is written `$$`, how Compose spells one. */
  private add(ch: string): void {
    this.current += ch === '$' ? '$$' : ch;
  }

  private endWord(): void {
    if (this.inWord) {
      this.words.push({ text: this.current, line: this.wordLine, column: this.wordColumn });
      this.current = '';
      this.inWord = false;
    }
  }

  /** True when everything from the given offset to the next line feed (or the end) is blank. */
  private restOfLineIsBlank(fromOffset: number): boolean {
    let j = this.i + fromOffset;
    while (j < this.text.length && (this.text[j] === ' ' || this.text[j] === '\t' || this.text[j] === '\r')) j++;
    return j >= this.text.length || this.text[j] === '\n';
  }

  private readSingleQuoted(): void {
    const line = this.line;
    const column = this.column;
    this.begin(line, column);
    this.advance(); // opening quote
    for (;;) {
      if (this.i >= this.text.length) this.fail('This single-quoted string is never closed.', line, column);
      const c = this.peek()!;
      if (c === "'") {
        this.advance();
        return;
      }
      this.add(this.advance());
    }
  }

  private readDoubleQuoted(): void {
    const line = this.line;
    const column = this.column;
    this.begin(line, column);
    this.advance(); // opening quote
    for (;;) {
      if (this.i >= this.text.length) this.fail('This double-quoted string is never closed.', line, column);
      const c = this.peek()!;
      if (c === '"') {
        this.advance();
        return;
      }
      if (c === '\\') {
        const next = this.peek(1);
        if (next === '$' || next === '`' || next === '"' || next === '\\') {
          this.advance();
          this.add(this.advance());
          continue;
        }
        if (next === '\n') {
          this.advance();
          this.advance();
          continue;
        }
        if (next === '\r' && this.peek(2) === '\n') {
          this.advance();
          this.advance();
          this.advance();
          continue;
        }
        // Bash: a backslash before anything else inside double quotes stays a backslash.
        this.add(this.advance());
        continue;
      }
      if (c === '$') {
        this.readDollar(true);
        continue;
      }
      if (c === '`') {
        this.fail(
          'A backtick starts a command substitution, which is never run here, even inside a double-quoted string.',
        );
      }
      this.add(this.advance());
    }
  }

  private readAnsiCEscape(): string {
    const e = this.peek();
    if (e === undefined) this.fail("This $'...' ANSI-C quoted string ends with an incomplete escape.");
    switch (e) {
      case 'a':
        this.advance();
        return '\x07';
      case 'b':
        this.advance();
        return '\b';
      case 'e':
      case 'E':
        this.advance();
        return '\x1b';
      case 'f':
        this.advance();
        return '\f';
      case 'n':
        this.advance();
        return '\n';
      case 'r':
        this.advance();
        return '\r';
      case 't':
        this.advance();
        return '\t';
      case 'v':
        this.advance();
        return '\v';
      case '\\':
        this.advance();
        return '\\';
      case "'":
        this.advance();
        return "'";
      case '"':
        this.advance();
        return '"';
      case '?':
        this.advance();
        return '?';
      case 'x': {
        this.advance();
        let hex = '';
        while (hex.length < 2 && isHexDigit(this.peek())) hex += this.advance();
        return hex ? String.fromCharCode(parseInt(hex, 16)) : 'x';
      }
      case 'u': {
        this.advance();
        let hex = '';
        while (hex.length < 4 && isHexDigit(this.peek())) hex += this.advance();
        return hex ? String.fromCodePoint(parseInt(hex, 16)) : 'u';
      }
      case 'U': {
        this.advance();
        let hex = '';
        while (hex.length < 8 && isHexDigit(this.peek())) hex += this.advance();
        if (hex === '') return 'U';
        const point = parseInt(hex, 16);
        if (point > 0x10ffff) this.fail("This $'...' ANSI-C quoted string holds a character code that does not exist.");
        return String.fromCodePoint(point);
      }
      default:
        if (isOctalDigit(e)) {
          let oct = '';
          while (oct.length < 3 && isOctalDigit(this.peek())) oct += this.advance();
          return String.fromCharCode(parseInt(oct, 8) & 0xff);
        }
        // Bash drops an unrecognised escape's backslash and keeps the character.
        this.advance();
        return e;
    }
  }

  private readAnsiCQuoted(): void {
    const line = this.line;
    const column = this.column;
    this.begin(line, column);
    this.advance(); // the dollar sign
    this.advance(); // the opening quote
    for (;;) {
      if (this.i >= this.text.length) this.fail("This $'...' ANSI-C quoted string is never closed.", line, column);
      const c = this.peek()!;
      if (c === "'") {
        this.advance();
        return;
      }
      if (c === '\\') {
        this.advance();
        this.add(this.readAnsiCEscape());
        continue;
      }
      this.add(this.advance());
    }
  }

  /**
   * Reads a dollar sign and what follows it. A name, or braces round a name and one of Compose's default forms, is kept as
   * written; `$(pwd)` becomes a dot; a dollar sign with nothing after it that a shell would read is a plain `$$`.
   */
  private readDollar(inDouble: boolean): void {
    const line = this.line;
    const column = this.column;
    this.begin(line, column);
    const next = this.peek(1);
    if (next === "'" && !inDouble) {
      this.readAnsiCQuoted();
      return;
    }
    if (next === '(') {
      this.readSubstitution(line, column);
      return;
    }
    if (next === '{') {
      this.readBraced(line, column);
      return;
    }
    if (isNameStart(next)) {
      this.current += this.advance(); // the dollar sign stays
      while (isNameCharacter(this.peek())) this.current += this.advance();
      return;
    }
    if (next !== undefined && (isDigit(next) || SPECIAL_PARAMETERS.includes(next))) {
      this.fail(
        'A dollar sign followed by a digit or one of @ * # ? - $ ! is a shell variable that has no value here, so it was refused. Write a name such as $NAME for Compose to fill in, or put the dollar sign in single quotes to keep it as text.',
        line,
        column,
      );
    }
    this.advance();
    this.current += '$$';
  }

  /** Reads `$(`: only `$(pwd)` and `$(PWD)` are understood, and they become `.`. */
  private readSubstitution(line: number, column: number): void {
    const pwd = this.text.startsWith('(pwd)', this.i + 1) || this.text.startsWith('(PWD)', this.i + 1);
    if (!pwd) {
      this.fail(
        'A $( starts a command substitution, which is never run here. Only $(pwd) is read, as the current folder.',
        line,
        column,
      );
    }
    const after = this.peek(6);
    if (isNameCharacter(after) || after === '.' || after === '-') {
      this.fail(
        'Text written straight after $(pwd) cannot be read as a folder name. Put a slash or a colon after it.',
        line,
        column,
      );
    }
    for (let n = 0; n < 6; n++) this.advance();
    this.current += '.';
    this.usesPwd = true;
  }

  /** Reads `${`: a variable name, optionally followed by one of Compose's default forms, kept exactly as written. */
  private readBraced(line: number, column: number): void {
    const refused =
      'Only ${NAME} and the forms ${NAME:-text}, ${NAME-text}, ${NAME:?text}, ${NAME?text}, ${NAME:+text} and ${NAME+text} are read, because those are the forms Compose fills in.';
    let j = this.i + 2;
    if (!isNameStart(this.text[j])) this.fail(refused, line, column);
    while (isNameCharacter(this.text[j])) j++;
    let end: number;
    if (this.text[j] === '}') {
      end = j + 1;
    } else {
      let k = j;
      const first = this.text[k];
      if (first === ':') {
        const operator = this.text[k + 1];
        if (operator !== '-' && operator !== '?' && operator !== '+') this.fail(refused, line, column);
        k += 2;
      } else if (first === '-' || first === '?' || first === '+') {
        k += 1;
      } else {
        this.fail(refused, line, column);
      }
      let depth = 1;
      while (k < this.text.length) {
        const d = this.text[k]!;
        if (d === '}') {
          depth -= 1;
          if (depth === 0) break;
        } else if (d === '$' && this.text[k + 1] === '{') {
          if (!isNameStart(this.text[k + 2])) this.fail(refused, line, column);
          depth += 1;
          k += 1;
        } else if (d === '$' && this.text[k + 1] === '(') {
          this.fail('A command substitution inside ${...} is never run here.', line, column);
        } else if (d === '`' || d === "'" || d === '"' || d === '\\' || d === '\n') {
          this.fail(
            'Quotes, backslashes, backticks and line breaks inside ${...} are not read. Keep the default text plain.',
            line,
            column,
          );
        }
        k += 1;
      }
      if (k >= this.text.length) this.fail('This ${...} is never closed.', line, column);
      end = k + 1;
    }
    const raw = this.text.slice(this.i, end);
    for (let n = this.i; n < end; n++) this.advance();
    this.current += raw;
  }

  tokenize(): ReadCommand {
    checkSize(this.text);

    while (this.i < this.text.length) {
      const ch = this.peek()!;

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.advance();
        this.endWord();
        continue;
      }

      if (ch === '#' && !this.inWord) {
        while (this.i < this.text.length && this.peek() !== '\n') this.advance();
        continue;
      }

      if (UNQUOTED_OPERATORS.has(ch)) {
        this.fail(
          `This page reads a docker run command and never runs shell code: "${ch}" is a shell operator, so the command was refused.`,
        );
      }

      if (ch === '^' && this.restOfLineIsBlank(1)) {
        this.fail(
          'This line ends with a caret (^), which is how Windows cmd.exe continues a command onto the next line. This page reads POSIX and Bash shell syntax, not cmd.exe, so it was refused rather than guessed at.',
        );
      }

      if (ch === '`') {
        if (this.restOfLineIsBlank(1)) {
          this.fail(
            'This line ends with a backtick, which is how PowerShell continues a command onto the next line. This page reads POSIX and Bash shell syntax, not PowerShell, so it was refused rather than guessed at.',
          );
        }
        this.fail('A backtick starts a command substitution, which is never run here.');
      }

      if (ch === '$') {
        this.readDollar(false);
        continue;
      }

      if (ch === "'") {
        this.readSingleQuoted();
        continue;
      }

      if (ch === '"') {
        this.readDoubleQuoted();
        continue;
      }

      if (ch === '\\') {
        const line = this.line;
        const column = this.column;
        this.advance();
        const next = this.peek();
        if (next === '\n') {
          this.advance(); // line continuation: removed entirely, joins the lines
          continue;
        }
        if (next === '\r' && this.peek(1) === '\n') {
          this.advance();
          this.advance();
          continue;
        }
        if (next === undefined) this.fail('A backslash at the end of the command has nothing to escape.', line, column);
        this.begin(line, column);
        this.add(this.advance());
        continue;
      }

      this.begin(this.line, this.column);
      this.add(this.advance());
    }

    this.endWord();
    return { words: this.words, usesPwd: this.usesPwd };
  }
}

/**
 * Splits `text` into words exactly as a POSIX shell (with Bash's `$'...'` quoting) would, without ever running anything,
 * and says where each word starts. Throws a `DockerRunError` (with a 1-based `line` and `column`) for a paste over the
 * size limit and for any construct that would make a shell do more than pass text on.
 */
export function readDockerCommand(text: string): ReadCommand {
  return new DockerTokenizer(text).tokenize();
}

/** The words of `text` as plain strings; see `readDockerCommand`. */
export function tokenizeDockerCommand(text: string): string[] {
  return readDockerCommand(text).words.map((word) => word.text);
}
