import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Field, ToolPage, ToolResult, Values } from '../lib/tool-ui';
import { formatBytes } from '../lib/tool-ui';
import OutputView from './OutputView';

function initialValues(fields: Field[]): Values {
  const v: Values = {};
  for (const f of fields) {
    if (f.type === 'file') v[f.name] = [];
    else if (f.type === 'checkbox') v[f.name] = f.default ?? false;
    else v[f.name] = f.default ?? '';
  }
  return v;
}

function FieldControl({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
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
              {selected[0].name} — {formatBytes(selected[0].size)}
              {selected.length > 1 ? `, and ${selected.length - 1} more` : ''}
            </p>
          ) : null}
          {help}
        </div>
      );
    }

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
  const abortRef = useRef<AbortController | null>(null);
  const runSeq = useRef(0);

  useEffect(() => {
    setValues(base);
    setResult(null);
    setCrashed(null);
    setProgress(null);
  }, [base]);

  const execute = useCallback(
    async (v: Values) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++runSeq.current;
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

  const visibleFields = tool.fields.filter((f) => !f.visible || f.visible(values));
  const set = (name: string, v: unknown) => {
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

  return (
    <div className="tool-layout">
      <section className="panel" aria-label="Input and options">
        <div className="panel-head">
          Input
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
            <FieldControl key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
          ))}
          <div className="toolbar">
            {tool.autoRun === false ? (
              <button
                type="button"
                className="button button-primary"
                onClick={() => void execute(values)}
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
                if (tool.cancellable && running) abandonRun('reset');
                setValues(base);
                setResult(null);
                setCrashed(null);
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
        <div className="panel-body">
          {crashed ? (
            <div className="note note-error">
              The tool failed on this input: {crashed}. This is a bug. Please report it with a description of the input,
              not the input itself.
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
            <p style={{ color: 'var(--text-faint)', fontSize: '0.88rem', margin: 0 }}>
              {tool.autoRun === false ? 'Choose your input, then press Run.' : 'Output appears here as you type.'}
            </p>
          ) : null}

          {statsPosition === 'after-outputs' ? statsBlock : null}
        </div>
      </section>
    </div>
  );
}
