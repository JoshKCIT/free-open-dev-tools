/**
 * A hand-written selector list tokenizer/parser for Selectors Level 4,
 * built to answer exactly one question -- what does a selector's
 * specificity count as -- so it does not attempt to validate every rule of
 * the full selector grammar. It parses:
 *
 *  - type selectors and the universal selector, each with an optional
 *    namespace prefix (`ns|div`, `*|div`, `|div`, `ns|*`)
 *  - `#id` and `.class`
 *  - attribute selectors with every operator (`=`, `~=`, `|=`, `^=`, `$=`,
 *    `*=`) and the `i`/`s` case-sensitivity flag
 *  - pseudo-classes and pseudo-elements, with or without arguments; the
 *    argument text of a pseudo-class this tool does not need to understand
 *    (`:hover`, `:lang(en)`, `:nth-of-type(2)`) is skipped as balanced,
 *    unparsed text
 *  - the four selector list arguments (`:is()`, `:not()`, `:has()`,
 *    `:where()`) and the `of <selector-list>` clause of `:nth-child()` and
 *    `:nth-last-child()`, both of which are recursively parsed as nested
 *    selector lists because Selectors Level 4 defines their specificity in
 *    terms of the selectors inside them
 *  - combinators: descendant (whitespace), `>`, `+`, `~`, and the column
 *    combinator `||`
 *  - CSS escapes (`\` plus up to six hex digits, or `\` plus one literal
 *    character) inside identifiers and strings
 *
 * `:host()`, `:host-context()`, `::slotted()` and `::part()` cross a shadow
 * tree boundary this tool has no notion of, and CSS Nesting's `&` refers to
 * an outer rule this tool never sees -- all four are refused by name rather
 * than silently scored as zero, per this project's own scope decision, not
 * a claim about the Selectors Level 4 specification (which does define
 * `:host()`'s own specificity elsewhere).
 */

export interface SelectorSyntaxErrorPosition {
  line: number;
  column: number;
}

/** Thrown for any selector list this tokenizer cannot parse. `line` and `column` are 1-based. */
export class SelectorSyntaxError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'SelectorSyntaxError';
    this.line = line;
    this.column = column;
  }
}

/** How deeply a selector may nest inside `:is()`, `:not()`, `:has()`, `:where()` or an `of` clause before it is refused. */
export const MAX_NESTING_DEPTH = 32;

export type SimpleSelectorKind =
  'type' | 'universal' | 'id' | 'class' | 'attribute' | 'pseudo-class' | 'pseudo-element';

/** The four pseudo-classes whose specificity is replaced by their most specific argument (`:where()` always zero). */
export type SelectorListPseudo = 'is' | 'not' | 'has' | 'where';

/** The two pseudo-classes whose specificity is their own (one pseudo-class) plus their `of` clause's most specific argument, if any. */
export type NthPseudo = 'nth-child' | 'nth-last-child';

export interface SimpleSelectorPart {
  kind: SimpleSelectorKind;
  /** The exact source text of this part, e.g. "#foo", ".bar", "::before", "[href^=https]", ":not(FOO)". */
  text: string;
  /** Lower-cased name: the tag name for a type selector, or the pseudo name otherwise. Absent for id, class, attribute and the universal selector. */
  name?: string;
  /** Set only for `:is()`, `:not()`, `:has()` and `:where()`. */
  selectorListPseudo?: SelectorListPseudo;
  /** Set only for `:nth-child()` and `:nth-last-child()`. */
  nthPseudo?: NthPseudo;
  /** The parsed selector list argument, for a `selectorListPseudo` part or an `nthPseudo` part that has an `of` clause. */
  argument?: ParsedSelector[];
  pos: SelectorSyntaxErrorPosition;
}

export interface CompoundSelector {
  parts: SimpleSelectorPart[];
  pos: SelectorSyntaxErrorPosition;
}

export type Combinator = '>' | '+' | '~' | '||' | 'descendant';

export interface SelectorSegment {
  /** null only for the first segment of a selector with no leading combinator. */
  combinator: Combinator | null;
  compound: CompoundSelector;
}

export interface ParsedSelector {
  /** The exact, trimmed source text of exactly this one selector (no surrounding commas). */
  text: string;
  segments: SelectorSegment[];
  pos: SelectorSyntaxErrorPosition;
}

export interface ParseSelectorListOptions {
  /** The 1-based document line this text came from, for error and part positions. Default 1. */
  line?: number;
  /** True only for a relative selector list (`:has()`'s own argument), where a leading combinator is grammatical. */
  allowLeadingCombinator?: boolean;
}

const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
const SELECTOR_LIST_PSEUDOS = new Set<SelectorListPseudo>(['is', 'not', 'has', 'where']);
const NTH_PSEUDOS = new Set<NthPseudo>(['nth-child', 'nth-last-child']);

class SelectorParser {
  private readonly text: string;
  private i = 0;
  private curLine: number;
  private lineStart = 0;
  private depth = 0;

  constructor(text: string, startLine: number) {
    this.text = text;
    this.curLine = startLine;
  }

  private pos(at: number = this.i): SelectorSyntaxErrorPosition {
    return { line: this.curLine, column: at - this.lineStart + 1 };
  }

  private err(message: string, at: number = this.i): never {
    const p = this.pos(at);
    throw new SelectorSyntaxError(message, p.line, p.column);
  }

  private eof(at: number = this.i): boolean {
    return at >= this.text.length;
  }

  private peek(offset = 0): string {
    return this.text[this.i + offset] ?? '';
  }

  private advanceChar(): void {
    if (this.text[this.i] === '\n') {
      this.curLine++;
      this.lineStart = this.i + 1;
    }
    this.i++;
  }

  private advanceTo(target: number): void {
    while (this.i < target) this.advanceChar();
  }

  private skipWs(): void {
    while (!this.eof() && /\s/.test(this.peek())) this.advanceChar();
  }

  /** Skips whitespace and reports whether any was found -- the signal for an implied descendant combinator. */
  private skipWsReporting(): boolean {
    const start = this.i;
    this.skipWs();
    return this.i > start;
  }

  private isIdentStartChar(ch: string): boolean {
    if (!ch) return false;
    return /[a-zA-Z_\u0080-￿-]/.test(ch) || ch === '\\';
  }

  private isIdentChar(ch: string): boolean {
    if (!ch) return false;
    return this.isIdentStartChar(ch) || /[0-9]/.test(ch);
  }

  private readEscape(): string {
    this.advanceChar(); // consume backslash
    if (this.eof()) this.err('A backslash at the end of the selector is not a valid escape.');
    const c = this.peek();
    if (/[0-9a-fA-F]/.test(c)) {
      let hex = '';
      for (let n = 0; n < 6 && /[0-9a-fA-F]/.test(this.peek()); n++) {
        hex += this.peek();
        this.advanceChar();
      }
      if (/\s/.test(this.peek())) this.advanceChar();
      const code = parseInt(hex, 16);
      try {
        return String.fromCodePoint(Number.isFinite(code) ? code : 0xfffd);
      } catch {
        return '�';
      }
    }
    const ch = this.peek();
    this.advanceChar();
    return ch;
  }

  private readIdent(context: string): string {
    let out = '';
    let count = 0;
    while (!this.eof()) {
      const c = this.peek();
      if (c === '\\') {
        out += this.readEscape();
        count++;
        continue;
      }
      const ok = count === 0 ? this.isIdentStartChar(c) : this.isIdentChar(c);
      if (!ok) break;
      out += c;
      this.advanceChar();
      count++;
    }
    if (count === 0) this.err(`Expected ${context}.`);
    return out;
  }

  private readString(): string {
    const quote = this.peek();
    this.advanceChar();
    let out = '';
    for (;;) {
      if (this.eof()) this.err('This quoted string never closes.');
      const c = this.peek();
      if (c === quote) {
        this.advanceChar();
        break;
      }
      if (c === '\\') {
        out += this.readEscape();
        continue;
      }
      if (c === '\n') this.err('A quoted string cannot contain an unescaped line break.');
      out += c;
      this.advanceChar();
    }
    return out;
  }

  private readTypeName(): string {
    if (this.peek() === '*') {
      this.advanceChar();
      return '*';
    }
    return this.readIdent('a type selector');
  }

  private tryParseTypeOrUniversal(parts: SimpleSelectorPart[]): boolean {
    const c = this.peek();
    if (c !== '*' && c !== '|' && !this.isIdentStartChar(c)) return false;

    const startPos = this.pos();
    const startIndex = this.i;

    let local: string;
    if (c === '|') {
      this.advanceChar(); // the explicit no-namespace marker
      local = this.readTypeName();
    } else {
      const first = this.readTypeName();
      const nextAfterPipe = this.peek(1);
      const looksNamespaced =
        this.peek() === '|' &&
        nextAfterPipe !== '=' &&
        nextAfterPipe !== '|' &&
        (this.isIdentStartChar(nextAfterPipe) || nextAfterPipe === '*');
      if (looksNamespaced) {
        this.advanceChar(); // consume '|'
        local = this.readTypeName();
      } else {
        local = first;
      }
    }

    const text = this.text.slice(startIndex, this.i);
    if (local === '*') parts.push({ kind: 'universal', text, pos: startPos });
    else parts.push({ kind: 'type', text, name: local.toLowerCase(), pos: startPos });
    return true;
  }

  private parseClass(parts: SimpleSelectorPart[]): void {
    const startPos = this.pos();
    const startIndex = this.i;
    this.advanceChar(); // '.'
    const name = this.readIdent('a class name after "."');
    parts.push({ kind: 'class', text: this.text.slice(startIndex, this.i), name, pos: startPos });
  }

  private parseId(parts: SimpleSelectorPart[]): void {
    const startPos = this.pos();
    const startIndex = this.i;
    this.advanceChar(); // '#'
    const name = this.readIdent('an id after "#"');
    parts.push({ kind: 'id', text: this.text.slice(startIndex, this.i), name, pos: startPos });
  }

  private parseAttribute(parts: SimpleSelectorPart[]): void {
    const startPos = this.pos();
    const startIndex = this.i;
    this.advanceChar(); // '['
    this.skipWs();

    const readAttrNamePart = (): string => {
      if (this.peek() === '*') {
        this.advanceChar();
        return '*';
      }
      return this.readIdent('an attribute name');
    };
    readAttrNamePart();
    if (this.peek() === '|' && this.peek(1) !== '=' && (this.isIdentStartChar(this.peek(1)) || this.peek(1) === '*')) {
      this.advanceChar();
      readAttrNamePart();
    }
    this.skipWs();

    if (this.peek() !== ']') {
      const opChar = this.peek();
      if (opChar === '=') {
        this.advanceChar();
      } else if ('~|^$*'.includes(opChar)) {
        this.advanceChar();
        if (this.peek() !== '=') this.err(`Expected "=" after "${opChar}" in an attribute selector.`);
        this.advanceChar();
      } else {
        this.err(`Unexpected "${opChar || 'end of input'}" in an attribute selector.`);
      }
      this.skipWs();
      if (this.peek() === '"' || this.peek() === "'") this.readString();
      else this.readIdent('an attribute value');
      this.skipWs();
      // A single-letter case/accent-sensitivity flag (i, I, s, S) precedes the closing bracket.
      if (this.peek() === 'i' || this.peek() === 'I' || this.peek() === 's' || this.peek() === 'S') {
        this.advanceChar();
        this.skipWs();
      }
    }

    if (this.peek() !== ']') this.err('Expected "]" to close an attribute selector.');
    this.advanceChar();
    parts.push({ kind: 'attribute', text: this.text.slice(startIndex, this.i), pos: startPos });
  }

  /** Skips a balanced, unparsed argument list -- used for any pseudo-class or pseudo-element this tool does not need to look inside. */
  private skipBalancedParens(): void {
    let depth = 1; // the opening '(' is already consumed
    while (!this.eof()) {
      const c = this.peek();
      if (c === '(') {
        depth++;
        this.advanceChar();
        continue;
      }
      if (c === ')') {
        depth--;
        this.advanceChar();
        if (depth === 0) return;
        continue;
      }
      if (c === '"' || c === "'") {
        this.readString();
        continue;
      }
      if (c === '\\') {
        this.readEscape();
        continue;
      }
      this.advanceChar();
    }
    this.err('This argument list never closes.');
  }

  /**
   * Finds, at parenthesis depth 0 relative to the current position (just
   * after the pseudo-class's own opening paren), either the word "of" as a
   * whole word or the closing paren -- whichever comes first. The `An+B`
   * expression `:nth-child()` takes never itself contains a paren or the
   * word "of", so this scan is safe without understanding that grammar.
   */
  private findNthSplit(): { kind: 'of'; index: number } | { kind: 'close'; index: number } {
    let depth = 0;
    let j = this.i;
    while (j < this.text.length) {
      const c = this.text[j];
      if (c === '(') {
        depth++;
        j++;
        continue;
      }
      if (c === ')') {
        if (depth === 0) return { kind: 'close', index: j };
        depth--;
        j++;
        continue;
      }
      if (depth === 0 && (c === 'o' || c === 'O') && (this.text[j + 1] === 'f' || this.text[j + 1] === 'F')) {
        const before = j === this.i ? undefined : this.text[j - 1];
        const after = this.text[j + 2];
        const beforeOk = before === undefined || /\s/.test(before);
        const afterOk = after === undefined || /\s/.test(after);
        if (beforeOk && afterOk) return { kind: 'of', index: j };
      }
      j++;
    }
    this.err('This argument list never closes.');
  }

  private parsePseudo(parts: SimpleSelectorPart[]): void {
    const startPos = this.pos();
    const startIndex = this.i;
    this.advanceChar(); // first ':'
    let isDouble = false;
    if (this.peek() === ':') {
      this.advanceChar();
      isDouble = true;
    }
    const name = this.readIdent('a pseudo-class or pseudo-element name');
    const nameLower = name.toLowerCase();

    if (!isDouble && (nameLower === 'host' || nameLower === 'host-context')) {
      this.err(
        `":${nameLower}" is not scored by this tool: it selects a shadow host, a construct this tool's selector list has no notion of.`,
        startIndex,
      );
    }
    if (isDouble && (nameLower === 'slotted' || nameLower === 'part')) {
      this.err(
        `"::${nameLower}" is not scored by this tool: it crosses a shadow tree boundary this tool's selector list has no notion of.`,
        startIndex,
      );
    }

    const isPseudoElement = isDouble || LEGACY_PSEUDO_ELEMENTS.has(nameLower);
    let selectorListPseudo: SelectorListPseudo | undefined;
    let nthPseudo: NthPseudo | undefined;
    let argument: ParsedSelector[] | undefined;

    if (this.peek() === '(') {
      this.advanceChar(); // '('
      if (!isPseudoElement && SELECTOR_LIST_PSEUDOS.has(nameLower as SelectorListPseudo)) {
        selectorListPseudo = nameLower as SelectorListPseudo;
        this.enterNesting();
        argument = this.parseSelectorGroup(true, nameLower === 'has');
        this.depth--;
      } else if (!isPseudoElement && NTH_PSEUDOS.has(nameLower as NthPseudo)) {
        nthPseudo = nameLower as NthPseudo;
        const split = this.findNthSplit();
        if (split.kind === 'close') {
          this.advanceTo(split.index);
          this.advanceChar(); // ')'
        } else {
          this.advanceTo(split.index);
          this.advanceChar();
          this.advanceChar(); // "of"
          this.skipWs();
          this.enterNesting();
          argument = this.parseSelectorGroup(true, false);
          this.depth--;
        }
      } else {
        this.skipBalancedParens();
      }
    }

    const text = this.text.slice(startIndex, this.i);
    parts.push({
      kind: isPseudoElement ? 'pseudo-element' : 'pseudo-class',
      text,
      name: nameLower,
      selectorListPseudo,
      nthPseudo,
      argument,
      pos: startPos,
    });
  }

  private enterNesting(): void {
    if (this.depth >= MAX_NESTING_DEPTH) {
      this.err(
        `This selector nests more than ${MAX_NESTING_DEPTH} levels deep inside :is(), :not(), :has(), :where() or an "of" clause; refused rather than risk freezing the tab.`,
      );
    }
    this.depth++;
  }

  private tryReadCombinator(): '>' | '+' | '~' | '||' | null {
    const c = this.peek();
    if (c === '>' || c === '+' || c === '~') {
      this.advanceChar();
      return c;
    }
    if (c === '|' && this.peek(1) === '|') {
      this.advanceChar();
      this.advanceChar();
      return '||';
    }
    return null;
  }

  private parseCompound(): CompoundSelector {
    const startPos = this.pos();
    const parts: SimpleSelectorPart[] = [];
    let saw = this.tryParseTypeOrUniversal(parts);
    for (;;) {
      const c = this.peek();
      if (c === '.') {
        this.parseClass(parts);
        saw = true;
        continue;
      }
      if (c === '#') {
        this.parseId(parts);
        saw = true;
        continue;
      }
      if (c === '[') {
        this.parseAttribute(parts);
        saw = true;
        continue;
      }
      if (c === ':') {
        this.parsePseudo(parts);
        saw = true;
        continue;
      }
      if (c === '&') {
        this.err(
          'CSS Nesting\'s "&" selector is not scored by this tool: it refers to an outer rule this tool never sees.',
        );
      }
      break;
    }
    if (!saw) this.err(this.eof() ? 'Expected a selector here.' : `Unexpected "${this.peek()}" here.`);
    return { parts, pos: startPos };
  }

  private parseOneComplexSelector(allowLeadingCombinator: boolean): ParsedSelector {
    const startPos = this.pos();
    const startIndex = this.i;
    const segments: SelectorSegment[] = [];
    let pending: Combinator | null = null;

    const lead = this.tryReadCombinator();
    if (lead) {
      if (!allowLeadingCombinator) this.err(`A selector cannot start with the combinator "${lead}".`, startIndex);
      pending = lead;
      this.skipWs();
    }

    for (;;) {
      const compound = this.parseCompound();
      segments.push({ combinator: pending, compound });
      pending = null;
      const hadWs = this.skipWsReporting();
      const c = this.peek();
      if (c === ',' || c === ')' || this.eof()) break;
      const comb = this.tryReadCombinator();
      if (comb) {
        pending = comb;
        this.skipWs();
        continue;
      }
      if (hadWs) {
        pending = 'descendant';
        continue;
      }
      this.err(`Unexpected "${c}" here.`);
    }

    const text = this.text.slice(startIndex, this.i).trim();
    return { text, segments, pos: startPos };
  }

  /** Parses one or more comma-separated selectors. `stopAtCloseParen` consumes the trailing `)`; otherwise the whole remaining text must be exhausted. */
  parseSelectorGroup(stopAtCloseParen: boolean, allowLeadingCombinator: boolean): ParsedSelector[] {
    const selectors: ParsedSelector[] = [];
    this.skipWs();
    for (;;) {
      selectors.push(this.parseOneComplexSelector(allowLeadingCombinator));
      this.skipWs();
      if (this.peek() === ',') {
        this.advanceChar();
        this.skipWs();
        continue;
      }
      break;
    }
    if (stopAtCloseParen) {
      if (this.peek() !== ')') this.err('Expected ")" to close this argument list.');
      this.advanceChar();
    } else if (!this.eof()) {
      this.err(`Unexpected "${this.peek()}" here.`);
    }
    return selectors;
  }
}

/**
 * Parses one selector list (one or more comma-separated complex selectors)
 * from a single line of text. Throws `SelectorSyntaxError` on anything it
 * cannot parse, with `line` and `column` positions.
 */
export function parseSelectorList(input: string, options: ParseSelectorListOptions = {}): ParsedSelector[] {
  const parser = new SelectorParser(input, options.line ?? 1);
  return parser.parseSelectorGroup(false, options.allowLeadingCombinator ?? false);
}
