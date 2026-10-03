# Rebuilds nist-shake.ts from the two NIST example PDFs. Usage: python make-nist-shake.py <folder holding SHAKE128_Msg0.pdf and SHAKE256_Msg0.pdf> > nist-shake.ts
# Needs pypdf (6.19.0 was used, in a scratch virtual environment).
import pypdf, re, sys
sys.stdout.reconfigure(newline='\n')
out = []
out.append("// The first 200 bytes of the output of the two NIST example files for the empty message, SHAKE128_Msg0.pdf and")
out.append("// SHAKE256_Msg0.pdf, from")
out.append("// https://csrc.nist.gov/CSRC/media/Projects/Cryptographic-Standards-and-Guidelines/documents/examples/ (fetched 2026-10-03).")
out.append("// Each file prints 512 bytes after the words Output val is; the text was extracted with pypdf 6.19.0 on Python 3.14.3")
out.append("// and the hexadecimal bytes copied here in lower case, 40 bytes to a line.")
for f, name in [('SHAKE128_Msg0', 'NIST_SHAKE128_EMPTY_200'), ('SHAKE256_Msg0', 'NIST_SHAKE256_EMPTY_200')]:
    r = pypdf.PdfReader(sys.argv[1] + '/%s.pdf' % f)
    t = ' '.join(p.extract_text() for p in r.pages)
    i = t.find('Output val is')
    seg = t[i + 13:]
    hexs = re.findall(r'\b[0-9A-F]{2}\b', seg)
    assert len(hexs) == 512, len(hexs)
    h = ''.join(hexs[:200]).lower()
    out.append("export const %s =" % name)
    chunks = [h[k:k + 80] for k in range(0, len(h), 80)]
    for n, c in enumerate(chunks):
        out.append("  '%s'%s" % (c, ';' if n == len(chunks) - 1 else ' +'))
sys.stdout.write('\n'.join(out) + '\n')
