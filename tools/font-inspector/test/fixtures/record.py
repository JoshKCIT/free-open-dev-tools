"""Authoring-time recorder: what fontTools reads from the fonts that build-fonts.py makes.

Usage:  python record.py <folder holding the built fonts> <output file>

Writes recorded.json: {fontTools, recordedAt, macRoman128, codePages, checks}. The 45 checks are what the unit tests hold
the package's own reader to. Each check is {font, kind, value}; a value is plain JSON.
"""
import datetime
import json
import os
import sys

import fontTools
from fontTools.encodings import codecs as _fontTools_codecs  # noqa: F401  registers the Mac codecs
from fontTools.pens.basePen import decomposeQuadraticSegment
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTCollection, TTFont
from fontTools.ttLib.tables._n_a_m_e import NameRecord

EPOCH_1904 = datetime.datetime(1904, 1, 1)


def num(value):
    """Integers stay integers, whole floats become integers and other floats are kept exactly as Python holds them."""
    if isinstance(value, float) and value == int(value):
        return int(value)
    return value


def point(p):
    return [num(p[0]), num(p[1])]


def segments(font, glyph_name):
    """Every drawn segment of a glyph, composites decomposed, as sorted JSON strings (the glyph's outline as a set)."""
    glyph_set = font.getGlyphSet()
    pen = DecomposingRecordingPen(glyph_set)
    glyph_set[glyph_name].draw(pen)
    out = []
    current = None
    start = None
    for op, args in pen.value:
        if op == 'moveTo':
            current = start = args[0]
        elif op == 'lineTo':
            out.append(['L', point(current), point(args[0])])
            current = args[0]
        elif op == 'curveTo':
            out.append(['C', point(current), point(args[0]), point(args[1]), point(args[2])])
            current = args[2]
        elif op == 'qCurveTo':
            pts = list(args)
            if pts[-1] is None:
                continue  # a contour with no on-curve point: not in these fonts
            for control, end in decomposeQuadraticSegment(pts):
                out.append(['Q', point(current), point(control), point(end)])
                current = end
        elif op in ('closePath', 'endPath'):
            if op == 'closePath' and start is not None and current != start:
                out.append(['L', point(current), point(start)])
            current = start = None
    return sorted(json.dumps(s, separators=(',', ':')) for s in out)


def names(font):
    rows = []
    for r in font['name'].names:
        rows.append({'platform': r.platformID, 'encoding': r.platEncID, 'language': r.langID, 'id': r.nameID,
                     'text': r.toUnicode()})
    return sorted(rows, key=lambda r: (r['platform'], r['encoding'], r['language'], r['id']))


def cmap_map(font):
    out = {}
    for table in font['cmap'].tables:
        if table.format in (0, 4, 6, 12, 13):
            for code, glyph in table.cmap.items():
                out.setdefault(code, font.getGlyphID(glyph))
    return {str(k): v for k, v in sorted(out.items()) if v != 0}


def variation_selectors(font):
    rows = []
    for table in font['cmap'].tables:
        if table.format == 14:
            for selector, items in sorted(table.uvsDict.items()):
                rows.append({
                    'selector': selector,
                    'defaults': sorted(c for c, g in items if g is None),
                    'nonDefaults': sorted([c, font.getGlyphID(g)] for c, g in items if g is not None),
                })
    return rows


def feature_tags(font, which):
    if which not in font:
        return None
    table = font[which].table
    return sorted({r.FeatureTag for r in table.FeatureList.FeatureRecord}) if table.FeatureList else []


def feature_scripts(font, which):
    if which not in font:
        return None
    table = font[which].table
    records = table.FeatureList.FeatureRecord
    found = {}
    for sr in table.ScriptList.ScriptRecord:
        script = sr.ScriptTag
        if sr.Script.DefaultLangSys:
            for index in sr.Script.DefaultLangSys.FeatureIndex:
                found.setdefault(records[index].FeatureTag, set()).add(f'{script}/dflt')
        for lr in sr.Script.LangSysRecord:
            for index in lr.LangSys.FeatureIndex:
                found.setdefault(records[index].FeatureTag, set()).add(f'{script}/{lr.LangSysTag}')
    return {k: sorted(v) for k, v in sorted(found.items())}


def date_text(seconds):
    return (EPOCH_1904 + datetime.timedelta(seconds=seconds)).strftime('%Y-%m-%d %H:%M:%S UTC')


def metrics(font):
    os2 = font['OS/2']
    return {
        'numGlyphs': font['maxp'].numGlyphs,
        'unitsPerEm': font['head'].unitsPerEm,
        'fontRevision': num(font['head'].fontRevision),
        'created': date_text(font['head'].created),
        'modified': date_text(font['head'].modified),
        'ascent': font['hhea'].ascent,
        'descent': font['hhea'].descent,
        'lineGap': font['hhea'].lineGap,
        'typoAscender': os2.sTypoAscender,
        'typoDescender': os2.sTypoDescender,
        'typoLineGap': os2.sTypoLineGap,
        'winAscent': os2.usWinAscent,
        'winDescent': os2.usWinDescent,
        'weightClass': os2.usWeightClass,
        'widthClass': os2.usWidthClass,
        'vendor': os2.achVendID,
        'xHeight': getattr(os2, 'sxHeight', None),
        'capHeight': getattr(os2, 'sCapHeight', None),
    }


def outlines(font):
    order = font.getGlyphOrder()
    return {str(i): segments(font, name) for i, name in enumerate(order)}


def main():
    folder, target = sys.argv[1], sys.argv[2]
    checks = []

    def add(file, kind, value):
        checks.append({'font': file, 'kind': kind, 'value': value})

    for file in ['plain.ttf', 'mac-names.ttf', 'preview.ttf', 'variable.ttf', 'cff.otf']:
        font = TTFont(os.path.join(folder, file), lazy=False)
        add(file, 'names', names(font))
        add(file, 'cmap', cmap_map(font))
        add(file, 'gsub', feature_tags(font, 'GSUB'))
        add(file, 'gpos', feature_tags(font, 'GPOS'))
        add(file, 'metrics', metrics(font))
        add(file, 'embedding', {'fsType': font['OS/2'].fsType})
        add(file, 'outlines', outlines(font))
        if file == 'variable.ttf':
            fvar = font['fvar']
            add(file, 'fvarAxes', [{'tag': a.axisTag, 'min': num(a.minValue), 'default': num(a.defaultValue),
                                    'max': num(a.maxValue), 'nameId': a.axisNameID} for a in fvar.axes])
            add(file, 'fvarInstances', [{'subfamilyNameId': i.subfamilyNameID,
                                         'coordinates': {k: num(v) for k, v in i.coordinates.items()}}
                                        for i in fvar.instances])
        if file == 'plain.ttf':
            add(file, 'variationSelectors', variation_selectors(font))
            add(file, 'gsubScriptsLanguages', feature_scripts(font, 'GSUB'))
            add(file, 'gposScriptsLanguages', feature_scripts(font, 'GPOS'))

    collection = TTCollection(os.path.join(folder, 'collection.ttc'))
    add('collection.ttc', 'memberCount', len(collection.fonts))
    for position, member in enumerate(collection.fonts, start=1):
        add(f'collection.ttc#{position}', 'names', names(member))
        add(f'collection.ttc#{position}', 'metrics', metrics(member))

    assert len(checks) == 45, len(checks)

    # All 128 Mac Roman high bytes, as Python and as fontTools decode them (they must agree).
    high = bytes(range(0x80, 0x100))
    python_text = high.decode('mac_roman')
    record = NameRecord()
    record.platformID, record.platEncID, record.langID, record.nameID = 1, 0, 0, 1
    record.string = high
    assert record.toUnicode() == python_text

    code_pages = []
    for encoding, codec, text in (
        (3, 'gbk', '中文字体测试'),
        (4, 'big5', '中文字體測試'),
        (5, 'euc_kr', '한글 글꼴 시험'),
    ):
        raw = text.encode(codec)
        check = NameRecord()
        check.platformID, check.platEncID, check.langID, check.nameID = 3, encoding, 0x409, 1
        check.string = raw
        assert check.toUnicode() == text, (codec, check.toUnicode())
        code_pages.append({'encoding': encoding, 'codec': codec, 'bytesHex': raw.hex(), 'text': text})

    result = {
        'fontTools': fontTools.version,
        'recordedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'macRoman128': python_text,
        'codePages': code_pages,
        'checks': checks,
    }
    with open(target, 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(result, handle, ensure_ascii=False, indent=1)
        handle.write('\n')
    print('recorded', len(checks), 'checks with fontTools', fontTools.version)


if __name__ == '__main__':
    main()
