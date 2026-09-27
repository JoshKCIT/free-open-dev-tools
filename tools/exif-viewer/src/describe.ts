/**
 * One place every visitor-facing sentence this tool uses to describe a
 * removed metadata segment or chunk lives, so `strip-jpeg.ts`, `strip-png.ts`
 * and `strip-webp.ts` never each invent their own wording for the same kind
 * of removal (the `describeSource` precedent in `apps/web/src/tools/data-uri.ts`).
 * Nothing here names a container format's own segment or chunk names --
 * those already appear in the `list` output block's own labelled entries;
 * this file only says, in plain words, what kind of information left the
 * file.
 */

export type RemovalReason =
  'exif' | 'xmp' | 'iptc' | 'comment' | 'colour-profile' | 'trailing-data' | 'timestamp' | 'unrecognised';

const SENTENCES: Record<RemovalReason, string> = {
  exif: 'the camera and location metadata (Exif)',
  xmp: 'the embedded XMP information block',
  iptc: 'captions and keywords (Photoshop/IPTC)',
  comment: 'a text comment',
  'colour-profile': 'the embedded colour profile',
  'trailing-data': 'data appended after the end of the picture',
  timestamp: 'the last-modified date the file itself carried',
  unrecognised: 'an unrecognised metadata block',
};

/** The plain sentence for a removal reason, optionally naming a detail such as the chunk type that triggered it. */
export function describeRemoval(reason: RemovalReason, detail?: string): string {
  const sentence = SENTENCES[reason];
  return detail ? `${sentence} (${detail})` : sentence;
}
