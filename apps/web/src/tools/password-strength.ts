import { meta, score, MAX_PASSWORD_LENGTH } from '@fodt/password-strength';
import { defineTool, str, type OutputBlock, type ToolResult } from '../lib/tool-ui';

// This is the phase's one deliberate exception to every other new tool
// leaning on a wait-for-Run field: a strength meter's whole value is
// feedback while typing, so this page leaves the run-on-button flag unset,
// which keeps `defineTool`'s own site default (see ../lib/tool-ui) in
// effect rather than overriding it. The existing 140ms debounce
// (ToolRunner.tsx) already covers this page's typing latency; the
// dictionaries were bundled statically for exactly this reason
// (02-CONTEXT.md D-12), so no worker and no spinner is needed.
export default defineTool({
  id: 'password-strength',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    {
      name: 'password',
      label: 'Password',
      type: 'text',
      placeholder: 'Type a password to see how guessable it is',
      help: 'Scored inside this page as you type. Never sent anywhere: no request, no storage, no cookie, no URL.',
    },
  ],
  examples: [
    { label: 'A commonly leaked password', values: { password: 'password' } },
    { label: 'A long random passphrase', values: { password: 'correct horse battery staple velvet lantern' } },
  ],
  run(values): ToolResult {
    const password = str(values, 'password');
    // Scoring nothing is not a judgement about a password: an empty input
    // returns no outputs at all, which is what makes the runner show its
    // own "Output appears here as you type." placeholder instead of a
    // verdict of the lowest score.
    if (!password) return { outputs: [] };

    const report = score(password);

    // The verdict's tone comes straight from the tool package's own
    // SCORE_LABELS lookup (tools/password-strength/src/index.ts), which is
    // itself a single array indexed by score -- not a chain of conditionals
    // here or there. Reading it through `report.tone` keeps the mapping
    // defined in exactly one place instead of duplicating it in this file
    // and risking the two drifting apart.
    const leadingReason = report.reasons[0]?.sentence ?? 'No specific weak pattern was found.';

    // Fixed contract order (02-UI-SPEC.md Section 4): verdict note, then
    // stats, then the reasons list, then the crack-time table. The runner
    // renders every `stats` entry before every output block unless told
    // otherwise (ToolRunner.tsx), so `statsPosition: 'after-first-output'`
    // below is what actually places stats between the verdict note and the
    // reasons list -- without it the visitor would see stats above the
    // verdict, silently violating this order. A two-state boolean could not
    // express "after the first block, before the rest"; that is exactly why
    // ToolResult.statsPosition (02-02) is a three-valued union rather than a
    // boolean. The assembled array below reads verdict, reasons, table --
    // the stats line is inserted by the runner between outputs[0] and
    // outputs[1], not written here.
    const outputs: OutputBlock[] = [
      {
        kind: 'note',
        tone: report.tone,
        value: `${report.label} (${report.score} / 4). ${leadingReason}`,
      },
      {
        kind: 'list',
        label: 'Why',
        items: report.reasons.map((r) => r.sentence),
      },
      {
        kind: 'table',
        label: 'Estimated crack time by scenario',
        table: {
          headers: ['Attack scenario', 'Estimated time'],
          rows: report.crackTimes.map((c) => [c.scenario, c.display]),
        },
      },
    ];

    if (report.truncated) {
      outputs.push({
        kind: 'note',
        tone: 'info',
        value: `Only the first ${MAX_PASSWORD_LENGTH} characters were scored; anything typed after that was ignored.`,
      });
    }

    // "Estimated time to crack under the fastest offline scenario" is the
    // last entry in report.crackTimes -- see the fixed order in
    // tools/password-strength/src/index.ts's CRACK_TIME_ORDER: rate-limited
    // online, unthrottled online, slow/salted offline, fast/unsalted
    // offline. Fast/unsalted offline is the fastest an attacker can go.
    const fastestOffline = report.crackTimes[report.crackTimes.length - 1]!;

    return {
      outputs,
      statsPosition: 'after-first-output',
      stats: [
        ['Score', `${report.score} / 4 — ${report.label}`],
        [`Estimated crack time (${fastestOffline.scenario.toLowerCase()})`, fastestOffline.display],
      ],
    };
  },
});
