import { it, expect } from 'vitest';
import {
  MEDIA_KINDS,
  MarkupError,
  buildMedia,
  meta,
  parseSourceLines,
  parseTrackLines,
  type MediaSpec,
} from '../src/index';
import { TRACK_KINDS } from '../src/spec-data';
import { HOSTILE, attrOf, findAll, parse, shape, textOf, type ParsedElement } from './parse';

const LF = String.fromCharCode(10);

/** The MarkupError a call throws, or null when it does not throw. */
function refusal(run: () => unknown): MarkupError | null {
  try {
    run();
    return null;
  } catch (err) {
    if (err instanceof MarkupError) return err;
    throw err;
  }
}

it('has the catalog id and name and states its limits', () => {
  expect(meta.id).toBe('media-embed-builder');
  expect(meta.name).toBe('HTML Media Embed Builder');
  expect(meta.limits.length).toBeGreaterThan(0);
});

it('WHATWG 4.8.10 the captions and subtitles example of the standard is reproduced as video markup', () => {
  // WHATWG 4.8.10: the first two tracks of "This video has subtitles in several languages", written with quoted values.
  const built = buildMedia({
    kind: 'video',
    src: 'brave.webm',
    tracks:
      'brave.en.vtt | subtitles | en | English' +
      LF +
      'brave.en.hoh.vtt | captions | en | English for the Hard of Hearing',
    controls: true,
  });
  expect(built).not.toBeNull();
  if (built === null) return;
  expect(built.html).toBe(
    [
      '<video src="brave.webm" controls>',
      '  <track kind="subtitles" src="brave.en.vtt" srclang="en" label="English">',
      '  <track kind="captions" src="brave.en.hoh.vtt" srclang="en" label="English for the Hard of Hearing">',
      '</video>',
    ].join(LF),
  );

  const { frag, errors } = parse(built.html);
  expect(errors).toEqual([]);
  const tracks = findAll(frag, 'track');
  expect(tracks).toHaveLength(2);
  expect(tracks.map((t) => t.attrs.map((a) => a.name))).toEqual([
    ['kind', 'src', 'srclang', 'label'],
    ['kind', 'src', 'srclang', 'label'],
  ]);
  expect(attrOf(tracks[1]!, 'label')).toBe('English for the Hard of Hearing');

  // The standard names the five kinds, and a kind outside them is refused naming the field.
  expect([...TRACK_KINDS]).toEqual(['subtitles', 'captions', 'descriptions', 'chapters', 'metadata']);
  const bad = refusal(() => parseTrackLines('a.vtt | chapter | en | Chapters'));
  expect(bad?.field).toBe('Tracks');
  expect(bad?.message).toContain('4.8.10');
});

it('the video markup parses with parse5 with zero parse errors and the preview carries no typed address', () => {
  const built = buildMedia({
    kind: 'video',
    src: 'https://example.invalid/brave.webm',
    tracks: 'https://example.invalid/brave.en.vtt | subtitles | en | English',
    controls: false,
  });
  expect(built).not.toBeNull();
  if (built === null) return;
  expect(parse(built.html).errors).toEqual([]);
  // The markup keeps the choice: no controls were asked for.
  expect(attrOf(findAll(parse(built.html).frag, 'video')[0]!, 'controls')).toBeUndefined();

  const preview = parse(built.preview);
  expect(preview.errors).toEqual([]);
  const video = findAll(preview.frag, 'video')[0]!;
  expect(attrOf(video, 'src')).toBeUndefined();
  // The preview always shows controls so the element is visible.
  expect(video.attrs.map((a) => a.name)).toContain('controls');
  const tracks = findAll(preview.frag, 'track');
  expect(tracks).toHaveLength(1);
  expect(attrOf(tracks[0]!, 'src')).toBeUndefined();
  expect(built.preview).not.toContain('example.invalid');
  expect(built.preview).not.toContain('brave');
});

// ---- Task 2: video and audio in full ------------------------------------------------------------------------------

it('WHATWG 4.8.8 video with src has no source children, and without src the sources come before the tracks', () => {
  // WHATWG 4.8.8: with a src attribute, track elements then fallback; without it, source elements, then track elements.
  const both = refusal(() => buildMedia({ kind: 'video', src: 'a.webm', mediaSources: 'b.webm | video/webm' }));
  expect(both?.field).toBe('Sources');
  expect(both?.message).toContain('4.8.8');

  const built = buildMedia({
    kind: 'video',
    mediaSources: [
      'movie.webm | video/webm; codecs="vp9" | (min-width: 600px)',
      'movie.mp4 | video/mp4',
      'movie.ogv',
    ].join(LF),
    tracks: 'c.vtt | captions | en | English',
    fallback: 'Your browser cannot play this video.',
    controls: true,
  });
  expect(built).not.toBeNull();
  if (built === null) return;
  const { frag, errors } = parse(built.html);
  expect(errors).toEqual([]);
  const video = findAll(frag, 'video')[0]!;
  expect(attrOf(video, 'src')).toBeUndefined();
  const children = video.childNodes.filter((n) => 'tagName' in n).map((n) => (n as ParsedElement).tagName);
  expect(children).toEqual(['source', 'source', 'source', 'track']);
  const sources = findAll(frag, 'source');
  expect(sources[0]!.attrs.map((a) => a.name)).toEqual(['src', 'type', 'media']);
  expect(attrOf(sources[0]!, 'type')).toBe('video/webm; codecs="vp9"');
  expect(attrOf(sources[0]!, 'media')).toBe('(min-width: 600px)');
  expect(sources[2]!.attrs.map((a) => a.name)).toEqual(['src']);
  expect(textOf(video)).toContain('Your browser cannot play this video.');

  // A source line with an empty address, a malformed type, a fourth cell, and neither src nor a source are refused.
  const empty = refusal(() => buildMedia({ kind: 'video', mediaSources: 'a.webm' + LF + ' | video/webm' }));
  expect(empty?.field).toBe('Sources');
  expect(empty?.message).toContain('line 2');
  expect(refusal(() => buildMedia({ kind: 'video', mediaSources: 'a.webm | video' }))?.message).toContain(
    'type/subtype',
  );
  expect(refusal(() => buildMedia({ kind: 'video', mediaSources: 'a | video/webm | all | extra' }))?.field).toBe(
    'Sources',
  );
  expect(refusal(() => buildMedia({ kind: 'video', tracks: 'c.vtt | captions | en | English' }))?.field).toBe(
    'Media address',
  );
  expect(parseSourceLines('a.webm | video/webm' + LF + LF + 'b.webm').map((s) => s.line)).toEqual([1, 3]);
});

it('WHATWG 4.8.9 audio follows the same source and track rules without poster, width or height', () => {
  const built = buildMedia({
    kind: 'audio',
    mediaSources: 'song.ogg | audio/ogg' + LF + 'song.mp3 | audio/mpeg',
    tracks: 'song.en.vtt | captions | en | English',
    controls: true,
  });
  expect(built).not.toBeNull();
  if (built === null) return;
  const { frag, errors } = parse(built.html);
  expect(errors).toEqual([]);
  expect(findAll(frag, 'audio')).toHaveLength(1);
  expect(findAll(frag, 'source')).toHaveLength(2);
  expect(findAll(frag, 'track')).toHaveLength(1);

  const both = refusal(() => buildMedia({ kind: 'audio', src: 'a.mp3', mediaSources: 'b.mp3' }));
  expect(both?.field).toBe('Sources');
  expect(both?.message).toContain('4.8.9');

  const poster = refusal(() => buildMedia({ kind: 'audio', src: 'a.mp3', poster: 'p.jpg' }));
  expect(poster?.field).toBe('Poster address');
  expect(poster?.message).toContain('4.8.9');
  expect(refusal(() => buildMedia({ kind: 'audio', src: 'a.mp3', width: '300' }))?.field).toBe('Width');
  expect(refusal(() => buildMedia({ kind: 'audio', src: 'a.mp3', height: '300' }))?.field).toBe('Height');
  expect(refusal(() => buildMedia({ kind: 'audio', src: 'a.mp3', playsinline: true }))?.field).toBe('Play inline');

  // Audio takes no layout-shift note: it has no size.
  const plain = buildMedia({ kind: 'audio', src: 'a.mp3', controls: true });
  expect(plain?.warnings.join(' ')).not.toContain('layout');
  expect(plain?.html).toBe('<audio src="a.mp3" controls></audio>');
});

it('WHATWG 4.8.10 track kinds come from the standard, subtitles need srclang, labels are not empty and only one default per kind group', () => {
  const track = (lines: string) => () => buildMedia({ kind: 'video', src: 'v.webm', tracks: lines });
  const kind = refusal(track('a.vtt | chapter | en | Chapters'));
  expect(kind?.field).toBe('Tracks');
  expect(kind?.message).toContain('subtitles, captions, descriptions, chapters, metadata');
  expect(kind?.message).toContain('line 1');

  // WHATWG 4.8.10: srclang must be present when the kind is subtitles, and a blank kind is the subtitles state.
  expect(refusal(track('a.vtt | subtitles | | English'))?.message).toContain('srclang');
  expect(refusal(track('a.vtt'))?.message).toContain('srclang');
  expect(refusal(track('a.vtt | captions | | English'))).toBeNull();
  // srclang must be a well-formed language tag.
  expect(refusal(track('a.vtt | subtitles | en-GB | English'))).toBeNull();
  const lang = refusal(track('a.vtt | subtitles | english! | English'));
  expect(lang?.field).toBe('Tracks');
  expect(lang?.message).toContain('BCP 47');
  expect(refusal(track('a.vtt | metadata | en_GB | x'))?.message).toContain('BCP 47');

  // A blank kind is not written, and an empty label cell means no label.
  const bare = buildMedia({ kind: 'video', src: 'v.webm', tracks: 'a.vtt | | en' });
  expect(bare?.html).toContain('<track src="a.vtt" srclang="en">');
  const noLabel = buildMedia({ kind: 'video', src: 'v.webm', tracks: 'a.vtt | captions | en |' });
  expect(noLabel?.html).toContain('<track kind="captions" src="a.vtt" srclang="en">');

  // The fifth cell writes default, and only the word default is accepted there.
  const withDefault = buildMedia({ kind: 'video', src: 'v.webm', tracks: 'a.vtt | captions | en | English | DEFAULT' });
  expect(withDefault?.html).toContain('label="English" default>');
  expect(refusal(track('a.vtt | captions | en | English | yes'))?.message).toContain('default');

  // At most one default among subtitles and captions, one among descriptions, one among chapters.
  const twoCaptions = refusal(
    track(['a.vtt | subtitles | en | A | default', 'b.vtt | captions | en | B | default'].join(LF)),
  );
  expect(twoCaptions?.field).toBe('Tracks');
  expect(twoCaptions?.message).toContain('line 2');
  expect(twoCaptions?.message).toContain('default');
  expect(
    refusal(track(['a.vtt | descriptions | en | A | default', 'b.vtt | descriptions | fr | B | default'].join(LF))),
  ).not.toBeNull();
  expect(
    refusal(track(['a.vtt | chapters | en | A | default', 'b.vtt | chapters | fr | B | default'].join(LF))),
  ).not.toBeNull();
  // Different groups, and any number of metadata tracks, may each have one default.
  expect(
    refusal(
      track(
        [
          'a.vtt | subtitles | en | A | default',
          'b.vtt | descriptions | en | B | default',
          'c.vtt | chapters | en | C | default',
          'd.vtt | metadata | en | D | default',
          'e.vtt | metadata | fr | E | default',
        ].join(LF),
      ),
    ),
  ).toBeNull();

  // Two tracks of the same kind, the same language (EN is en) and the same label are duplicates.
  const dup = refusal(track(['a.vtt | subtitles | en | English', 'b.vtt | subtitles | EN | English'].join(LF)));
  expect(dup?.field).toBe('Tracks');
  expect(dup?.message).toContain('line 2');
  expect(dup?.message).toContain('same');
  expect(refusal(track(['a.vtt | subtitles | en | English', 'b.vtt | subtitles | en | Other'].join(LF)))).toBeNull();
  expect(refusal(track(['a.vtt | captions | en', 'b.vtt | captions | en'].join(LF)))).not.toBeNull();
  expect(refusal(track(['a.vtt | captions | en', 'b.vtt | subtitles | en'].join(LF)))).toBeNull();

  // The cells of a parsed line keep their meaning.
  expect(
    parseTrackLines('a.vtt | captions | en | English | default').map((t) => [t.kind, t.srclang, t.label, t.isDefault]),
  ).toEqual([['captions', 'en', 'English', true]]);
});

it('WHATWG 4.8.11 preload, loading and crossorigin take only their keywords', () => {
  const html = (extra: Partial<MediaSpec>) => buildMedia({ kind: 'video', src: 'v.webm', ...extra })?.html;
  // WHATWG 4.8.11.5, 2.5.7 and 2.5.4: the keyword tables of the three attributes.
  for (const preload of ['auto', 'none', 'metadata']) {
    expect(html({ preload })).toContain(`preload="${preload}"`);
  }
  for (const loading of ['lazy', 'eager']) expect(html({ loading })).toContain(`loading="${loading}"`);
  for (const crossorigin of ['anonymous', 'use-credentials']) {
    expect(html({ crossorigin })).toContain(`crossorigin="${crossorigin}"`);
  }
  expect(html({ preload: '', loading: '', crossorigin: '' })).toBe('<video src="v.webm"></video>');

  const preload = refusal(() => html({ preload: 'fast' }));
  expect(preload?.field).toBe('Preload');
  expect(preload?.message).toContain('auto, none, metadata');
  expect(preload?.message).toContain('4.8.11');
  const loading = refusal(() => html({ loading: 'soon' }));
  expect(loading?.field).toBe('Loading');
  expect(loading?.message).toContain('lazy, eager');
  const cors = refusal(() => html({ crossorigin: 'include' }));
  expect(cors?.field).toBe('Crossorigin');
  expect(cors?.message).toContain('anonymous, use-credentials');

  // Attribute order: src, poster, width, height, preload, loading, crossorigin, then the booleans.
  const all = buildMedia({
    kind: 'video',
    src: 'v.webm',
    poster: 'p.jpg',
    width: '640',
    height: '360',
    preload: 'metadata',
    loading: 'lazy',
    crossorigin: 'anonymous',
    controls: true,
    autoplay: true,
    muted: true,
    loop: true,
    playsinline: true,
  });
  expect(all?.html).toBe(
    '<video src="v.webm" poster="p.jpg" width="640" height="360" preload="metadata" loading="lazy" crossorigin="anonymous" controls autoplay muted loop playsinline></video>',
  );
  expect(refusal(() => html({ width: '64.5' }))?.field).toBe('Width');
  expect(refusal(() => html({ height: '-1' }))?.field).toBe('Height');
  expect(refusal(() => html({ poster: 'a b' + String.fromCharCode(0) }))?.field).toBe('Poster address');
});

it('autoplay without muted is kept and flagged because browsers commonly block it', () => {
  const plain = buildMedia({ kind: 'video', src: 'v.webm', width: '1', height: '1', controls: true, autoplay: true });
  expect(plain?.html).toContain(' autoplay');
  expect(plain?.warnings.join(' ')).toContain('block autoplay unless the media is muted');

  const muted = buildMedia({
    kind: 'video',
    src: 'v.webm',
    width: '1',
    height: '1',
    controls: true,
    autoplay: true,
    muted: true,
  });
  expect(muted?.html).toContain(' autoplay muted');
  expect(muted?.warnings.join(' ')).not.toContain('autoplay');

  // Lazy loading defers autoplay (4.8.11), and the loading attribute on video and audio is not acted on by every engine.
  const lazy = buildMedia({
    kind: 'audio',
    src: 'a.mp3',
    controls: true,
    autoplay: true,
    muted: true,
    loading: 'lazy',
  });
  const notes = lazy?.warnings.join(' ') ?? '';
  expect(notes).toContain('lazy loading defers autoplay');
  expect(notes).toContain('only Chromium-based browsers acted on it');
  expect(notes).not.toMatch(/will (always )?(play|start)|works in every browser|all browsers/i);

  // No loading attribute, no loading note; the layout-shift note appears for a video without width and height.
  expect(muted?.warnings.join(' ')).not.toContain('Chromium');
  const sizeless = buildMedia({ kind: 'video', src: 'v.webm', controls: true });
  expect(sizeless?.warnings.join(' ')).toContain('layout shift');
});

it('a track address with a scheme is flagged when the media element has no crossorigin setting', () => {
  const tracks = 'https://cdn.example/en.vtt | captions | en | English';
  const open = buildMedia({ kind: 'video', src: 'v.webm', width: '1', height: '1', controls: true, tracks });
  const notes = open?.warnings.join(' ') ?? '';
  expect(notes).toContain('crossorigin');
  expect(notes).toContain('CORS');

  const set = buildMedia({
    kind: 'video',
    src: 'v.webm',
    width: '1',
    height: '1',
    controls: true,
    crossorigin: 'anonymous',
    tracks,
  });
  expect(set?.warnings.join(' ')).not.toContain('CORS');
  const relative = buildMedia({
    kind: 'video',
    src: 'v.webm',
    width: '1',
    height: '1',
    controls: true,
    tracks: 'en.vtt | captions | en | English',
  });
  expect(relative?.warnings.join(' ')).not.toContain('CORS');

  // A script address in any address field is kept as typed and flagged.
  const script = buildMedia({ kind: 'video', src: 'javascript:alert(1)', controls: true });
  expect(script?.html).toContain('src="javascript:alert(1)"');
  expect(script?.warnings.join(' ')).toContain('javascript:');
  const poster = buildMedia({ kind: 'video', src: 'v.webm', poster: 'data:text/html,x', controls: true });
  expect(poster?.warnings.join(' ')).toContain('data:');
});

it('the preview always shows media controls while the markup keeps the choice', () => {
  const audio = buildMedia({ kind: 'audio', src: 'a.mp3', controls: false });
  expect(audio?.html).toBe('<audio src="a.mp3"></audio>');
  expect(audio?.preview).toBe('<audio controls></audio>');
  const notes = audio?.warnings.join(' ') ?? '';
  expect(notes).toContain('not displayed');
  expect(notes).toContain('preview');

  const video = buildMedia({ kind: 'video', src: 'v.webm', width: '1', height: '1', controls: false });
  expect(video?.html).not.toContain('controls');
  expect(video?.preview).toContain('controls');
  expect(video?.warnings.join(' ')).toContain('preview always shows controls');

  // With controls chosen, the preview keeps one controls attribute and no note about it.
  const chosen = buildMedia({ kind: 'video', src: 'v.webm', width: '1', height: '1', controls: true });
  expect(chosen?.preview).toBe('<video width="1" height="1" controls></video>');
  expect(chosen?.warnings).toEqual([]);

  // Nothing typed gives no output, and blank selects and booleans alone do not count as typed.
  expect(buildMedia({ kind: 'video' })).toBeNull();
  expect(buildMedia({ kind: 'audio', src: '  ', tracks: '', controls: true, preload: '' })).toBeNull();
});

// ---- Task 3: responsive images, picture, the preview, hostile text and the boundaries -----------------------------

const picture =
  (pictureSources: string, extra: Partial<MediaSpec> = {}) =>
  () =>
    buildMedia({
      kind: 'picture',
      src: 'fallback.jpg',
      alt: 'A harbour',
      width: '400',
      height: '300',
      pictureSources,
      ...extra,
    });

it('WHATWG 4.8.2 a picture source followed by another source or by an img with srcset needs media or type', () => {
  // The first of two sources needs a media value (not blank, not all) or a type; the last, before an img without srcset, does not.
  const first = refusal(picture(['a.avif 1x', 'b.jpg 1x'].join(LF)));
  expect(first?.field).toBe('Picture sources');
  expect(first?.message).toContain('line 1');
  expect(first?.message).toContain('4.8.2');
  expect(refusal(picture(['a.avif 1x | image/avif', 'b.jpg 1x'].join(LF)))).toBeNull();
  expect(refusal(picture(['a.avif 1x | | (min-width: 800px)', 'b.jpg 1x'].join(LF)))).toBeNull();
  expect(refusal(picture('a.avif 1x'))).toBeNull();

  // A media value of all, in any letter case, does not count; neither does a blank cell.
  expect(refusal(picture(['a.avif 1x | | all', 'b.jpg 1x'].join(LF)))?.message).toContain('line 1');
  expect(refusal(picture(['a.avif 1x | | ALL', 'b.jpg 1x'].join(LF)))?.message).toContain('line 1');
  // The line number counts blank lines, so the message points at what the visitor sees.
  const lined = refusal(picture(['a.avif 1x | image/avif', '', 'b.webp 1x', 'c.jpg 1x'].join(LF)));
  expect(lined?.message).toContain('line 3');

  // The last source followed by an img that has srcset needs media or type too.
  const withSrcset = (lines: string) => picture(lines, { srcset: 'f-1x.jpg 1x, f-2x.jpg 2x' });
  expect(refusal(withSrcset('a.avif 1x'))?.message).toContain('line 1');
  expect(refusal(withSrcset('a.avif 1x | image/avif'))).toBeNull();

  // The structure: sources first, then the img, attributes srcset, type, media, sizes, and never a src on a source.
  const built = picture(
    [
      'a-400.avif 400w, a-800.avif 800w | image/avif | (min-width: 800px) | 100vw',
      'b-400.jpg 400w, b-800.jpg 800w | image/jpeg | | 50vw',
      'c.jpg 1x',
    ].join(LF),
  )();
  expect(built).not.toBeNull();
  if (built === null) return;
  const { frag, errors } = parse(built.html);
  expect(errors).toEqual([]);
  const pictureNode = findAll(frag, 'picture')[0]!;
  const kids = pictureNode.childNodes.filter((n) => 'tagName' in n).map((n) => (n as ParsedElement).tagName);
  expect(kids).toEqual(['source', 'source', 'source', 'img']);
  const sources = findAll(frag, 'source');
  expect(sources[0]!.attrs.map((a) => a.name)).toEqual(['srcset', 'type', 'media', 'sizes']);
  expect(sources[1]!.attrs.map((a) => a.name)).toEqual(['srcset', 'type', 'sizes']);
  expect(sources[2]!.attrs.map((a) => a.name)).toEqual(['srcset']);
  for (const source of sources) expect(attrOf(source, 'src')).toBeUndefined();
  expect(attrOf(sources[0]!, 'srcset')).toBe('a-400.avif 400w, a-800.avif 800w');

  // Width descriptors in a source need its sizes, unless the img allows auto sizes (lazy and sizes auto).
  const needsSizes = refusal(picture('a-400.avif 400w | image/avif'));
  expect(needsSizes?.field).toBe('Picture sources');
  expect(needsSizes?.message).toContain('line 1');
  expect(refusal(picture('a-400.avif 400w | image/avif', { loading: 'lazy', sizes: 'auto' }))).toBeNull();
  expect(refusal(picture('a-400.avif 400w | image/avif | | auto', { loading: 'eager' }))?.message).toContain('lazy');
  // A refused srcset or sizes in a source names the line.
  expect(refusal(picture('a.avif 100w, b.avif 2x | image/avif | | 50vw'))?.message).toContain('line 1');
  expect(refusal(picture('a.avif 1x | image/avif | | 50%'))?.message).toContain('line 1');
  expect(refusal(picture('a.avif 1x | image | | '))?.message).toContain('type/subtype');
  expect(refusal(picture('a.avif 1x | image/avif | | 50vw | extra'))?.message).toContain('four cells');
  expect(refusal(picture(' | image/avif'))?.message).toContain('line 1');

  // A picture with no source line is an img inside a picture, with a note saying so.
  const bare = buildMedia({ kind: 'picture', src: 'only.jpg', alt: 'Only', width: '1', height: '1' });
  expect(bare?.html).toBe('<picture>\n  <img src="only.jpg" alt="Only" width="1" height="1">\n</picture>');
  expect(bare?.warnings.join(' ')).toContain('no source');
});

it('WHATWG 4.8.3 an image needs alt text unless it is marked decorative, and width and height are written when given', () => {
  const noAlt = refusal(() => buildMedia({ kind: 'image', src: 'a.png' }));
  expect(noAlt?.field).toBe('Alt text');
  expect(noAlt?.message).toContain('4.8.4.4');
  expect(refusal(() => buildMedia({ kind: 'image', src: 'a.png', alt: '   ' }))?.field).toBe('Alt text');

  // WHATWG 4.8.4.4.8: a purely decorative image uses an empty alt, written as alt with no text.
  const decorative = buildMedia({ kind: 'image', src: 'a.png', decorative: true, width: '320', height: '200' });
  expect(decorative?.html).toBe('<img src="a.png" alt="" width="320" height="200">');
  expect(decorative?.warnings).toEqual([]);
  const both = buildMedia({ kind: 'image', src: 'a.png', alt: 'Words', decorative: true, width: '1', height: '1' });
  expect(both?.html).toBe('<img src="a.png" alt="" width="1" height="1">');
  expect(both?.warnings.join(' ')).toContain('decorative');

  // Attribute order, with srcset and sizes: src, srcset, sizes, alt, width, height, loading, crossorigin.
  const full = buildMedia({
    kind: 'image',
    src: 'photo-800.jpg',
    srcset: 'photo-400.jpg 400w, photo-800.jpg 800w',
    sizes: '(max-width: 600px) 100vw, 800px',
    alt: 'A harbour at dusk',
    width: '800',
    height: '533',
    loading: 'lazy',
    crossorigin: 'anonymous',
  });
  expect(full?.html).toBe(
    '<img src="photo-800.jpg" srcset="photo-400.jpg 400w, photo-800.jpg 800w" sizes="(max-width: 600px) 100vw, 800px" alt="A harbour at dusk" width="800" height="533" loading="lazy" crossorigin="anonymous">',
  );
  expect(full?.warnings).toEqual([]);
  expect(parse(full!.html).errors).toEqual([]);

  // Only srcset is enough, and auto sizes need lazy loading.
  expect(buildMedia({ kind: 'image', srcset: 'a.png 1x, b.png 2x', alt: 'A', width: '1', height: '1' })?.html).toBe(
    '<img srcset="a.png 1x, b.png 2x" alt="A" width="1" height="1">',
  );
  const auto = buildMedia({
    kind: 'image',
    srcset: 'a.png 400w',
    sizes: 'auto',
    loading: 'lazy',
    alt: 'A',
    width: '1',
    height: '1',
  });
  expect(auto?.html).toContain('sizes="auto"');
  expect(
    refusal(() => buildMedia({ kind: 'image', srcset: 'a.png 400w', sizes: 'auto', alt: 'A' }))?.message,
  ).toContain('lazy');
  expect(refusal(() => buildMedia({ kind: 'image', srcset: 'a.png 400w', alt: 'A' }))?.field).toBe('Sizes');
  expect(
    refusal(() => buildMedia({ kind: 'image', src: 'a.png', srcset: 'a.png 1x, b.png 100w', sizes: '50vw', alt: 'A' }))
      ?.field,
  ).toBe('Srcset');

  // A note asks for width and height when either is missing (WHATWG 4.8.3), and a size must be whole pixels.
  const sizeless = buildMedia({ kind: 'image', src: 'a.png', alt: 'A' });
  expect(sizeless?.warnings.join(' ')).toContain('layout shift');
  expect(buildMedia({ kind: 'image', src: 'a.png', alt: 'A', width: '1' })?.warnings.join(' ')).toContain(
    'layout shift',
  );
  expect(refusal(() => buildMedia({ kind: 'image', src: 'a.png', alt: 'A', width: '3.5', height: '1' }))?.field).toBe(
    'Width',
  );
  // Sizes without srcset has no effect, and a script address is kept as typed and flagged.
  expect(
    buildMedia({ kind: 'image', src: 'a.png', alt: 'A', sizes: '50vw', width: '1', height: '1' })?.warnings.join(' '),
  ).toContain('no effect');
  const script = buildMedia({ kind: 'image', src: 'javascript:alert(1)', alt: 'A', width: '1', height: '1' });
  expect(script?.html).toContain('src="javascript:alert(1)"');
  expect(script?.warnings.join(' ')).toContain('javascript:');
});

/** The address-bearing attributes of the preview of every media element, as name and value. */
function addressesIn(html: string): [string, string, string][] {
  const { frag } = parse(html);
  const out: [string, string, string][] = [];
  for (const tag of ['video', 'audio', 'source', 'track', 'img', 'picture']) {
    for (const node of findAll(frag, tag)) {
      for (const name of ['src', 'srcset', 'poster']) {
        const value = attrOf(node, name);
        if (value !== undefined) out.push([tag, name, value]);
      }
    }
  }
  return out;
}

it('the preview loads nothing: every src, srcset, poster and track address is replaced or removed', () => {
  const typed = 'https://example.invalid/typed-address';
  const specs: MediaSpec[] = [
    {
      kind: 'video',
      src: typed + '.webm',
      poster: typed + '.jpg',
      tracks: `${typed}.vtt | captions | en | English`,
      width: '1',
      height: '1',
    },
    {
      kind: 'video',
      mediaSources: `${typed}.webm | video/webm\n${typed}.mp4 | video/mp4`,
      tracks: `${typed}.vtt | captions | en | English`,
    },
    { kind: 'audio', mediaSources: `${typed}.ogg | audio/ogg`, tracks: `${typed}.vtt | chapters | en | Parts` },
    {
      kind: 'image',
      src: typed + '.png',
      srcset: `${typed}-1x.png 1x, ${typed}-2x.png 2x`,
      alt: 'A',
      width: '30',
      height: '20',
    },
    {
      kind: 'picture',
      src: typed + '.jpg',
      srcset: `${typed}-1x.jpg 1x`,
      alt: 'A',
      pictureSources: `${typed}.avif 1x | image/avif | (min-width: 800px)\n${typed}.webp 1x | image/webp`,
      width: '40',
      height: '25',
    },
  ];
  for (const spec of specs) {
    const built = buildMedia(spec);
    expect(built, JSON.stringify(spec)).not.toBeNull();
    if (built === null) continue;
    expect(built.html, 'the markup keeps the address').toContain('example.invalid');
    expect(built.preview, 'the preview holds no part of the typed address').not.toContain('example.invalid');
    expect(parse(built.preview).errors).toEqual([]);
    for (const [tag, name, value] of addressesIn(built.preview)) {
      // The only address a preview may carry is a data placeholder, on an image or a picture source.
      expect(['img', 'source'], `${spec.kind}: ${tag} ${name}`).toContain(tag);
      expect(tag === 'img' ? name === 'src' : name === 'srcset').toBe(true);
      expect(value.startsWith('data:image/svg+xml,')).toBe(true);
    }
  }
  // An image gets a placeholder sized from its own width and height, and the source type becomes the placeholder type.
  const image = buildMedia({ kind: 'image', srcset: 'a.png 1x', alt: 'A', width: '30', height: '20' });
  const src = attrOf(findAll(parse(image!.preview).frag, 'img')[0]!, 'src') ?? '';
  expect(decodeURIComponent(src)).toContain('width="30" height="20"');
  const pic = buildMedia({
    kind: 'picture',
    src: 'a.jpg',
    alt: 'A',
    pictureSources: 'a.avif 1x | image/avif | (min-width: 800px)\nb.webp 1x | image/webp',
  });
  const picSources = findAll(parse(pic!.preview).frag, 'source');
  expect(picSources.map((s) => attrOf(s, 'type'))).toEqual(['image/svg+xml', 'image/svg+xml']);
  expect(attrOf(picSources[0]!, 'media')).toBe('(min-width: 800px)');
});

const BENIGN = 'plain';

/** For each media kind: a plain spec that gives output, and the free-text fields hostile text is put in. */
const FREE_MEDIA: { plain: MediaSpec; free: [keyof MediaSpec, (h: string) => string][] }[] = [
  {
    plain: {
      kind: 'video',
      src: 'v.webm',
      poster: 'p.jpg',
      tracks: 'a.vtt | captions | en | English',
      fallback: 'Old browser',
      width: '1',
      height: '1',
      controls: true,
    },
    free: [
      ['src', (h) => h],
      ['poster', (h) => h],
      ['tracks', (h) => `${h} | captions | en | ${h}`],
      ['fallback', (h) => h],
    ],
  },
  {
    plain: {
      kind: 'audio',
      mediaSources: 'a.ogg | audio/ogg | (min-width: 1px)',
      tracks: 'a.vtt | captions | en | English',
      fallback: 'Old browser',
      controls: true,
    },
    free: [
      ['mediaSources', (h) => `${h} | audio/ogg | ${h}`],
      ['tracks', (h) => `${h} | captions | en | ${h}`],
      ['fallback', (h) => h],
    ],
  },
  {
    plain: {
      kind: 'image',
      src: 'a.png',
      srcset: 'a-1x.png 1x, a-2x.png 2x',
      alt: 'Alt',
      width: '1',
      height: '1',
    },
    free: [
      ['src', (h) => h],
      ['alt', (h) => h],
      ['srcset', (h) => `${h} 1x, a-2x.png 2x`],
    ],
  },
  {
    plain: {
      kind: 'picture',
      src: 'a.png',
      alt: 'Alt',
      pictureSources: 'a.avif 1x | image/avif | (min-width: 1px)',
      width: '1',
      height: '1',
    },
    free: [
      ['src', (h) => h],
      ['alt', (h) => h],
      ['pictureSources', (h) => `${h} 1x | image/avif | ${h}`],
    ],
  },
];

it('hostile text in every free-text field leaves the parsed media tree unchanged', () => {
  expect(FREE_MEDIA.map((entry) => entry.plain.kind).sort()).toEqual([...MEDIA_KINDS].sort());
  for (const { plain, free } of FREE_MEDIA) {
    const baseline = buildMedia(plain);
    if (baseline === null) throw new Error(`${plain.kind}: the plain spec gives no output`);
    const expected = shape(parse(baseline.html).frag);
    expect(parse(baseline.html).errors, plain.kind).toEqual([]);
    for (const [field, fill] of free) {
      for (const hostile of [BENIGN, ...HOSTILE]) {
        const value = fill(hostile);
        let built;
        try {
          built = buildMedia({ ...plain, [field]: value } as MediaSpec);
        } catch (err) {
          // A value HTML cannot carry, or one a list cannot read (spaces inside an address), is refused naming a field.
          expect(err, `${plain.kind} ${String(field)}`).toBeInstanceOf(MarkupError);
          continue;
        }
        if (built === null) throw new Error(`${plain.kind} ${String(field)}: hostile text gives no output`);
        const label = `${plain.kind} ${String(field)} ${hostile.slice(0, 20)}`;
        const parsed = parse(built.html);
        expect(parsed.errors, label).toEqual([]);
        expect(shape(parsed.frag), label).toBe(expected);
        // The preview parses cleanly and carries no address except a data placeholder.
        const preview = parse(built.preview);
        expect(preview.errors, label).toEqual([]);
        for (const [, , address] of addressesIn(built.preview)) {
          expect(address.startsWith('data:image/svg+xml,'), label).toBe(true);
        }
        expect(preview.frag.childNodes.length, label).toBeGreaterThan(0);
        expect(shape(preview.frag), label).not.toContain('script');
      }
    }
  }
});

it('no source and no src gives a message naming the field, and the source, track and candidate caps are enforced', () => {
  // Nothing typed gives no output for every kind.
  for (const kind of MEDIA_KINDS) expect(buildMedia({ kind }), `${kind} with nothing typed`).toBeNull();

  // Once anything else is typed, the missing address is named.
  expect(refusal(() => buildMedia({ kind: 'video', width: '1' }))?.field).toBe('Media address');
  expect(refusal(() => buildMedia({ kind: 'audio', fallback: 'x' }))?.field).toBe('Media address');
  expect(refusal(() => buildMedia({ kind: 'image', alt: 'A', width: '1' }))?.field).toBe('Image address');
  expect(refusal(() => buildMedia({ kind: 'picture', alt: 'A', width: '1' }))?.field).toBe('Image address');
  expect(refusal(() => buildMedia({ kind: 'picture', pictureSources: 'a.avif 1x', alt: 'A' }))?.field).toBe(
    'Image address',
  );

  // One source line is accepted and no src is then needed.
  expect(buildMedia({ kind: 'video', mediaSources: 'a.webm | video/webm', controls: true })?.html).toContain('<source');

  // Exactly 20 sources, tracks and candidates are accepted; 21 are refused naming the cap of 20.
  const sources = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}.webm | video/webm`).join(LF);
  expect(refusal(() => buildMedia({ kind: 'video', mediaSources: sources(20) }))).toBeNull();
  const tooManySources = refusal(() => buildMedia({ kind: 'video', mediaSources: sources(21) }));
  expect(tooManySources?.field).toBe('Sources');
  expect(tooManySources?.message).toContain('20');

  const tracks = (n: number) =>
    Array.from({ length: n }, (_, i) => `t${i + 1}.vtt | captions | en | L${i + 1}`).join(LF);
  expect(refusal(() => buildMedia({ kind: 'video', src: 'v.webm', tracks: tracks(20) }))).toBeNull();
  const tooManyTracks = refusal(() => buildMedia({ kind: 'video', src: 'v.webm', tracks: tracks(21) }));
  expect(tooManyTracks?.field).toBe('Tracks');
  expect(tooManyTracks?.message).toContain('20');

  const candidates = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}.png ${i + 1}x`).join(', ');
  expect(refusal(() => buildMedia({ kind: 'image', srcset: candidates(20), alt: 'A' }))).toBeNull();
  const tooManyCandidates = refusal(() => buildMedia({ kind: 'image', srcset: candidates(21), alt: 'A' }));
  expect(tooManyCandidates?.field).toBe('Srcset');
  expect(tooManyCandidates?.message).toContain('20');

  const pictureSources = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}.avif 1x | image/avif`).join(LF);
  expect(
    refusal(() => buildMedia({ kind: 'picture', src: 'a.jpg', alt: 'A', pictureSources: pictureSources(20) })),
  ).toBeNull();
  const tooManyPicture = refusal(() =>
    buildMedia({ kind: 'picture', src: 'a.jpg', alt: 'A', pictureSources: pictureSources(21) }),
  );
  expect(tooManyPicture?.field).toBe('Picture sources');
  expect(tooManyPicture?.message).toContain('20');

  // A field longer than 20,000 characters is refused before it is read.
  expect(refusal(() => buildMedia({ kind: 'image', src: 'a'.repeat(20001), alt: 'A' }))?.message).toContain('20,000');
});
