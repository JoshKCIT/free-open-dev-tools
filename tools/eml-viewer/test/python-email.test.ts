/**
 * The recorded second opinion: Python's email library (email.policy.default) run over the corpus in
 * fixtures/python-email/messages.json, with its output stored in expected.json (see record.py and the README beside them).
 * This test never runs Python. It reads the recording and compares it, message by message, with what the tool makes of the
 * same bytes: the decoded From, To and Subject, the mailboxes of From and To, every part (path, content type, file name,
 * character set, decoded size and SHA-256) and the text of the first plain text body.
 *
 * A difference is allowed only when it is named here, with what each side gave and why. A difference that is not listed
 * fails the test, and a listed difference that no longer happens fails it too, so the list can neither hide a new
 * disagreement nor go stale.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import {
  analyzeMessage,
  decodeEncodedWords,
  decodePartBody,
  findParam,
  parseAddressList,
  parseMime,
} from '../src/index';
import type { PartNode } from '../src/index';
import { bytesOf } from './helpers';

interface PythonPart {
  path: string;
  contentType: string;
  filename: string;
  charset: string;
  size: number | null;
  sha256: string | null;
}
interface PythonMessage {
  from: string;
  to: string;
  subject: string;
  fromMailboxes: { name: string; address: string }[];
  toMailboxes: { name: string; address: string }[];
  parts: PythonPart[];
  firstText: string | null;
}
interface Recording {
  recordedAt: string;
  python: string;
  messages: Record<string, PythonMessage>;
}

const corpus = JSON.parse(readFileSync(new URL('./fixtures/python-email/messages.json', import.meta.url), 'utf8')) as {
  messages: Record<string, { source: string; text: string }>;
};
const recording = JSON.parse(
  readFileSync(new URL('./fixtures/python-email/expected.json', import.meta.url), 'utf8'),
) as Recording;

/** A named, explained disagreement between the tool and Python. `tool` and `python` are the values each gave. */
interface KnownDifference {
  message: string;
  field: string;
  tool: string;
  python: string;
  why: string;
}

/**
 * Every difference between the tool and Python on the corpus. All five are in the text of an address header: Python builds
 * that text again from the addresses it parsed (comments dropped, a space after each comma and after a group colon, a
 * display name with a dot quoted again), while the tool shows the header as it was written, with its folds taken out and its
 * encoded words decoded. In every one of these messages the mailbox lists of the two sides are equal (they are compared
 * above and no difference is reported), so the same addresses and names are read; only the text around them differs. Parts,
 * file names, character sets, sizes, SHA-256 digests and the first text body agree on all 20 messages.
 */
const KNOWN_DIFFERENCES: KnownDifference[] = [
  {
    message: 'rfc5322-a1-3-groups',
    field: 'to',
    tool: 'A Group:Ed Jones <c@a.test>,joe@where.test,John <jdoe@one.test>;',
    python: 'A Group: Ed Jones <c@a.test>, joe@where.test, John <jdoe@one.test>;',
    why: 'Python writes the group again with a space after the colon and after each comma; the tool shows the header as written (RFC 5322 Appendix A.1.3), and both read the same three mailboxes.',
  },
  {
    message: 'rfc5322-a5-oddities',
    field: 'from',
    tool: 'Pete(A nice \\) chap) <pete(his account)@silly.test(his host)>',
    python: 'Pete <pete@silly.test>',
    why: 'The header holds three comments (RFC 5322 Appendix A.5). Python drops comments when it renders an address header; the tool keeps the text as written, and both read the mailbox Pete at pete@silly.test.',
  },
  {
    message: 'rfc5322-a5-oddities',
    field: 'to',
    tool: "A Group(Some people)     :Chris Jones <c@(Chris's host.)public.example>,         joe@example.org,  John <jdoe@one.test> (my dear friend); (the end of the group)",
    python: 'A Group: Chris Jones <c@public.example>, joe@example.org, John <jdoe@one.test>;',
    why: 'The header holds comments and folding white space inside a group (RFC 5322 Appendix A.5). Python renders the group without them; the tool keeps the text as written, and both read the same three mailboxes.',
  },
  {
    message: 'rfc5322-a6-1-obsolete-addresses',
    field: 'from',
    tool: 'Joe Q. Public <john.q.public@example.com>',
    python: '"Joe Q. Public" <john.q.public@example.com>',
    why: 'RFC 5322 Appendix A.6.1 writes the display name without quotes, which is the obsolete form. Python quotes it again because it holds a dot; the tool shows the text as written, and both read the same name and address.',
  },
  {
    message: 'rfc5322-a6-1-obsolete-addresses',
    field: 'to',
    tool: 'Mary Smith <@node.test:mary@example.net>, , jdoe@test  . example',
    python: 'Mary Smith <mary@example.net>, jdoe@test.example',
    why: 'The header uses an obsolete route, an empty element and spaces around a dot (RFC 5322 Appendix A.6.1). Python renders the cleaned addresses; the tool shows the text as written, and both read the same two mailboxes.',
  },
];

/** Collects the parts of a message the way record.py numbers them. */
function toolParts(bytes: Uint8Array, rawNames: Map<string, string>): PythonPart[] {
  const root = parseMime(bytes);
  const out: PythonPart[] = [];
  const stack: PartNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    let size: number | null = null;
    let sha256: string | null = null;
    if (node.container === 'leaf') {
      const body = decodePartBody(bytes, node).bytes;
      size = body.length;
      sha256 = createHash('sha256').update(body).digest('hex');
    }
    out.push({
      path: node.path,
      contentType: node.contentType,
      filename: rawNames.get(node.path) ?? '',
      charset: (findParam(node.type, 'charset')?.value ?? '').toLowerCase(),
      size,
      sha256,
    });
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child !== undefined) stack.push(child);
    }
  }
  return out;
}

const show = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

it('the recorded Python email messages give the same headers, parts, names, sizes and digests except the listed differences', async () => {
  // The recording carries its own version and time, and covers every message of the corpus (at least 12).
  expect(recording.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  expect(recording.python).toMatch(/^3\.14\./);
  const names = Object.keys(corpus.messages);
  expect(names.length).toBeGreaterThanOrEqual(12);
  expect(Object.keys(recording.messages)).toEqual(names);

  const found: KnownDifference[] = [];
  for (const name of names) {
    const text = corpus.messages[name]?.text ?? '';
    const python = recording.messages[name];
    if (python === undefined) throw new Error(`no recording for ${name}`);
    const bytes = bytesOf(text);
    const analysis = await analyzeMessage(bytes);
    const note = (field: string, tool: unknown, theirs: unknown): void => {
      found.push({ message: name, field, tool: show(tool), python: show(theirs), why: '' });
    };
    const compare = (field: string, tool: unknown, theirs: unknown): void => {
      if (show(tool) !== show(theirs)) note(field, tool, theirs);
    };

    // The decoded headers.
    const header = (wanted: string): string =>
      analysis.headers.find((row) => row.name.toLowerCase() === wanted)?.value ?? '';
    compare('from', header('from'), python.from);
    compare('to', header('to'), python.to);
    compare('subject', header('subject'), python.subject);

    // The mailboxes of From and To, with each display name decoded.
    const mailboxes = (wanted: string): { name: string; address: string }[] => {
      const row = analysis.headers.find((r) => r.name.toLowerCase() === wanted);
      if (row === undefined) return [];
      return parseAddressList(row.raw).mailboxes.map((m) => ({
        name: decodeEncodedWords(m.name).text,
        address: m.address,
      }));
    };
    compare('fromMailboxes', mailboxes('from'), python.fromMailboxes);
    compare('toMailboxes', mailboxes('to'), python.toMailboxes);

    // The parts.
    const rawNames = new Map(analysis.attachments.map((a) => [a.path, a.rawName] as const));
    const ours = toolParts(bytes, rawNames);
    compare(
      'part paths',
      ours.map((p) => p.path),
      python.parts.map((p) => p.path),
    );
    const count = Math.min(ours.length, python.parts.length);
    for (let i = 0; i < count; i++) {
      const a = ours[i];
      const b = python.parts[i];
      if (a === undefined || b === undefined) continue;
      for (const key of ['contentType', 'filename', 'charset', 'size', 'sha256'] as const) {
        compare(`parts[${b.path === '' ? 'message' : b.path}].${key}`, a[key], b[key]);
      }
    }

    // The first plain text body.
    compare('firstText', analysis.textBody?.text ?? null, python.firstText);
  }

  // Every difference is named, and every named difference still happens.
  const key = (d: KnownDifference): string => `${d.message}|${d.field}|${d.tool}|${d.python}`;
  const named = new Map(KNOWN_DIFFERENCES.map((d) => [key(d), d] as const));
  const unexplained = found
    .filter((d) => !named.has(key(d)))
    .map((d) => `${d.message} ${d.field}: tool ${d.tool} / python ${d.python}`);
  expect(unexplained).toEqual([]);
  const seen = new Set(found.map(key));
  const stale = KNOWN_DIFFERENCES.filter((d) => !seen.has(key(d))).map((d) => `${d.message} ${d.field}`);
  expect(stale).toEqual([]);
  // Each named difference says why.
  for (const d of KNOWN_DIFFERENCES) expect(d.why.length).toBeGreaterThan(30);
  // A large unexplained set would mean a bug, so the named set stays small.
  expect(KNOWN_DIFFERENCES.length).toBeLessThanOrEqual(20);
});
