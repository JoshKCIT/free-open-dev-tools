import { it, expect } from 'vitest';
import { MarkupError, buildMedia, meta, parseSourceLines, parseTrackLines, type MediaSpec } from '../src/index';
import { TRACK_KINDS } from '../src/spec-data';
import { attrOf, findAll, parse, textOf, type ParsedElement } from './parse';

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
