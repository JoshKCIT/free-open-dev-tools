# Classical Cipher Workbench

Caesar, ROT13, ROT47, Atbash and Vigenere, for learning and puzzle work only.

Part of [Free & Open Dev Tools](https://github.com/JoshKCIT/free-open-dev-tools). This folder is self-contained: it has its own
package file, tests, licence and documentation, and does not import anything from the rest of the repository.

## What it does

Applies and reverses five classical substitution ciphers: Caesar, ROT13, ROT47, Atbash and Vigenere. These are pencil-and-paper ciphers from before modern cryptography, useful for puzzles, training exercises and understanding how substitution works. None of them is designed to keep anything secret from a computer.

## Supported

- Caesar cipher with a chosen shift, applied and reversed, moving letters within their own case
- ROT13, a fixed Caesar shift of thirteen, its own inverse
- ROT47, which rotates the ninety-four printable ASCII characters from the exclamation mark to the tilde by forty-seven positions, its own inverse
- Atbash, mapping each letter to its mirror image in the alphabet within its own case, its own inverse
- Vigenere with a text key, enciphering and deciphering back to the original, preserving case and leaving non-letters untouched
- Every cipher round trips for text containing letters in both cases, digits, punctuation and characters outside ASCII

## Limits

- This is for learning and puzzle work only. None of these ciphers is secure; a computer can break every one of them in well under a second.
- Caesar, ROT13, Atbash and Vigenere transform only the twenty-six unaccented Latin letters; every other character, including accented letters, passes through unchanged.
- ROT47 covers only the ninety-four printable ASCII characters from the exclamation mark to the tilde; a space, a tab, a newline and anything outside that range passes through unchanged.
- A Vigenere key is not a password. It is recoverable from enough ciphertext by well-known frequency-analysis techniques, and this tool does not attempt to hide that.

## Ambiguous cases, and what this does about them

- In Vigenere, a non-letter in the plaintext or ciphertext is copied straight through and does not advance the key position, so the same key letter lines up with the next actual letter rather than being consumed by punctuation.
- In Vigenere, a non-letter appearing inside the key itself is ignored before the key is used, so a key such as "sun-shine" behaves exactly like "sunshine".

## Use it on its own

```sh
npx degit JoshKCIT/free-open-dev-tools/tools/classical-cipher classical-cipher
cd classical-cipher
npm install
npm test
```

## Install into a project

```sh
npm install @fodt/classical-cipher
```

This package is not published to npm. Copy the folder in, or add it as a workspace package, or depend on the
repository directly. The whole point is that you can vendor it: it is small enough to read.

## API

```ts
import { encipher, decipher } from '@fodt/classical-cipher';

encipher('Attack at dawn', { cipher: 'caesar', shift: 3 });   // 'Dwwdfn dw gdzq'
encipher('Hello', { cipher: 'rot13' });                       // 'Uryyb'
encipher('Hello, World!', { cipher: 'rot47' });               // 'w6==@[ (@C=5P'
decipher('Uryyb', { cipher: 'rot13' });                       // 'Hello'
encipher('attackatdawn', { cipher: 'vigenere', key: 'lemon' });
```

`encipher` and `decipher` dispatch on `options.cipher` and throw `ClassicalCipherError` for a Vigenere key with no letters. `CIPHERS` is an array of descriptors (label, whether a shift applies, whether a key applies, and a one-line note) for building a selector UI without hard-coding the five names elsewhere.

## Dependencies

None. This package has no runtime dependencies.

## Tests

```sh
npm test
```

No standards body publishes any of these five ciphers or test vectors for them; they are conventions, not specifications. The tests assert each algorithm's own definition, its inverse property (encipher then decipher returns the original), its agreement with a sibling cipher where the two overlap by construction (Caesar at shift thirteen equals ROT13; Vigenere with a one-letter key equals Caesar at the matching shift), and one hand-computed worked example per cipher shown in a comment so it can be checked without running anything. ROT47 is additionally asserted at both exact range boundaries by name, because an inverse-property test alone would also pass an identity function.

## Licence

MIT. See [LICENSE](./LICENSE).
