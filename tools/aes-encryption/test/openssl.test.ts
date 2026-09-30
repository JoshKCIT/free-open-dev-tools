import { describe, it, expect } from 'vitest';
import {
  encryptWithPassphrase,
  decryptWithPassphrase,
  opensslDecryptCommand,
  evpBytesToKey,
  OPENSSL_CIPHERS,
  KDFS,
} from '../src/openssl';
import { AesError } from '../src/codec';

function hex(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

const PASSPHRASE = 'correct horse battery staple';
const PLAINTEXT_TEXT = 'The quick brown fox jumps over the lazy dog';
const PLAINTEXT = new TextEncoder().encode(PLAINTEXT_TEXT);
const SALT_HEX = '0102030405060708';
const SALT = hex(SALT_HEX);

/**
 * Six interoperability fixtures, generated once against the local machine's
 * `openssl` 3.5.5 CLI (verified with `openssl version`), recorded here as
 * literals -- these tests never shell out.
 *
 * OpenSSL 3.5.5, when given an explicit `-S <salt>`, writes NO `Salted__`
 * header at all (confirmed directly this session): it emits only the raw
 * ciphertext. Each fixture below is therefore assembled once, outside the
 * repository, as Base64 of `"Salted__"` + the 8 salt bytes +
 * Base64-decode(the openssl output), and every fixture was independently
 * confirmed to decrypt with the exact CONFIRM command shown, which is the
 * same command `opensslDecryptCommand` generates for that cipher/kdf pair.
 *
 * MAKE (identical shape for every row, cipher/kdf/iter substituted):
 *   PASS='correct horse battery staple'
 *   printf '%s' 'The quick brown fox jumps over the lazy dog' > plain.txt
 *   openssl enc -<cipher> [-pbkdf2 -iter <N> | -md sha256 | -md md5] \
 *     -S 0102030405060708 -a -A -in plain.txt -out c.b64 -pass env:PASS
 * CONFIRM (per row, exact command shown next to it below):
 *   openssl enc -d -<cipher> [-pbkdf2 -iter <N> -md sha256 | -md sha256 | -md md5] \
 *     -a -A -in <assembled-fixture-file> -pass env:PASS
 */
const FIXTURES = {
  // MAKE: openssl enc -aes-256-cbc -pbkdf2 -iter 10000 -S 0102030405060708 -a -A -in plain.txt -out c.b64 -pass env:PASS
  // CONFIRM: openssl enc -d -aes-256-cbc -pbkdf2 -iter 10000 -md sha256 -a -A -in c-full.txt -pass env:PASS
  pbkdf2_10000: {
    cipher: 'aes-256-cbc' as const,
    kdf: 'pbkdf2' as const,
    iterations: 10000,
    base64: 'U2FsdGVkX18BAgMEBQYHCMu0XEsdjP5nVNrhGouunGngbsutjjqqTyCT5gK/eAOZeHkWD8Nz2DctvlNPqkUVxw==',
  },
  // MAKE: openssl enc -aes-256-cbc -pbkdf2 -iter 1 -S 0102030405060708 -a -A -in plain.txt -out c.b64 -pass env:PASS
  // CONFIRM: openssl enc -d -aes-256-cbc -pbkdf2 -iter 1 -md sha256 -a -A -in c-full.txt -pass env:PASS
  pbkdf2_1: {
    cipher: 'aes-256-cbc' as const,
    kdf: 'pbkdf2' as const,
    iterations: 1,
    base64: 'U2FsdGVkX18BAgMEBQYHCCJNcK5mQ2f+EQ0oWiRzN1aZlwjOmjGXbP2dYxVyx4bGzqjriSjBkoSkNV+hY32a9A==',
  },
  // MAKE: openssl enc -aes-128-cbc -pbkdf2 -iter 10000 -S 0102030405060708 -a -A -in plain.txt -out c.b64 -pass env:PASS
  // CONFIRM: openssl enc -d -aes-128-cbc -pbkdf2 -iter 10000 -md sha256 -a -A -in c-full.txt -pass env:PASS
  pbkdf2_128: {
    cipher: 'aes-128-cbc' as const,
    kdf: 'pbkdf2' as const,
    iterations: 10000,
    base64: 'U2FsdGVkX18BAgMEBQYHCHmoC72dxiBS+yC7fJ5CrWH0pXpGS11i+ypU3M+jp+lE1QOXgoZKDELb5G+xJQylhg==',
  },
  // MAKE: openssl enc -aes-256-ctr -pbkdf2 -iter 10000 -S 0102030405060708 -a -A -in plain.txt -out c.b64 -pass env:PASS
  // CONFIRM: openssl enc -d -aes-256-ctr -pbkdf2 -iter 10000 -md sha256 -a -A -in c-full.txt -pass env:PASS
  pbkdf2_ctr: {
    cipher: 'aes-256-ctr' as const,
    kdf: 'pbkdf2' as const,
    iterations: 10000,
    base64: 'U2FsdGVkX18BAgMEBQYHCBB4K0W/BN3W21qnbt6gh9E1nHtrVkIZEV1naLgjR+c98oFpIRqDTJwl4+I=',
  },
  // MAKE: openssl enc -aes-256-cbc -md sha256 -S 0102030405060708 -a -A -in plain.txt -out c.b64 -pass env:PASS
  // CONFIRM: openssl enc -d -aes-256-cbc -md sha256 -a -A -in c-full.txt -pass env:PASS
  evp_sha256: {
    cipher: 'aes-256-cbc' as const,
    kdf: 'evp-sha256' as const,
    base64: 'U2FsdGVkX18BAgMEBQYHCHtD/ejvtIarcP+UjwmqmC3PpRToA+iYfsJBYHoAGSMUQ+4t5okEBEZR4pcup9uqZA==',
  },
  // MAKE: openssl enc -aes-256-cbc -md md5 -S 0102030405060708 -a -A -in plain.txt -out c.b64 -pass env:PASS
  // CONFIRM: openssl enc -d -aes-256-cbc -md md5 -a -A -in c-full.txt -pass env:PASS
  evp_md5: {
    cipher: 'aes-256-cbc' as const,
    kdf: 'evp-md5' as const,
    base64: 'U2FsdGVkX18BAgMEBQYHCCl5Ava7Uv+9tA3Qhj3YjHb52vLEURqcl5eQCm5AMCUkR+dme6BY9MBRypJmvyljQw==',
  },
};

// The pbkdf2_10000 fixture, wrapped at 64 characters per line -- what
// `openssl enc -a` (without `-A`) writes for output this size. Line-wrapped
// with a trailing newline, exactly as the file `openssl` itself produced.
const PBKDF2_10000_WRAPPED =
  'U2FsdGVkX18BAgMEBQYHCMu0XEsdjP5nVNrhGouunGngbsutjjqqTyCT5gK/eAOZ\neHkWD8Nz2DctvlNPqkUVxw==\n';

// `openssl enc -aes-256-cbc -md sha256 -S 0102030405060708 -P -pass env:PASS`
const EVP_SHA256_KEY = 'E1109D42D441BC0BD0491F46B649B77DCE5B8523B6B19C635B652FD823F0622D';
const EVP_SHA256_IV = '6644C96E1A96DE443A7D8D579C7EB7C9';
// `openssl enc -aes-256-cbc -md md5 -S 0102030405060708 -P -pass env:PASS`
const EVP_MD5_KEY = '6F920A43E427BC52EB313ACE899B93B1F97D81751DEF5647EBAB3F3BB7D0F679';
const EVP_MD5_IV = 'E99863375E6EB096F347A8F7A07E8A27';

describe('openssl enc 3.5.5 interop fixtures', () => {
  for (const [name, fx] of Object.entries(FIXTURES)) {
    it(`${name}: decrypts to the known plaintext`, async () => {
      const opts = { cipher: fx.cipher, kdf: fx.kdf, iterations: 'iterations' in fx ? fx.iterations : undefined };
      const { plaintext, saltHex } = await decryptWithPassphrase(fx.base64, PASSPHRASE, opts);
      expect(new TextDecoder().decode(plaintext)).toBe(PLAINTEXT_TEXT);
      expect(saltHex).toBe(SALT_HEX);
    });

    it(`${name}: re-encrypting with the same salt reproduces the fixture byte for byte`, async () => {
      const opts = {
        cipher: fx.cipher,
        kdf: fx.kdf,
        iterations: 'iterations' in fx ? fx.iterations : undefined,
        salt: SALT,
      };
      const { base64 } = await encryptWithPassphrase(PLAINTEXT, PASSPHRASE, opts);
      expect(base64).toBe(fx.base64);
    });
  }

  it('the 10000-iteration fixture also decrypts wrapped at 64 characters per line', async () => {
    const { plaintext } = await decryptWithPassphrase(PBKDF2_10000_WRAPPED, PASSPHRASE, {
      cipher: 'aes-256-cbc',
      kdf: 'pbkdf2',
      iterations: 10000,
    });
    expect(new TextDecoder().decode(plaintext)).toBe(PLAINTEXT_TEXT);
  });
});

describe('EVP_BytesToKey derivation matches openssl enc -P', () => {
  it('SHA-256 variant', () => {
    const derived = evpBytesToKey(new TextEncoder().encode(PASSPHRASE), SALT, 'sha256', 32 + 16);
    expect(toHex(derived.slice(0, 32)).toUpperCase()).toBe(EVP_SHA256_KEY);
    expect(toHex(derived.slice(32)).toUpperCase()).toBe(EVP_SHA256_IV);
  });

  it('MD5 variant', () => {
    const derived = evpBytesToKey(new TextEncoder().encode(PASSPHRASE), SALT, 'md5', 32 + 16);
    expect(toHex(derived.slice(0, 32)).toUpperCase()).toBe(EVP_MD5_KEY);
    expect(toHex(derived.slice(32)).toUpperCase()).toBe(EVP_MD5_IV);
  });
});

describe('opensslDecryptCommand', () => {
  it('produces the exact documented string for all 12 cipher x kdf combinations, containing -pass env:PASS and never pass:', () => {
    for (const cipher of OPENSSL_CIPHERS) {
      for (const kdf of KDFS) {
        const command = opensslDecryptCommand({ cipher: cipher.id, kdf: kdf.id, iterations: 10000 });
        expect(command).toContain('-pass env:PASS');
        expect(command).not.toContain('pass:');
        expect(command).not.toContain(PASSPHRASE);
        if (kdf.id === 'pbkdf2') {
          expect(command).toBe(
            `openssl enc -d -${cipher.id} -pbkdf2 -iter 10000 -md sha256 -a -A -in encrypted.txt -pass env:PASS`,
          );
        } else if (kdf.id === 'evp-sha256') {
          expect(command).toBe(`openssl enc -d -${cipher.id} -md sha256 -a -A -in encrypted.txt -pass env:PASS`);
        } else {
          expect(command).toBe(`openssl enc -d -${cipher.id} -md md5 -a -A -in encrypted.txt -pass env:PASS`);
        }
      }
    }
  });
});

describe('errors', () => {
  it('wrong passphrase on the CBC fixture gives exactly the fixed message and no plaintext', async () => {
    const fx = FIXTURES.pbkdf2_10000;
    try {
      await decryptWithPassphrase(fx.base64, 'wrong passphrase entirely', {
        cipher: fx.cipher,
        kdf: fx.kdf,
        iterations: fx.iterations,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AesError);
      expect((err as AesError).message).toBe('Could not decrypt: wrong passphrase, wrong options, or damaged data.');
      expect((err as AesError).message).not.toContain('wrong passphrase entirely');
    }
  });

  it('missing Salted__ header gives the header message', async () => {
    await expect(decryptWithPassphrase('aGVsbG8gd29ybGQ=', PASSPHRASE)).rejects.toThrow(/must start with Salted__/);
  });

  it('bad Base64 names the position', async () => {
    try {
      await decryptWithPassphrase('U2FsdGVkX1!!!!', PASSPHRASE);
      expect.unreachable();
    } catch (err) {
      expect((err as AesError).message).toMatch(/position \d+/);
    }
  });

  it('iterations 0 and 10000001 are refused', async () => {
    await expect(
      encryptWithPassphrase(PLAINTEXT, PASSPHRASE, { cipher: 'aes-256-cbc', kdf: 'pbkdf2', iterations: 0 }),
    ).rejects.toThrow(/1 to 10,000,000/);
    await expect(
      encryptWithPassphrase(PLAINTEXT, PASSPHRASE, { cipher: 'aes-256-cbc', kdf: 'pbkdf2', iterations: 10_000_001 }),
    ).rejects.toThrow(/1 to 10,000,000/);
  });

  it('empty passphrase is refused on encrypt and decrypt', async () => {
    await expect(encryptWithPassphrase(PLAINTEXT, '')).rejects.toThrow(/Enter a passphrase/);
    await expect(decryptWithPassphrase(FIXTURES.pbkdf2_10000.base64, '')).rejects.toThrow(/Enter a passphrase/);
  });

  it('a fixed salt that is not 16 hex digits (8 bytes) is refused', async () => {
    await expect(encryptWithPassphrase(PLAINTEXT, PASSPHRASE, { salt: new Uint8Array(4) })).rejects.toThrow(
      /exactly 8 bytes/,
    );
  });
});

describe('secret contract', () => {
  it('JSON.stringify of every encryptWithPassphrase result excludes the passphrase', async () => {
    for (const cipher of OPENSSL_CIPHERS) {
      for (const kdf of KDFS) {
        const result = await encryptWithPassphrase(PLAINTEXT, PASSPHRASE, {
          cipher: cipher.id,
          kdf: kdf.id,
          iterations: 10000,
        });
        expect(JSON.stringify(result)).not.toContain(PASSPHRASE);
        expect(JSON.stringify(result)).not.toContain(Buffer.from(PASSPHRASE).toString('base64'));
      }
    }
  });
});

describe('round trip', () => {
  // About 2 s alone (1 MiB through every cipher and key derivation); the
  // default 5 s is too tight when the whole suite runs in parallel.
  it('every cipher x kdf, plus empty plaintext, an astral UTF-8 character, and 1 MiB of bytes', async () => {
    const cases = [new Uint8Array(0), new TextEncoder().encode('hello 𝄞 world'), new Uint8Array(1024 * 1024).fill(9)];
    for (const cipher of OPENSSL_CIPHERS) {
      for (const kdf of KDFS) {
        for (const plaintext of cases) {
          const enc = await encryptWithPassphrase(plaintext, PASSPHRASE, {
            cipher: cipher.id,
            kdf: kdf.id,
            iterations: 100,
          });
          const dec = await decryptWithPassphrase(enc.base64, PASSPHRASE, {
            cipher: cipher.id,
            kdf: kdf.id,
            iterations: 100,
          });
          expect(toHex(dec.plaintext)).toBe(toHex(plaintext));
        }
      }
    }
  }, 30_000);
});
