/**
 * The default path of a cookie (draft-ietf-httpbis-rfc6265bis-22 section 5.1.4): the path of the response address up to,
 * but not including, its right-most slash; a path with no more than one slash, or one that does not start with a slash,
 * gives `/`.
 */
export function defaultPath(path: string): string {
  if (path === '' || path.charCodeAt(0) !== 47) return '/';
  const last = path.lastIndexOf('/');
  if (last === 0) return '/';
  return path.slice(0, last);
}
