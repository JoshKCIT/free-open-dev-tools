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
 *
 * The head carries each page's own content security policy as its first element (the host sends no headers), built
 * from what the page's tool declares in `tools/<id>/src/meta.json` under `needs`. See `lib/csp.mjs`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadCatalog } from './lib/catalog.mjs';
import { inlineScriptHashes, mermaidFrameHashes, metaTag, policyFor } from './lib/csp.mjs';

const dist = join(ROOT, 'apps', 'web', 'dist');
const indexPath = join(dist, 'index.html');
if (!existsSync(indexPath)) {
  console.error('apps/web/dist/index.html not found. Run the Vite build first.');
  process.exit(1);
}

// A template that already carries a policy (this step run twice over one build) would otherwise gain a second one.
const template = readFileSync(indexPath, 'utf8').replace(
  /<meta\s[^>]*http-equiv="Content-Security-Policy"[^>]*>[ \t]*\r?\n?[ \t]*/i,
  '',
);
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
    needs: [],
    title: `${SITE} — browser-local developer utilities and money calculators`,
    description:
      'Free developer tools and money calculators, published for anyone to use. Explore the source, download individual tools, and make them your own. Everything runs in your browser.',
  },
  {
    path: 'tools',
    needs: [],
    title: `All tools — ${SITE}`,
    description:
      'Search and browse every developer tool and money calculator on the site. All of them process your input in the browser.',
  },
  {
    path: 'catalog',
    needs: [],
    title: `Catalog — ${SITE}`,
    description:
      'The full catalog of every developer tool and money calculator, showing which are built and usable today. Every one of them runs entirely in your browser.',
  },
  {
    path: 'privacy',
    needs: [],
    title: `Privacy — ${SITE}`,
    description: 'Exactly what happens to what you type, and what the hosting provider can still see. No vague claims.',
  },
  {
    path: 'about',
    needs: [],
    title: `About — ${SITE}`,
    description: 'Why this exists, how each tool is built and tested, and how to contribute.',
  },
];

// What a built tool page needs beyond the baseline policy. A page with no meta file fails the step, so a page can never
// ship with a policy nobody chose.
function needsOf(id) {
  const metaPath = join(ROOT, 'tools', id, 'src', 'meta.json');
  if (!existsSync(metaPath)) {
    throw new Error(`tools/${id}/src/meta.json is missing for a built tool page (${id}).`);
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  return meta.needs === undefined ? [] : meta.needs;
}

for (const tool of canonical) {
  if (!implemented.has(tool.id)) continue;
  routes.push({
    path: `tools/${tool.id}`,
    needs: needsOf(tool.id),
    title: `${tool.name} — ${SITE}`,
    description: `${tool.summary} Runs entirely in your browser.`,
  });
}

// Attribute-order and line-break tolerant: a formatter may split a meta tag
// across several lines, and a regex that assumed one line would silently match
// nothing and leave every page with the same description.
const TITLE_TAG = /<title>[\s\S]*?<\/title>/;
const DESCRIPTION_TAG = /<meta\s[^>]*name="description"[^>]*>/;
// The anchor the policy goes in front of: Vite writes the encoding declaration first in the head.
const CHARSET_TAG = /<meta\s+charset="utf-8"\s*\/?>/i;

// The inline scripts of the template are the same on every page, so their hashes are computed once. The Mermaid frame
// hashes cost a compile of two files, so they are computed only when some page declares the frame.
const scriptHashes = inlineScriptHashes(template);
const frameHashes = routes.some((r) => r.needs.includes('mermaid-frame')) ? mermaidFrameHashes(ROOT) : [];

function render(route) {
  // Replacer functions, not replacement strings: a string is read for `$&`, `$1`, `$$` and so on, which would
  // rewrite a title or summary that holds a dollar sign.
  const withTitle = template.replace(TITLE_TAG, () => `<title>${escape(route.title)}</title>`);
  const withDescription = withTitle.replace(
    DESCRIPTION_TAG,
    () => `<meta name="description" content="${escape(route.description)}" />`,
  );

  // A replacement that changed nothing means the template moved and this script
  // did not. Fail rather than emit pages that all claim to be the same thing.
  if (withTitle === template) {
    throw new Error('Could not find a <title> tag in apps/web/index.html to replace.');
  }
  if (withDescription === withTitle) {
    throw new Error('Could not find a description meta tag in apps/web/index.html to replace.');
  }
  // Put the policy in front of the encoding declaration, so it is the first element of the head. The encoding
  // declaration stays well inside the first 1,024 bytes the browser reads to find it.
  const indent = (template.match(/^([ \t]*)<meta\s+charset=/im) ?? ['', ''])[1];
  const withPolicy = withDescription.replace(
    CHARSET_TAG,
    (charset) => `${metaTag(policyFor({ needs: route.needs, scriptHashes, frameHashes }))}\n${indent}${charset}`,
  );
  if (withPolicy === withDescription) {
    throw new Error(
      'Could not find the charset meta in apps/web/index.html to put the content security policy before.',
    );
  }
  return withPolicy;
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
    needs: [],
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
