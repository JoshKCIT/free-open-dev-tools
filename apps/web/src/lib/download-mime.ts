/**
 * The Blob type the shared Download button gives a text download, chosen from the file name alone.
 *
 * Why it matters: when a file with no extension (an SSH key such as `id_ed25519`, or a name such as `_headers`) is saved
 * from a `text/plain` Blob, Chromium and Windows WebKit add `.txt` to the saved name, and ssh will not find the key. A
 * Blob of type `application/octet-stream` is saved under exactly the name given, so those names get that type. A name that
 * already carries an extension keeps the plain text type, which is what lets a browser keep its own handling of `.pem`,
 * `.pub`, `.h` and the like. A leading-dot name such as `.gitignore` counts as having an extension.
 *
 * The name is always one of the fixed names the pages write; nothing here reads any input.
 */

/** The three names SSH looks for by default. They have no extension, so the extension test would catch them as well. */
export const KEY_FILE_NAMES: readonly string[] = Object.freeze(['id_rsa', 'id_ecdsa', 'id_ed25519']);

const HAS_EXTENSION = /\.[A-Za-z0-9]+$/;

const TEXT_TYPE = 'text/plain;charset=utf-8';
const BINARY_TYPE = 'application/octet-stream';

/** The Blob type for a downloaded text file with this name. */
export function downloadMime(name: string): string {
  if (KEY_FILE_NAMES.includes(name)) return BINARY_TYPE;
  return HAS_EXTENSION.test(name) ? TEXT_TYPE : BINARY_TYPE;
}
