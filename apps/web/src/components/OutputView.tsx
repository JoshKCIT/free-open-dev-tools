import { useEffect, useMemo, useRef, useState } from 'react';
import type { OutputBlock, DownloadableFile } from '../lib/tool-ui';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <button
      type="button"
      className="button"
      style={{ padding: '3px 9px', fontSize: '0.78rem' }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState('done');
        } catch {
          setState('failed');
        }
      }}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Press Ctrl+C' : label}
      <span className="visually-hidden" role="status">
        {state === 'done' ? 'Copied to clipboard' : ''}
      </span>
    </button>
  );
}

/**
 * Builds the download from an in-memory blob. Nothing is uploaded, and the
 * object URL is revoked as soon as the click is handled.
 */
function DownloadButton({ file, label = 'Download' }: { file: DownloadableFile; label?: string }) {
  return (
    <button
      type="button"
      className="button"
      style={{ padding: '3px 9px', fontSize: '0.78rem' }}
      onClick={() => {
        const body: BlobPart =
          typeof file.content === 'string' ? file.content : (file.content.slice().buffer as ArrayBuffer);
        const url = URL.createObjectURL(new Blob([body], { type: file.mime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }}
    >
      {label}
    </button>
  );
}

/**
 * Renders tool-produced HTML with scripts, forms and all network access denied
 * by the sandbox attribute and a restrictive content security policy. The tool
 * package has already sanitised the markup; this is the second layer.
 */
function SandboxedHtml({ html }: { html: string }) {
  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">` +
      `<style>:root{color-scheme:light}body{font:15px/1.55 system-ui,sans-serif;margin:12px;color:#16191d}` +
      `img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}` +
      `pre{background:#f1f3f6;padding:8px;border-radius:4px;overflow:auto}</style></head><body>${html}</body></html>`,
    [html],
  );
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  useEffect(() => {
    // The frame is same-origin-less under sandbox="", so height is fixed rather
    // than measured. Keeping the sandbox fully closed is worth the trade.
    setHeight(320);
  }, [srcDoc]);
  return (
    <iframe
      ref={ref}
      className="preview-frame"
      sandbox=""
      srcDoc={srcDoc}
      title="Rendered preview"
      style={{ height }}
    />
  );
}

export default function OutputView({ block }: { block: OutputBlock }) {
  const label = 'label' in block ? block.label : undefined;

  const head = (extra?: React.ReactNode) =>
    label || extra ? (
      <div className="output-label">
        <span>{label}</span>
        <span className="spacer" />
        {extra}
      </div>
    ) : null;

  switch (block.kind) {
    case 'code':
    case 'text': {
      const actions = (
        <>
          <CopyButton text={block.value} />
          {block.download ? (
            <DownloadButton
              file={{
                name: block.download,
                mime: block.kind === 'code' ? 'text/plain;charset=utf-8' : 'text/plain;charset=utf-8',
                content: block.value,
              }}
            />
          ) : null}
        </>
      );
      return (
        <div className="output-block">
          {head(actions)}
          <pre className={`output${block.kind === 'code' ? ' nowrap' : ''}`} tabIndex={0}>
            {block.value || ' '}
          </pre>
        </div>
      );
    }

    case 'keyvalue':
      return (
        <div className="output-block">
          {head(<CopyButton text={block.pairs.map(([k, v]) => `${k}: ${v}`).join('\n')} />)}
          <dl className="kv">
            {block.pairs.map(([k, v], i) => (
              <div key={`${k}-${i}`} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      );

    case 'table': {
      const tsv = [block.table.headers.join('\t'), ...block.table.rows.map((r) => r.join('\t'))].join('\n');
      return (
        <div className="output-block">
          {head(<CopyButton text={tsv} label="Copy as TSV" />)}
          <table className="output-table">
            <thead>
              <tr>
                {block.table.headers.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className={block.table.mono?.includes(j) ? 'mono' : undefined}>
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <div className="output-block">
          {head(<CopyButton text={block.items.join('\n')} />)}
          <List style={{ margin: 0, paddingLeft: 20, fontSize: '0.875rem' }}>
            {block.items.map((item, i) => (
              <li key={i} style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem', overflowWrap: 'anywhere' }}>
                {item}
              </li>
            ))}
          </List>
        </div>
      );
    }

    case 'swatches':
      return (
        <div className="output-block">
          {head(<CopyButton text={block.colors.map((c) => c.label).join('\n')} />)}
          <div className="swatch-grid">
            {block.colors.map((c, i) => (
              <button
                key={`${c.label}-${i}`}
                type="button"
                className="swatch"
                title={`Copy ${c.label}`}
                onClick={() => void navigator.clipboard.writeText(c.label).catch(() => {})}
              >
                <span className="swatch-color" style={{ background: c.css }} />
                <span className="swatch-meta">
                  <strong>{c.label}</strong>
                  {c.caption ? <span>{c.caption}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      );

    case 'sandboxed-html':
      return (
        <div className="output-block">
          {head(<CopyButton text={block.html} label="Copy HTML" />)}
          <SandboxedHtml html={block.html} />
        </div>
      );

    case 'image':
      return (
        <div className="output-block">
          {head(null)}
          <div style={{ border: '1px solid var(--border)', borderRadius: 5, padding: 10, textAlign: 'center' }}>
            <img
              src={block.src}
              alt={block.alt}
              width={block.width}
              height={block.height}
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          </div>
        </div>
      );

    case 'files':
      return (
        <div className="output-block">
          {head(null)}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {block.files.map((f) => (
              <li
                key={f.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: '1px solid var(--border)',
                  borderRadius: 5,
                  padding: '6px 10px',
                  fontSize: '0.85rem',
                }}
              >
                <span style={{ fontFamily: 'var(--mono)', overflowWrap: 'anywhere' }}>{f.name}</span>
                <span style={{ color: 'var(--text-faint)', fontSize: '0.78rem' }}>
                  {typeof f.content === 'string' ? `${f.content.length} chars` : `${f.content.byteLength} bytes`}
                </span>
                <span style={{ marginLeft: 'auto' }}>
                  <DownloadButton file={f} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      );

    case 'note':
      return (
        <div className="output-block">
          <div className={`note note-${block.tone}`}>{block.value}</div>
        </div>
      );

    case 'diff':
      return (
        <div className="output-block">
          {head(<CopyButton text={block.lines.map((l) => l.text).join('\n')} label="Copy diff" />)}
          <pre className="diff-view" tabIndex={0}>
            {block.lines.map((l, i) => (
              <span
                key={i}
                className={`diff-line${
                  l.type === 'add'
                    ? ' diff-add'
                    : l.type === 'del'
                      ? ' diff-del'
                      : l.type === 'meta'
                        ? ' diff-meta'
                        : ''
                }`}
              >
                {l.text || ' '}
              </span>
            ))}
          </pre>
        </div>
      );

    default:
      return null;
  }
}
