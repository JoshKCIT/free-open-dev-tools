/**
 * The size limits of this tool. The two diagram caps stand in for the time limit a worker would give: the engine
 * cannot run in a worker and a busy frame holds the page that owns it, so the work is bounded by the size of the
 * diagram, chosen from measured worst cases (about 3.2 seconds).
 */

/** A diagram longer than this many characters is refused before anything runs. */
export const MAX_DIAGRAM_CHARS = 20_000;

/** A diagram with more lines than this is refused before anything runs. */
export const MAX_DIAGRAM_LINES = 300;

/** A drawn SVG larger than this many UTF-8 bytes is refused. */
export const MAX_SVG_BYTES = 5 * 1024 * 1024;

/** A PNG with more pixels than this is refused. */
export const MAX_PNG_PIXELS = 16_000_000;

/** A PNG wider or taller than this many pixels is refused. */
export const MAX_PNG_SIDE = 8192;

/** The PNG scales on offer. */
export const PNG_SCALES: readonly number[] = [1, 2, 3, 4];
