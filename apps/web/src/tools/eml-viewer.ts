import {
  EmlViewerError,
  MAX_ATTACHMENTS_OFFERED,
  MAX_TEXT_BODY_SHOWN,
  checkFileSize,
  checkPasteSize,
  meta,
  previewHtml,
  showBody,
  visible,
  withCommas,
  type EmlAnalysis,
  type PreviewResult,
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

/** How many Authentication-Results rows the table shows. */
const AUTH_ROWS_SHOWN = 200;

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

function hopRows(analysis: EmlAnalysis): (string | number)[][] {
  return analysis.hops.map((hop) => {
    const from = hop.fromComment === '' ? hop.from : `${hop.from} (${hop.fromComment})`;
    const withText = hop.via === '' ? hop.with : hop.with === '' ? `via ${hop.via}` : `${hop.with} via ${hop.via}`;
    return [
      hop.index,
      visible(from, 200),
      visible(hop.by, 200),
      visible(withText, 100),
      visible(hop.id, 100),
      hop.time,
      hop.delay,
      visible(hop.note, 300),
    ];
  });
}

function authRows(analysis: EmlAnalysis): (string | number)[][] {
  return analysis.authResults
    .slice(0, AUTH_ROWS_SHOWN)
    .map((row) => [
      row.position,
      visible(row.server, 200),
      visible(row.method, 80),
      visible(row.result, 80),
      visible(row.properties, 300),
      visible(row.reason, 200),
    ]);
}

/** One block of rows per signature: a heading row, then a row for each tag the signature has. */
function dkimRows(analysis: EmlAnalysis): (string | number)[][] {
  const rows: (string | number)[][] = [];
  analysis.dkim.forEach((entry, i) => {
    const sig = entry.signature;
    const notes = [...sig.issues, sig.alignment].filter((text) => text !== '').join(' ');
    const lookup =
      sig.lookupName === ''
        ? ''
        : `Key lookup name, shown as text only and never looked up: ${visible(sig.lookupName, 200)}`;
    rows.push([`Signature ${i + 1} (header ${entry.header})`, '', lookup, visible(notes, 600)]);
    for (const tag of sig.tags) {
      rows.push([visible(tag.tag, 40), visible(tag.value, 200), tag.meaning, visible(tag.note, 400)]);
    }
  });
  return rows;
}

function arcItems(analysis: EmlAnalysis): string[] {
  return analysis.arc.map((set) => {
    const issues = set.issues.length === 0 ? '' : ` Worth a look: ${set.issues.join(' ')}`;
    return visible(`${set.summary}.${issues}`, 700);
  });
}

function asReceived(a: EmlAnalysis['attachments'][number]): string {
  const own = a.rawName === '' ? '(no name given)' : a.nameChanged ? visible(a.rawName, 200) : '';
  if (a.otherNames.length === 0) return own;
  const others = a.otherNames.map((name) => visible(name, 100)).join(', ');
  return own === '' ? `also named: ${others}` : `${own} (also named: ${others})`;
}

function attachmentRows(analysis: EmlAnalysis): (string | number)[][] {
  return analysis.attachments.map((a) => [
    a.name,
    asReceived(a),
    visible(a.declaredType, 100),
    `${withCommas(a.size)} bytes`,
    a.sha256,
  ]);
}

/** The HTML body: the closed frame and what was blocked, or the source as text when it is too big or too deep. */
function htmlOutputs(html: string, analysis: EmlAnalysis): OutputBlock[] {
  let preview: PreviewResult;
  try {
    preview = previewHtml(html, window, analysis.cidParts);
  } catch {
    return [{ kind: 'note', tone: 'warn', value: 'The HTML body could not be prepared, so it is not shown.' }];
  }
  if (preview.status === 'skipped') {
    return [
      { kind: 'note', tone: 'warn', value: preview.reason },
      {
        kind: 'code',
        label: 'HTML body (shown as text, not rendered)',
        language: 'html',
        value: showBody(html.slice(0, MAX_TEXT_BODY_SHOWN)),
      },
    ];
  }
  const outputs: OutputBlock[] = [
    {
      kind: 'sandboxed-html',
      label: 'HTML body (nothing loads, nothing navigates)',
      html: preview.html,
      copy: false,
    },
  ];
  if (preview.notes.length > 0) {
    outputs.push({ kind: 'note', label: 'What the preview changed', tone: 'info', value: preview.notes.join('\n') });
  }
  if (preview.blocked.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Remote content that was blocked',
      table: {
        headers: ['Kind', 'Where', 'Address', 'Count'],
        rows: preview.blocked.map((b) => [b.kind, b.where, visible(b.address, 200), b.count]),
        mono: [2],
      },
    });
  }
  if (preview.links.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Links in the message (not active)',
      table: {
        headers: ['Text', 'Address', 'Check'],
        rows: preview.links.map((l) => [
          l.text === '' ? '(no text)' : visible(l.text, 200),
          l.target === '' ? '(removed: not a web or mail address)' : visible(l.target, 200),
          l.mismatch ? 'The text names a different host than the link does.' : '',
        ]),
        mono: [1],
      },
    });
  }
  if (preview.omitted > 0) {
    outputs.push({
      kind: 'note',
      tone: 'info',
      value: `${withCommas(preview.omitted)} more references or links were found and are not listed.`,
    });
  }
  return outputs;
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

  if (analysis.notes.length > 0) {
    outputs.push({ kind: 'note', label: 'Notes', tone: 'info', value: analysis.notes.join('\n') });
  }

  if (analysis.observations.length > 0) {
    outputs.push({
      kind: 'list',
      label: 'Worth a look',
      items: analysis.observations.map((text) => visible(text, 400)),
    });
  }

  if (analysis.hops.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Delivery hops, oldest first',
      table: {
        headers: ['#', 'From', 'By', 'With', 'Id', 'Time (UTC)', 'Delay', 'Note'],
        rows: hopRows(analysis),
        mono: [1, 2, 3, 4, 5],
      },
    });
  }

  if (analysis.authResults.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'Authentication-Results, as the server that wrote them said',
      table: {
        headers: ['Position', 'Server', 'Method', 'Result', 'Properties', 'Reason'],
        rows: authRows(analysis),
        mono: [1, 2, 3, 4],
      },
    });
    if (analysis.authResults.length > AUTH_ROWS_SHOWN) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `Showing the first ${AUTH_ROWS_SHOWN} of ${withCommas(analysis.authResults.length)} authentication results.`,
      });
    }
  }

  if (analysis.dkim.length > 0) {
    outputs.push({
      kind: 'table',
      label: 'DKIM-Signature',
      table: {
        headers: ['Tag', 'Value', 'Meaning', 'Note'],
        rows: dkimRows(analysis),
        mono: [1],
      },
    });
  }

  if (analysis.arc.length > 0) {
    outputs.push({ kind: 'list', label: 'ARC sets, as the servers that wrote them said', items: arcItems(analysis) });
  }

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

  if (analysis.htmlBody !== null) outputs.push(...htmlOutputs(analysis.htmlBody, analysis));

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
    const saves: DownloadableFile[] = analysis.attachments.slice(0, MAX_ATTACHMENTS_OFFERED).map((a) => ({
      name: a.name,
      mime: 'application/octet-stream',
      content: a.bytes,
    }));
    outputs.push({ kind: 'files', label: 'Save', files: saves });
    if (analysis.attachments.length > MAX_ATTACHMENTS_OFFERED) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `Only the first ${MAX_ATTACHMENTS_OFFERED} attachments have a Save button; the rest are listed in the table.`,
      });
    }
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
