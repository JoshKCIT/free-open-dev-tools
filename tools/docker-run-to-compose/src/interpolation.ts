/**
 * True when `text` holds a variable that Compose fills in: a dollar sign followed by a name or by an opening brace. The
 * tokenizer writes a literal dollar sign as `$$`, so a doubled dollar sign is skipped as one unit and is not a variable.
 */
export function hasInterpolation(text: string): boolean {
  let i = text.indexOf('$');
  while (i >= 0) {
    const next = text[i + 1];
    if (next === '$') {
      i = text.indexOf('$', i + 2);
      continue;
    }
    if (
      next === '{' ||
      (next !== undefined && ((next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z') || next === '_'))
    ) {
      return true;
    }
    i = text.indexOf('$', i + 1);
  }
  return false;
}
