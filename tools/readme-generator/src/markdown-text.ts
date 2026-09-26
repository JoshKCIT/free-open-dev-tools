/**
 * Plain-text CommonMark helpers: escaping a value so it renders literally,
 * and generating the anchor GitHub gives a heading.
 */

/**
 * Every ASCII punctuation character CommonMark's own Backslash Escapes
 * section (2.4) says may be escaped: "Any ASCII punctuation character may be
 * backslash-escaped:
 * `\!\"\#\$\%\&\'\(\)\*\+\,\-\.\/\:\;\<\=\>\?\@\[\\\]\^\_\`\{\|\}\~`"
 * (spec.commonmark.org/0.31.2/, example 12) -- except a bare hyphen, kept
 * unescaped here: a hyphen has no special meaning in running inline text
 * (only at the very start of a line, as a list marker, thematic break or
 * Setext heading underline, none of which this project ever places a
 * visitor value at the start of), and the plan's own worked example expects
 * the project name "my-lib" to render as `# my-lib`, not `# my\-lib`.
 */
const ASCII_PUNCTUATION = /[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~]/g;

/**
 * Backslash-escapes every ASCII punctuation character (but not a bare
 * hyphen, see above) in `text`, so a project name, badge label or other
 * plain field renders as literal text in CommonMark rather than being read
 * as emphasis, a link, a heading marker or any other syntax (CommonMark
 * 0.31.2 section 2.4; example 14 confirms an escaped character "does not
 * have their usual Markdown meanings").
 */
export function escapeInline(text: string): string {
  return text.replace(ASCII_PUNCTUATION, (ch) => `\\${ch}`);
}

/**
 * A link destination written without angle brackets "does not include ASCII
 * control characters or space character, and includes parentheses only if
 * (a) they are backslash-escaped or (b) they are part of a balanced pair of
 * unescaped parentheses" (CommonMark 0.31.2 section 6.3, Links). Rather than
 * balance-check parentheses, this project always uses CommonMark's other
 * accepted destination form instead when a space, control character or
 * parenthesis is present: "a sequence of zero or more characters between an
 * opening < and a closing >" (same section).
 */
export function linkDestination(url: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters, not a typo.
  if (/[\s()<>\x00-\x1f]/.test(url)) {
    return `<${url.replace(/[<>]/g, (ch) => `\\${ch}`)}>`;
  }
  return url;
}

/**
 * GitHub's own documented section-link rule (github/docs,
 * get-started/writing-on-github/.../basic-writing-and-formatting-syntax.md,
 * "Section links"): "Letters are converted to lower-case. Spaces are
 * replaced by hyphens. Any other whitespace or punctuation characters are
 * removed. Leading and trailing whitespace are removed." A literal hyphen
 * already in the heading is kept (confirmed against the reference
 * `github-slugger` implementation many tools use to reproduce GitHub's own
 * anchors: its removal regex explicitly excludes U+002D). Ambiguity,
 * disclosed rather than guessed at: that same documentation page's own
 * worked example renders the Greek capital letter Θ unlowercased in the
 * anchor ("...the-greek-letter-Θ"), contradicting its own first rule; this
 * function follows the stated rule (lower-case every letter) since that is
 * what the reference implementation actually does.
 */
export function githubSlug(heading: string): string {
  const lower = heading.toLowerCase();
  const kept = lower.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\-\s]/gu, '');
  return kept.trim().replace(/\s+/g, '-');
}
