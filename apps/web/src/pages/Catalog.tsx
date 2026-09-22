import { Link } from 'react-router-dom';
import { CATALOG, byCategory } from '../lib/registry';
import { REPO_URL } from '../lib/site';

export default function Catalog() {
  const groups = byCategory(CATALOG);
  const built = CATALOG.filter((t) => t.implemented).length;

  return (
    <>
      <h1>Catalog</h1>
      <div className="prose">
        <p>
          <strong>{built}</strong> of those are built, tested and usable today. The rest are listed here so the gap is
          visible rather than hidden. Nothing on this page is a mock: if a tool is not marked as built, there is no
          half-finished version of it behind a link.
        </p>
        <p>
          <a href={`${REPO_URL}/blob/main/docs/LEDGER.md`} rel="noreferrer noopener">
            Implementation ledger
          </a>{' '}
          — what is left to build, in order.
        </p>
      </div>

      {groups.map((g) => (
        <section key={g.category}>
          <h2 className="category-heading">
            {g.label} — {g.tools.filter((t) => t.implemented).length} of {g.tools.length} built
          </h2>
          <ul className="tool-grid">
            {g.tools.map((t) => (
              <li key={t.id}>
                {t.implemented ? (
                  <Link className="tool-card" to={`/tools/${t.id}`}>
                    <h3>{t.name}</h3>
                    <p>{t.summary}</p>
                    <span className="tool-card-meta">
                      <span className="pill">Built</span>
                    </span>
                  </Link>
                ) : (
                  <div className="tool-card" style={{ opacity: 0.72 }}>
                    <h3>{t.name}</h3>
                    <p>{t.summary}</p>
                    <span className="tool-card-meta">
                      <span className="pill pill-neutral">Planned</span>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
