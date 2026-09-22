import { Routes, Route, Link, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import Home from './pages/Home';
import ToolsIndex from './pages/ToolsIndex';
import ToolView from './pages/ToolView';
import Privacy from './pages/Privacy';
import About from './pages/About';
import Catalog from './pages/Catalog';
import NotFound from './pages/NotFound';
import ThemeToggle from './components/ThemeToggle';
import { REPO_URL } from './lib/site';

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="currentColor" opacity="0.12" />
      <path
        d="M12 9l-5 7 5 7M20 9l5 7-5 7"
        stroke="currentColor"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Moves keyboard focus to the page heading on navigation. */
function FocusOnRouteChange() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    // Not on first paint: taking focus there would put it past the skip link,
    // so the first Tab press would miss it.
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="wrap">
          <Link className="brand" to="/">
            <span style={{ color: 'var(--accent)', display: 'flex' }}>
              <Logo />
            </span>
            Free &amp; Open Dev Tools
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/tools">Tools</NavLink>
            <NavLink to="/catalog">Catalog</NavLink>
            <NavLink to="/privacy">Privacy</NavLink>
            <NavLink to="/about">About</NavLink>
            <a href={REPO_URL} rel="noreferrer noopener">
              Source
            </a>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <FocusOnRouteChange />

      <main id="main" tabIndex={-1}>
        <div className="wrap">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/tools" element={<ToolsIndex />} />
            <Route path="/tools/:id" element={<ToolView />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <span>Free &amp; Open Dev Tools. MIT licensed. Every tool runs in your browser.</span>
          <nav aria-label="Footer">
            <Link to="/privacy">Privacy</Link>
            <Link to="/about">About</Link>
            <a href={REPO_URL} rel="noreferrer noopener">
              GitHub
            </a>
            <a href={`${REPO_URL}/issues/new/choose`} rel="noreferrer noopener">
              Report an issue
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
