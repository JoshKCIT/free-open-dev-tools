import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Field, ToolPage, ToolResult, Values } from '../lib/tool-ui';
import { formatBytes } from '../lib/tool-ui';
import GridField from './GridField';
import PointField from './PointField';
import OutputView, { StaleOutputContext } from './OutputView';
import WorkingCue, { startSentence } from './WorkingCue';

function initialValues(fields: Field[]): Values {
  const v: Values = {};
  for (const f of fields) {
    if (f.type === 'file') v[f.name] = [];
    else if (f.type === 'checkbox') v[f.name] = f.default ?? false;
    // A deep copy: edits to the grid a visitor is typing into must never
    // mutate the field's own default array, or Reset would hand back a
    // grid the visitor had already changed.
    else if (f.type === 'grid')
      v[f.name] = Array.isArray(f.default) ? (f.default as string[][]).map((row) => row.slice()) : [['']];
    // A copy of the field's own default point, or the field's minimum on
    // both axes when no default is given, so Reset always hands back a
    // finite { x, y } rather than an empty object PointField would have to
    // special-case.
    else if (f.type === 'point')
      v[f.name] = {
        x: (f.default as { x?: number } | undefined)?.x ?? f.min ?? 0,
        y: (f.default as { y?: number } | undefined)?.y ?? f.min ?? 0,
      };
    else v[f.name] = f.default ?? '';
  }
  return v;
}

function FieldControl({
  field,
  value,
  onChange,
  resetSeq,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  // Bumped by ToolRunner's Reset button. Used only as the file input's own
  // React key: a native <input type="file"> is uncontrolled, so clearing
  // `value` to [] does not clear what the browser itself displays as
  // chosen. Changing the key forces React to unmount and recreate just this
  // element, which is the only way to clear that native display.
  resetSeq: number;
}) {
  const id = `f-${field.name}`;
  const describedBy = field.help ? `${id}-help` : undefined;
  const mono = field.mono ?? field.type === 'textarea';

  const help = field.help ? (
    <p className="field-help" id={`${id}-help`}>
      {field.help}
    </p>
  ) : null;

  switch (field.type) {
    case 'textarea':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <textarea
            id={id}
            className={mono ? 'mono' : undefined}
            rows={field.rows ?? 8}
            value={String(value ?? '')}
            placeholder={field.placeholder}
            aria-describedby={describedBy}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => onChange(e.target.value)}
          />
          {help}
        </div>
      );

    case 'text':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <input
            id={id}
            type="text"
            className={mono ? 'mono' : undefined}
            value={String(value ?? '')}
            placeholder={field.placeholder}
            aria-describedby={describedBy}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => onChange(e.target.value)}
          />
          {help}
        </div>
      );

    case 'number':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <input
            id={id}
            type="number"
            value={value === '' || value === undefined ? '' : String(value)}
            min={field.min}
            max={field.max}
            step={field.step}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
          {help}
        </div>
      );

    case 'range':
      return (
        <div className="field">
          <label htmlFor={id}>
            {field.label}
            <span style={{ float: 'right', fontFamily: 'var(--mono)', fontWeight: 500, color: 'var(--text-muted)' }}>
              {String(value)}
            </span>
          </label>
          <input
            id={id}
            type="range"
            value={Number(value ?? 0)}
            min={field.min}
            max={field.max}
            step={field.step}
            aria-describedby={describedBy}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          {help}
        </div>
      );

    case 'select':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <select
            id={id}
            value={String(value ?? '')}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {help}
        </div>
      );

    case 'radio':
      return (
        <div className="field" role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
          <span className="field-label" id={`${id}-label`}>
            {field.label}
          </span>
          <div className="radio-group">
            {field.options?.map((o) => (
              <label key={o.value}>
                <input
                  type="radio"
                  name={field.name}
                  value={o.value}
                  checked={String(value) === o.value}
                  onChange={() => onChange(o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
          {help}
        </div>
      );

    case 'checkbox':
      return (
        <div className="field">
          <div className="checkbox-field">
            <input
              id={id}
              type="checkbox"
              checked={Boolean(value)}
              aria-describedby={describedBy}
              onChange={(e) => onChange(e.target.checked)}
            />
            <label htmlFor={id}>{field.label}</label>
          </div>
          {help}
        </div>
      );

    case 'color':
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id={id}
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#2563eb'}
              aria-describedby={describedBy}
              onChange={(e) => onChange(e.target.value)}
            />
            <input
              type="text"
              className="mono"
              value={String(value ?? '')}
              aria-label={`${field.label} value`}
              spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
          {help}
        </div>
      );

    case 'file': {
      const selected = Array.isArray(value) ? (value as File[]) : [];
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <input
            id={id}
            key={resetSeq}
            type="file"
            accept={field.accept}
            multiple={field.multiple}
            aria-describedby={describedBy}
            onChange={(e) => onChange(Array.from(e.target.files ?? []))}
          />
          {/* No custom empty-state copy: when nothing is chosen the browser
              renders its own placeholder, which the design contract records
              as deliberate. This summary line is additive and shown only
              once at least one file is selected. */}
          {selected.length > 0 && selected[0] ? (
            <p className="field-help">
              {selected[0].name} ({formatBytes(selected[0].size)})
              {selected.length > 1 ? `, and ${selected.length - 1} more` : ''}
            </p>
          ) : null}
          {help}
        </div>
      );
    }

    case 'grid':
      return <GridField field={field} value={value} onChange={onChange} />;

    case 'point':
      return <PointField field={field} value={value} onChange={onChange} />;

    default:
      return null;
  }
}

export default function ToolRunner({ tool }: { tool: ToolPage }) {
  const base = useMemo(() => initialValues(tool.fields), [tool]);
  const [values, setValues] = useState<Values>(base);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [running, setRunning] = useState(false);
  const [crashed, setCrashed] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ fraction: number; detail?: string } | null>(null);
  // Bumped only by Reset (below); remounts native file inputs so the
  // browser's own "no file chosen" display clears along with the app's
  // selected-file summary. See FieldControl's own comment on this prop.
  const [resetSeq, setResetSeq] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const runSeq = useRef(0);
  // The working cue. `run` is keyed on the run, not on `running`: `running` stays true when a new run
  // supersedes a running one, so only a counter bumped inside `execute` restarts the cue's clock. `startedAt` is a
  // `performance.now()` reading from the start of the run.
  const [run, setRun] = useState({ id: 0, startedAt: 0 });
  // The id of the run whose cue is on screen, or null. Set when the cue first appears, reset by the effect below.
  const [cueShownFor, setCueShownFor] = useState<number | null>(null);
  // True from the moment the start sentence was spoken until the end sentence is, so a run that superseded a shown one
  // still ends with one message and a run that never showed a cue never touches the status.
  const announced = useRef(false);
  // The one status message: the start sentence when a cue appears, then Finished. or Cancelled. when the run ends.
  const [status, setStatus] = useState('');
  // How the run that is ending ended: abandoned by Cancel, Reset or an edit, or run to its own end.
  const endedBy = useRef<'finished' | 'cancelled'>('finished');
  // Set by Cancel; honoured in an effect once `running` is false, because the Run button is disabled while it is true.
  const focusAfterCancel = useRef(false);
  // Set when Run is pressed while it has focus (the keyboard, or a click in an engine that focuses buttons). Disabling a
  // focused button drops focus to the page body, so the run's end puts it back on Run unless the visitor moved it.
  const focusRunAfterRun = useRef(false);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const inputTitleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setValues(base);
    setResult(null);
    setCrashed(null);
    setProgress(null);
    announced.current = false;
    setCueShownFor(null);
    setStatus('');
  }, [base]);

  const execute = useCallback(
    async (v: Values) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++runSeq.current;
      endedBy.current = 'finished';
      focusAfterCancel.current = false;
      const startedAt = performance.now();
      setRun((r) => ({ id: r.id + 1, startedAt }));
      setRunning(true);
      setCrashed(null);
      setProgress(null);
      try {
        const r = await tool.run(v, {
          signal: controller.signal,
          onProgress: (fraction, detail) => {
            // Guarded on BOTH the captured sequence AND the captured
            // controller's aborted state. The sequence counter is only
            // advanced when a run begins, or when the run is abandoned
            // below. After a cancel with no new run started, the sequence
            // is unchanged -- a job that ignores its abort signal and
            // keeps reporting would sail through a sequence-only guard and
            // repaint the bar the cancel just cleared. Checking abortion
            // too closes that gap.
            if (seq === runSeq.current && !controller.signal.aborted) {
              setProgress({ fraction, detail });
            }
          },
        });
        // A tool may finish its work without ever observing the abort
        // signal. If the controller has already been aborted (by Cancel or
        // by the run being abandoned below), return here before setting a
        // result, so a late result can never overwrite the cancellation
        // note that was already set. Only the catch path checked this
        // before; the success path checked only the sequence, which is
        // not enough.
        if (controller.signal.aborted) return;
        if (seq === runSeq.current) setResult(r);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (seq === runSeq.current) {
          setResult(null);
          setCrashed(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (seq === runSeq.current) {
          setRunning(false);
          setProgress(null);
        }
      }
    },
    [tool],
  );

  /**
   * The single operation that invalidates whatever run is currently in
   * flight. Cancel, Reset, the field value setter and the example buttons
   * all route through this rather than each reimplementing invalidation,
   * so a visitor who edits the form, resets it or picks a different
   * example while a cancellable run is in flight can never be handed that
   * run's result into a form that has since moved on.
   *
   * Does all four of the following, in this order:
   *   1. advance the run sequence counter -- every sequence-based guard in
   *      this component (the progress callback above, and the success
   *      path in `execute`) now treats the in-flight run as stale;
   *   2. abort the controller -- a worker or a signal-observing tool
   *      stops; a tool that ignores the signal cannot be stopped from
   *      here, only suppressed (see the comment above `execute`'s abort
   *      check);
   *   3. clear the progress state, so a stale bar can never linger into
   *      whatever comes next;
   *   4. clear `running` directly. This step is NOT redundant: step 1
   *      already advanced the sequence, so the `finally` block in
   *      `execute` above -- which only clears `running` while its
   *      captured sequence is still current -- will skip its own cleanup
   *      once that promise settles. Without this step the Run button,
   *      gated on `disabled={running}`, would stay disabled forever.
   */
  const abandonRun = useCallback((reason: 'cancel' | 'reset' | 'edit') => {
    // 1. advance the run sequence counter.
    runSeq.current++;
    endedBy.current = 'cancelled';
    if (reason === 'cancel') focusAfterCancel.current = true;
    // 2. abort the controller.
    abortRef.current?.abort();
    // 3. clear the progress state.
    setProgress(null);
    // 4. clear running directly -- step 1 already advanced the sequence, so
    //    execute's own finally (which only clears running while its
    //    captured sequence is still current) skips its own cleanup here.
    //    Without this the Run button, disabled while running, would never
    //    re-enable once the abandoned promise settles.
    setRunning(false);
    if (reason === 'cancel') {
      // Cancelling never shows a partial result: a half-computed digest a
      // visitor might copy and trust is worse than none.
      setCrashed(null);
      setResult({
        outputs: [{ kind: 'note', tone: 'warn', value: 'Cancelled before finishing. No result was produced.' }],
      });
    } else if (reason === 'reset') {
      setResult(null);
      setCrashed(null);
    }
    // reason === 'edit': leave the result panel exactly as it is. The
    // visitor is mid-thought, not starting over.
  }, []);

  // Debounced auto-run. The delay keeps a large paste from re-running per keystroke.
  useEffect(() => {
    if (tool.autoRun === false) return;
    const t = setTimeout(() => void execute(values), 140);
    return () => clearTimeout(t);
  }, [values, execute, tool.autoRun]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The end of a shown cue. The cue clears its own timers when it unmounts (it renders only while a run is going and is
  // keyed on the run), so every way a run can end, and a run that supersedes another, reaches the same single cleanup.
  // This effect drops a cue that belongs to an earlier run and, once nothing is running, says the end once, and only
  // when the start was spoken: a run that never showed the cue changes the status not at all, and a run that supersedes
  // a shown one says nothing at the switch because the work goes on, then ends with the one message.
  useEffect(() => {
    setCueShownFor((id) => (running && id === run.id ? id : null));
    if (!running && announced.current) {
      announced.current = false;
      setStatus(endedBy.current === 'cancelled' ? 'Cancelled.' : 'Finished.');
    }
  }, [running, run.id]);

  // After Cancel, put focus where the visitor can carry on: the Run button, or the Input title on a page that has none.
  // After a run that was started from a focused Run button, put focus back on Run, but only while it is still on the
  // page body: a visitor who moved to a field or another control during the run keeps their place.
  useEffect(() => {
    if (running) return;
    const afterCancel = focusAfterCancel.current;
    const afterRun = focusRunAfterRun.current;
    focusAfterCancel.current = false;
    focusRunAfterRun.current = false;
    if (afterCancel) {
      (runButtonRef.current ?? inputTitleRef.current)?.focus();
    } else if (afterRun && (document.activeElement === null || document.activeElement === document.body)) {
      runButtonRef.current?.focus();
    }
  }, [running]);

  // Timed refresh (a result may ask for one run more through `refreshAfterMs`). One timer, armed from the latest result
  // and cleared by the effect's own cleanup when a new result arrives, Reset empties the result or the page is left;
  // an edit clears it at once through `clearRefresh`. The run itself is the ordinary `execute` with the values the form
  // holds at that moment, so it takes the same path as a typed change.
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the armed timer is due, in device-clock milliseconds; null when no timer is armed. A tab that was hidden has its
  // timers held back, so the catch-up below compares this with the clock when the tab is shown again.
  const dueAt = useRef<number | null>(null);
  const clearRefresh = useCallback(() => {
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = null;
    dueAt.current = null;
  }, []);
  useEffect(() => {
    const wait = result?.refreshAfterMs;
    if (!wait || tool.autoRun === false) return;
    const ms = Math.min(Math.max(wait, 250), 60_000);
    dueAt.current = Date.now() + ms;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      dueAt.current = null;
      void execute(valuesRef.current);
    }, ms);
    return clearRefresh;
  }, [result, execute, tool.autoRun, clearRefresh]);
  // Catch-up: when the tab becomes visible again, or the page comes back from the back-forward cache, after the due time
  // has passed, run once at once. The run's own result arms the timer for the next boundary.
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState !== 'visible' || dueAt.current === null || Date.now() < dueAt.current) return;
      clearRefresh();
      void execute(valuesRef.current);
    };
    document.addEventListener('visibilitychange', catchUp);
    window.addEventListener('pageshow', catchUp);
    return () => {
      document.removeEventListener('visibilitychange', catchUp);
      window.removeEventListener('pageshow', catchUp);
    };
  }, [execute, clearRefresh]);

  const visibleFields = tool.fields.filter((f) => !f.visible || f.visible(values));
  const set = (name: string, v: unknown) => {
    clearRefresh();
    if (tool.cancellable && running) abandonRun('edit');
    setValues((prev) => ({ ...prev, [name]: v }));
  };

  const hasOutput = result && result.outputs.length > 0;
  const statsBlock =
    result?.stats && result.stats.length > 0 ? (
      <div className="stats">
        {result.stats.map(([k, v]) => (
          <span key={k}>
            {k} <strong>{v}</strong>
          </span>
        ))}
      </div>
    ) : null;
  const statsPosition = result?.statsPosition ?? 'before-outputs';
  // An earlier result is on screen: outputs, problems, warnings, stats or a crash message.
  const hasEarlierResult =
    crashed !== null ||
    Boolean(
      result && (result.outputs.length > 0 || result.errors?.length || result.warnings?.length || result.stats?.length),
    );
  const cueVisible = running && cueShownFor === run.id;
  const stale = cueVisible && hasEarlierResult;

  return (
    <div className="tool-layout">
      <section className="panel" aria-label="Input and options">
        <div className="panel-head">
          <span className="panel-title" ref={inputTitleRef} tabIndex={-1}>
            Input
          </span>
          <span className="spacer" />
          {tool.examples && tool.examples.length > 0 ? (
            <div className="toolbar toolbar-small">
              {tool.examples.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  className="button"
                  style={{ padding: '3px 9px', fontSize: '0.78rem' }}
                  onClick={() => {
                    // Bypasses the field setter, so it must abandon an
                    // in-flight cancellable run itself -- otherwise a
                    // visitor who picks a different example mid-run could
                    // be handed the old run's result into the new example's
                    // fields.
                    clearRefresh();
                    if (tool.cancellable && running) abandonRun('edit');
                    setValues({ ...base, ...ex.values });
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="panel-body">
          {visibleFields.map((f) => (
            <FieldControl
              key={f.name}
              field={f}
              value={values[f.name]}
              onChange={(v) => set(f.name, v)}
              resetSeq={resetSeq}
            />
          ))}
          <div className="toolbar">
            {tool.autoRun === false ? (
              <button
                type="button"
                className="button button-primary"
                ref={runButtonRef}
                onClick={() => {
                  focusRunAfterRun.current = document.activeElement === runButtonRef.current;
                  void execute(values);
                }}
                disabled={running}
              >
                {running ? 'Working…' : 'Run'}
              </button>
            ) : null}
            {tool.cancellable && running ? (
              <button type="button" className="button" onClick={() => abandonRun('cancel')}>
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              className="button"
              onClick={() => {
                clearRefresh();
                if (tool.cancellable && running) abandonRun('reset');
                // A shallow copy, not `base` itself: when a visitor presses
                // Reset without ever having changed a field, `values` is
                // already the exact `base` reference (its own initial
                // state), so `setValues(base)` would be a no-op React
                // bails out on -- the debounced auto-run effect below
                // never re-fires because its own `values` dependency
                // never changed identity, leaving the output panel empty
                // after `setResult(null)` with nothing to ever refill it.
                setValues({ ...base });
                setResult(null);
                setCrashed(null);
                // Remounts every native file input (see resetSeq's own
                // comment above), clearing the browser's own displayed
                // file name alongside the app's selected-file summary.
                setResetSeq((k) => k + 1);
              }}
            >
              Reset
            </button>
          </div>
          {progress ? (
            <>
              <progress className="tool-progress" max={1} value={progress.fraction} aria-label="Run progress" />
              {progress.detail ? <p className="field-help">{progress.detail}</p> : null}
            </>
          ) : null}
        </div>
      </section>

      <section className="panel" aria-label="Output" aria-busy={running}>
        <div className="panel-head">
          Output
          <span className="spacer" />
          <span className="pill" title="Input is processed by JavaScript in this tab and is never transmitted.">
            Processed locally in your browser
          </span>
        </div>
        {running ? (
          <WorkingCue
            key={`${tool.id}:${run.id}`}
            runId={run.id}
            startedAt={run.startedAt}
            limit={tool.runLimit}
            cancellable={Boolean(tool.cancellable)}
            stale={hasEarlierResult}
            onShown={() => {
              announced.current = true;
              setCueShownFor(run.id);
              setStatus(startSentence(tool.runLimit));
            }}
          />
        ) : null}
        <StaleOutputContext.Provider value={stale}>
          <div className={stale ? 'panel-body output-stale' : 'panel-body'}>
            {crashed ? (
              <div className="note note-error">
                The tool failed on this input: {crashed}. This is a bug. Please report it with a description of the
                input, not the input itself.
              </div>
            ) : null}

            {result?.errors && result.errors.length > 0 ? (
              <ul className="issue-list" aria-label="Input problems">
                {result.errors.map((e, i) => (
                  <li className="issue" key={i}>
                    {e.line !== undefined ? (
                      <strong>
                        Line {e.line}
                        {e.column !== undefined ? `, column ${e.column}` : ''}:{' '}
                      </strong>
                    ) : null}
                    {e.path ? <code>{e.path}</code> : null} {e.message}
                  </li>
                ))}
              </ul>
            ) : null}

            {result?.warnings && result.warnings.length > 0
              ? result.warnings.map((w, i) => (
                  <div className="note note-warn" key={i}>
                    {w}
                  </div>
                ))
              : null}

            {statsPosition === 'before-outputs' ? statsBlock : null}

            {hasOutput ? (
              <div>
                {result.outputs.map((b, i) => (
                  <Fragment key={i}>
                    <OutputView block={b} />
                    {statsPosition === 'after-first-output' && i === 0 ? statsBlock : null}
                  </Fragment>
                ))}
              </div>
            ) : !result?.errors?.length && !crashed ? (
              <p className="output-empty" style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
                {tool.autoRun === false ? 'Choose your input, then press Run.' : 'Output appears here as you type.'}
              </p>
            ) : null}

            {statsPosition === 'after-outputs' ? statsBlock : null}
          </div>
        </StaleOutputContext.Provider>
      </section>

      {/* The one status message sits outside the Output section, which is marked busy while a run goes: assistive
          technology may hold back changes inside a busy region until it is no longer busy, which would swallow the start
          sentence. It is visually hidden and absolutely positioned, so it takes no grid cell. */}
      <span className="visually-hidden" role="status">
        {status}
      </span>
    </div>
  );
}
