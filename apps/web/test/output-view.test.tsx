import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OutputView from '../src/components/OutputView';

describe('OutputView markup', () => {
  it('renders the label, the value and a Download button for a code block with a download name', () => {
    const html = renderToStaticMarkup(
      <OutputView
        block={{ kind: 'code', label: 'OpenSSH public key', value: 'ssh-ed25519 AAAA', download: 'id_ed25519.pub' }}
      />,
    );
    expect(html).toContain('OpenSSH public key');
    expect(html).toContain('ssh-ed25519 AAAA');
    expect(html).toContain('>Download<');
    expect(html).toContain('>Copy<');
  });

  it('renders no Download button when the block has no download name', () => {
    const html = renderToStaticMarkup(<OutputView block={{ kind: 'code', label: 'Result', value: 'x' }} />);
    expect(html).not.toContain('>Download<');
  });

  it('renders a note with its tone class', () => {
    const html = renderToStaticMarkup(
      <OutputView block={{ kind: 'note', tone: 'info', value: 'Run chmod 600 id_rsa' }} />,
    );
    expect(html).toContain('note note-info');
    expect(html).toContain('Run chmod 600 id_rsa');
  });
});
