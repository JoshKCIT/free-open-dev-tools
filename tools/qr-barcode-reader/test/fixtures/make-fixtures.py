"""Writes independent-codes.ts: barcode and QR images made by an independent writer, as base64 literals.

The writer is BWIPP (Barcode Writer in Pure PostScript) driven through treepoem, with Ghostscript turning the PostScript
into pixels. Nothing here uses this repository's own writers or reading engine, so what the reader is asked to read was
made by someone else. Three more images are degraded copies in the style of a photograph of a screen (perspective tilt,
blur, low contrast, vignette, moire, noise, JPEG at quality 45), made with a fixed seed so the script is repeatable.

Run it from a scratch virtual environment, never the machine's own Python, with Ghostscript on the PATH:

    python -m venv <scratch>/venv-15b
    <scratch>/venv-15b/bin/pip install treepoem==3.29.0 pillow==12.3.0 numpy==2.5.3
    <scratch>/venv-15b/bin/python make-fixtures.py

The file it writes is committed (the unit tests never run this script; CI has other versions of these tools).
"""

import base64
import datetime
import importlib.metadata
import io
import json
import os
import random
import subprocess
import sys

import numpy as np
import treepoem
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

random.seed(7)
np.random.seed(7)

HERE = os.path.dirname(os.path.abspath(__file__))

# name, treepoem barcode type, data written, treepoem options, symbology name the reader should give (the reading
# engine's own enum name), the text the reader should give. A Code 93 symbol needs its two check characters to be a
# valid symbol, which BWIPP writes only when asked (includecheck); the same symbol without them is kept as a negative
# case. UPC-A is an EAN-13 symbol with an implied leading zero (GS1 General Specifications), and a UPC-E symbol is
# read as the 13 digit code it expands to.
CODES = [
    ("qr", "qrcode", "Hello, world", {"eclevel": "M"}, "QRCode", "Hello, world"),
    ("code128", "code128", "Hello-123", {}, "Code128", "Hello-123"),
    ("code39", "code39", "HELLO-39", {}, "Code39", "HELLO-39"),
    ("ean13", "ean13", "5901234123457", {}, "EAN13", "5901234123457"),
    ("ean8", "ean8", "96385074", {}, "EAN8", "96385074"),
    ("upca", "upca", "036000291452", {}, "EAN13", "0036000291452"),
    ("itf", "interleaved2of5", "1234567890", {}, "ITF", "1234567890"),
    ("codabar", "rationalizedCodabar", "A123456B", {}, "Codabar", "A123456B"),
    ("datamatrix", "datamatrix", "Hello DataMatrix", {}, "DataMatrix", "Hello DataMatrix"),
    ("pdf417", "pdf417", "Hello PDF417 world", {}, "PDF417", "Hello PDF417 world"),
    ("aztec", "azteccode", "Hello Aztec", {}, "Aztec", "Hello Aztec"),
    ("code93", "code93", "CODE93", {"includecheck": True}, "Code93", "CODE93"),
    ("code93-no-check", "code93", "CODE93", {}, "Code93", "CODE93"),
    ("microqr", "microqrcode", "12345", {}, "MicroQRCode", "12345"),
    ("upce", "upce", "01234565", {}, "UPCE", "0012345000065"),
]

# The images the photograph-of-a-screen treatment is applied to, by name.
SCREEN_PHOTO_BASES = ["qr", "code128", "ean13"]


def png_bytes(image):
    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def perspective(image, tilt):
    w, h = image.size
    dx = int(w * tilt)
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    dst = [(dx, 0), (w - dx // 3, dx // 2), (w - dx, h - dx // 2), (0, h)]
    rows = [[x, y, 1, 0, 0, 0, -u * x, -u * y] for (x, y), (u, v) in zip(src, dst)]
    rows += [[0, 0, 0, x, y, 1, -v * x, -v * y] for (x, y), (u, v) in zip(src, dst)]
    target = np.array([u for (u, v) in dst] + [v for (u, v) in dst])
    coeffs = np.linalg.lstsq(np.array(rows), target, rcond=None)[0]
    return image.transform((w, h), Image.PERSPECTIVE, tuple(coeffs), Image.BICUBIC, fillcolor=255)


def noise(image, sigma):
    a = np.asarray(image).astype(np.float32)
    a += np.random.normal(0, sigma, a.shape)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def screen_photo(image):
    image = ImageOps.expand(image, border=40, fill=200)
    image = image.resize((int(image.width * 0.8) + 80, int(image.height * 0.8) + 80), Image.BILINEAR)
    image = perspective(image, 0.06)
    image = image.filter(ImageFilter.GaussianBlur(1.1))
    image = ImageEnhance.Contrast(image).enhance(0.6)
    a = np.asarray(image).astype(np.float32)
    h, w = a.shape
    yy, xx = np.mgrid[0:h, 0:w]
    vignette = 1 - 0.25 * (((xx - w / 2) / w) ** 2 + ((yy - h / 2) / h) ** 2) * 4
    moire = 8 * np.sin(xx * 1.9) * np.sin(yy * 1.7)
    a = a * vignette + moire + 20
    return noise(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), 10)


def ghostscript_version():
    for name in ("gs", "gswin64c"):
        try:
            return subprocess.run([name, "--version"], capture_output=True, text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            continue
    return "unknown"


def literal(value):
    return json.dumps(value, ensure_ascii=True)


def main():
    images = {}
    lines = []
    lines.append("/**")
    lines.append(" * Barcode and QR images written by BWIPP (Barcode Writer in Pure PostScript) through treepoem and rendered by")
    lines.append(" * Ghostscript, as base64 PNG literals, plus three degraded copies in the style of a photograph of a screen.")
    lines.append(" * Written by make-fixtures.py on " + datetime.date.today().isoformat() + " with treepoem " + importlib.metadata.version("treepoem") + ",")
    lines.append(" * Pillow " + importlib.metadata.version("pillow") + ", numpy " + importlib.metadata.version("numpy") + ", Ghostscript " + ghostscript_version() + " and Python " + sys.version.split()[0] + ".")
    lines.append(" * Do not edit by hand: change the script and run it again.")
    lines.append(" */")
    lines.append("")
    lines.append("export interface IndependentCode {")
    lines.append("  /** A short name used in test messages and in the lists of documented exceptions. */")
    lines.append("  name: string;")
    lines.append("  /** The symbology as the writer names it. */")
    lines.append("  writtenAs: string;")
    lines.append("  /** The data given to the writer. */")
    lines.append("  data: string;")
    lines.append("  /** The reading engine's own name for the symbology the reader should report. */")
    lines.append("  format: string;")
    lines.append("  /** The text the reader should report. */")
    lines.append("  text: string;")
    lines.append("  /** A base64 PNG. */")
    lines.append("  png: string;")
    lines.append("}")
    lines.append("")
    lines.append("export const INDEPENDENT_CODES: IndependentCode[] = [")
    for name, kind, data, options, fmt, text in CODES:
        image = treepoem.generate_barcode(barcode_type=kind, data=data, options=options, scale=3).convert("L")
        images[name] = image
        encoded = base64.b64encode(png_bytes(image)).decode("ascii")
        lines.append("  {")
        lines.append("    name: " + literal(name) + ",")
        lines.append("    writtenAs: " + literal(kind) + ",")
        lines.append("    data: " + literal(data) + ",")
        lines.append("    format: " + literal(fmt) + ",")
        lines.append("    text: " + literal(text) + ",")
        lines.append("    png: " + literal(encoded) + ",")
        lines.append("  },")
    lines.append("];")
    lines.append("")
    lines.append("export interface ScreenPhoto {")
    lines.append("  /** The independent image this copy was made from. */")
    lines.append("  base: string;")
    lines.append("  format: string;")
    lines.append("  text: string;")
    lines.append("  /** A base64 JPEG (quality 45). */")
    lines.append("  jpeg: string;")
    lines.append("}")
    lines.append("")
    lines.append("export const SCREEN_PHOTOS: ScreenPhoto[] = [")
    expected = {c[0]: (c[4], c[5]) for c in CODES}
    for base in SCREEN_PHOTO_BASES:
        degraded = screen_photo(images[base])
        buffer = io.BytesIO()
        degraded.save(buffer, "JPEG", quality=45)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        lines.append("  {")
        lines.append("    base: " + literal(base) + ",")
        lines.append("    format: " + literal(expected[base][0]) + ",")
        lines.append("    text: " + literal(expected[base][1]) + ",")
        lines.append("    jpeg: " + literal(encoded) + ",")
        lines.append("  },")
    lines.append("];")
    lines.append("")
    path = os.path.join(HERE, "independent-codes.ts")
    with open(path, "w", newline="\n") as handle:
        handle.write("\n".join(lines))
    print("wrote", path, os.path.getsize(path), "bytes")


if __name__ == "__main__":
    main()
