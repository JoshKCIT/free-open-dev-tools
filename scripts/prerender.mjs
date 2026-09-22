#!/usr/bin/env node
/**
 * Writes a real HTML file for every route.
 *
 * The site is a single-page app, but a static host serves files, not routes.
 * Emitting one file per route means `/tools/base64` is a 200 with its own
 * title and description rather than a 404 or a redirect hack, so links,
 * bookmarks and search engines all behave.
 *
 * This does not server-render the app. The body is still hydrated by the same
 * bundle; only the head differs per route.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadCatalog } from './lib/catalog.mjs';

const dist = join(ROOT, 'apps', 'web', 'dist');
const indexPath = join(dist, 'index.html');
if (!existsSync(indexPath)) {
  console.error('apps/web/dist/index.html not found. Run the Vite build first.');
  process.exit(1);
}

const template = readFileSync(indexPath, 'utf8');
const SITE = 'Free & Open Dev Tools';

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const implemented = new Set(
  existsSync(join(ROOT, 'apps', 'web', 'src', 'tools'))
    ? readdirSync(join(ROOT, 'apps', 'web', 'src', 'tools'))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => f.replace(/\.ts$/, ''))
    : [],
);

const canonical = loadCatalog();

const routes = [
  {
    path: '',
    title: `${SITE} — browser-local developer utilities`,
    description:
      'Free developer tools, published for anyone to use. Explore the source, download individual tools, and make them your own. Everything runs in your browser.',
  },
  {
    path: 'tools',
    title: `All tools — ${SITE}`,
    description: 'Search and browse every developer tool on the site. All of them process your input in the browser.',
  },
  {
    path: 'catalog',
    title: `Catalog — ${SITE}`,
    description:
      'The full catalog of every planned tool, showing which are built and usable today. Every one of them runs entirely in your browser.',
  },
  {
    path: 'privacy',
    title: `Privacy — ${SITE}`,
    description: 'Exactly what happens to what you type, and what the hosting provider can still see. No vague claims.',
  },
  {
    path: 'about',
    title: `About — ${SITE}`,
    description: 'Why this exists, how each tool is built and tested, and how to contribute.',
  },
];

for (const tool of canonical) {
  if (!implemented.has(tool.id)) continue;
  routes.push({
    path: `tools/${tool.id}`,
    title: `${tool.name} — ${SITE}`,
    description: `${tool.summary} Runs entirely in your browser.`,
  });
}

// Attribute-order and line-break tolerant: a formatter may split a meta tag
// across several lines, and a regex that assumed one line would silently match
// nothing and leave every page with the same description.
const TITLE_TAG = /<title>[\s\S]*?<\/title>/;
const DESCRIPTION_TAG = /<meta\s[^>]*name="description"[^>]*>/;

function render(route) {
  const withTitle = template.replace(TITLE_TAG, `<title>${escape(route.title)}</title>`);
  const withDescription = withTitle.replace(
    DESCRIPTION_TAG,
    `<meta name="description" content="${escape(route.description)}" />`,
  );

  // A replacement that changed nothing means the template moved and this script
  // did not. Fail rather than emit pages that all claim to be the same thing.
  if (withTitle === template) {
    throw new Error('Could not find a <title> tag in apps/web/index.html to replace.');
  }
  if (withDescription === withTitle) {
    throw new Error('Could not find a description meta tag in apps/web/index.html to replace.');
  }
  return withDescription;
}

let written = 0;
for (const route of routes) {
  const html = render(route);
  const dir = route.path ? join(dist, ...route.path.split('/')) : dist;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  written++;

  // Also write the sibling `.html` file. Static hosts differ on how they
  // resolve an extensionless URL: GitHub Pages tries `<path>.html` before
  // `<path>/index.html`, and some preview servers only do one of the two.
  if (route.path) {
    const segments = route.path.split('/');
    const parent = segments.length > 1 ? join(dist, ...segments.slice(0, -1)) : dist;
    mkdirSync(parent, { recursive: true });
    writeFileSync(join(parent, `${segments[segments.length - 1]}.html`), html);
  }
}

// A static host that cannot match a path falls back to 404.html. Serving the
// app there keeps a mistyped or removed tool URL inside the app, where the
// not-found page can suggest the catalog.
writeFileSync(
  join(dist, '404.html'),
  render({
    path: '404',
    title: `Page not found — ${SITE}`,
    description: 'That address does not match a tool or a page here.',
  }),
);

// GitHub Pages otherwise runs the output through Jekyll, which drops files
// and folders whose names begin with an underscore.
writeFileSync(join(dist, '.nojekyll'), '');

writeFileSync(
  join(dist, 'robots.txt'),
  `User-agent: *\nAllow: /\nSitemap: https://joshkcit.github.io/free-open-dev-tools/sitemap.xml\n`,
);

const base = 'https://joshkcit.github.io/free-open-dev-tools';
const urls = routes.map((r) => `  <url><loc>${base}/${r.path}</loc></url>`).join('\n');
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
);

const bytes = (dir) => {
  let total = 0;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    total += s.isDirectory() ? bytes(p) : s.size;
  }
  return total;
};

console.log(
  `Prerendered ${written} routes (${implemented.size} tool pages). Output ${(bytes(dist) / 1024 / 1024).toFixed(2)} MB.`,
);
