/**
 * Small address literal checks for the SPF grammar (RFC 7208 section 12): written here because a page cannot use Node's net
 * module. Both are cross-checked against Node's isIPv4 and isIPv6 in a test; the one named difference is that Node accepts a
 * zone id after an IPv6 address (::1%eth0), while the text forms the grammar cites (RFC 4291 section 2.2) have none.
 */

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isHex(code: number): boolean {
  return isDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/** ip4-network (RFC 7208 section 12): four numbers from 0 to 255 with no leading zero, separated by periods. */
export function isIp4Literal(text: string): boolean {
  // The longest form is 255.255.255.255, so anything longer is refused before it is scanned.
  if (text.length < 7 || text.length > 15) return false;
  let parts = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const code = i < text.length ? text.charCodeAt(i) : 46;
    if (code !== 46) {
      if (!isDigit(code)) return false;
      continue;
    }
    const length = i - start;
    if (length === 0 || length > 3) return false;
    if (length > 1 && text.charCodeAt(start) === 48) return false;
    if (Number(text.slice(start, i)) > 255) return false;
    parts++;
    start = i + 1;
  }
  return parts === 4;
}

/**
 * An IPv6 address in the text forms of RFC 4291 section 2.2: eight groups of one to four hex digits, one :: standing for one
 * or more groups of zeros, and an IPv4 address in the last 32 bits. No zone id.
 */
export function isIp6Literal(text: string): boolean {
  const n = text.length;
  // The longest form is 45 characters (an IPv4 tail after six groups), so anything longer is refused before it is scanned.
  if (n < 2 || n > 45) return false;
  let compressed = false;
  let groups = 0;
  let i = 0;
  if (text.charCodeAt(0) === 58) {
    if (text.charCodeAt(1) !== 58) return false;
    compressed = true;
    i = 2;
    if (i === n) return true;
  }
  while (i < n) {
    let j = i;
    let dotted = false;
    while (j < n && text.charCodeAt(j) !== 58) {
      if (text.charCodeAt(j) === 46) dotted = true;
      j++;
    }
    const segment = text.slice(i, j);
    if (dotted) {
      // An IPv4 address is allowed only as the last 32 bits.
      if (j !== n || !isIp4Literal(segment)) return false;
      groups += 2;
    } else {
      if (segment.length < 1 || segment.length > 4) return false;
      for (let k = 0; k < segment.length; k++) if (!isHex(segment.charCodeAt(k))) return false;
      groups += 1;
    }
    if (j === n) break;
    if (text.charCodeAt(j + 1) === 58) {
      if (compressed) return false;
      compressed = true;
      i = j + 2;
      if (i === n) break;
    } else {
      i = j + 1;
      if (i === n) return false;
    }
  }
  return compressed ? groups <= 7 : groups === 8;
}
