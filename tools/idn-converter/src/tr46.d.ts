/**
 * The tr46 package (UTS #46 Unicode IDNA Compatibility Processing) ships no types. This declaration gives the two
 * functions this folder calls and the options it passes, and nothing else, so the standalone type-check of this folder
 * passes without a suppressed error. Option names and defaults are those of tr46 6.0.0 (all false when left out).
 */
declare module 'tr46' {
  export interface Tr46Options {
    checkHyphens?: boolean;
    checkBidi?: boolean;
    checkJoiners?: boolean;
    useSTD3ASCIIRules?: boolean;
    /** Read by toASCII only. */
    verifyDNSLength?: boolean;
    transitionalProcessing?: boolean;
    ignoreInvalidPunycode?: boolean;
  }

  /** The ASCII form of a domain name, or null when UTS #46 records an error. */
  export function toASCII(domainName: string, options?: Tr46Options): string | null;

  /** The Unicode form of a domain name (always produced) and whether UTS #46 recorded an error. */
  export function toUnicode(domainName: string, options?: Tr46Options): { domain: string; error: boolean };
}
