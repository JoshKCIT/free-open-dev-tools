import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Field, ToolPage, ToolResult, Values } from '../lib/tool-ui';
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

    case 'file':
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
          {help}
        </div>
      );

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
  const abortRef = useRef<AbortController | null>(null);
  const runSeq = useRef(0);

  useEffect(() => {
    setValues(base);
    setResult(null);
    setCrashed(null);
  }, [base]);

  const execute = useCallback(
    async (v: Values) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++runSeq.current;
      setRunning(true);
      setCrashed(null);
      try {
        const r = await tool.run(v, { signal: controller.signal });
        if (seq === runSeq.current) setResult(r);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (seq === runSeq.current) {
          setResult(null);
          setCrashed(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (seq === runSeq.current) setRunning(false);
      }
    },
    [tool],
  );

  // Debounced auto-run. The delay keeps a large paste from re-running per keystroke.
  useEffect(() => {
    if (tool.autoRun === false) return;
    const t = setTimeout(() => void execute(values), 140);
    return () => clearTimeout(t);
  }, [values, execute, tool.autoRun]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const visibleFields = tool.fields.filter((f) => !f.visible || f.visible(values));
  const set = (name: string, v: unknown) => setValues((prev) => ({ ...prev, [name]: v }));

  const hasOutput = result && result.outputs.length > 0;

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
                  onClick={() => setValues({ ...base, ...ex.values })}
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
            <button
              type="button"
              className="button"
              onClick={() => {
                setValues(base);
                setResult(null);
                setCrashed(null);
              }}
            >
              Reset
            </button>
          </div>
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

          {result?.stats && result.stats.length > 0 ? (
            <div className="stats">
              {result.stats.map(([k, v]) => (
                <span key={k}>
                  {k} <strong>{v}</strong>
                </span>
              ))}
            </div>
          ) : null}

          {hasOutput ? (
            <div>
              {result.outputs.map((b, i) => (
                <OutputView key={i} block={b} />
              ))}
            </div>
          ) : !result?.errors?.length && !crashed ? (
            <p style={{ color: 'var(--text-faint)', fontSize: '0.88rem', margin: 0 }}>
              {tool.autoRun === false ? 'Choose your input, then press Run.' : 'Output appears here as you type.'}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
