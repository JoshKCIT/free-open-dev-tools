/**
 * Reads one record of comma-separated values the way docker reads the value of --mount, --gpus and a long-form
 * --network: fields are split at commas, a field that starts with a double quote runs to the closing quote (a doubled
 * quote inside is one quote), and a quote anywhere else in a field, or text after a closing quote, makes the record
 * malformed. Returns null for a malformed record.
 */
export function readCsvRecord(text: string): string[] | null {
  const fields: string[] = [];
  let i = 0;
  for (;;) {
    let field = '';
    if (text[i] === '"') {
      i += 1;
      for (;;) {
        if (i >= text.length) return null;
        const ch = text[i]!;
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        field += ch;
        i += 1;
      }
      if (i < text.length && text[i] !== ',') return null;
    } else {
      const comma = text.indexOf(',', i);
      const end = comma < 0 ? text.length : comma;
      const raw = text.slice(i, end);
      if (raw.includes('"')) return null;
      field = raw;
      i = end;
    }
    fields.push(field);
    if (i >= text.length) return fields;
    i += 1; // the comma
  }
}
