/**
 * The sentences the hex viewer's background search shows when it fails for a reason that is not the viewer's own.
 *
 * This is a module of its own, with no import and no side effect, for two reasons. The worker module posts its ready
 * message the moment it is loaded and imports the tool package, which resolves to a built folder, so a unit test cannot
 * load it; this file can be loaded by one. And the rule it keeps is easy to state here: an error that is not the
 * viewer's own (a picked file that vanished or changed after it was picked, a browser read that was aborted, a library
 * error nobody expected) carries the browser's or a library's own words, and those words can name a path or a detail
 * the visitor has no use for. So the error's text and name are only ever tested to tell a memory failure from any other
 * failure, and are never sent: one fixed sentence goes to the page.
 */

/** A memory failure: the search ran out of memory. */
export const HEX_VIEWER_MEMORY_MESSAGE = 'The search needed more memory than this tab could give.';

/** A picked file that could not be read for a reason that is not the viewer's own. Same words the page shows for the same cause. */
export const HEX_VIEWER_FILE_MESSAGE =
  'Could not read that file. If it changed or moved after you picked it, pick it again.';

/** Pasted bytes (or a message with no job) that failed for a reason nobody expected. */
export const HEX_VIEWER_UNKNOWN_MESSAGE = 'The background task failed for an unknown reason.';

/**
 * The one sentence for any failure that is not a HexViewerError. A memory-like failure gives the memory sentence for a
 * file or for pasted bytes; otherwise a picked file gives the file sentence and anything else the unknown sentence.
 */
export function hexViewerUnknownFailure(err: unknown, kind: 'file' | 'bytes' | undefined): string {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/RangeError|Invalid (array|string) length|allocation|memory/i.test(text)) return HEX_VIEWER_MEMORY_MESSAGE;
  return kind === 'file' ? HEX_VIEWER_FILE_MESSAGE : HEX_VIEWER_UNKNOWN_MESSAGE;
}
