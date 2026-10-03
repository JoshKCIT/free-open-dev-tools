# Prints the zlib Adler-32 values and the passlib NT hashes that checksums.test.ts and md4.test.ts quote.
# Usage (inside a scratch virtual environment with passlib 1.7.4 installed): python make-zlib-passlib.py
import zlib
from passlib.hash import nthash

for s in ['', 'a', 'abc', '123456789', 'Wikipedia', 'x' * 100000]:
    print('adler32', repr(s[:12]), len(s), '%08x' % zlib.adler32(s.encode()))
for pw in ['Password', 'password', 'p\U0001F600ss', '', '\u00e9']:
    print('nthash', ascii(pw), nthash.hash(pw))
