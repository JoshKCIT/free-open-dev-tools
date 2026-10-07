import {
  EmlViewerError,
  checkFileSize,
  checkPasteSize,
  meta,
  previewHtml,
  showBody,
  visible,
  withCommas,
  type EmlAnalysis,
  type TreeOut,
} from '@fodt/eml-viewer';
import {
  EML_VIEWER_NOT_STARTED_MESSAGE,
  EML_VIEWER_START_LIMIT_MESSAGE,
  EML_VIEWER_STOPPED_MESSAGE,
  EML_VIEWER_TIME_LIMIT_MESSAGE,
  EML_VIEWER_TIME_LIMIT_MS,
  EmlViewerRunError,
  emlViewerInWorker,
} from '../lib/run-eml-viewer-in-worker';
import {
  bool,
  defineTool,
  files,
  str,
  type DownloadableFile,
  type OutputBlock,
  type ToolIssue,
  type ToolResult,
  type TreeNode,
} from '../lib/tool-ui';

/** How many decoded headers the table shows unless the visitor asks for all of them. */
const HEADERS_SHOWN = 100;

/** The fixed sentences the worker helper can give, which are shown as they are. */
const FIXED_MESSAGES = new Set([
  EML_VIEWER_NOT_STARTED_MESSAGE,
  EML_VIEWER_START_LIMIT_MESSAGE,
  EML_VIEWER_STOPPED_MESSAGE,
  EML_VIEWER_TIME_LIMIT_MESSAGE,
]);

/** An invented message: an encoded subject and sender, a plain and an HTML body with an image, and an attachment. */
const SAMPLE_MESSAGE = [
  'From: =?UTF-8?Q?Jos=C3=A9_Baker?= <jose@example.com>',
  'To: Alice <alice@example.org>',
  'Subject: =?UTF-8?Q?Caf=C3=A9_menu?=',
  'Date: Tue, 06 Oct 2026 09:59:58 +0000',
  'Message-ID: <sample-1@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="BOUNDARY-1"',
  '',
  '--BOUNDARY-1',
  'Content-Type: multipart/alternative; boundary="ALT-1"',
  '',
  '--ALT-1',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hello Alice, the menu is attached.',
  '--ALT-1',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Hello <b>Alice</b>, the menu is attached.</p>',
  '<img src="https://tracker.example/pixel.gif" width="1" height="1">',
  '--ALT-1--',
  '--BOUNDARY-1',
  'Content-Type: text/plain; name="report.txt"',
  'Content-Disposition: attachment; filename="report.txt"',
  'Content-Transfer-Encoding: base64',
  '',
  'UXVhcnRlcmx5IGZpZ3VyZXM6IDQyIHVuaXRzIHNoaXBwZWQuCg==',
  '--BOUNDARY-1--',
].join('\n');

function treeNodes(node: TreeOut, depth: number): TreeNode {
  return {
    label: visible(node.label, 80),
    detail: node.detail,
    children: node.children.map((child) => treeNodes(child, depth + 1)),
    open: depth < 3,
  };
}

function headerRows(analysis: EmlAnalysis, all: boolean): (string | number)[][] {
  const shown = all ? analysis.headers : analysis.headers.slice(0, HEADERS_SHOWN);
  return shown.map((row) => [
    row.index,
    visible(row.name, 80),
    visible(row.value, 200),
    row.decoded ? visible(row.raw, 200) : '',
  ]);
}

function attachmentRows(analysis: EmlAnalysis): (string | number)[][] {
  return analysis.attachments.map((a) => [
    a.name,
    a.rawName === '' ? '(no name given)' : a.nameChanged ? visible(a.rawName, 200) : '',
    visible(a.declaredType, 100),
    `${withCommas(a.size)} bytes`,
    a.sha256,
  ]);
}

function resultOutputs(analysis: EmlAnalysis, allHeaders: boolean): OutputBlock[] {
  const outputs: OutputBlock[] = [
    {
      kind: 'note',
      tone: 'info',
      value:
        'Read on this device. Nothing is sent, nothing in the message is loaded, and nothing is verified, because that would need DNS.',
    },
    {
      kind: 'keyvalue',
      label: 'Summary',
      pairs: analysis.summary.map(([key, value]) => [key, visible(value, 200)] as [string, string]),
    },
  ];

  if (analysis.tree !== null) {
    outputs.push({ kind: 'tree', label: 'MIME structure', nodes: [treeNodes(analysis.tree, 0)] });
  }

  outputs.push({
    kind: 'table',
    label: 'Headers',
    table: {
      headers: ['#', 'Header', 'Value (decoded)', 'As written'],
      rows: headerRows(analysis, allHeaders),
      mono: [1],
    },
  });
  if (!allHeaders && analysis.headers.length > HEADERS_SHOWN) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: `Showing the first ${HEADERS_SHOWN} of ${withCommas(analysis.headers.length)} headers. Tick All headers to see every one.`,
    });
  }

  if (analysis.textBody !== null) {
    outputs.push({ kind: 'code', label: 'Plain text body', language: 'text', value: showBody(analysis.textBody.text) });
  }

  if (analysis.htmlBody !== null) {
    const preview = previewHtml(analysis.htmlBody, window, analysis.cidParts);
    if (preview.status === 'shown') {
      outputs.push({
        kind: 'sandboxed-html',
        label: 'HTML body (nothing loads, nothing navigates)',
        html: preview.html,
        copy: false,
      });
    }
  }

  if (analysis.attachments.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Attachments',
      table: {
        headers: ['Name', 'As received', 'Type', 'Size', 'SHA-256'],
        rows: attachmentRows(analysis),
        mono: [4],
      },
    });
    const saves: DownloadableFile[] = analysis.attachments.slice(0, 200).map((a) => ({
      name: a.name,
      mime: 'application/octet-stream',
      content: a.bytes,
    }));
    outputs.push({ kind: 'files', label: 'Save', files: saves });
  }
  return outputs;
}

function failure(err: unknown): ToolResult {
  const issue = (message: string): ToolIssue => ({ message });
  if (err instanceof EmlViewerError || err instanceof EmlViewerRunError) {
    return { outputs: [], errors: [issue(err.message)] };
  }
  if (err instanceof Error && FIXED_MESSAGES.has(err.message)) return { outputs: [], errors: [issue(err.message)] };
  return { outputs: [], errors: [issue('Could not read that message.')] };
}

export default defineTool({
  id: 'eml-viewer',
  // The message is read in a new background worker with a 20 second limit (see run-eml-viewer-in-worker.ts's own comment):
  // reading, decoding and hashing up to 25 MiB cannot be interrupted part way, so the page decides when it has taken too
  // long, and Cancel stops it at once. The run starts only on the Run button, never as the visitor types.
  autoRun: false,
  cancellable: true,
  runLimit: { ms: EML_VIEWER_TIME_LIMIT_MS },
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'source',
      label: 'Message from',
      type: 'radio',
      default: 'file',
      options: [
        { value: 'file', label: 'A saved file' },
        { value: 'paste', label: 'Pasted text' },
      ],
    },
    {
      name: 'file',
      label: 'Message file',
      type: 'file',
      accept: '.eml,.txt,message/rfc822',
      help: 'A saved email, up to 25 MiB. It is read on this device and nothing is uploaded.',
      visible: (values) => str(values, 'source', 'file') === 'file',
    },
    {
      name: 'pasted',
      label: 'Message',
      type: 'textarea',
      rows: 12,
      placeholder: 'Type or paste here. Nothing leaves your browser.',
      help: 'A whole message or only its headers, up to 5 MiB of text.',
      visible: (values) => str(values, 'source', 'file') === 'paste',
    },
    {
      name: 'allHeaders',
      label: 'All headers',
      type: 'checkbox',
      default: false,
      help: 'Off shows the first 100 decoded headers.',
    },
  ],
  examples: [
    {
      label: 'Encoded subject, two bodies and an attachment',
      values: { source: 'paste', pasted: SAMPLE_MESSAGE },
    },
  ],
  async run(values, ctx): Promise<ToolResult> {
    const source = str(values, 'source', 'file') === 'paste' ? 'paste' : 'file';
    try {
      let result: EmlAnalysis;
      if (source === 'file') {
        const file = files(values, 'file')[0];
        // No file, no output and no worker.
        if (!file) return { outputs: [] };
        // Refused before any worker starts, so an over-limit file is never read.
        checkFileSize(file.size);
        result = await emlViewerInWorker({ type: 'eml-viewer-job', file }, ctx);
      } else {
        const text = str(values, 'pasted');
        if (text.trim() === '') return { outputs: [] };
        checkPasteSize(text.length);
        result = await emlViewerInWorker({ type: 'eml-viewer-job', bytes: new TextEncoder().encode(text) }, ctx);
      }
      return { outputs: resultOutputs(result, bool(values, 'allHeaders')) };
    } catch (err) {
      // An abort rejection is let through rather than swallowed: the runner's own cancellation note already owns that
      // message.
      if (ctx.signal.aborted) throw err;
      return failure(err);
    }
  },
});
