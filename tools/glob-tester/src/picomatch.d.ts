/**
 * picomatch ships no types of its own. This declares the few members glob.ts uses, and nothing else, so the standalone
 * type-check of this folder passes without a suppressed error (the same approach as the Less core declaration in the
 * Sass and Less compiler folder).
 */
declare module 'picomatch' {
  /** The options this folder passes. `windows` is always given, so the platform a browser reports never matters. */
  export interface PicomatchOptions {
    /** Also accept a backslash as a path separator. Always false here. */
    windows?: boolean;
    /** Let * and ? reach a name that starts with a dot. */
    dot?: boolean;
    /** Ignore case. */
    nocase?: boolean;
  }

  /** What a matcher gives back when asked for details: whether the path matched and the regular expression it used. */
  export interface MatchDetails {
    isMatch: boolean;
    regex: RegExp;
  }

  /** The function picomatch returns for one glob: true when the path matches, or the details when asked for them. */
  export interface Matcher {
    (input: string): boolean;
    (input: string, returnObject: true): MatchDetails;
  }

  export interface Picomatch {
    (glob: string, options?: PicomatchOptions): Matcher;
    /** The regular expression a glob becomes. */
    makeRe(glob: string, options?: PicomatchOptions): RegExp;
  }

  const picomatch: Picomatch;
  export default picomatch;
}
