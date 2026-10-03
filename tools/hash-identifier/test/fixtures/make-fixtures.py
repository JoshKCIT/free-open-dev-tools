#!/usr/bin/env python3
"""Records the corpus of real hash strings that test/corpus.test.ts identifies.

Every string is made by an independent generator: the OpenSSL command line (passwd), passlib, argon2-cffi, Werkzeug,
Django, Python's hashlib and zlib, and the OpenSSL digest command for RIPEMD-160. The generators are not part of this
repository and nothing here is a test of the code under test: the expected rule of each string is the format its
generator documents.

Run it from a scratch virtual environment (never the machine's own Python), with OpenSSL on the path:

    python -m venv venv-14
    venv-14/bin/python -m pip install passlib==1.7.4 bcrypt==4.0.1 argon2-cffi Werkzeug Django
    venv-14/bin/python make-fixtures.py            # one JSON object per line: { string, generator, rule }
    venv-14/bin/python make-fixtures.py --ts       # the same entries as the text of corpus.ts

Salts are random, so a run gives different strings; the committed corpus.ts is one recorded run. The text that was hashed
is one fixed short sample (INPUT_TEXT) and is never written to the output.
"""
import base64
import hashlib
import json
import subprocess
import sys
import warnings
import zlib

warnings.filterwarnings('ignore')

import argon2 as argon2_cffi  # noqa: E402
import bcrypt as pyca_bcrypt  # noqa: E402
import passlib  # noqa: E402
from passlib import hash as H  # noqa: E402
from importlib.metadata import version as package_version  # noqa: E402
from werkzeug.security import generate_password_hash  # noqa: E402

INPUT_TEXT = 'password'

PASSLIB = 'passlib ' + passlib.__version__
OPENSSL = subprocess.run(['openssl', 'version'], capture_output=True, text=True).stdout.strip().split(' (')[0]
ARGON2 = 'argon2-cffi ' + argon2_cffi.__version__
WERKZEUG = 'Werkzeug ' + package_version('werkzeug')
PYTHON = 'Python ' + sys.version.split()[0] + ' hashlib'

entries = []


def add(string, generator, rule):
    entries.append({'string': string, 'generator': generator, 'rule': rule})


# 1. OpenSSL passwd (salt fixed so the layout is easy to read)
for flag, label, rule in [('-1', 'md5crypt', 'md5crypt'), ('-5', 'sha256crypt', 'sha256crypt'), ('-6', 'sha512crypt', 'sha512crypt'), ('-apr1', 'apr1', 'apr1')]:
    out = subprocess.run(['openssl', 'passwd', flag, '-salt', 'saltsalt', INPUT_TEXT], capture_output=True, text=True).stdout.strip()
    add(out, OPENSSL + ' passwd ' + flag, rule)

# 2. passlib: (class name, rule, extra arguments)
PASSLIB_CASES = [
    ('bcrypt', 'bcrypt', {}),
    ('phpass', 'phpass', {}),
    ('md5_crypt', 'md5crypt', {}),
    ('sha256_crypt', 'sha256crypt', {}),
    ('sha512_crypt', 'sha512crypt', {}),
    ('sha1_crypt', 'sha1crypt', {}),
    ('sun_md5_crypt', 'sunmd5', {}),
    ('des_crypt', 'descrypt', {}),
    ('bsdi_crypt', 'bsdicrypt', {}),
    ('bigcrypt', 'bigcrypt', {}),
    ('apr_md5_crypt', 'apr1', {}),
    ('pbkdf2_sha1', 'pbkdf2-sha1', {}),
    ('pbkdf2_sha256', 'pbkdf2-sha256', {}),
    ('pbkdf2_sha512', 'pbkdf2-sha512', {}),
    ('scrypt', 'scrypt-phc', {}),
    ('argon2', 'argon2id', {}),
    ('bcrypt_sha256', 'bcrypt-sha256', {}),
    ('ldap_salted_sha1', 'ldap-ssha', {}),
    ('ldap_sha1', 'ldap-sha', {}),
    ('ldap_md5', 'ldap-md5', {}),
    ('ldap_salted_md5', 'ldap-smd5', {}),
    ('ldap_md5_crypt', 'ldap-crypt/md5crypt', {}),
    ('ldap_sha512_crypt', 'ldap-crypt/sha512crypt', {}),
    ('mysql323', 'mysql323', {}),
    ('mysql41', 'mysql41', {}),
    ('postgres_md5', 'pg-md5', {'user': 'scott'}),
    ('oracle11', 'oracle11', {}),
    ('oracle10', 'oracle10', {'user': 'scott'}),
    ('msdcc', None, {'user': 'scott'}),
    ('msdcc2', None, {'user': 'scott'}),
    ('nthash', 'ntlm', {}),
    ('lmhash', 'lm', {}),
    ('django_pbkdf2_sha256', 'django-pbkdf2-sha256', {}),
    ('django_pbkdf2_sha1', 'django-pbkdf2-sha1', {}),
    ('django_bcrypt', 'django-bcrypt', {}),
    ('django_bcrypt_sha256', 'django-bcrypt-sha256', {}),
    ('django_salted_sha1', 'django-sha1', {}),
    ('django_salted_md5', 'django-md5', {}),
    ('django_des_crypt', 'django-crypt', {}),
    ('atlassian_pbkdf2_sha1', 'ldap-pkcs5s2', {}),
    ('cta_pbkdf2_sha1', 'p5k2', {}),
    ('dlitz_pbkdf2_sha1', 'p5k2', {}),
    ('grub_pbkdf2_sha512', None, {}),
    ('scram', 'scram', {}),
    ('ldap_pbkdf2_sha256', 'ldap-pbkdf2-sha256', {}),
    ('ldap_pbkdf2_sha512', 'ldap-pbkdf2-sha512', {}),
    ('ldap_pbkdf2_sha1', 'ldap-pbkdf2-sha1', {}),
    ('ldap_bcrypt', 'ldap-crypt/bcrypt', {}),
    ('hex_md5', 'md5', {}),
    ('hex_sha1', 'sha1', {}),
    ('hex_sha256', 'sha256', {}),
    ('hex_sha512', 'sha512', {}),
    ('cisco_type7', None, {}),
    ('cisco_pix', None, {}),
    ('cisco_asa', None, {}),
    ('fshp', None, {}),
]
for name, rule, extra in PASSLIB_CASES:
    add(getattr(H, name).hash(INPUT_TEXT, **extra), PASSLIB + ' ' + name, rule)

# 3. argon2-cffi and Werkzeug
add(argon2_cffi.PasswordHasher().hash(INPUT_TEXT), ARGON2 + ' id', 'argon2id')
add(argon2_cffi.PasswordHasher(type=argon2_cffi.Type.I).hash(INPUT_TEXT), ARGON2 + ' i', 'argon2i')
add(argon2_cffi.PasswordHasher(type=argon2_cffi.Type.D).hash(INPUT_TEXT), ARGON2 + ' d', 'argon2d')
add(generate_password_hash(INPUT_TEXT), WERKZEUG + ' default', 'werkzeug-scrypt')
add(generate_password_hash(INPUT_TEXT, method='pbkdf2:sha256'), WERKZEUG + ' pbkdf2:sha256', 'werkzeug-pbkdf2')
add(generate_password_hash(INPUT_TEXT, method='scrypt'), WERKZEUG + ' scrypt', 'werkzeug-scrypt')

# 4. Python hashlib, zlib and the OpenSSL digest command
data = INPUT_TEXT.encode()
HEX_RULES = {
    'md5': 'md5', 'sha1': 'sha1', 'sha224': 'sha224', 'sha256': 'sha256', 'sha384': 'sha384', 'sha512': 'sha512',
    'sha3_224': 'sha3-224', 'sha3_256': 'sha3-256', 'sha3_384': 'sha3-384', 'sha3_512': 'sha3-512',
    'blake2b': 'blake2b', 'blake2s': 'blake2s', 'sha512_224': 'sha512-224', 'sha512_256': 'sha512-256',
}
for name, rule in HEX_RULES.items():
    add(hashlib.new(name, data).hexdigest(), PYTHON + ' ' + name, rule)
ripemd = subprocess.run(['openssl', 'dgst', '-ripemd160', '-provider', 'legacy', '-provider', 'default'], input=data, capture_output=True).stdout.decode().split('= ')[-1].strip()
add(ripemd, OPENSSL + ' dgst -ripemd160', 'ripemd160')
for name, rule in [('md5', 'b64-md5'), ('sha1', 'b64-sha1'), ('sha256', 'b64-sha256'), ('sha512', 'b64-sha512')]:
    digest = hashlib.new(name, data).digest()
    add(base64.b64encode(digest).decode(), PYTHON + ' ' + name + ' then base64.b64encode', rule)
    add(base64.urlsafe_b64encode(digest).decode().rstrip('='), PYTHON + ' ' + name + ' then base64.urlsafe_b64encode without padding', rule)
add('%08x' % zlib.crc32(data), 'Python ' + sys.version.split()[0] + ' zlib crc32', 'crc32')
add('%08x' % zlib.adler32(data), 'Python ' + sys.version.split()[0] + ' zlib adler32', 'adler32')

# 5. Django's own output (second opinion for the Django rules; listed apart from the 91 above)
django_entries = []
try:
    import django
    from django.conf import settings
    from django.contrib.auth.hashers import make_password

    settings.configure(PASSWORD_HASHERS=[
        'django.contrib.auth.hashers.PBKDF2PasswordHasher',
        'django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher',
        'django.contrib.auth.hashers.Argon2PasswordHasher',
        'django.contrib.auth.hashers.BCryptSHA256PasswordHasher',
        'django.contrib.auth.hashers.BCryptPasswordHasher',
        'django.contrib.auth.hashers.ScryptPasswordHasher',
    ])
    for hasher, rule in [('pbkdf2_sha256', 'django-pbkdf2-sha256'), ('pbkdf2_sha1', 'django-pbkdf2-sha1'), ('argon2', 'django-argon2'),
                         ('bcrypt_sha256', 'django-bcrypt-sha256'), ('bcrypt', 'django-bcrypt'), ('scrypt', 'django-scrypt')]:
        django_entries.append({'string': make_password(INPUT_TEXT, hasher=hasher), 'generator': 'Django ' + django.get_version() + ' ' + hasher, 'rule': rule})
except ImportError:
    pass

assert len(entries) == 91, len(entries)

if '--ts' in sys.argv:
    sys.stdout.reconfigure(newline='\n')  # LF endings on every machine

    def lit(value):
        return 'null' if value is None else "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"

    def rows(items):
        return ''.join('  { string: %s, generator: %s, rule: %s },\n' % (lit(i['string']), lit(i['generator']), lit(i['rule'])) for i in items)

    sys.stdout.write('/** Recorded by make-fixtures.py: see README.md. Each entry is one real string, the generator that made it and the id of the rule\n'
                     ' * its documented format maps to (null: a format the rule table does not cover, see NOT_COVERED_IN_TABLE in corpus.test.ts). */\n')
    sys.stdout.write('export interface CorpusEntry {\n  string: string;\n  generator: string;\n  rule: string | null;\n}\n\n')
    sys.stdout.write('export const CORPUS: CorpusEntry[] = [\n' + rows(entries) + '];\n\n')
    sys.stdout.write('/** Strings made by Django itself, recorded as a second opinion for the Django rules. */\n')
    sys.stdout.write('export const DJANGO_CORPUS: CorpusEntry[] = [\n' + rows(django_entries) + '];\n')
else:
    for item in entries + django_entries:
        print(json.dumps(item))
