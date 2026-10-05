import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import ToolsIndex from './pages/ToolsIndex';
import ToolView from './pages/ToolView';
import Privacy from './pages/Privacy';
import About from './pages/About';
import Catalog from './pages/Catalog';
import NotFound from './pages/NotFound';
import ThemeToggle from './components/ThemeToggle';
import { SiteLink, SiteNavLink } from './components/SiteLink';
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

export default function App() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="wrap">
          <SiteLink className="brand" to="/">
            <span style={{ color: 'var(--accent)', display: 'flex' }}>
              <Logo />
            </span>
            Free &amp; Open Dev Tools
          </SiteLink>
          <nav className="nav" aria-label="Main">
            <SiteNavLink to="/tools">Tools</SiteNavLink>
            <SiteNavLink to="/catalog">Catalog</SiteNavLink>
            <SiteNavLink to="/privacy">Privacy</SiteNavLink>
            <SiteNavLink to="/about">About</SiteNavLink>
            <a href={REPO_URL} rel="noreferrer noopener">
              Source
            </a>
            <ThemeToggle />
          </nav>
        </div>
      </header>

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
            <SiteLink to="/privacy">Privacy</SiteLink>
            <SiteLink to="/about">About</SiteLink>
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
