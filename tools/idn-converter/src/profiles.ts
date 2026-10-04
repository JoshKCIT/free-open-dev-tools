/**
 * The two sets of UTS #46 options the converter offers. Both use nontransitional processing (transitional processing is
 * deprecated) and IgnoreInvalidPunycode false, and both keep the bidirectional and joiner checks on.
 */
export type ProfileId = 'strict' | 'browser';

export interface Profile {
  readonly checkHyphens: boolean;
  readonly checkBidi: boolean;
  readonly checkJoiners: boolean;
  readonly useSTD3ASCIIRules: boolean;
  readonly verifyDNSLength: boolean;
  readonly transitionalProcessing: false;
  readonly ignoreInvalidPunycode: false;
}

/** As for registering a name: every check UTS #46 offers is on (this is also how the conformance data is checked). */
export const STRICT: Profile = {
  checkHyphens: true,
  checkBidi: true,
  checkJoiners: true,
  useSTD3ASCIIRules: true,
  verifyDNSLength: true,
  transitionalProcessing: false,
  ignoreInvalidPunycode: false,
};

/**
 * As a browser address bar reads a name: the URL Standard's "domain parser ToASCII" with beStrict false (read on
 * 2026-10-04 at https://url.spec.whatwg.org/#concept-domain-to-ascii) runs Unicode ToASCII with CheckHyphens,
 * UseSTD3ASCIIRules and VerifyDnsLength set to false, CheckBidi and CheckJoiners true, Transitional_Processing false and
 * IgnoreInvalidPunycode false. The URL Standard's other steps (an all-ASCII name is kept as typed, a result with a
 * forbidden domain code point is refused) belong to its URL parser and are not applied here.
 */
export const BROWSER: Profile = {
  checkHyphens: false,
  checkBidi: true,
  checkJoiners: true,
  useSTD3ASCIIRules: false,
  verifyDNSLength: false,
  transitionalProcessing: false,
  ignoreInvalidPunycode: false,
};

export const PROFILES: ReadonlyMap<ProfileId, Profile> = new Map<ProfileId, Profile>([
  ['strict', STRICT],
  ['browser', BROWSER],
]);
