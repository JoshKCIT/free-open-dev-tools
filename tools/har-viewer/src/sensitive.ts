export const SENSITIVE_HEADERS: readonly string[] = [];
export const SENSITIVE_PARAMS: readonly string[] = [];

export function isSensitive(kind: 'header' | 'cookie' | 'param', name: string, value: string): boolean {
  void kind;
  void name;
  void value;
  throw new Error('not implemented');
}

export function maskValue(value: string): string {
  void value;
  throw new Error('not implemented');
}
