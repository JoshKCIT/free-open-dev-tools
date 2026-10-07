/**
 * The HTML preview. Only small, shallow markup is given to jsdom: deep or large markup is refused by the pre-scan before
 * any DOM call, and its test checks the refusal and a time ratio on the scan only (never feed deep markup to jsdom).
 */
import { it, expect } from 'vitest';
import { previewHtml } from '../src/index';
import { makeWindow } from './helpers';

it('no anchor keeps href, target, ping or rel after the post-pass', () => {
  const win = makeWindow();
  const html =
    '<p>See <a href="https://example.test/menu" target="_blank" ping="https://example.test/ping" rel="noopener">the menu</a> or ' +
    '<a href="mailto:alice@example.test" rel="nofollow">write</a> or <a href="#top" target="_top">top</a>.</p>';
  const result = previewHtml(html, win, []);
  expect(result.status).toBe('shown');
  if (result.status !== 'shown') return;

  // What the visitor's frame will read: parse the result and look at every anchor.
  const doc = new (win as unknown as { DOMParser: typeof DOMParser }).DOMParser().parseFromString(
    result.html,
    'text/html',
  );
  const anchors = Array.from(doc.querySelectorAll('a'));
  expect(anchors.length).toBe(3);
  for (const anchor of anchors) {
    for (const name of ['href', 'target', 'ping', 'rel']) {
      expect(anchor.hasAttribute(name), `an anchor kept ${name}`).toBe(false);
    }
  }
  // The anchors' text survives and the targets are listed as text instead.
  expect(doc.body.textContent).toContain('the menu');
  expect(result.links.map((l) => l.target)).toEqual(['https://example.test/menu', 'mailto:alice@example.test', '#top']);
  expect(result.links.map((l) => l.text)).toEqual(['the menu', 'write', 'top']);
});
