import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import {
  FRAME_CSP,
  MAX_DIAGRAM_CHARS,
  MAX_DIAGRAM_LINES,
  MERMAID_THEMES,
  MermaidError,
  UNKNOWN_TYPE_MESSAGE,
  buildFrameDocument,
  mermaidConfig,
  meta as toolMeta,
  parserMessage,
  pngSize,
  prepareDiagram,
  prescanDiagram,
  scanConstructs,
  scrubSvg,
  themeName,
} from '../src/index';
import { RECORDED_OUTPUTS } from './fixtures/recorded-outputs';
import { SAMPLES } from './fixtures/samples';

let consoleSpies: MockInstance[] = [];

beforeEach(() => {
  consoleSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'info').mockImplementation(() => undefined),
    vi.spyOn(console, 'debug').mockImplementation(() => undefined),
  ];
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

/** The error the pre-scan throws for a text, failing the test when it accepts it. */
function refusalOf(text: string): MermaidError {
  try {
    prescanDiagram(text);
  } catch (err) {
    expect(err).toBeInstanceOf(MermaidError);
    return err as MermaidError;
  }
  throw new Error('the pre-scan was expected to refuse this diagram');
}

const DIRECTIVE = 'settings directives are not supported here.';
const FRONTMATTER = 'only a title is allowed in the frontmatter.';
const LINKS = 'click and link lines are not supported here, so the diagram cannot open addresses or run handlers.';
const IMAGES = 'image shapes are not supported here.';
const MATH = 'math is not supported here.';

it('the pre-scan refuses directives, settings frontmatter, click and link lines, image shapes and math with the line number', () => {
  const cases: Array<[string, number, string]> = [
    ['flowchart LR\n  A --> B\n  %%{init: {"theme": "dark"}}%%', 3, DIRECTIVE],
    ['%%{init: {"themeCSS": "a"}}%%\nflowchart LR\n  A --> B', 1, DIRECTIVE],
    ['flowchart LR %%{init: {}}%%\n  A --> B', 1, DIRECTIVE],
    ['flowchart LR\r\n  A --> B\r\n  B --> C\r\n  %%{wrap}%%', 4, DIRECTIVE],
    ['%% a comment that mentions %%{ nothing\nflowchart LR', 1, DIRECTIVE],
    ['---\nconfig:\n  theme: dark\n---\nflowchart LR\n  A --> B', 2, FRONTMATTER],
    ['---\ntitle: One\ntitle: Two\n---\nflowchart LR\n  A --> B', 3, FRONTMATTER],
    ['---\ntitle: One\nflowchart LR\n  A --> B', 3, FRONTMATTER],
    ['---\ntitle: One', 1, FRONTMATTER],
    ['\n\n---\ntitle: A\nconfig: {}\n---\nflowchart LR', 5, FRONTMATTER],
    ['flowchart LR\n  A --> B\n  click A href "https://example.com/" _blank', 3, LINKS],
    ['flowchart LR\n  A --> B\n  CLICK A call callback()', 3, LINKS],
    ['flowchart LR\n  A --> B; click A href "x"', 2, LINKS],
    ['sequenceDiagram\n  participant A\n  link A: Dashboard @ https://example.com/', 3, LINKS],
    ['sequenceDiagram\n  participant A\n  links A: {"Dashboard": "https://example.com/"}', 3, LINKS],
    ['classDiagram\n  class Shape\n  callback Shape "fn"', 3, LINKS],
    ['gantt\n  dateFormat YYYY-MM-DD\n  section S\n  Task :t1, 2024-01-01, 3d\n  click t1 href "x"', 5, LINKS],
    ['flowchart LR\n  A@{ img: "https://example.com/a.png", label: "x" }', 2, IMAGES],
    ['flowchart LR\n  A@{\n    label: "x",\n    img: "y"\n  }', 4, IMAGES],
    ['flowchart LR\n  A@{ "IMG" : "y" }', 2, IMAGES],
    ['flowchart LR\n  A@{ shape: rect }\n  B@{ label: "z", img : "y" }', 3, IMAGES],
    ['flowchart LR\n  A["$$x^2 + y$$"]', 2, MATH],
    ['flowchart LR\n  A --> B\n  C["a $$ b"]', 3, MATH],
    ['---\ntitle: $$x$$\n---\nflowchart LR', 2, MATH],
  ];
  for (const [text, line, sentence] of cases) {
    const err = refusalOf(text);
    expect(err.message, text).toBe(`Line ${line}: ${sentence}`);
    expect(err.line, text).toBe(line);
  }
});

/** Every character JavaScript's own white space pattern matches, except the two line breaks the scan splits lines on. */
function engineBlanks(): number[] {
  const found: number[] = [];
  for (let unit = 0; unit <= 0xffff; unit++) {
    if (unit !== 0x0a && unit !== 0x0d && /\s/.test(String.fromCharCode(unit))) found.push(unit);
  }
  return found;
}

it('the pre-scan treats every character the engine reads as white space as blank, so a fence or click line led by one is still refused with its own message', () => {
  const blanks = engineBlanks();
  // The space, the vertical tab, the em space, the ideographic space and the line and paragraph separators are all there.
  for (const unit of [0x20, 0x0b, 0x2003, 0x3000, 0x2028, 0x2029, 0x205f]) expect(blanks).toContain(unit);
  const settings = 'config:\n  look: handDrawn\n  themeCSS: "x"';
  for (const unit of blanks) {
    const blank = String.fromCodePoint(unit);
    const label = `U+${unit.toString(16).toUpperCase()}`;
    const fence = refusalOf(`---${blank}\n${settings}\n---\nflowchart LR\n A-->B`);
    expect(fence.message, label).toBe(`Line 2: ${FRONTMATTER}`);
    expect(fence.line, label).toBe(2);
    // A closing fence that ends in one of these characters still closes the frontmatter, as it does for the engine.
    expect(prescanDiagram(`---\ntitle: One\n---${blank}\nflowchart LR\n A-->B`), label).toEqual({ title: 'One' });
    for (const word of ['click', 'link', 'callback']) {
      const click = refusalOf(`flowchart LR\n  A --> B\n${blank}${word} A href "http://evil.example/"`);
      expect(click.message, `${label} ${word}`).toBe(`Line 3: ${LINKS}`);
      const afterSemicolon = refusalOf(`flowchart LR\n  A --> B;${blank}${word}${blank}A href "x"`);
      expect(afterSemicolon.message, `${label} ${word} after a semicolon`).toBe(`Line 2: ${LINKS}`);
    }
  }
  // A line that is only these characters is still an empty line, and a title with them around it still reads.
  const em = String.fromCodePoint(0x2003);
  expect(prescanDiagram(`${em}\n---${em}\ntitle:${em}Spaced${em}\n---${em}\nflowchart LR\n  A --> B`)).toEqual({
    title: 'Spaced',
  });
});

it('the text handed to the engine is checked against the engine own frontmatter pattern and refused unless it is the title block written here', () => {
  // The pre-scan reads the first two fences as an empty frontmatter and the rest as the diagram, but once those lines
  // are dropped the diagram starts with a fence of its own, which the engine would read as settings.
  const sneaky = '---\n---\n---\nconfig:\n  look: handDrawn\n---\nflowchart LR\n A-->B';
  expect(() => prescanDiagram(sneaky)).not.toThrow();
  try {
    prepareDiagram(sneaky);
    throw new Error('prepareDiagram was expected to refuse this diagram');
  } catch (err) {
    expect(err).toBeInstanceOf(MermaidError);
    expect((err as MermaidError).message).toBe(`Line 3: ${FRONTMATTER}`);
    expect((err as MermaidError).line).toBe(3);
  }
  // With a title the engine reads exactly the block this code wrote, which is fine.
  expect(prepareDiagram('---\ntitle: One\n---\nflowchart LR\n A-->B').text).toMatch(/^---\ntitle: /);
  // The same fence led by an em space is a fence for the engine too.
  const em = String.fromCodePoint(0x2003);
  expect(() => prepareDiagram(`---\n---\n---${em}\nconfig:\n  look: handDrawn\n---\nflowchart LR`)).toThrow(
    MermaidError,
  );
  for (const [name, text] of Object.entries(SAMPLES)) {
    expect(() => prepareDiagram(text), name).not.toThrow();
  }
});

it('the pre-scan accepts a title-only frontmatter, accTitle and accDescr, text icons and all 22 sample diagrams', () => {
  expect(Object.keys(SAMPLES)).toHaveLength(22);
  for (const [name, text] of Object.entries(SAMPLES)) {
    expect(() => prescanDiagram(text), name).not.toThrow();
  }
  expect(prescanDiagram('---\ntitle: My Title\n---\nflowchart LR\n  A --> B')).toEqual({ title: 'My Title' });
  expect(prescanDiagram('  ---  \n  title : Spaced\n  ---  \nflowchart LR')).toEqual({ title: 'Spaced' });
  expect(prescanDiagram('flowchart LR\n  A --> B')).toEqual({});
  expect(prescanDiagram('flowchart LR\n  accTitle: A title\n  accDescr: A description\n  A --> B')).toEqual({});
  expect(() => prescanDiagram('flowchart LR\n  A["fa:fa-car Car"] --> B["logos:aws"]')).not.toThrow();
  expect(() => prescanDiagram('flowchart LR\n  A@{ icon: "logos:aws", label: "x" }')).not.toThrow();
  // A node that is called click is not a click line, and the types whose lines are free text may start with these words.
  expect(() => prescanDiagram('flowchart LR\n  click --> B\n  link --> C')).not.toThrow();
  expect(() => prescanDiagram('mindmap\n  root((r))\n    Click here\n    Link building')).not.toThrow();
  expect(() => prescanDiagram('timeline\n  2024 : Click tracking')).not.toThrow();
  // A statement that merely mentions the words later in the line is not a click line either.
  expect(() => prescanDiagram('flowchart LR\n  A["please click here"] --> B["a link"]')).not.toThrow();
});

it('a diagram over 20000 characters or 300 lines is refused before rendering', () => {
  expect(MAX_DIAGRAM_CHARS).toBe(20_000);
  expect(MAX_DIAGRAM_LINES).toBe(300);
  const long = 'a'.repeat(20_001);
  expect(refusalOf(long).message).toBe(
    'This diagram is 20001 characters. The limit is 20,000 because a large diagram can freeze this page while it is drawn.',
  );
  expect(refusalOf(long).line).toBeUndefined();
  expect(() => prescanDiagram('a'.repeat(20_000))).not.toThrow();

  const lines301 = Array.from({ length: 301 }, () => 'A-->B').join('\n');
  expect(refusalOf(lines301).message).toBe(
    'This diagram has 301 lines. The limit is 300 because a large diagram can freeze this page while it is drawn.',
  );
  const lines300 = Array.from({ length: 300 }, () => 'A-->B').join('\n');
  expect(() => prescanDiagram(lines300)).not.toThrow();
  expect(() => prescanDiagram(`${lines300}\n`)).not.toThrow();
  expect(refusalOf(`${lines300}\n\n`).message).toContain('301 lines');
  expect(refusalOf(lines301.split('\n').join('\r\n')).message).toContain('301 lines');
  // The size is checked before anything else: a directive in a diagram that is too long is not what is reported.
  const directiveAndLong = `%%{init: {}}%%\n${'a'.repeat(20_001)}`;
  expect(refusalOf(directiveAndLong).message).toContain(`${directiveAndLong.length} characters`);
});

it('a parser error becomes the parser line and the expecting clause, capped at 160 characters, never the diagram text', async () => {
  expect(parserMessage(2, "Expecting 'AMP', 'COLON'")).toBe(
    "Line 2: the diagram could not be read. Expecting 'AMP', 'COLON'",
  );
  expect(parserMessage(7)).toBe('Line 7: the diagram could not be read.');
  expect(parserMessage(undefined, "Expecting 'EOF'")).toBe("The diagram could not be read. Expecting 'EOF'");
  expect(parserMessage()).toBe('The diagram could not be read.');
  expect(parserMessage(0)).toBe('The diagram could not be read.');
  expect(parserMessage(-3)).toBe('The diagram could not be read.');
  expect(parserMessage(2.5)).toBe('The diagram could not be read.');
  const long = parserMessage(12, `Expecting ${Array.from({ length: 60 }, (_, i) => `'TOKEN${i}'`).join(', ')}`);
  expect(long).toHaveLength(160);
  expect(long.endsWith('...')).toBe(true);
  // Control and direction characters in the clause are written out.
  const escaped = parserMessage(1, `Expecting ${String.fromCodePoint(7)}'A'${String.fromCodePoint(0x202e)}`);
  expect(escaped).toContain('\\u{7}');
  expect(escaped).toContain('\\u{202E}');
  expect(escaped).not.toContain(String.fromCodePoint(0x202e));

  // The frame's boot script puts only the parser's own location and the grammar's token names into a message, even
  // when the engine's message quotes the diagram, including a quote that spells out what the parser said.
  const marker = 'MARKER-WORD-7Q2';
  const posts = (
    await runBootScript(() => {
      const excerpt = `...${marker} Expecting ${marker}`;
      throw Object.assign(
        new Error(
          `Parse error on line 4:\n${excerpt}\n--------------------^\nExpecting 'AMP', 'COLON', 'PIPE', got '${marker}'`,
        ),
        { hash: { loc: { first_line: 3 }, text: marker } },
      );
    })
  ).posts;
  const error = posts[1] as { kind: string; line: number; expecting: string };
  expect(error.kind).toBe('error');
  expect(error.line).toBe(3);
  expect(error.expecting).toBe("Expecting 'AMP', 'COLON', 'PIPE'");
  expect(JSON.stringify(posts)).not.toContain(marker);
  const shown = parserMessage(error.line, error.expecting);
  expect(shown).toBe("Line 3: the diagram could not be read. Expecting 'AMP', 'COLON', 'PIPE'");
  expect(shown).not.toContain(marker);

  const langium = (
    await runBootScript(() => {
      throw new Error(
        `Parsing failed: Lexer error on line 2, column 9: unexpected character: ->${marker}<- at offset: 12. Parse error on line 2, column 19: Expecting token of type 'NUMBER_PIE' but found ${marker}.`,
      );
    })
  ).posts[1] as { line: number; expecting: string };
  expect(langium.line).toBe(2);
  expect(langium.expecting).toBe("Expecting token of type 'NUMBER_PIE'");

  const lexical = (
    await runBootScript(() => {
      throw new Error(`Lexical error on line 5. Unrecognized text.\n${marker}(\n-----------^`);
    })
  ).posts[1] as { line: number; expecting?: string };
  expect(lexical.line).toBe(5);
  expect(lexical.expecting).toBeUndefined();

  const unknown = (
    await runBootScript(() => {
      throw Object.assign(new Error(`No diagram type detected matching given configuration for text: ${marker}`), {
        name: 'UnknownDiagramError',
      });
    })
  ).posts[1] as { line?: number; expecting?: string; unknownType: boolean };
  expect(unknown.unknownType).toBe(true);
  expect(unknown.line).toBeUndefined();
  expect(unknown.expecting).toBeUndefined();
  expect(JSON.stringify(unknown)).not.toContain(marker);
  expect(UNKNOWN_TYPE_MESSAGE).not.toContain(marker);

  const other = (
    await runBootScript(() => {
      throw new Error(`Invalid date:${marker}`);
    })
  ).posts[1] as { line?: number; expecting?: string; unknownType: boolean };
  expect(JSON.stringify(other)).not.toContain(marker);
});

it('the frame document carries the locked policy, strict security level and SVG labels and escapes the closing script tag', async () => {
  expect(FRAME_CSP).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:");
  const bundle = 'window.mermaid = { x: "a</script>b</SCRIPT >c</Script" };';
  const doc = buildFrameDocument(bundle);
  expect(
    doc.startsWith(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`),
  ).toBe(true);
  expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<script'));
  // Only the document's own two closing tags remain; the bundle's three are written as <\/script.
  expect(doc.toLowerCase().split('</script').length - 1).toBe(2);
  expect(doc).toContain('a<\\/script>b<\\/SCRIPT >c<\\/Script"');
  expect(doc.split('<\\/').join('</').includes(bundle)).toBe(true);
  expect(doc.split('<script>')).toHaveLength(3);

  expect(mermaidConfig('dark')).toEqual({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: 'dark',
    maxTextSize: 20_000,
    maxEdges: 300,
  });
  expect(doc).toContain('"securityLevel":"strict"');
  expect(doc).toContain('"htmlLabels":false,"flowchart":{"htmlLabels":false}');

  // The boot script posts ready, answers only its parent, applies the configuration and falls back to the default theme.
  const ran = await runBootScript(() => ({ svg: '<svg></svg>' }), { theme: 'forest' });
  expect(ran.posts).toEqual([{ kind: 'ready' }, { kind: 'done', id: 1, svg: '<svg></svg>' }]);
  expect(JSON.parse(JSON.stringify(ran.initialized))).toEqual({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: 'forest',
    maxTextSize: 20_000,
    maxEdges: 300,
  });
  const fallback = await runBootScript(() => ({ svg: '<svg></svg>' }), { theme: '__proto__' });
  expect((fallback.initialized as { theme: string }).theme).toBe('default');
  const stranger = await runBootScript(() => ({ svg: '<svg></svg>' }), { fromStranger: true });
  expect(stranger.posts).toEqual([{ kind: 'ready' }]);
});

it('theme names are looked up safely for __proto__, constructor and toString', () => {
  expect(MERMAID_THEMES.size).toBe(5);
  for (const name of ['default', 'neutral', 'dark', 'forest', 'base']) {
    expect(MERMAID_THEMES.get(name)).toBe(name);
    expect(themeName(name)).toBe(name);
  }
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '']) {
    expect(MERMAID_THEMES.get(key)).toBeUndefined();
    expect(themeName(key)).toBe('default');
  }
});

it('meta pins mermaid 11.17.2 exactly and the installed bundle is 11.17.2', () => {
  expect(toolMeta.dependencies).toEqual({ mermaid: '11.17.2' });
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(packageJson.dependencies).toEqual({ mermaid: '11.17.2' });
  const installed = JSON.parse(readFileSync(new URL('../node_modules/mermaid/package.json', import.meta.url), 'utf8'));
  expect(installed.version).toBe('11.17.2');
  expect(installed.license).toBe('MIT');
  expect(Object.keys(installed.dependencies)).not.toContain('elkjs');
  const bundle = readFileSync(new URL('../node_modules/mermaid/dist/mermaid.min.js', import.meta.url), 'utf8');
  expect(bundle.length).toBeGreaterThan(3_000_000);
  expect(bundle).toContain('11.17.2');
});

it('the engine receives the text without the lines it would drop, so a parser line maps back to the pasted line', () => {
  expect(prepareDiagram('flowchart LR\n  A --> B')).toEqual({ text: 'flowchart LR\n  A --> B', lineOffset: 0 });
  expect(prepareDiagram('\n\nflowchart LR\n  A -->')).toEqual({ text: 'flowchart LR\n  A -->', lineOffset: 2 });
  expect(prepareDiagram('%% first\n\n%% second\nflowchart LR\n  A -->')).toEqual({
    text: 'flowchart LR\n  A -->',
    lineOffset: 3,
  });
  expect(prepareDiagram('flowchart LR\n  %% note\n  A --> B\n\n\n  C -->')).toEqual({
    text: 'flowchart LR\n\n  A --> B\n\n\n  C -->',
    lineOffset: 0,
  });
  expect(prepareDiagram('---\ntitle: My Title\n---\n\nflowchart LR\n  A --> B')).toEqual({
    text: '---\ntitle: My Title\n---\nflowchart LR\n  A --> B',
    lineOffset: 4,
  });
  expect(prepareDiagram('---\n---\npie\n  "a" : 1').lineOffset).toBe(2);
  expect(prepareDiagram('\r\nflowchart LR\r\n  A --> B\r\n')).toEqual({
    text: 'flowchart LR\n  A --> B',
    lineOffset: 1,
  });
  expect(prepareDiagram('')).toEqual({ text: '', lineOffset: 0 });
  expect(prepareDiagram('%% only a comment')).toEqual({ text: '', lineOffset: 1 });
});

it('the png size is the svg size times the scale, and a size over the limits is refused with the numbers', () => {
  const svg = (box: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" width="100%"></svg>`;
  expect(pngSize(svg('0 0 233.09375 318.6640625'), 1)).toEqual({ width: 234, height: 319 });
  expect(pngSize(svg('0 0 233.09375 318.6640625'), 2)).toEqual({ width: 467, height: 638 });
  expect(pngSize(svg('-50 -50 450 299'), 4)).toEqual({ width: 1800, height: 1196 });
  expect(() => pngSize(svg('0 0 2000 2000'), 3)).toThrow(
    'The PNG would be 6000 by 6000 pixels. The limit is 16,000,000 pixels and 8,192 on a side; choose a smaller scale.',
  );
  expect(pngSize(svg('0 0 2000 10'), 4)).toEqual({ width: 8000, height: 40 });
  expect(pngSize(svg('0 0 2048 10'), 4)).toEqual({ width: 8192, height: 40 });
  expect(() => pngSize(svg('0 0 2100 10'), 4)).toThrow(MermaidError);
  expect(() => pngSize(svg('0 0 100 100'), 5)).toThrow('Scale must be a whole number from 1 to 4.');
  expect(() => pngSize(svg('0 0 100 100'), 1.5)).toThrow(MermaidError);
  expect(() => pngSize(svg('0 0 100 100'), Number.NaN)).toThrow(MermaidError);
  expect(() => pngSize('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 1)).toThrow(
    'The rendered diagram does not state its size.',
  );
  expect(pngSize('<svg xmlns="http://www.w3.org/2000/svg" width="120px" height="60"></svg>', 2)).toEqual({
    width: 240,
    height: 120,
  });
});

it('nothing is written to the console while checking or scrubbing', () => {
  for (const text of Object.values(SAMPLES)) {
    prescanDiagram(text);
    scanConstructs(text);
    prepareDiagram(text);
  }
  for (const svg of Object.values(RECORDED_OUTPUTS)) scrubSvg(svg);
  for (const bad of ['%%{init: {}}%%', '---\nconfig: {}\n---', 'click A href "x"', '$$x$$']) {
    try {
      prescanDiagram(`flowchart LR\n${bad}`);
    } catch {
      // The refusal is the point; only the console is checked here.
    }
  }
  try {
    scrubSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');
  } catch {
    // The same.
  }
  parserMessage(3, "Expecting 'A'");
  buildFrameDocument('x');
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

/**
 * Runs the frame's boot script in a scratch context with a stand-in for the engine: `render` is called with the text
 * and returns the SVG (or throws the error the test gives). Returns what the script posted to its parent and the
 * configuration it gave the engine. The test sends one render message, from the script's parent unless it asks for
 * a stranger.
 */
async function runBootScript(
  render: (text: string) => { svg: string },
  options: { theme?: string; fromStranger?: boolean } = {},
): Promise<{ posts: unknown[]; initialized: unknown }> {
  const doc = buildFrameDocument('');
  const boot = doc.slice(doc.lastIndexOf('<script>') + '<script>'.length, doc.lastIndexOf('</script>'));
  const posts: unknown[] = [];
  let initialized: unknown;
  let listener: ((event: { source: unknown; data: unknown }) => void) | undefined;
  const parent = { postMessage: (message: unknown): void => void posts.push(JSON.parse(JSON.stringify(message))) };
  const context = {
    parent,
    addEventListener: (_type: string, handler: typeof listener): void => {
      listener = handler;
    },
    mermaid: {
      initialize: (config: unknown): void => {
        initialized = config;
      },
      render: (_id: string, text: string): Promise<{ svg: string }> => Promise.resolve().then(() => render(text)),
    },
  };
  vm.runInNewContext(boot, context);
  listener?.({
    source: options.fromStranger ? {} : parent,
    data: { kind: 'render', id: 1, text: 'flowchart LR\n  A --> B', theme: options.theme ?? 'default' },
  });
  // The script answers through promises; let them settle before the posts are read.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { posts, initialized };
}
