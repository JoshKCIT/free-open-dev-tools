/**
 * The catalog gate's source scan for code that could send something out of the page, kept free of file access so each
 * pattern can be tested on its own (scripts/test/no-network-scan.test.mjs). `scripts/check-catalog.mjs` runs it over
 * every tool package source file, every tool page and the shared site code.
 */

/**
 * Removes comments and string literals before scanning for network calls.
 *
 * Without this the check fires on documentation and on test data: the case
 * converter legitimately uses "XMLHttpRequest" as an example identifier. What
 * matters is whether the code can actually call these, not whether it names them.
 */
export function stripStringsAndComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        // A template literal can contain real code inside ${ }.
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            if (depth > 0) i++;
          }
          out += ' ' + source.slice(start, i) + ' ';
          i++;
          continue;
        }
        i++;
      }
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * What no tool or shared site code may contain once strings and comments are gone, each with the label the gate prints.
 *
 * The WebRTC and WebTransport names are matched wherever they appear, so reaching them as a member
 * (`new window.RTCPeerConnection()`, `globalThis.WebTransport`) is caught as well as the bare name. A page policy does
 * not govern WebRTC in every browser, so this scan and the lint rules are the layers that keep it out.
 */
export const FORBIDDEN = [
  [/\bfetch\s*\(/, 'fetch('],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/navigator\.sendBeacon/, 'navigator.sendBeacon'],
  [/new\s+WebSocket/, 'new WebSocket'],
  [/new\s+EventSource/, 'new EventSource'],
  [/import\s*\(\s*['"]https?:/, 'a remote dynamic import'],
  [
    /\b(?:webkit)?RTCPeerConnection\b|\bRTCDataChannel\b|\bWebTransport\b/,
    'a peer connection, data channel or transport',
  ],
];

/** The labels of every forbidden pattern found in `source` after its strings and comments are removed. */
export function forbiddenIn(source) {
  const code = stripStringsAndComments(source);
  return FORBIDDEN.filter(([pattern]) => pattern.test(code)).map(([, label]) => label);
}
