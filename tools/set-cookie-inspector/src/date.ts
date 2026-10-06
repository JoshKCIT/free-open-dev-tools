/**
 * The cookie date algorithm of draft-ietf-httpbis-rfc6265bis-22 section 5.1.1: a lenient reading of the date in an Expires
 * attribute. The text is cut into tokens at the delimiters, each token is tried as a time, a day of the month, a month
 * and a year in that order, and the first token that fits a part which is not yet found sets it. Day names, time zones and
 * the order of the parts do not matter.
 *
 * Two-digit years differ from the rule of the email standard: 70 to 99 mean 1970 to 1999 and 0 to 69 mean 2000 to 2069.
 * The scan reads at most 1,000 tokens, so a hostile text costs a bounded amount of work.
 */

const MAX_TOKENS = 1000;

const MONTHS: readonly string[] = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** %x09 / %x20-2F / %x3B-40 / %x5B-60 / %x7B-7E */
function isDelimiter(code: number): boolean {
  return (
    code === 0x09 ||
    (code >= 0x20 && code <= 0x2f) ||
    (code >= 0x3b && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** How many digits start at `at` (stops at the end of the token). */
function digitRun(token: string, at: number): number {
  let i = at;
  while (i < token.length && isDigit(token.charCodeAt(i))) i += 1;
  return i - at;
}

/** hms-time [ non-digit *OCTET ]: three fields of one or two digits joined by colons, then nothing or a non-digit. */
function matchTime(token: string): { hour: number; minute: number; second: number } | null {
  const values: number[] = [];
  let at = 0;
  for (let field = 0; field < 3; field++) {
    const run = digitRun(token, at);
    if (run < 1 || run > 2) return null;
    values.push(Number(token.slice(at, at + run)));
    at += run;
    if (field < 2) {
      if (token.charCodeAt(at) !== 58) return null;
      at += 1;
    }
  }
  // After the last field comes the end of the token or a non-digit; two digits were taken, so a third would be a digit.
  if (at < token.length && isDigit(token.charCodeAt(at))) return null;
  const [hour, minute, second] = values;
  return { hour: hour ?? 0, minute: minute ?? 0, second: second ?? 0 };
}

/** 1*2DIGIT [ non-digit *OCTET ] */
function matchDay(token: string): number | null {
  const run = digitRun(token, 0);
  if (run < 1 || run > 2) return null;
  return Number(token.slice(0, run));
}

/** ( "jan" / ... / "dec" ) *OCTET, in any letter case. */
function matchMonth(token: string): number | null {
  if (token.length < 3) return null;
  const name = token.slice(0, 3).toLowerCase();
  const index = MONTHS.indexOf(name);
  return index < 0 ? null : index;
}

/** 2*4DIGIT [ non-digit *OCTET ] */
function matchYear(token: string): number | null {
  const run = digitRun(token, 0);
  if (run < 2 || run > 4) return null;
  return Number(token.slice(0, run));
}

/**
 * Reads a cookie date and returns it in milliseconds since 1970 (UTC), or null when the algorithm fails: a part is
 * missing, the day is not 1 to 31, the year is below 1601, the hour is above 23, the minute or second above 59, or the day
 * does not exist in that month.
 */
export function parseCookieDate(text: string): number | null {
  let time: { hour: number; minute: number; second: number } | null = null;
  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;
  let tokens = 0;
  let i = 0;
  const length = text.length;
  while (i < length && tokens < MAX_TOKENS) {
    while (i < length && isDelimiter(text.charCodeAt(i))) i += 1;
    if (i >= length) break;
    const start = i;
    while (i < length && !isDelimiter(text.charCodeAt(i))) i += 1;
    const token = text.slice(start, i);
    tokens += 1;
    if (time === null) {
      const found = matchTime(token);
      if (found !== null) {
        time = found;
        continue;
      }
    }
    if (day === null) {
      const found = matchDay(token);
      if (found !== null) {
        day = found;
        continue;
      }
    }
    if (month === null) {
      const found = matchMonth(token);
      if (found !== null) {
        month = found;
        continue;
      }
    }
    if (year === null) {
      const found = matchYear(token);
      if (found !== null) year = found;
    }
  }
  if (time === null || day === null || month === null || year === null) return null;
  // Steps 3 and 4: two-digit years.
  if (year >= 70 && year <= 99) year += 1900;
  else if (year >= 0 && year <= 69) year += 2000;
  // Step 5.
  if (day < 1 || day > 31 || year < 1601 || time.hour > 23 || time.minute > 59 || time.second > 59) return null;
  // Step 6: a date that does not exist (31 February) fails.
  const at = Date.UTC(year, month, day, time.hour, time.minute, time.second);
  const check = new Date(at);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) return null;
  return at;
}
