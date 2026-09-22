import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LIVE_TOOLS, byCategory, searchTools, CATEGORY_ORDER, CATALOG } from '../lib/registry';

export default function ToolsIndex() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const activeCategory = params.get('category') ?? '';

  const categories = useMemo(() => {
    const present = new Set(LIVE_TOOLS.map((t) => t.category));
    return CATEGORY_ORDER.filter((c) => present.has(c)).map((c) => ({
      id: c,
      label: CATALOG.find((t) => t.category === c)!.categoryLabel,
      count: LIVE_TOOLS.filter((t) => t.category === c).length,
    }));
  }, []);

  const filtered = useMemo(() => {
    const scoped = activeCategory ? LIVE_TOOLS.filter((t) => t.category === activeCategory) : LIVE_TOOLS;
    return searchTools(query, scoped);
  }, [query, activeCategory]);

  const groups = query
    ? [{ category: 'results', label: `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`, tools: filtered }]
    : byCategory(filtered);

  return (
    <>
      <h1>Tools</h1>
      <p style={{ color: 'var(--text-muted)', maxWidth: '70ch' }}>
        {LIVE_TOOLS.length} tools, all processed in your browser. Each one links to its own folder in the repository,
        with tests and a README you can read before you trust it.
      </p>

      <div className="search-row">
        <div className="search-input">
          <label className="visually-hidden" htmlFor="tool-search">
            Search tools
          </label>
          <input
            id="tool-search"
            type="search"
            placeholder="Search by name, purpose or format, for example: jwt, cidr, cron, base64"
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="category-filters" role="group" aria-label="Filter by category">
        <button
          type="button"
          className="chip"
          aria-pressed={activeCategory === ''}
          onClick={() => setParams({}, { replace: true })}
        >
          All {LIVE_TOOLS.length}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className="chip"
            aria-pressed={activeCategory === c.id}
            onClick={() => setParams({ category: c.id }, { replace: true })}
          >
            {c.label} {c.count}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p style={{ margin: 0 }}>
            No tool matches <strong>{query}</strong>.
          </p>
          <p style={{ margin: '8px 0 0' }}>
            It may be in the planned catalog but not built yet. <Link to="/catalog">Check the catalog</Link> to see
            where it stands.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.category}>
            <h2 className="category-heading">{g.label}</h2>
            <ul className="tool-grid">
              {g.tools.map((t) => (
                <li key={t.id}>
                  <Link className="tool-card" to={`/tools/${t.id}`}>
                    <h3>{t.name}</h3>
                    <p>{t.summary}</p>
                    <span className="tool-card-meta">{t.categoryLabel}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
