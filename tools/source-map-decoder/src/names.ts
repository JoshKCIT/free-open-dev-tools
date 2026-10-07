/** What the name of a frame's function is read from: the name the map gives at each frame's own position. */
export interface NamedFrame {
  /** The name the map holds at the position of this frame, or null. */
  name: string | null;
}

/**
 * The function name of frame `index`, read from the call site: the next frame (its caller) stands at the place the
 * function was called, and a map names the token at a position, so the name mapped at the caller's position is the
 * name of the function that was called. A map names the token at a position, not the function around it, so this is a
 * best reading, not a fact: it is null when the next frame has no name here, and the last frame never has one.
 */
export function callSiteName(frames: readonly NamedFrame[], index: number): string | null {
  const next = frames[index + 1];
  return next?.name ?? null;
}
