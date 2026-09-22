import { Link } from 'react-router-dom';
import { LIVE_TOOLS, CATALOG, byCategory } from '../lib/registry';
import { REPO_URL } from '../lib/site';

export default function Home() {
  const groups = byCategory(LIVE_TOOLS);

  const featuredIds = [
    'json-formatter',
    'base64',
    'jwt-decoder',
    'regex-tester',
    'unix-timestamp',
    'uuid',
    'hash-text',
    'url-codec',
    'cron-expression',
    'text-diff',
    'data-convert',
    'ip-subnet',
  ];
  const featured = featuredIds.map((id) => LIVE_TOOLS.find((t) => t.id === id)).filter(Boolean) as typeof LIVE_TOOLS;

  return (
    <>
      <section className="hero">
        <h1>Free developer tools, published for anyone to use.</h1>
        <p className="hero-lede">
          Explore the source, download individual tools, and make them your own. Every tool here runs in your browser,
          is MIT licensed, and lives in a folder you can copy out and run on its own.
        </p>
        <div className="hero-actions">
          <Link className="button button-primary" to="/tools">
            Browse {LIVE_TOOLS.length} tools
          </Link>
          <a className="button" href={REPO_URL} rel="noreferrer noopener">
            View the source
          </a>
          <Link className="button" to="/privacy">
            What we can and cannot see
          </Link>
        </div>
        <div className="stat-row">
          <div>
            <strong>{LIVE_TOOLS.length}</strong>
            <span>tools you can use now</span>
          </div>
          <div>
            <strong>{CATALOG.length}</strong>
            <span>in the planned catalog</span>
          </div>
          <div>
            <strong>0</strong>
            <span>accounts, adverts or trackers</span>
          </div>
        </div>
      </section>

      {featured.length > 0 ? (
        <section aria-labelledby="featured-heading">
          <h2 id="featured-heading" className="category-heading" style={{ marginTop: 0 }}>
            Start here
          </h2>
          <ul className="tool-grid">
            {featured.map((t) => (
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
      ) : null}

      <section style={{ marginTop: 40 }} className="prose">
        <h2>How this is different</h2>
        <p>
          Most tool sites like this one are a black box. You paste a token, a config file or a customer record into a
          page and you have no way to know what happens next. This site is built so that you do not have to take that on
          trust.
        </p>
        <ul>
          <li>
            <strong>Your input stays in the tab.</strong> Every tool processes input with JavaScript already running in
            your browser. There is no API to call because there is no server to call it.{' '}
            <Link to="/privacy">The privacy page</Link> sets out exactly what the hosting provider can still see.
          </li>
          <li>
            <strong>Every tool is a folder you can take.</strong> Each one has its own package file, tests, README and
            MIT licence, and no dependency on the rest of this repository.
          </li>
          <li>
            <strong>Correctness is tested against standards, not against other tool sites.</strong> Each tool names the
            specification it implements and the test vectors it is checked against.
          </li>
          <li>
            <strong>Limits are written down.</strong> Every tool page has a section saying what it will not do and where
            it loses information. That section is never empty.
          </li>
        </ul>
      </section>

      {groups.length > 0 ? (
        <section style={{ marginTop: 32 }}>
          <h2 className="category-heading">Everything, by category</h2>
          <ul className="tool-grid">
            {groups.map((g) => (
              <li key={g.category}>
                <Link className="tool-card" to={`/tools?category=${g.category}`}>
                  <h3>{g.label}</h3>
                  <p>
                    {g.tools
                      .map((t) => t.name)
                      .slice(0, 4)
                      .join(', ')}
                    {g.tools.length > 4 ? `, and ${g.tools.length - 4} more` : ''}
                  </p>
                  <span className="tool-card-meta">{g.tools.length} tools</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
