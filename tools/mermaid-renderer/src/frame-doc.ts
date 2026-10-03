import { MAX_DIAGRAM_CHARS, MAX_DIAGRAM_LINES } from './limits';

/**
 * The policy of the frame the diagram is drawn in. Nothing may be loaded from anywhere: scripts and styles only as the
 * text of the document itself, and images only as `data:` addresses. The document that holds it is given no origin by
 * the page (a sandbox without `allow-same-origin`), so it cannot reach the page's storage either.
 */
/**
 * The size of the frame the diagram is drawn in, in pixels. The engine sizes some diagrams (a Gantt chart, for one) to
 * the width of the document it draws in, and a document with no width gives a drawing with no size, so the frame is
 * given a fixed one that does not depend on the visitor's window: the same diagram is the same size on every device.
 */
export const FRAME_WIDTH_PX = 1024;
export const FRAME_HEIGHT_PX = 768;

export const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";

/** The Mermaid themes the page offers, compared exactly. */
const THEME_NAMES: readonly string[] = ['default', 'neutral', 'dark', 'forest', 'base'];

/**
 * The Mermaid configuration. The security level is strict, labels are drawn as SVG text (HTML labels are not well
 * formed XML, and PNG and SVG export both need well formed XML), and the engine's own size limits match this tool's.
 * Diagram text cannot change `securityLevel`, `startOnLoad` or `maxTextSize` from inside the diagram.
 */
export function mermaidConfig(theme: string) {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme,
    maxTextSize: MAX_DIAGRAM_CHARS,
    maxEdges: MAX_DIAGRAM_LINES,
  };
}

/**
 * The script that runs in the frame after the Mermaid bundle. It tells its parent it is ready, and for each
 * `{ kind: 'render', id, text, theme }` message from its parent (and only from its parent) draws the diagram and
 * posts `{ kind: 'done', id, svg }`, or `{ kind: 'error', id, line, expecting, unknownType }` with the line of the
 * parser's own location, the clause of its message that lists what it expected, and whether the diagram type was not
 * recognised. It never posts the diagram text.
 */
function bootScript(): string {
  const base = mermaidConfig('default');
  return [
    '(function () {',
    `  var BASE = ${JSON.stringify(base)};`,
    `  var THEMES = ${JSON.stringify(THEME_NAMES)};`,
    '  function send(message) { parent.postMessage(message, "*"); }',
    '  function messageOf(error) { return String((error && error.message) || ""); }',
    '  function expectingOf(message) {',
    '    var at = -1;',
    '    var stop;',
    '    if (message.indexOf("Parse error on line") === 0) {',
    '      at = message.indexOf("^\\nExpecting");',
    '      if (at >= 0) at += 2;',
    '      stop = ", got ";',
    '    } else if (message.indexOf("Parsing failed") === 0) {',
    '      at = message.indexOf("Expecting token of type");',
    '      stop = " but found";',
    '    }',
    '    if (at < 0) return undefined;',
    '    var clause = message.slice(at);',
    '    var cut = clause.indexOf(stop);',
    '    if (cut > 0) clause = clause.slice(0, cut);',
    '    var lineBreak = clause.indexOf("\\n");',
    '    if (lineBreak > 0) clause = clause.slice(0, lineBreak);',
    '    return clause.slice(0, 200);',
    '  }',
    '  function lineOf(error, message) {',
    '    var loc = error && error.hash && error.hash.loc;',
    '    if (loc && typeof loc.first_line === "number") return loc.first_line;',
    '    if (message.indexOf("Parsing failed") === 0 || message.indexOf("Lexical error") === 0) {',
    '      var at = message.indexOf("on line ");',
    '      var number = at >= 0 ? parseInt(message.slice(at + 8, at + 16), 10) : 0;',
    '      if (number >= 1) return number;',
    '    }',
    '    return undefined;',
    '  }',
    '  addEventListener("message", function (event) {',
    '    var data = event.data;',
    '    if (event.source !== parent || !data || data.kind !== "render") return;',
    '    var id = data.id;',
    '    var theme = THEMES.indexOf(data.theme) >= 0 ? data.theme : "default";',
    '    var config = Object.assign({}, BASE, { theme: theme });',
    '    Promise.resolve()',
    '      .then(function () {',
    '        mermaid.initialize(config);',
    '        return mermaid.render("fodt-diagram", String(data.text));',
    '      })',
    '      .then(',
    '        function (result) { send({ kind: "done", id: id, svg: result.svg }); },',
    '        function (error) {',
    '          var message = messageOf(error);',
    '          send({',
    '            kind: "error",',
    '            id: id,',
    '            line: lineOf(error, message),',
    '            expecting: expectingOf(message),',
    '            unknownType: Boolean(error && error.name === "UnknownDiagramError"),',
    '          });',
    '        }',
    '      );',
    '  });',
    '  send({ kind: "ready" });',
    '})();',
  ].join('\n');
}

/** The closing tag of a script, which would end the script early if the bundle held it. */
const SCRIPT_CLOSE = '</script';

/** The bundle text with every closing script tag (in any case) written so the HTML parser cannot end the script. */
function escapeScriptClose(bundle: string): string {
  const lower = bundle.toLowerCase();
  let at = lower.indexOf(SCRIPT_CLOSE);
  if (at < 0) return bundle;
  let out = '';
  let from = 0;
  while (at >= 0) {
    out += `${bundle.slice(from, at)}<\\/${bundle.slice(at + 2, at + SCRIPT_CLOSE.length)}`;
    from = at + SCRIPT_CLOSE.length;
    at = lower.indexOf(SCRIPT_CLOSE, from);
  }
  return out + bundle.slice(from);
}

/**
 * The document the page puts in the frame: the policy first, then the Mermaid bundle (with every closing script tag
 * escaped) and the boot script. The page sets this as the `srcdoc` of a frame whose sandbox has `allow-scripts` and
 * nothing else.
 */
export function buildFrameDocument(bundle: string): string {
  return [
    '<!doctype html><html><head>',
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`,
    '<meta charset="utf-8"></head><body>',
    `<script>${escapeScriptClose(bundle)}</script>`,
    `<script>${bootScript()}</script>`,
    '</body></html>',
  ].join('');
}
