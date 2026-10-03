/**
 * The OpenSSH public key blob and line (RFC 4253 section 6.6 for ssh-rsa). A blob is a series of SSH strings (RFC 4251
 * section 5): a four byte big-endian length and then the bytes; an mpint is a string holding the number with no leading
 * zeros and one zero byte in front of a set top bit, and zero is the empty string.
 *
 * RULE, stated once and enforced by a test: no message thrown or returned from this file may ever contain a fragment
 * of a key, a secret, or a token. Describe the shape of the problem, never the content.
 */
import { concat } from './der-write';
import type { KeyModel } from './model';
import { bytesToBase64 } from './pem';

function uint32(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

/** An SSH string: a length and the bytes. */
export function sshString(bytes: Uint8Array): Uint8Array {
  return concat(uint32(bytes.length), bytes);
}

/** An SSH mpint of an unsigned magnitude. */
export function sshMpint(magnitude: Uint8Array): Uint8Array {
  let skip = 0;
  while (skip < magnitude.length && magnitude[skip] === 0) skip++;
  const trimmed = magnitude.subarray(skip);
  if (trimmed.length === 0) return uint32(0);
  return sshString((trimmed[0]! & 0x80) !== 0 ? concat(Uint8Array.of(0), trimmed) : trimmed);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text, (character) => character.charCodeAt(0)));
}

/** The name written at the start of the line and of the blob, for example ssh-rsa. */
export function sshKeyType(_key: KeyModel): string {
  return 'ssh-rsa';
}

/** The public key blob that follows the name on an OpenSSH public key line. */
export function sshPublicBlob(key: KeyModel): Uint8Array {
  return concat(sshString(ascii(sshKeyType(key))), sshMpint(key.e), sshMpint(key.n));
}

/** The OpenSSH public key line: the name, the Base64 of the blob and, when given, the comment after one space. */
export function sshPublicLine(key: KeyModel, comment: string): string {
  const line = `${sshKeyType(key)} ${bytesToBase64(sshPublicBlob(key))}`;
  return comment === '' ? line : `${line} ${comment}`;
}
