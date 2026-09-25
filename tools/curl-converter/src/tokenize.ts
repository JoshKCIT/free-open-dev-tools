/**
 * A POSIX-shell-and-bash word splitter that never runs anything.
 *
 * Grounded in the POSIX Shell Command Language section 2.2 "Quoting"
 * (https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)
 * for single quotes, double quotes and backslash escaping, and the Bash
 * Reference Manual's "ANSI-C Quoting" section
 * (https://www.gnu.org/software/bash/manual/bash.html) for `$'...'` escape
 * decoding. Every construct that would let the shell run something other
 * than plain text -- parameter and command substitution, pipelines,
 * redirection, sequencing, an unterminated quote, or a line that looks like
 * a Windows cmd.exe or PowerShell continuation -- is refused with a message
 * naming the position, never evaluated.
 */
import { CurlConverterError } from './model';

const MAX_INPUT_LENGTH = 1_000_000;

const UNQUOTED_OPERATORS = new Set(['|', ';', '&', '<', '>', '(', ')']);

class ShellTokenizer {
  private readonly src: string;
  private i = 0;
  private line = 1;
  private column = 1;
  private readonly words: string[] = [];
  private current = '';
  private inWord = false;

  constructor(src: string) {
    this.src = src;
  }

  private fail(message: string): never {
    throw new CurlConverterError(message, { line: this.line, column: this.column });
  }

  private peek(offset = 0): string | undefined {
    return this.src[this.i + offset];
  }

  private advance(): string {
    const ch = this.src[this.i]!;
    this.i++;
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private endWord(): void {
    if (this.inWord) {
      this.words.push(this.current);
      this.current = '';
      this.inWord = false;
    }
  }

  /** True when everything from here to the next newline (or end of input) is blank. */
  private restOfLineIsBlank(fromOffset: number): boolean {
    let j = this.i + fromOffset;
    while (j < this.src.length && (this.src[j] === ' ' || this.src[j] === '\t' || this.src[j] === '\r')) j++;
    return j >= this.src.length || this.src[j] === '\n';
  }

  private readSingleQuoted(): void {
    this.advance(); // opening '
    this.inWord = true;
    for (;;) {
      if (this.i >= this.src.length) this.fail('This single-quoted string is never closed.');
      const c = this.peek()!;
      if (c === "'") {
        this.advance();
        return;
      }
      this.current += this.advance();
    }
  }

  private readDoubleQuoted(): void {
    this.advance(); // opening "
    this.inWord = true;
    for (;;) {
      if (this.i >= this.src.length) this.fail('This double-quoted string is never closed.');
      const c = this.peek()!;
      if (c === '"') {
        this.advance();
        return;
      }
      if (c === '\\') {
        const next = this.peek(1);
        if (next === '$' || next === '`' || next === '"' || next === '\\') {
          this.advance();
          this.current += this.advance();
          continue;
        }
        if (next === '\n') {
          this.advance();
          this.advance();
          continue;
        }
        // Bash: a backslash before anything else inside double quotes stays literal.
        this.current += this.advance();
        continue;
      }
      if (c === '$') {
        this.fail(
          'This tool does not evaluate variables or command substitution ($...), even inside a double-quoted string: it reads exactly the text given, and never runs it.',
        );
      }
      if (c === '`') {
        this.fail('Backtick command substitution is not run by this tool, even inside a double-quoted string.');
      }
      this.current += this.advance();
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
        while (hex.length < 2 && this.peek() !== undefined && /[0-9a-fA-F]/.test(this.peek()!)) hex += this.advance();
        return hex ? String.fromCharCode(parseInt(hex, 16)) : 'x';
      }
      case 'u': {
        this.advance();
        let hex = '';
        while (hex.length < 4 && this.peek() !== undefined && /[0-9a-fA-F]/.test(this.peek()!)) hex += this.advance();
        return hex ? String.fromCodePoint(parseInt(hex, 16)) : 'u';
      }
      case 'U': {
        this.advance();
        let hex = '';
        while (hex.length < 8 && this.peek() !== undefined && /[0-9a-fA-F]/.test(this.peek()!)) hex += this.advance();
        return hex ? String.fromCodePoint(parseInt(hex, 16)) : 'U';
      }
      default:
        if (/[0-7]/.test(e)) {
          let oct = '';
          while (oct.length < 3 && this.peek() !== undefined && /[0-7]/.test(this.peek()!)) oct += this.advance();
          return String.fromCharCode(parseInt(oct, 8) & 0xff);
        }
        // Bash drops an unrecognised escape's backslash and keeps the character.
        this.advance();
        return e;
    }
  }

  private readAnsiCQuoted(): void {
    this.advance(); // consume $
    this.advance(); // consume opening '
    this.inWord = true;
    for (;;) {
      if (this.i >= this.src.length) this.fail("This $'...' ANSI-C quoted string is never closed.");
      const c = this.peek()!;
      if (c === "'") {
        this.advance();
        return;
      }
      if (c === '\\') {
        this.advance();
        this.current += this.readAnsiCEscape();
        continue;
      }
      this.current += this.advance();
    }
  }

  tokenize(): string[] {
    if (this.src.length > MAX_INPUT_LENGTH) {
      throw new CurlConverterError('This command is over 1 MB, so it was refused rather than risk freezing the tab.');
    }

    while (this.i < this.src.length) {
      const ch = this.peek()!;

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.advance();
        this.endWord();
        continue;
      }

      if (ch === '#' && !this.inWord) {
        while (this.i < this.src.length && this.peek() !== '\n') this.advance();
        continue;
      }

      if (UNQUOTED_OPERATORS.has(ch)) {
        this.fail(
          `This tool does not run shell code: "${ch}" is a shell operator, and this page only reads what curl would be given, never runs it.`,
        );
      }

      if (ch === '^' && this.restOfLineIsBlank(1)) {
        this.fail(
          'This line ends with a caret (^), which is how Windows cmd.exe continues a command onto the next line. This tool reads POSIX/bash shell syntax, not cmd.exe, so it was refused rather than guessed at.',
        );
      }

      if (ch === '`') {
        if (this.restOfLineIsBlank(1)) {
          this.fail(
            'This line ends with a backtick (`), which is how PowerShell continues a command onto the next line. This tool reads POSIX/bash shell syntax, not PowerShell, so it was refused rather than guessed at.',
          );
        }
        this.fail(
          'Backtick command substitution is not run by this tool: it reads what curl would be given, and never runs it.',
        );
      }

      if (ch === '$') {
        if (this.peek(1) === "'") {
          this.readAnsiCQuoted();
          continue;
        }
        this.fail(
          'This tool does not evaluate variables or command substitution ($...): it reads exactly the text given, and never runs it.',
        );
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
        this.advance();
        const next = this.peek();
        if (next === '\n') {
          this.advance(); // line continuation: removed entirely, joins the lines
          continue;
        }
        if (next === undefined) this.fail('A backslash at the end of input has nothing to escape.');
        this.advance();
        this.current += next;
        this.inWord = true;
        continue;
      }

      this.advance();
      this.current += ch;
      this.inWord = true;
    }

    this.endWord();
    return this.words;
  }
}

/**
 * Splits `command` into words exactly as a POSIX shell (with bash's
 * `$'...'` ANSI-C quoting extension) would, without ever evaluating
 * anything. Throws `CurlConverterError` (with 1-based `line`/`column`) on
 * any construct that would make the shell do more than pass text through:
 * variable or command substitution, an unquoted shell operator, an
 * unterminated quote, or a Windows cmd.exe/PowerShell line continuation.
 */
export function tokenizeShell(command: string): string[] {
  return new ShellTokenizer(command).tokenize();
}
