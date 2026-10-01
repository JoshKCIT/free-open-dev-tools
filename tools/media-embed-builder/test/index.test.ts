import { it, expect } from 'vitest';
import { MarkupError, buildMedia, meta, parseTrackLines } from '../src/index';
import { TRACK_KINDS } from '../src/spec-data';
import { attrOf, findAll, parse } from './parse';

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
