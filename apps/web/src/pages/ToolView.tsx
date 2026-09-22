import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ToolPage } from '../lib/tool-ui';
import { getEntry, loadTool, TOOL_META } from '../lib/registry';
import { issueUrl, toolSourceUrl, COMMIT } from '../lib/site';
import ToolRunner from '../components/ToolRunner';
import NotFound from './NotFound';

export default function ToolView() {
  const { id = '' } = useParams();
  const entry = getEntry(id);
  const [tool, setTool] = useState<ToolPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    let live = true;
    setState('loading');
    setTool(null);
    loadTool(id)
      .then((t) => {
        if (!live) return;
        if (t) {
          setTool(t);
          setState('ready');
        } else {
          setState('missing');
        }
      })
      .catch(() => live && setState('missing'));
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    if (entry) document.title = `${entry.name} — Free & Open Dev Tools`;
    return () => {
      document.title = 'Free & Open Dev Tools';
    };
  }, [entry]);

  if (!entry) return <NotFound />;

  const meta = TOOL_META[id];

  if (state === 'missing') {
    return (
      <>
        <div className="breadcrumbs">
          <Link to="/tools">Tools</Link> / {entry.name}
        </div>
        <h1>{entry.name}</h1>
        <p className="tool-summary">{entry.summary}</p>
        <div className="note note-warn" style={{ maxWidth: '70ch' }}>
          This tool is in the catalog but is not built yet. It has not been implemented, tested or shipped, and there is
          no partial version behind this page. See <Link to="/catalog">the catalog</Link> for what is done and what is
          outstanding.
        </div>
      </>
    );
  }

  return (
    <>
      <header className="tool-header">
        <div className="breadcrumbs">
          <Link to="/tools">Tools</Link> / <Link to={`/tools?category=${entry.category}`}>{entry.categoryLabel}</Link> /{' '}
          {entry.name}
        </div>
        <h1>{entry.name}</h1>
        <p className="tool-summary">{entry.summary}</p>
        <div className="badge-row">
          <span className="pill">Processed locally in your browser</span>
          {meta ? <span className="pill pill-neutral">v{meta.version}</span> : null}
          <span className="pill pill-neutral">MIT</span>
          <a
            className="button"
            style={{ padding: '3px 10px', fontSize: '0.8rem' }}
            href={toolSourceUrl(id)}
            rel="noreferrer noopener"
          >
            Source and tests
          </a>
          <a
            className="button"
            style={{ padding: '3px 10px', fontSize: '0.8rem' }}
            href={issueUrl(id, entry.name)}
            rel="noreferrer noopener"
          >
            Report an issue
          </a>
        </div>
      </header>

      {state === 'loading' || !tool ? (
        <div className="panel">
          <div className="panel-body">
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Loading the tool…</p>
          </div>
        </div>
      ) : (
        <ToolRunner tool={tool} />
      )}

      {tool ? (
        <div className="docs-section">
          <div className="docs-card">
            <h2>What this does</h2>
            <p>{tool.docs.about}</p>
          </div>
          <div className="docs-card">
            <h2>Supported</h2>
            <ul>
              {tool.docs.supports.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          <div className="docs-card">
            <h2>Limits</h2>
            <ul>
              {tool.docs.limits.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
          {tool.docs.standards && tool.docs.standards.length > 0 ? (
            <div className="docs-card">
              <h2>Defined by</h2>
              <ul>
                {tool.docs.standards.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} rel="noreferrer noopener">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="docs-card">
            <h2>Use it yourself</h2>
            <p style={{ marginBottom: 8 }}>Copy this one tool out and run its tests:</p>
            <pre className="output" style={{ fontSize: '0.76rem' }}>
              {`npx degit JoshKCIT/free-open-dev-tools/tools/${id} ${id}
cd ${id} && npm install && npm test`}
            </pre>
            <p style={{ marginTop: 8, fontSize: '0.8rem' }}>
              Deployed from commit <code>{COMMIT.slice(0, 8)}</code>.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
