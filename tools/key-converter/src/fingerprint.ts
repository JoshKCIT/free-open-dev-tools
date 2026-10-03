/**
 * The two fingerprints ssh-keygen prints for a public key blob: SHA256 (the Base64 of the SHA-256 digest with the equals
 * signs removed, prefixed SHA256:) and MD5 (the digest as lower case hex pairs joined by colons, prefixed MD5:).
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { md5 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { derHex } from './der';
import { bytesToBase64 } from './pem';

export function sshFingerprints(blob: Uint8Array): { sha256: string; md5: string } {
  return {
    sha256: `SHA256:${bytesToBase64(sha256(blob), false, false)}`,
    md5: `MD5:${derHex(md5(blob), ':')}`,
  };
}
