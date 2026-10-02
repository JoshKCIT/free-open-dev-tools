/**
 * Turns the text leaves of a value read from XML into numbers and booleans (canonical file, copied byte for byte
 * into every folder that reads XML for its types). It has no dependency.
 *
 * XML holds only text, so a reader that wants numbers and booleans has to decide which text counts. The rule here is
 * the one JSON itself uses (RFC 8259 section 6 and section 3): a leaf is a number only when it is written the way a
 * JSON number is written, with no leading zeros, no plus sign, no hexadecimal and no surrounding spaces, and it is a
 * boolean only when it is exactly `true` or `false`. A postcode such as `01234` or a phone number such as `+4412`
 * therefore stays text. Everything else stays a string. Keys are never changed.
 */

const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

function typeLeaf(text: string): unknown {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (JSON_NUMBER.test(text)) {
    const n = Number(text);
    // -0 and a number outside the range of a double (such as 1e999) would change on the way, so they stay text.
    if (Number.isFinite(n) && !Object.is(n, -0)) return n;
  }
  return text;
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Copies `value` with every string leaf typed by the rule above. The value must already be within the reader's depth
 * limit (the XML reader checks it), so plain recursion is safe.
 */
export function typeXmlValues(value: unknown): unknown {
  if (typeof value === 'string') return typeLeaf(value);
  if (Array.isArray(value)) return value.map((item) => typeXmlValues(item));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      setOwn(out, key, typeXmlValues((value as Record<string, unknown>)[key]));
    }
    return out;
  }
  return value;
}
