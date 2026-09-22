import { REPO_URL } from '../lib/site';

export default function Privacy() {
  return (
    <div className="prose">
      <h1>Privacy</h1>
      <p style={{ fontSize: '1.05rem', color: 'var(--text-muted)' }}>
        This page tells you what happens to what you type, and what happens around it. It avoids the phrase "we collect
        nothing", because that would not be true of the infrastructure this site is served from.
      </p>

      <h2>What happens to your input</h2>
      <p>
        <strong>Tool input is processed by JavaScript running in your tab and is not transmitted anywhere.</strong>{' '}
        There is no backend API for these tools. There is nothing to send input to.
      </p>
      <p>Concretely, for every tool on this site:</p>
      <ul>
        <li>Your input is never placed in a network request, of any kind, by any tool.</li>
        <li>
          Your input is never placed in the URL. Some tool sites put your data in a shareable link; this one does not,
          because URLs end up in browser history, in referrer headers and in server logs.
        </li>
        <li>
          Your input is never written to <code>localStorage</code>, <code>sessionStorage</code>, IndexedDB or a cookie.
          Reload the page and it is gone.
        </li>
        <li>
          Your input is never included in the "Report an issue" link. That link carries the tool name and nothing else.
        </li>
        <li>There is no analytics script, no error reporting service, no session recorder and no advertising.</li>
      </ul>
      <p>
        This is enforced, not just promised. An automated test drives every tool in a real browser with the network
        intercepted, and fails the build if any request is made, if storage is written, or if the URL changes while a
        tool is running. See <code>e2e/privacy.spec.ts</code> in{' '}
        <a href={REPO_URL} rel="noreferrer noopener">
          the repository
        </a>
        .
      </p>

      <h2>What the hosting provider can still see</h2>
      <p>
        The site is static files served by GitHub Pages. Like any web host, GitHub receives and may log the ordinary
        details of an HTTP request when your browser fetches a page or an asset:
      </p>
      <ul>
        <li>Your IP address.</li>
        <li>The date and time of the request.</li>
        <li>
          Which file was requested, which includes the tool page path, for example <code>/tools/jwt-decoder</code>.
        </li>
        <li>Your user agent string and, in some cases, the referring page.</li>
      </ul>
      <p>
        <strong>
          This means the fact that you opened a particular tool can be visible to the host, even though what you typed
          into it is not.
        </strong>{' '}
        That log is GitHub's, not ours, and is governed by{' '}
        <a
          href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement"
          rel="noreferrer noopener"
        >
          GitHub's privacy statement
        </a>
        . Neither of those logs is readable by this project, and nothing is added to them by anything on this site.
      </p>
      <p>
        If the page path alone is sensitive in your situation, the honest answer is to run the site locally or take the
        single tool folder you need. Both are supported, documented and take about a minute.
      </p>

      <h2>Downloading assets is not the same as processing input</h2>
      <p>These two things are easy to confuse, so to be explicit:</p>
      <ul>
        <li>
          <strong>Loading the page</strong> downloads HTML, JavaScript and CSS from this site's own origin. That is one
          or more ordinary HTTP requests, and it is what the logging above describes. It happens before you type
          anything.
        </li>
        <li>
          <strong>Using a tool</strong> runs code that is already in your browser. It causes no further requests at all.
        </li>
      </ul>
      <p>
        Everything the site needs is served from its own origin. There are no third-party scripts, no web fonts from a
        font service, no icon CDN and no embedded editor loaded from elsewhere. A third-party request would leak your IP
        address and the page you are on to that third party, so there are none.
      </p>

      <h2>What is stored in your browser</h2>
      <p>
        One item, in <code>localStorage</code>, under the key <code>fodt-theme</code>. It holds the string{' '}
        <code>light</code> or <code>dark</code> if you have chosen a theme, and is absent otherwise. It never contains
        tool input. Clearing site data removes it and nothing else is affected.
      </p>
      <p>No cookies are set. No service worker is registered.</p>

      <h2>Rendering untrusted content safely</h2>
      <p>
        Some tools render what you paste: Markdown preview, HTML formatting, SVG optimising. Pasted content is treated
        as hostile:
      </p>
      <ul>
        <li>
          Script elements, event handler attributes and <code>javascript:</code> URLs are removed before rendering.
        </li>
        <li>
          The preview is rendered inside an iframe with an empty <code>sandbox</code> attribute, which blocks scripts,
          forms, popups and same-origin access.
        </li>
        <li>
          That frame also carries a content security policy of <code>default-src 'none'</code>, so even a tag that
          survived sanitising cannot fetch an external image, font or stylesheet and cannot signal anything outward.
        </li>
        <li>
          No tool executes code or queries you paste. Tools that would have required that, such as a JavaScript
          playground or a SQL playground, were deliberately left out.
        </li>
      </ul>

      <h2>Tools that would need the network</h2>
      <p>
        Some utilities cannot work without contacting a server: DNS lookups, TLS certificate checks, public IP
        detection, domain availability, live currency rates. <strong>None of them are on this site.</strong> They were
        excluded rather than quietly implemented with a backend.
      </p>
      <p>
        If a tool that needs the network is ever added, it will say so on its own page, name the destination, state
        exactly what is transmitted, and it will not be enabled by default.
      </p>

      <h2>No accounts, no payment, no tracking</h2>
      <p>
        There is nothing to sign up for. There is no paid tier. There is no newsletter. There is no advertising network,
        which also means no advertising network receives your IP address.
      </p>

      <h2>How to check any of this yourself</h2>
      <ol>
        <li>Open your browser's developer tools and select the Network tab.</li>
        <li>Load a tool page and let it finish loading.</li>
        <li>Clear the request list, then type into the tool.</li>
        <li>Confirm the list stays empty.</li>
      </ol>
      <p>
        You can also read the source. Each tool's processing logic is a small file in its own folder, with its own
        tests, linked from the top of every tool page.
      </p>

      <h2>Changes</h2>
      <p>
        This page is part of the repository and changes to it are visible in the commit history. There is no mailing
        list to notify, so the history is the record.
      </p>
    </div>
  );
}
