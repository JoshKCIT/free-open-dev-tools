import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readPkcs8, readSpki } from '../src/formats';
import { keyOutputs } from '../src/index';
import { KeyConverterError, checkComment } from '../src/model';
import { readRfc4716, rfc4716, sshPublicBlob, sshPublicLine } from '../src/openssh';
import { bytesOf } from './fixtures/fixture-list';
import * as fx from './fixtures/keys';

/**
 * Specification: RFC 4716 section 3.3 (a header line is at most 72 bytes; a longer one ends in a backslash and continues
 * on the next line) and the OpenSSH public key line, which ends at the end of its line. The comment is not secret but it
 * is written into files, so a control character in it is refused instead of written.
 */

const spies = {
  log: vi.spyOn(console, 'log'),
  warn: vi.spyOn(console, 'warn'),
  error: vi.spyOn(console, 'error'),
};
beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockImplementation(() => undefined);
});
afterEach(() => {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  for (const spy of Object.values(spies)) spy.mockReset();
});

const ch = (code: number): string => String.fromCodePoint(code);
const key = readPkcs8(bytesOf(fx.ED25519_PKCS8_DER_B64));
const publicKey = readSpki(bytesOf(fx.ED25519_SPKI_DER_B64));

function refusal(comment: string): string {
  try {
    checkComment(comment);
  } catch (err) {
    expect(err).toBeInstanceOf(KeyConverterError);
    return (err as KeyConverterError).message;
  }
  throw new Error('expected a refusal');
}

it('a comment with a control character is refused, and the sentence names its position and never repeats it', () => {
  for (const code of [0, 1, 9, 0x1b, 0x7f, 0x80, 0x85, 0x9f]) {
    const message = refusal('ab' + ch(code) + 'cd');
    expect(message, code.toString(16)).toBe(
      'The comment has a control character at character 3. A comment is written as plain text on one line, so remove it.',
    );
  }
  // A line break keeps its own sentence.
  expect(refusal('one' + ch(10) + 'two')).toBe(
    'The comment has a line break at character 4. A comment is written on a single line, so remove the break.',
  );
  // Ordinary text, accents, CJK and an emoji are accepted.
  for (const fine of [
    '',
    'me@laptop',
    'Caf' + ch(0xe9) + ' ' + ch(0x4e2d) + ch(0x6587),
    ch(0x1f510) + ' key',
    ch(0xa0),
  ]) {
    expect(() => checkComment(fine)).not.toThrow();
  }
  // It reaches every writer: no OpenSSH line or RFC 4716 header can hold the character.
  for (const writer of [
    () => sshPublicLine(key, 'a' + ch(0x1b) + '[2J'),
    () => rfc4716(key, 'a' + ch(0) + 'b'),
    () => keyOutputs(key, { comment: 'a' + ch(0x1b) + 'b' }),
  ]) {
    expect(writer).toThrow(KeyConverterError);
  }
});

/** The UTF-8 length of a string, in bytes. */
const bytesOfText = (text: string): number => new TextEncoder().encode(text).length;

it('an RFC 4716 header longer than 72 bytes is continued with a trailing backslash and reads back whole', () => {
  const comments = [
    // Plain words, long enough for three lines.
    'a long comment for a key that is kept on a laptop and copied to a server and used by a person who wrote it ' +
      'down so that it is possible to tell which key is which when there are very many keys on one machine',
    // Quotes and backslashes in every position, so a break may fall beside an escape.
    '"\\'.repeat(100),
    // Spaces, so a continuation line may begin or end with one.
    'word '.repeat(50),
    ' '.repeat(120) + 'x',
    // Two and three byte characters and an emoji.
    ('Caf' + ch(0xe9) + ch(0x4e2d) + ch(0x6587) + ch(0x1f510) + ' ').repeat(25),
    // The longest comment the page accepts.
    'x'.repeat(256),
    // Exactly at the edge: the header is 72 bytes, 73 bytes, and 71 bytes.
    'y'.repeat(72 - 'Comment: ""'.length),
    'y'.repeat(73 - 'Comment: ""'.length),
    'y'.repeat(71 - 'Comment: ""'.length),
  ];
  for (const comment of comments) {
    const file = rfc4716(key, comment);
    const lines = file.split('\n');
    expect(lines[0]).toBe('---- BEGIN SSH2 PUBLIC KEY ----');
    const headerEnd = lines.findIndex(
      (line, index) => index > 0 && !line.includes(':') && !lines[index - 1]!.endsWith('\\'),
    );
    const header = lines.slice(1, headerEnd);
    expect(header.length).toBeGreaterThan(0);
    for (const [index, line] of header.entries()) {
      expect(bytesOfText(line), `line ${index + 1} of "${comment.slice(0, 12)}"`).toBeLessThanOrEqual(72);
      // Every physical line but the last ends in a backslash, and the last does not look continued.
      const last = index === header.length - 1;
      if (!last) expect(line.endsWith('\\')).toBe(true);
    }
    const back = readRfc4716(file);
    expect(back.comment, comment.slice(0, 12)).toBe(comment);
    expect(Buffer.from(sshPublicBlob(back.key)).equals(Buffer.from(sshPublicBlob(publicKey)))).toBe(true);
  }
  // A short comment is still one line, exactly as before.
  expect(rfc4716(key, 'my laptop').split('\n')[1]).toBe('Comment: "my laptop"');
  expect(rfc4716(key, 'my laptop').split('\n')[2]).not.toMatch(/:/);
});
