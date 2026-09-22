import { Link } from 'react-router-dom';
import { REPO_URL, COMMIT, BUILD_DATE } from '../lib/site';
import { CATALOG, LIVE_TOOLS } from '../lib/registry';

export default function About() {
  return (
    <div className="prose">
      <h1>About</h1>
      <p>
        Free &amp; Open Dev Tools is a set of developer utilities that run entirely in your browser. It is free, has no
        accounts, no adverts and no tracking, and every tool is MIT licensed source you can take and reuse.
      </p>

      <h2>Why it exists</h2>
      <p>
        Developers paste sensitive things into online tools constantly: tokens, config files, customer records, internal
        schemas. Most of those tools give you no way to tell whether the input left your machine. This one is built so
        that the answer is checkable rather than a matter of trust, and so the code behind each tool is small enough to
        actually read.
      </p>

      <h2>How a tool is built here</h2>
      <ul>
        <li>
          <strong>Logic is separate from interface.</strong> The processing for each tool is a plain TypeScript module
          under <code>tools/&lt;id&gt;</code> that knows nothing about React or the browser DOM. The page is a thin
          layer over it.
        </li>
        <li>
          <strong>Each folder stands alone.</strong> It has its own package file, its own tests, its own README and its
          own licence. Copy the folder out, run <code>npm install &amp;&amp; npm test</code>, and it works with no
          reference back to this repository.
        </li>
        <li>
          <strong>Behaviour is defined before it is written.</strong> Each tool names the specification it implements.
          Tests come from that specification's own test vectors where they exist, not from comparing against another
          tool site.
        </li>
        <li>
          <strong>Ambiguity is written down rather than guessed.</strong> Where a format genuinely has more than one
          reading, such as cron dialects, duplicate JSON keys or timestamp units, the tool makes the choice visible
          instead of picking silently.
        </li>
      </ul>

      <h2>State of the catalog</h2>
      <p>
        {LIVE_TOOLS.length} of {CATALOG.length} planned tools are built and tested. The{' '}
        <Link to="/catalog">catalog page</Link> shows the rest, and the{' '}
        <a href={`${REPO_URL}/blob/main/docs/LEDGER.md`} rel="noreferrer noopener">
          implementation ledger
        </a>{' '}
        records exactly what is outstanding and in what order.
      </p>

      <h2>Contributing</h2>
      <p>
        Issues and pull requests are welcome. The{' '}
        <a href={`${REPO_URL}/blob/main/CONTRIBUTING.md`} rel="noreferrer noopener">
          contributing guide
        </a>{' '}
        explains the tool template, the test expectations and the privacy rules a new tool has to satisfy before it can
        be merged.
      </p>
      <p>
        When reporting a bug, please describe the input rather than pasting it, especially if it contains anything
        sensitive. The issue link on each tool page deliberately carries no input.
      </p>

      <h2>Licence and attribution</h2>
      <p>
        Everything here — the code, the build scripts, the documentation and the site copy — is MIT licensed. Take any
        of it and use it. Third-party dependencies keep their own licences, listed in{' '}
        <a href={`${REPO_URL}/blob/main/docs/THIRD-PARTY.md`} rel="noreferrer noopener">
          the third-party notices
        </a>
        .
      </p>

      <h2>This build</h2>
      <p>
        Commit <code>{COMMIT}</code>, built {BUILD_DATE}. The{' '}
        <a href={`${REPO_URL}/blob/main/docs/RELEASE-MANIFEST.md`} rel="noreferrer noopener">
          release manifest
        </a>{' '}
        maps each shipped tool to its version and its verification result.
      </p>
    </div>
  );
}
