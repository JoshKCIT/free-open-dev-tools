import type { Frame } from './trace';

/** One line of the decoded trace: the text to show, and whether a filter has removed it. */
export interface DecodedLine {
  text: string;
  hidden: boolean;
}

/** The name a decoded frame shows: the call-site reading when there is one, else the name as the engine printed it. */
export function displayName(frame: Frame, callSite: string | null): string {
  if (callSite === null) return frame.functionName;
  return frame.functionName.startsWith('new ') ? `new ${callSite}` : callSite;
}

/**
 * Writes a frame again in the shape it came in, with the original place and the best function name in place of the
 * generated ones: `    at name (source:line:column)` for V8, `name@source:line:column` for SpiderMonkey and JavaScriptCore.
 */
export function decodedFrameText(frame: Frame, place: string, callSite: string | null): string {
  const name = displayName(frame, callSite);
  if (frame.style === 'gecko') return `${frame.indent}${name}@${place}`;
  const async = frame.async ? 'async ' : '';
  return name === '' ? `${frame.indent}at ${async}${place}` : `${frame.indent}at ${async}${name} (${place})`;
}

/** The decoded trace as text: every line that is not hidden, in the order of the pasted trace, joined by line feeds. */
export function formatDecodedTrace(lines: readonly DecodedLine[]): string {
  const out: string[] = [];
  for (const line of lines) if (!line.hidden) out.push(line.text);
  return out.join('\n');
}
