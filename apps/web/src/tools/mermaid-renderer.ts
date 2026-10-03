import {
  meta,
  MermaidError,
  PNG_SCALES,
  UNKNOWN_TYPE_MESSAGE,
  cutWithEllipsis,
  parserMessage,
  prepareDiagram,
  prescanDiagram,
  scrubSvg,
  svgSize,
  themeName,
  visible,
  withPixelSize,
} from '@fodt/mermaid-renderer';
import { MermaidFrameError, renderInFrame, svgDataAddress, svgToPng } from '../lib/mermaid-frame';
import { defineTool, formatBytes, num, str, type OutputBlock, type ToolIssue, type ToolResult } from '../lib/tool-ui';

const FLOWCHART_EXAMPLE = `flowchart LR
  A[Write] --> B{Review}
  B -->|Approved| C[Publish]
  B -->|Changes| A
`;

const SEQUENCE_EXAMPLE = `sequenceDiagram
  participant Browser
  participant Server
  Browser->>Server: Request the page
  Server-->>Browser: Send the page
  Browser->>Browser: Draw it
`;

const PIE_EXAMPLE = `pie title Pets
  accTitle: Pet share
  accDescr: Dogs and cats compared, with dogs the larger share
  "Dogs" : 386
  "Cats" : 85
`;

/** The longest text alternative the image gets: its type, the diagram's own title and its own description. */
const MAX_ALT_CHARS = 600;

/** The scale field's value, or undefined when it is not a whole number the field allows. */
function readScale(values: Record<string, unknown>): number | undefined {
  const scale = num(values, 'scale', 2);
  return Number.isInteger(scale) && PNG_SCALES.includes(scale) ? scale : undefined;
}

/** The text alternative of the image: the diagram type, and the diagram's own title and description when it has them. */
function altText(type: string | undefined, title: string | undefined, description: string | undefined): string {
  const label = type === undefined ? 'Mermaid diagram' : `Mermaid ${type} diagram`;
  const named = [title, description].filter((part): part is string => part !== undefined);
  return cutWithEllipsis(named.length === 0 ? label : `${label}: ${named.join('. ')}`, MAX_ALT_CHARS);
}

export default defineTool({
  id: 'mermaid-renderer',
  // Drawing waits for a deliberate Run press: the engine runs in a frame that holds the page while it works, so it is
  // never started as you type, and it cannot be cancelled part way.
  autoRun: false,
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'source',
      label: 'Diagram',
      type: 'textarea',
      rows: 16,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'Up to 20,000 characters and 300 lines. Settings lines, click and link lines and image shapes are refused.',
    },
    {
      name: 'theme',
      label: 'Theme',
      type: 'select',
      default: 'default',
      options: [
        { value: 'default', label: 'Default' },
        { value: 'neutral', label: 'Neutral' },
        { value: 'dark', label: 'Dark' },
        { value: 'forest', label: 'Forest' },
        { value: 'base', label: 'Base' },
      ],
    },
    {
      name: 'format',
      label: 'Result',
      type: 'radio',
      default: 'svg',
      options: [
        { value: 'svg', label: 'SVG' },
        { value: 'png', label: 'SVG and PNG' },
      ],
    },
    {
      name: 'scale',
      label: 'PNG scale',
      type: 'number',
      default: 2,
      min: 1,
      max: 4,
      step: 1,
      help: 'Times the diagram size, from 1 to 4.',
      visible: (values) => str(values, 'format', 'svg') === 'png',
    },
  ],
  examples: [
    { label: 'A flowchart with a decision', values: { source: FLOWCHART_EXAMPLE } },
    { label: 'A sequence diagram', values: { source: SEQUENCE_EXAMPLE } },
    { label: 'A pie chart with a title and description for screen readers', values: { source: PIE_EXAMPLE } },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const source = str(values, 'source');
    if (source.trim() === '') return { outputs: [] };
    const theme = themeName(str(values, 'theme', 'default'));
    const wantsPng = str(values, 'format', 'svg') === 'png';
    let scale = 1;
    if (wantsPng) {
      const chosen = readScale(values);
      if (chosen === undefined) {
        return { outputs: [], errors: [{ message: 'PNG scale must be a whole number from 1 to 4.' }] };
      }
      scale = chosen;
    }

    let lineOffset = 0;
    try {
      // The text is checked before any frame exists: a refusal here never builds one.
      const { title: frontmatterTitle } = prescanDiagram(source);
      const prepared = prepareDiagram(source);
      lineOffset = prepared.lineOffset;
      const drawn = await renderInFrame(prepared.text, theme, ctx);
      // Only a scrubbed SVG is ever shown, exported or rasterised.
      const scrubbed = scrubSvg(drawn);
      const svg = scrubbed.svg;
      const natural = svgSize(svg);
      const width = Math.max(1, Math.ceil(natural.width));
      const height = Math.max(1, Math.ceil(natural.height));
      const named =
        scrubbed.title ??
        (frontmatterTitle === undefined ? undefined : cutWithEllipsis(visible(frontmatterTitle), 300));

      const outputs: OutputBlock[] = [
        {
          kind: 'image',
          label: 'Diagram',
          src: svgDataAddress(withPixelSize(svg, width, height)),
          alt: altText(scrubbed.type, named === '' ? undefined : named, scrubbed.description),
          width,
          height,
        },
      ];
      const listed: string[] = [];
      if (scrubbed.title !== undefined) listed.push(`Title: ${scrubbed.title}`);
      if (scrubbed.description !== undefined) listed.push(`Description: ${scrubbed.description}`);
      if (listed.length > 0) outputs.push({ kind: 'list', label: 'Title and description', items: listed });
      outputs.push({ kind: 'code', label: 'SVG', language: 'xml', value: svg, download: 'diagram.svg' });

      const stats: [string, string][] = [
        ['Type', scrubbed.type ?? 'Mermaid'],
        ['SVG size', formatBytes(new TextEncoder().encode(svg).length)],
      ];
      if (wantsPng) {
        const png = await svgToPng(svg, scale);
        outputs.push({
          kind: 'files',
          label: 'PNG',
          files: [{ name: 'diagram.png', mime: 'image/png', content: png }],
        });
        stats.push(['PNG size', `${Math.ceil(natural.width * scale)} × ${Math.ceil(natural.height * scale)} px`]);
      }
      return { outputs, stats };
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      return { outputs: [], errors: [issueOf(err, lineOffset)] };
    }
  },
});

/** The problem as the page lists it: the engine's line mapped back to the pasted text, or the sentence the code wrote. */
function issueOf(err: unknown, lineOffset: number): ToolIssue {
  if (err instanceof MermaidFrameError) {
    const detail = err.detail;
    if (detail === undefined) return { message: err.message };
    if (detail.unknownType) return { message: UNKNOWN_TYPE_MESSAGE };
    const line = detail.line === undefined ? undefined : detail.line + lineOffset;
    return { message: parserMessage(line, detail.expecting) };
  }
  if (err instanceof MermaidError) return { message: err.message };
  return { message: 'Could not draw this diagram.' };
}
