import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { OutputBlock, PreviewNode } from '../lib/tool-ui';
import { previewHazard } from '../lib/css-preview-guard';

type PreviewBlock = Extract<OutputBlock, { kind: 'preview' }>;

function renderNode(node: PreviewNode, key: number | string = 0) {
  return (
    <div className={node.className} key={key}>
      {node.text}
      {node.children?.map((child, i) => renderNode(child, i))}
    </div>
  );
}

/**
 * The preview stage: a shadow host whose own shadow root is styled only by
 * the tool's exact CSS text, shown beside that text.
 *
 * This renders in the live page, never inside `OutputView.tsx`'s
 * `sandbox=""` iframe -- that sandbox runs no scripts at all by design, and
 * a draggable handle needs pointer and keyboard listeners. Because this
 * runs unsandboxed, under the page's own content security policy (which
 * already refuses outside requests; a second layer, not the only one),
 * `previewHazard` is checked before every single stylesheet application: a
 * hazard draws nothing at all rather than ever adopting CSS that could load
 * a resource.
 *
 * The tree is drawn inside the shadow root with React's own `createPortal`,
 * as plain elements carrying only a class name and text -- never
 * `dangerouslySetInnerHTML`, never a string of markup, never a `style`
 * prop. The CSS is applied as one constructed stylesheet (`replaceSync`)
 * adopted by the shadow root and nothing else, so the preview is styled by
 * exactly the CSS a visitor would copy. On an engine without constructed
 * stylesheets on shadow roots, a `<style>` element carrying the same text
 * is used instead (the scoped-style-element fallback).
 */
export default function CssPreview({ block }: { block: PreviewBlock }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<CSSStyleSheet | null>(null);
  const styleElRef = useRef<HTMLStyleElement | null>(null);
  const [ready, setReady] = useState(false);
  const [hazard, setHazard] = useState<string | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    if (!containerRef.current) {
      const container = document.createElement('div');
      container.className = 'css-preview-tree';
      shadow.appendChild(container);
      containerRef.current = container;
    }

    const supportsConstructed =
      typeof CSSStyleSheet !== 'undefined' &&
      typeof CSSStyleSheet.prototype.replaceSync === 'function' &&
      'adoptedStyleSheets' in shadow;

    if (supportsConstructed && !sheetRef.current) {
      const sheet = new CSSStyleSheet();
      shadow.adoptedStyleSheets = [sheet];
      sheetRef.current = sheet;
    } else if (!supportsConstructed && !styleElRef.current) {
      const styleEl = document.createElement('style');
      shadow.appendChild(styleEl);
      styleElRef.current = styleEl;
    }

    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const reason = previewHazard(block.css);
    setHazard(reason);
    if (reason) {
      // Draws nothing: clear whatever the stage was previously showing
      // rather than leaving a stale rule set adopted.
      if (sheetRef.current) sheetRef.current.replaceSync('');
      else if (styleElRef.current) styleElRef.current.textContent = '';
      return;
    }
    if (sheetRef.current) {
      try {
        sheetRef.current.replaceSync(block.css);
      } catch {
        // A malformed sheet must never crash the page; leave the previous
        // content in place. The tool's own safety writer already refuses
        // to build CSS that would land here.
      }
    } else if (styleElRef.current) {
      styleElRef.current.textContent = block.css;
    }
  }, [block.css, ready]);

  return (
    <div className="css-preview">
      <div className="css-preview-stage-wrap">
        <div
          ref={hostRef}
          className="css-preview-stage"
          data-backdrop={block.backdrop ?? 'plain'}
          role="group"
          aria-label="Live preview"
        />
        {hazard ? (
          <div className="note note-warn">
            The preview was not drawn because the CSS contained something that could load a resource.
          </div>
        ) : null}
      </div>
      <pre className="output nowrap" tabIndex={0}>
        {block.css || ' '}
      </pre>
      {ready && containerRef.current && !hazard ? createPortal(renderNode(block.tree), containerRef.current) : null}
    </div>
  );
}
