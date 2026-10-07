/** What a map says about which file it belongs to. */
export interface MapClaim {
  /** The map's `file` field, or null. */
  file: string | null;
  /** The name of the opened file the map came from (for example `min.js.map`), or null for a pasted map. */
  openedName: string | null;
}

/** How a frame came to be given a map. */
export type MatchHow = 'file' | 'opened' | 'base' | 'only';

export type Match =
  | { kind: 'matched'; map: number; how: MatchHow }
  /** Several maps claim the file equally well; none is chosen. */
  | { kind: 'several'; count: number }
  /** Maps were given and none claims the file. */
  | { kind: 'none' }
  /** No map was given at all. */
  | { kind: 'no-maps' };

/** An address without its query string and fragment, and with backslashes read as slashes. */
function pathOf(address: string): string {
  let end = address.length;
  const query = address.indexOf('?');
  if (query !== -1) end = query;
  const hash = address.indexOf('#');
  if (hash !== -1 && hash < end) end = hash;
  return address.slice(0, end).split('\\').join('/');
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** True when `path` is `name` or ends with it after a slash (a name that starts with a slash must end the path). */
function namesPath(path: string, name: string): boolean {
  if (name === '') return false;
  if (path === name) return true;
  return name.startsWith('/') ? path.endsWith(name) : path.endsWith('/' + name);
}

function withoutMapSuffix(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.map')) return name.slice(0, -4);
  return name;
}

/**
 * Chooses a map for each frame address. In order, and stopping at the first step where any map claims the file:
 *  1. the map's `file` field names the address (the whole name, or its end after a slash);
 *  2. the name of the opened file, without `.map`, names the address the same way;
 *  3. the base name (the last part) of the `file` field or of the opened name equals the base name of the address.
 * Exactly one claiming map is a match; several are reported as such and none is guessed. When no frame at all is
 * claimed and exactly one map was given, that map is applied to every frame, and the match says so (`only`).
 */
export function matchMaps(frames: readonly { url: string }[], maps: readonly MapClaim[]): Match[] {
  if (maps.length === 0) return frames.map(() => ({ kind: 'no-maps' }));
  const files = maps.map((m) => (m.file === null ? null : pathOf(m.file)));
  const opened = maps.map((m) => (m.openedName === null ? null : withoutMapSuffix(pathOf(m.openedName))));
  const results: Match[] = frames.map((frame): Match => {
    const path = pathOf(frame.url);
    const base = baseName(path);
    const pick = (hits: number[], how: MatchHow): Match | null => {
      if (hits.length === 0) return null;
      const first = hits[0];
      return hits.length === 1 && first !== undefined
        ? { kind: 'matched', map: first, how }
        : { kind: 'several', count: hits.length };
    };
    const byFile: number[] = [];
    const byOpened: number[] = [];
    const byBase: number[] = [];
    for (let i = 0; i < maps.length; i++) {
      const f = files[i] ?? null;
      const o = opened[i] ?? null;
      if (f !== null && namesPath(path, f)) byFile.push(i);
      if (o !== null && namesPath(path, o)) byOpened.push(i);
      if (base !== '' && ((f !== null && baseName(f) === base) || (o !== null && baseName(o) === base))) byBase.push(i);
    }
    return pick(byFile, 'file') ?? pick(byOpened, 'opened') ?? pick(byBase, 'base') ?? { kind: 'none' };
  });
  if (maps.length === 1 && frames.length > 0 && results.every((r) => r.kind === 'none')) {
    return frames.map((): Match => ({ kind: 'matched', map: 0, how: 'only' }));
  }
  return results;
}
