"""
Writes test/fixtures/pdfs.ts: small PDF files made by writers other than the code under test, as base64 text.

Writers (see README.md for the versions): reportlab draws the pages and the first document information, pikepdf writes
the XMP streams, the piece-info and last-modified entries, the encryption and the object streams, and pypdf makes the
incremental update. Every marker string starts SENTINEL- so a scan of a copy's bytes can look for it. After each file is
made, pypdf (a second reader, not the writer of that part) reads the document information back and the script stops if a
value is not the one that was given, so the strings the tests expect are what the file really holds.

Run from a Python environment that has reportlab, pikepdf and pypdf installed, from anywhere:

    python tools/pdf-text-metadata/test/fixtures/make-fixtures.py

The output is written next to this script. The files are made with reportlab's invariant mode and fixed dates; the two
encrypted files get new random salts on every run.
"""

import base64
import io
import shutil
import sys
import tempfile
from pathlib import Path

import pikepdf
from pikepdf import Array, Dictionary, Name, Pdf, String
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DictionaryObject, NameObject, StreamObject, TextStringObject
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
OUT = HERE / "pdfs.ts"

# The strings given to the writers (the tests expect these exact values).
TITLE = "SENTINEL-TITLE-7f3a"
AUTHOR = "SENTINEL-AUTHOR-Ada Lovelace"
SUBJECT = "SENTINEL-SUBJECT-91bc"
KEYWORDS = "SENTINEL-KEYWORDS-xyz"
CREATOR = "SENTINEL-CREATOR-Writer 9"
PRODUCER = "SENTINEL-PRODUCER-Maker 3"
CUSTOM = "SENTINEL-CUSTOM-VALUE"
CREATION = "D:20200102030405+02'00'"
MODIFIED = "D:20210203040506Z"
XMP_TITLE = "SENTINEL-XMP-TITLE-55aa"
XMP_CREATOR = "SENTINEL-XMP-CREATOR-Bob"
XMP_TOOL = "SENTINEL-XMP-TOOL"
PAGE_XMP = "SENTINEL-PAGE-XMP-QQ"
PIECE = "SENTINEL-PIECEINFO-ZZ"
REV2_AUTHOR = "SENTINEL-AUTHOR-REV2-Grace"
REV2_TITLE = "SENTINEL-TITLE-REV2"
REV2_XMP_CREATOR = "SENTINEL-XMP-CREATOR-REV2-Carol"
# Built from code points so no invisible or bidirectional character sits in this file.
UNICODE_TITLE = "Titel " + chr(0xFC) + "n" + chr(0xEF) + "c" + chr(0xF6) + "d" + chr(0xE9) + " " + chr(0x2713) + " " + chr(0x65E5) + chr(0x672C)
UNICODE_AUTHOR = "Zo" + chr(0xEB) + " M" + chr(0xFC) + "ller"
BIDI_TITLE = chr(0x202E) + "gnp.exe-SENTINEL-BIDI"


def draw_pages(path, pages=3, **info):
    c = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    c.setTitle(info.get("title", TITLE))
    c.setAuthor(info.get("author", AUTHOR))
    c.setSubject(info.get("subject", SUBJECT))
    c.setKeywords(info.get("keywords", KEYWORDS))
    c.setCreator(info.get("creator", CREATOR))
    for i in range(1, pages + 1):
        c.setFont("Helvetica", 14)
        c.drawString(72, 760, f"Page {i} heading")
        c.setFont("Times-Roman", 11)
        c.drawString(72, 730, f"This is line one of page {i}.")
        c.drawString(72, 712, f"Second line, page {i}: numbers 3.14159 and email test@example.com")
        c.showPage()
    c.save()


def page_xmp_stream(pdf):
    xmp = pikepdf.Stream(
        pdf,
        (
            '<?xpacket begin="' + chr(0xFEFF) + '" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
            '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>'
            + PAGE_XMP
            + '</dc:description></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
        ).encode("utf-8"),
    )
    xmp.Type = Name.Metadata
    xmp.Subtype = Name.XML
    return xmp


def set_info(pdf):
    pdf.docinfo["/Title"] = String(TITLE)
    pdf.docinfo["/Author"] = String(AUTHOR)
    pdf.docinfo["/Subject"] = String(SUBJECT)
    pdf.docinfo["/Keywords"] = String(KEYWORDS)
    pdf.docinfo["/Creator"] = String(CREATOR)
    pdf.docinfo["/Producer"] = String(PRODUCER)
    pdf.docinfo["/CreationDate"] = String(CREATION)
    pdf.docinfo["/ModDate"] = String(MODIFIED)
    pdf.docinfo["/Trapped"] = Name("/False")
    pdf.docinfo["/CustomKey"] = String(CUSTOM)


def tag_everything(src, objstm_dst, plain_dst):
    """Document information, a catalog XMP stream, a page XMP stream, PieceInfo and LastModified on a page."""
    pdf = Pdf.open(src)
    set_info(pdf)
    with pdf.open_metadata(set_pikepdf_as_editor=False, update_docinfo=False) as meta:
        meta["dc:title"] = XMP_TITLE
        meta["dc:creator"] = [XMP_CREATOR]
        meta["xmp:CreatorTool"] = XMP_TOOL
    page = pdf.pages[0]
    page.Metadata = page_xmp_stream(pdf)
    page.PieceInfo = Dictionary(
        MyApp=Dictionary(Private=Dictionary(Secret=String(PIECE)), LastModified=String("D:20200102030405Z"))
    )
    page.LastModified = String("D:20200102030405Z")
    pdf.save(
        objstm_dst,
        object_stream_mode=pikepdf.ObjectStreamMode.generate,
        deterministic_id=True,
    )
    pdf.save(
        plain_dst,
        object_stream_mode=pikepdf.ObjectStreamMode.disable,
        compress_streams=False,
        deterministic_id=True,
    )


def nested_metadata(src, dst):
    """Metadata keys in a form XObject stream dictionary, a font dictionary and an inline dictionary."""
    pdf = Pdf.open(src)
    set_info(pdf)
    page = pdf.pages[0]
    form = pdf.make_stream(b"q Q")
    form.Type = Name.XObject
    form.Subtype = Name.Form
    form.BBox = Array([0, 0, 10, 10])
    form.Metadata = page_xmp_stream(pdf)
    form.LastModified = String("D:20200102030405Z")
    resources = page.Resources
    resources.XObject = Dictionary(Fm0=form)
    for name in list(resources.Font.keys()):
        resources.Font[name].Metadata = page_xmp_stream(pdf)
    resources.ProcSet = Array([Name.PDF, Name.Text])
    # An inline (direct) dictionary inside the page dictionary that itself holds a PieceInfo.
    page.Extra = Dictionary(PieceInfo=Dictionary(App=Dictionary(Private=Dictionary(Secret=String(PIECE)))))
    pdf.save(dst, object_stream_mode=pikepdf.ObjectStreamMode.disable, compress_streams=False, deterministic_id=True)


def read_info(path, password=""):
    reader = PdfReader(str(path))
    if reader.is_encrypted:
        reader.decrypt(password)
    return {str(k): str(v) for k, v in (reader.metadata or {}).items()}


def expect(path, **wanted):
    info = read_info(path)
    for key, value in wanted.items():
        if info.get("/" + key) != value:
            sys.exit(f"{path.name}: pypdf reads /{key} as {info.get('/' + key)!r}, expected {value!r}")


def literal(name, path, note):
    data = Path(path).read_bytes()
    text = base64.b64encode(data).decode("ascii")
    return f"/** {note} ({len(data)} bytes) */\nexport const {name} = '{text}';\n"


def main():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        tmp = Path(tmp)
        draw_pages(tmp / "base.pdf")

        # F1_PLAIN: only reportlab's own document information (the strings above), three pages.
        shutil.copy(tmp / "base.pdf", tmp / "f1_plain.pdf")
        expect(tmp / "f1_plain.pdf", Title=TITLE, Author=AUTHOR, Subject=SUBJECT, Keywords=KEYWORDS, Creator=CREATOR)

        # F1_FULL and F1_FULL_NO_OBJSTM: every kind of metadata on the first page, in object streams and in plain objects.
        tag_everything(tmp / "base.pdf", tmp / "f1_full.pdf", tmp / "f1_full_noobjstm.pdf")
        for name in ("f1_full.pdf", "f1_full_noobjstm.pdf"):
            expect(
                tmp / name,
                Title=TITLE,
                Author=AUTHOR,
                Subject=SUBJECT,
                Keywords=KEYWORDS,
                Creator=CREATOR,
                Producer=PRODUCER,
                CreationDate=CREATION,
                ModDate=MODIFIED,
                CustomKey=CUSTOM,
            )

        # F2_INCREMENTAL: F1_FULL_NO_OBJSTM plus an incremental update (ISO 32000-1 7.5.6) that points the trailer at a NEW
        # document information dictionary (new Author and Title) and the catalog at a NEW XMP stream, as editors that save
        # incrementally do. The first revision's dictionary and XMP stream stay in the file, no longer referred to.
        shutil.copy(tmp / "f1_full_noobjstm.pdf", tmp / "f2_incremental.pdf")
        writer = PdfWriter(str(tmp / "f2_incremental.pdf"), incremental=True)
        new_info = DictionaryObject(
            {NameObject("/Author"): TextStringObject(REV2_AUTHOR), NameObject("/Title"): TextStringObject(REV2_TITLE)}
        )
        writer._info_obj = writer._add_object(new_info)
        new_xmp = StreamObject()
        new_xmp[NameObject("/Type")] = NameObject("/Metadata")
        new_xmp[NameObject("/Subtype")] = NameObject("/XML")
        new_xmp.set_data(
            (
                '<?xpacket begin="' + chr(0xFEFF) + '" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">'
                '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
                '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>'
                + REV2_XMP_CREATOR
                + '</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
            ).encode("utf-8")
        )
        writer.root_object[NameObject("/Metadata")] = writer._add_object(new_xmp)
        writer.write(str(tmp / "f2_incremental.pdf"))
        expect(tmp / "f2_incremental.pdf", Author=REV2_AUTHOR, Title=REV2_TITLE)
        raw = (tmp / "f2_incremental.pdf").read_bytes()
        # pypdf writes hyphens inside a string as the octal escape 055, so the new author is looked for by its last word.
        if AUTHOR.encode() not in raw or b"Grace" not in raw or XMP_CREATOR.encode() not in raw or b"Carol" not in raw:
            sys.exit("f2_incremental.pdf must hold the old and the new author and XMP creator in its bytes")

        # F3_OWNER_ENCRYPTED: opens without a password (owner password only).
        source = Pdf.open(tmp / "f1_full.pdf")
        source.save(tmp / "f3_owner.pdf", encryption=pikepdf.Encryption(owner="owner-pw", user="", R=6))
        # F4_USER_ENCRYPTED: needs the password user-pw to open.
        source = Pdf.open(tmp / "f1_full.pdf")
        source.save(tmp / "f4_user.pdf", encryption=pikepdf.Encryption(owner="owner-pw", user="user-pw", R=4))

        # F5_CLEAN_NO_INFO: two pages and no document information at all.
        c = canvas.Canvas(str(tmp / "f5.pdf"), pagesize=A4, invariant=1)
        c.setFont("Helvetica", 12)
        c.drawString(72, 760, "Clean page one")
        c.showPage()
        c.drawString(72, 760, "Clean page two")
        c.showPage()
        c.save()
        clean = Pdf.open(tmp / "f5.pdf")
        for key in list(clean.docinfo.keys()):
            del clean.docinfo[key]
        if "/Info" in clean.trailer:
            del clean.trailer["/Info"]
        clean.save(tmp / "f5_clean.pdf", deterministic_id=True)
        if read_info(tmp / "f5_clean.pdf"):
            sys.exit("f5_clean.pdf must hold no document information")

        # F6_UNICODE: one page, document information holding umlauts, a tick mark and Japanese (written as UTF-16).
        draw_pages(tmp / "f6.pdf", pages=1, title=UNICODE_TITLE, author=UNICODE_AUTHOR)
        expect(tmp / "f6.pdf", Title=UNICODE_TITLE, Author=UNICODE_AUTHOR)

        # F7_BIDI: a title that starts with the right-to-left override character U+202E.
        bidi = Pdf.open(tmp / "f5_clean.pdf")
        bidi.docinfo["/Title"] = String(BIDI_TITLE)
        bidi.save(tmp / "f7_bidi.pdf", deterministic_id=True)
        expect(tmp / "f7_bidi.pdf", Title=BIDI_TITLE)

        # F8_NESTED: Metadata, PieceInfo and LastModified in a form XObject, a font dictionary and an inline dictionary.
        nested_metadata(tmp / "base.pdf", tmp / "f8_nested.pdf")

        parts = [
            "/**\n"
            " * PDF fixtures written by tools/pdf-text-metadata/test/fixtures/make-fixtures.py (see README.md in this folder).\n"
            " * Do not edit by hand: run the script. Strings given to the writers:\n"
            f" *   Info: Title {TITLE}, Author {AUTHOR}, Subject {SUBJECT}, Keywords {KEYWORDS}, Creator {CREATOR},\n"
            f" *   Producer {PRODUCER}, CreationDate {CREATION}, ModDate {MODIFIED}, Trapped /False, CustomKey {CUSTOM}.\n"
            f" *   Catalog XMP: dc:title {XMP_TITLE}, dc:creator {XMP_CREATOR}, xmp:CreatorTool {XMP_TOOL}.\n"
            f" *   First page: XMP stream dc:description {PAGE_XMP}, PieceInfo secret {PIECE}, LastModified D:20200102030405Z.\n"
            f" *   Incremental update: Author {REV2_AUTHOR}, Title {REV2_TITLE}, XMP dc:creator {REV2_XMP_CREATOR}.\n"
            " *   Pages (all files but F5 and F6): 'Page N heading', 'This is line one of page N.',\n"
            " *   'Second line, page N: numbers 3.14159 and email test@example.com' for N = 1 to 3.\n"
            " */\n",
            literal("F1_PLAIN", tmp / "f1_plain.pdf", "reportlab only: Info with Title, Author, Subject, Keywords and Creator, three pages"),
            literal("F1_FULL", tmp / "f1_full.pdf", "every kind of metadata, objects in object streams, three pages"),
            literal("F1_FULL_NO_OBJSTM", tmp / "f1_full_noobjstm.pdf", "the same without object streams or stream compression"),
            literal("F2_INCREMENTAL", tmp / "f2_incremental.pdf", "F1_FULL_NO_OBJSTM plus an incremental update that points the trailer and catalog at new Info and XMP objects; both revisions are in the bytes"),
            literal("F3_OWNER_ENCRYPTED", tmp / "f3_owner.pdf", "AES-256 (R6), owner password owner-pw, empty user password: opens without a password"),
            literal("F4_USER_ENCRYPTED", tmp / "f4_user.pdf", "RC4/AES-128 (R4), user password user-pw: needs a password to open"),
            literal("F5_CLEAN_NO_INFO", tmp / "f5_clean.pdf", "two pages, no document information, no XMP: 'Clean page one', 'Clean page two'"),
            literal("F6_UNICODE", tmp / "f6.pdf", "one page; Title 'Titel \\u00fcn\\u00efc\\u00f6d\\u00e9 \\u2713 \\u65e5\\u672c' and Author 'Zo\\u00eb M\\u00fcller' written as UTF-16"),
            literal("F7_BIDI", tmp / "f7_bidi.pdf", "two pages; Title is U+202E then 'gnp.exe-SENTINEL-BIDI'"),
            literal("F8_NESTED", tmp / "f8_nested.pdf", "Metadata, PieceInfo and LastModified in a form XObject, a font dictionary and an inline dictionary"),
        ]
        OUT.write_text("\n".join(parts), encoding="utf-8", newline="\n")
        print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
