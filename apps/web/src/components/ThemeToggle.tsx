import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';

const KEY = 'fodt-theme';

/**
 * The only thing this site stores in your browser. It holds a theme name and
 * nothing else, and it never touches tool input.
 */
function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* storage can be blocked; the theme still applies for this page view */
    }
  }, [theme]);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;

  return (
    <button type="button" className="icon-button" onClick={() => setTheme(next)} title={label} aria-label={label}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
