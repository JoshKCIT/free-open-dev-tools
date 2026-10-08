#!/usr/bin/env python3
"""Records the second opinions the calculator in tools/number-base is tested against.

Run it from a scratch folder with an interpreter that has the `ziglang` package (a C compiler, clang 21.1.0):

    <scratch>/venv/Scripts/python.exe record.py --out <path to this folder>

It uses only the Python standard library besides `ziglang`, installs nothing and writes only the three recorded files
into --out: oracle8.json, wide-vectors.txt and precedence.json. The C and Python sources are this project's own (MIT);
the recorded results are facts about what the compiler and Python produce.

What it records
  oracle8.json       every (a, b) pair of 8-bit operands for 13 operations, signed and unsigned, computed by C
                     (oracle8.c) and cast back to the 8-bit type. Cells where C is undefined are marked, not compared.
  wide-vectors.txt   sampled vectors at 16, 32, 64, 128 and 256 bits. C (oraclew.c) answers where it can; Python integers
                     masked to the width (an independent implementation) answer 256 bits and every cell C leaves undefined.
                     Where both answered they must agree, or this script stops.
  precedence.json    seeded random unparenthesised chains of 2 to 6 operands over ten binary operators at uint32, int32,
                     uint64 and int64, every literal cast to the type, compiled and run. Only chains that neither divide by
                     zero nor shift out of range are kept, so C is defined for each.
"""
import argparse
import base64
import datetime
import gzip
import json
import os
import platform
import random
import subprocess
import sys
import tempfile

FLAGS = ['-std=gnu11', '-O0', '-fwrapv', '-fno-sanitize=undefined']
OPS = ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '>>>']
SEED_WIDE = 20261006
SEED_EXPR = 20261007
ROWS_PER_WIDTH = {16: 2800, 32: 2800, 64: 2400, 128: 1800, 256: 1800}
CHAINS_PER_TYPE = 600

OPS8 = ['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'ushr', 'not', 'neg']


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def compiler_version():
    out = run([sys.executable, '-m', 'ziglang', 'cc', '--version']).stdout.decode('utf-8', 'replace')
    lines = [l.strip() for l in out.replace('\r', '').split('\n') if l.strip()]
    version = lines[0]
    target = next((l for l in lines if l.startswith('Target:')), '')
    return version + (', ' + target if target else '')


def compile_c(source, exe):
    run([sys.executable, '-m', 'ziglang', 'cc'] + FLAGS + ['-o', exe, source])


def pack(raw):
    # mtime 0 keeps the bytes the same on every run.
    return base64.b64encode(gzip.compress(bytes(raw), 9, mtime=0)).decode('ascii')


# ---------------------------------------------------------------- exhaustive 8 bit

def record_oracle8(here, work, stamp, compiler):
    exe = os.path.join(work, 'oracle8.exe')
    compile_c(os.path.join(here, 'oracle8.c'), exe)
    text = run([exe]).stdout.decode('ascii').replace('\r', '')
    tables = []
    compared = 0
    undefined = 0
    for line in text.split('\n'):
        if not line:
            continue
        tag, name, data = line.split(' ')
        results = bytearray()
        mask = bytearray()
        i = 0
        while i < len(data):
            results.append(int(data[i:i + 2], 16))
            i += 2
            if i < len(data) and data[i] == '!':
                mask.append(1)
                i += 1
            else:
                mask.append(0)
        assert len(results) == 65536 and len(mask) == 65536, (tag, name)
        undefined += sum(mask)
        compared += 65536 - sum(mask)
        tables.append({'type': tag, 'op': name, 'results': pack(results), 'undefined': pack(mask)})
    assert len(tables) == 26
    doc = {
        'recordedAt': stamp,
        'compiler': compiler,
        'flags': ' '.join(FLAGS),
        'source': 'oracle8.c',
        'cells': {'compared': compared, 'undefined': undefined},
        'layout': 'each table: 65,536 cells, a-major (a = row, b = column), a and b are the 8-bit patterns 0 to 255; results holds one byte per cell, undefined holds 1 where C leaves the cell undefined; both gzip then base64',
        'tables': tables,
    }
    with open(os.path.join(here, 'oracle8.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n')
        for key in ['recordedAt', 'compiler', 'flags', 'source', 'cells', 'layout']:
            f.write('  %s: %s,\n' % (json.dumps(key), json.dumps(doc[key])))
        f.write('  "tables": [\n')
        f.write(',\n'.join('    ' + json.dumps(t) for t in tables))
        f.write('\n  ]\n}\n')
    return compared, undefined


# ---------------------------------------------------------------- the masked-integer reference

def to_val(x, w, signed):
    return x - (1 << w) if signed and x >> (w - 1) else x


def wrap(v, w, signed):
    return to_val(v & ((1 << w) - 1), w, signed)


def tdiv(a, b):
    q = abs(a) // abs(b)
    return q if (a < 0) == (b < 0) else -q


def ref(w, signed, op, a, b):
    """a and b are values in the type's own range. Returns None where the calculator must refuse."""
    if op == '+':
        return wrap(a + b, w, signed)
    if op == '-':
        return wrap(a - b, w, signed)
    if op == '*':
        return wrap(a * b, w, signed)
    if op == '/':
        return None if b == 0 else wrap(tdiv(a, b), w, signed)
    if op == '%':
        return None if b == 0 else wrap(a - b * tdiv(a, b), w, signed)
    if op == '&':
        return wrap(a & b, w, signed)
    if op == '|':
        return wrap(a | b, w, signed)
    if op == '^':
        return wrap(a ^ b, w, signed)
    if b < 0:
        return None
    if op == '<<':
        return 0 if b >= w else wrap(a << b, w, signed)
    if op == '>>':
        return (-1 if a < 0 else 0) if b >= w else wrap(a >> b, w, signed)
    if op == '>>>':
        return 0 if b >= w else wrap((a & ((1 << w) - 1)) >> b, w, signed)
    raise ValueError(op)


# ---------------------------------------------------------------- sampled wide vectors

def edge_patterns(w):
    m = (1 << w) - 1
    s = {0, 1, m, 1 << (w - 1), (1 << (w - 1)) - 1, m - 1, w - 1, w}
    return sorted(x & m for x in s)


def record_wide(here, work, stamp, compiler):
    rng = random.Random(SEED_WIDE)
    rows = []
    for w in (16, 32, 64, 128, 256):
        edges = edge_patterns(w)
        n_edge = len(edges) * len(edges)
        extra = max(8, ROWS_PER_WIDTH[w] // (2 * len(OPS)) - n_edge)
        for signed in (0, 1):
            for op in OPS:
                pairs = [(a, b) for a in edges for b in edges]
                if op in ('<<', '>>', '>>>'):
                    pairs += [(rng.getrandbits(w), rng.getrandbits(w)) for _ in range(extra // 2)]
                    pairs += [(rng.getrandbits(w), rng.randrange(0, w)) for _ in range(extra - extra // 2)]
                else:
                    pairs += [(rng.getrandbits(w), rng.getrandbits(w)) for _ in range(extra)]
                for a, b in pairs:
                    rows.append((w, signed, op, a, b))
    seen = set()
    unique = []
    for r in rows:
        if r not in seen:
            seen.add(r)
            unique.append(r)
    rows = unique

    exe = os.path.join(work, 'oraclew.exe')
    compile_c(os.path.join(here, 'oraclew.c'), exe)
    nl = chr(10)
    feed = nl.join('%d %d %s %0*x %0*x' % (w, s, op, w // 4, a, w // 4, b) for (w, s, op, a, b) in rows if w <= 128)
    out = run([exe], input=feed.encode('ascii')).stdout.decode('ascii').replace('\r', '').strip().split(nl)
    c_answer = {}
    for line in out:
        p = line.split(' ')
        c_answer[(int(p[0]), int(p[1]), p[2], p[3], p[4])] = None if p[5] == 'SKIP' else int(p[5], 16)

    lines = []
    counts = {'c': 0, 'python': 0, 'refused': 0}
    disagree = []
    for (w, s, op, a, b) in rows:
        av, bv = to_val(a, w, s), to_val(b, w, s)
        r = ref(w, s, op, av, bv)
        ah = '%0*x' % (w // 4, a)
        bh = '%0*x' % (w // 4, b)
        source = 'python'
        if w <= 128:
            c = c_answer[(w, s, op, ah, bh)]
            if c is not None:
                source = 'c'
                if r is None or r != to_val(c, w, s):
                    disagree.append((w, s, op, av, bv, r, to_val(c, w, s)))
        if source == 'c':
            counts['c'] += 1
        else:
            counts['python'] += 1
        if r is None:
            counts['refused'] += 1
            res = '!'
        else:
            res = '%0*x' % (w // 4, r & ((1 << w) - 1))
        lines.append('%d %s %s %s %s %s %s' % (w, 's' if s else 'u', op, ah, bh, res, source))
    if disagree:
        for d in disagree[:10]:
            print('DISAGREE', d, file=sys.stderr)
        raise SystemExit('C and the Python reference disagree on %d cells' % len(disagree))

    header = [
        '# Sampled fixed-width vectors for the calculator in tools/number-base (recorded by record.py).',
        '# C: %s; flags %s' % (compiler, ' '.join(FLAGS)),
        '# Python %s integers masked to the width answer 256 bits and every cell C leaves undefined; where both answered they agree.' % platform.python_version(),
        '# seed %d; recordedAt %s' % (SEED_WIDE, stamp),
        '# columns: width, s (signed) or u (unsigned), operator, a and b as hexadecimal bit patterns of the width,',
        '#          result as a hexadecimal bit pattern or ! where the calculator refuses (zero divisor or negative shift count),',
        '#          source c (clang) or python.',
    ]
    with open(os.path.join(here, 'wide-vectors.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(nl.join(header + lines) + nl)
    return len(lines), counts


# ---------------------------------------------------------------- precedence corpus

TYPES = {
    'uint32': (32, 0, 'uint32_t', 'uint32_t'),
    'int32': (32, 1, 'int32_t', 'uint32_t'),
    'uint64': (64, 0, 'uint64_t', 'uint64_t'),
    'int64': (64, 1, 'int64_t', 'uint64_t'),
}
BIN = ['|', '^', '&', '<<', '>>', '+', '-', '*', '/', '%']
OPERANDS = [0, 1, 2, 3, 5, 7, 8, 13, 100, 255, 1000, 65535, 2**31 - 1, 123456789]
PREC = {'|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6}


class Excluded(Exception):
    pass


def eval_chain(toks, w, signed):
    """C precedence, left associative, every step wrapped. Raises Excluded where C would not be defined."""
    pos = [0]

    def step(op, a, b):
        if op in ('/', '%') and b == 0:
            raise Excluded()
        if op in ('<<', '>>') and (b < 0 or b >= w):
            raise Excluded()
        if signed and op in ('/', '%') and b == -1 and a == -(1 << (w - 1)):
            raise Excluded()
        return ref(w, signed, op, a, b)

    def expr(minimum):
        left = toks[pos[0]]
        pos[0] += 1
        while pos[0] < len(toks) and PREC[toks[pos[0]]] >= minimum:
            op = toks[pos[0]]
            pos[0] += 1
            right = expr(PREC[op] + 1)
            left = step(op, left, right)
        return left

    return expr(1)


def record_precedence(here, work, stamp, compiler):
    rng = random.Random(SEED_EXPR)
    chains = []
    for name, (w, signed, ctype, utype) in TYPES.items():
        for _ in range(CHAINS_PER_TYPE):
            n = rng.randint(2, 6)
            toks = []
            for i in range(n):
                toks.append(rng.choice(OPERANDS))
                if i < n - 1:
                    toks.append(rng.choice(BIN))
            try:
                expected = eval_chain(toks, w, signed)
            except Excluded:
                continue
            chains.append((name, toks, expected))
    nl = chr(10)
    bs = chr(92)
    body = ['#include <stdio.h>', '#include <stdint.h>', 'int main(void) {']
    for i, (name, toks, expected) in enumerate(chains):
        w, signed, ctype, utype = TYPES[name]
        text = ' '.join(('((%s)%d)' % (ctype, t)) if isinstance(t, int) else t for t in toks)
        body.append('  { %s r = %s; printf("%%d %%llx%sn", %d, (unsigned long long)(%s)r); }' % (ctype, text, bs, i, utype))
    body.append('  return 0;')
    body.append('}')
    src = os.path.join(work, 'expr.c')
    with open(src, 'w', encoding='ascii', newline='\n') as f:
        f.write(nl.join(body) + nl)
    exe = os.path.join(work, 'expr.exe')
    compile_c(src, exe)
    out = run([exe]).stdout.decode('ascii').replace('\r', '').strip().split(nl)
    got = {}
    for line in out:
        i, hexv = line.split(' ')
        got[int(i)] = int(hexv, 16)
    rows = []
    bad = []
    for i, (name, toks, expected) in enumerate(chains):
        w, signed, ctype, utype = TYPES[name]
        mask = (1 << w) - 1
        if got[i] != (expected & mask):
            bad.append((name, toks, got[i], expected & mask))
        rows.append({'type': name, 'expr': ' '.join(str(t) for t in toks), 'result': '%x' % got[i]})
    if bad:
        for b in bad[:10]:
            print('DISAGREE', b, file=sys.stderr)
        raise SystemExit('C and the Python reference disagree on %d expressions' % len(bad))
    with open(os.path.join(here, 'precedence.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('{\n')
        f.write('  "recordedAt": %s,\n' % json.dumps(stamp))
        f.write('  "compiler": %s,\n' % json.dumps(compiler))
        f.write('  "flags": %s,\n' % json.dumps(' '.join(FLAGS)))
        f.write('  "seed": %d,\n' % SEED_EXPR)
        f.write('  "note": "Unparenthesised chains of 2 to 6 operands; every literal is cast to the type in C; result is the hexadecimal bit pattern of the width.",\n')
        f.write('  "rows": [\n')
        f.write(',\n'.join('    ' + json.dumps(r) for r in rows))
        f.write('\n  ]\n}\n')
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, help='the folder that holds oracle8.c and oraclew.c and receives the recordings')
    args = parser.parse_args()
    here = os.path.abspath(args.out)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    compiler = compiler_version()
    with tempfile.TemporaryDirectory() as work:
        compared, undefined = record_oracle8(here, work, stamp, compiler)
        print('oracle8.json: %d cells compared, %d undefined' % (compared, undefined))
        n, counts = record_wide(here, work, stamp, compiler)
        print('wide-vectors.txt: %d rows %s' % (n, counts))
        m = record_precedence(here, work, stamp, compiler)
        print('precedence.json: %d expressions' % m)
    print('compiler:', compiler)
    print('python:', platform.python_version())


if __name__ == '__main__':
    main()
