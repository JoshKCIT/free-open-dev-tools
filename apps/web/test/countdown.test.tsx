import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OutputView from '../src/components/OutputView';

const NOW = 1_111_111_098_000;

function render(endsAt: number, periodMs: number, label?: string): string {
  return renderToStaticMarkup(<OutputView block={{ kind: 'countdown', label, endsAt, periodMs }} />);
}

describe('countdown block markup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the whole seconds left of the period, a progress bar and a timer role, and no live region', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const html = render(NOW + 12_000, 30_000, 'Time left in the current step');
    expect(html).toContain('12 s left of 30 s');
    expect(html).toContain('<progress');
    expect(html).toContain('max="30000"');
    expect(html).toContain('value="12000"');
    expect(html).toContain('role="timer"');
    expect(html).toContain('aria-label="Time left in the current step"');
    expect(html).not.toMatch(/aria-live="(?!off)/);
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="log"');
  });

  it('rounds the seconds up, counting 30 down to 1, and never shows a negative number', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(render(NOW + 11_900, 30_000)).toContain('12 s left of 30 s');
    expect(render(NOW + 999, 30_000)).toContain('1 s left of 30 s');
    expect(render(NOW + 1, 30_000)).toContain('1 s left of 30 s');
    expect(render(NOW + 29_001, 30_000)).toContain('30 s left of 30 s');
    expect(render(NOW, 30_000)).toContain('0 s left of 30 s');
    expect(render(NOW - 5_000, 30_000)).toContain('0 s left of 30 s');
    expect(render(NOW + 90_000, 30_000)).toContain('30 s left of 30 s');
  });

  it('uses a fixed label when none is given and writes no script, link or raw markup', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const html = render(NOW + 5_000, 30_000);
    expect(html).toContain('aria-label="Time left in the current step"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('<iframe');
  });
});
