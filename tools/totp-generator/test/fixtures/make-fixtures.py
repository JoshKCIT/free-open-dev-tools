#!/usr/bin/env python3
"""Records second-opinion cases from pyotp, an independent mature implementation of HOTP, TOTP and the otpauth link.

Run from a scratch virtual environment that holds only pyotp 2.10.0 (nothing is installed into the machine's Python):

    python -m venv <scratch>/venv-14
    <scratch>/venv-14/Scripts/python -m pip install pyotp==2.10.0
    <scratch>/venv-14/Scripts/python tools/totp-generator/test/fixtures/make-fixtures.py > tools/totp-generator/test/fixtures/pyotp-cases.ts

It prints the TypeScript module the tests import: 60 random TOTP cases, 20 HOTP cases (counters from 0 up to 2^64 - 1) and
four otpauth links. Unit tests never run Python: the printed literals are committed. Seeds are written as hexadecimal,
and the links carry a {SEED} marker where the Base32 text of the seed goes, so no file holds a Base32 secret next to the
word that secret scanners look for.
"""
import base64
import datetime
import hashlib
import importlib.metadata
import json
import random
import sys

import pyotp

ALGORITHMS = {"SHA1": hashlib.sha1, "SHA256": hashlib.sha256, "SHA512": hashlib.sha512}
UTC = datetime.timezone.utc


def b32(seed: bytes) -> str:
    """Base32 of the seed as Python writes it, without padding (the form an otpauth link carries)."""
    return base64.b32encode(seed).decode("ascii").rstrip("=")


def random_bytes(n: int) -> bytes:
    return bytes(random.getrandbits(8) for _ in range(n))


def totp_cases(count: int):
    cases = []
    names = list(ALGORITHMS)
    for _ in range(count):
        seed = random_bytes(random.randint(10, 49))
        algorithm = random.choice(names)
        digits = random.choice([6, 7, 8])
        period = random.choice([15, 30, 60])
        seconds = random.randint(0, 4_000_000_000)
        generator = pyotp.TOTP(b32(seed), digits=digits, digest=ALGORITHMS[algorithm], interval=period)
        # A time zone aware time takes pyotp's exact UTC path (a naive time goes through the local zone).
        code = generator.at(datetime.datetime.fromtimestamp(seconds, UTC))
        cases.append(
            {
                "seedHex": seed.hex(),
                "seedB32": b32(seed),
                "algorithm": algorithm,
                "digits": digits,
                "period": period,
                "seconds": seconds,
                "code": code,
            }
        )
    return cases


def hotp_cases():
    counters = [0, 1, 2**31 - 1, 2**32 - 1, 2**32, 2**53 - 1, 2**53, 2**63, 2**64 - 1]
    counters += [random.randint(0, 2**48) for _ in range(11)]
    names = list(ALGORITHMS)
    cases = []
    for counter in counters:
        seed = random_bytes(random.randint(16, 40))
        algorithm = random.choice(names)
        digits = random.choice([6, 7, 8])
        generator = pyotp.HOTP(b32(seed), digits=digits, digest=ALGORITHMS[algorithm])
        cases.append(
            {
                "seedHex": seed.hex(),
                "algorithm": algorithm,
                "digits": digits,
                "counter": str(counter),
                "code": generator.at(counter),
            }
        )
    return cases


def link_cases():
    """Four links: plain, an issuer with a space, a colon and reserved characters, HOTP with a counter, and non-ASCII with SHA512."""
    cases = []

    seed = random_bytes(20)
    totp = pyotp.TOTP(b32(seed))
    cases.append(
        {
            "title": "plain",
            "seedHex": seed.hex(),
            "options": {"type": "totp", "issuer": "", "account": "alice@example.com", "algorithm": "SHA1", "digits": 6, "period": 30, "counter": "0"},
            "uri": totp.provisioning_uri(name="alice@example.com"),
        }
    )

    seed = random_bytes(20)
    issuer = "ACME Co: R&D (EU) !*'"
    account = "Jo O'Brien+test@example.com"
    totp = pyotp.TOTP(b32(seed), digits=7, interval=45)
    cases.append(
        {
            "title": "issuer with a space, a colon and reserved characters",
            "seedHex": seed.hex(),
            "options": {"type": "totp", "issuer": issuer, "account": account, "algorithm": "SHA1", "digits": 7, "period": 45, "counter": "0"},
            "uri": totp.provisioning_uri(name=account, issuer_name=issuer),
        }
    )

    seed = random_bytes(20)
    hotp = pyotp.HOTP(b32(seed))
    cases.append(
        {
            "title": "HOTP with a counter",
            "seedHex": seed.hex(),
            "options": {"type": "hotp", "issuer": "Example", "account": "bob", "algorithm": "SHA1", "digits": 6, "period": 30, "counter": "7"},
            "uri": hotp.provisioning_uri(name="bob", initial_count=7, issuer_name="Example"),
        }
    )

    seed = random_bytes(64)
    issuer = "Café Ünïcode"
    account = "zoë@example.com"
    totp = pyotp.TOTP(b32(seed), digits=8, digest=hashlib.sha512, interval=60)
    cases.append(
        {
            "title": "non-ASCII with SHA512",
            "seedHex": seed.hex(),
            "options": {"type": "totp", "issuer": issuer, "account": account, "algorithm": "SHA512", "digits": 8, "period": 60, "counter": "0"},
            "uri": totp.provisioning_uri(name=account, issuer_name=issuer),
        }
    )

    for case in cases:
        seed_b32 = b32(bytes.fromhex(case["seedHex"]))
        # The Base32 text of the seed becomes a marker, so the file holds no secret-shaped value.
        assert case["uri"].count(seed_b32) == 1
        case["uri"] = case["uri"].replace(seed_b32, "{SEED}")
    return cases


def main() -> None:
    random.seed(14050)
    print("// Recorded by tools/totp-generator/test/fixtures/make-fixtures.py with pyotp %s (see README.md). Do not edit by hand." % importlib.metadata.version("pyotp"))
    print()
    print("export interface TotpCase { seedHex: string; seedB32: string; algorithm: 'SHA1' | 'SHA256' | 'SHA512'; digits: 6 | 7 | 8; period: number; seconds: number; code: string }")
    print("export interface HotpCase { seedHex: string; algorithm: 'SHA1' | 'SHA256' | 'SHA512'; digits: 6 | 7 | 8; counter: string; code: string }")
    print("export interface LinkCase { title: string; seedHex: string; options: { type: 'totp' | 'hotp'; issuer: string; account: string; algorithm: 'SHA1' | 'SHA256' | 'SHA512'; digits: 6 | 7 | 8; period: number; counter: string }; uri: string }")
    print()
    print("export const PYOTP_VERSION = %s;" % json.dumps(importlib.metadata.version("pyotp")))
    print("export const TOTP_CASES: TotpCase[] = %s;" % json.dumps(totp_cases(60), indent=2))
    print("export const HOTP_CASES: HotpCase[] = %s;" % json.dumps(hotp_cases(), indent=2))
    print("/** The Base32 text of the seed goes where {SEED} is. */")
    print("export const LINK_CASES: LinkCase[] = %s;" % json.dumps(link_cases(), indent=2, ensure_ascii=True))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    main()
