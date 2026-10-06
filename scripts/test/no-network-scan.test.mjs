import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/catalog.mjs';
import { FORBIDDEN, forbiddenIn, stripStringsAndComments } from '../lib/no-network-scan.mjs';

/**
 * The catalog gate scans tool and shared site source for code that could send something out of the page. The WebRTC
 * and WebTransport names are part of that scan because a page policy does not govern WebRTC in every browser, so lint
 * and this scan are what keep it out. Each pattern is proved here on a small piece of text.
 */

const CONNECTION = 'a peer connection, data channel or transport';

describe('the no-network scan of the catalog gate', () => {
  it('finds a peer connection, a data channel or a transport however it is reached', () => {
    for (const code of [
      'export const a = () => new RTCPeerConnection();',
      'export const a = () => new window.RTCPeerConnection();',
      'export const a = () => new globalThis.webkitRTCPeerConnection();',
      'const { RTCDataChannel } = self;',
      'export const a = (u: string) => new self.WebTransport(u);',
      'export const a = (u: string) => `${new WebTransport(u)}`;',
    ]) {
      expect(forbiddenIn(code), code).toEqual([CONNECTION]);
    }
  });

  it('ignores the connection names in strings, comments and longer identifiers', () => {
    for (const code of [
      `export const label = 'RTCPeerConnection';`,
      '// new RTCPeerConnection() would be a leak',
      '/* WebTransport is banned */ export const x = 1;',
      'export const RTCPeerConnectionCount = 0; export const myWebTransportish = 1;',
    ]) {
      expect(forbiddenIn(code), code).toEqual([]);
    }
  });

  it('still finds the earlier network calls', () => {
    expect(forbiddenIn('fetch(u)')).toEqual(['fetch(']);
    expect(forbiddenIn('const x = new XMLHttpRequest();')).toEqual(['XMLHttpRequest']);
    expect(forbiddenIn('navigator.sendBeacon(u, d)')).toEqual(['navigator.sendBeacon']);
    expect(forbiddenIn('new WebSocket(u)')).toEqual(['new WebSocket']);
    expect(forbiddenIn('new EventSource(u)')).toEqual(['new EventSource']);
  });

  it('removes strings and comments but keeps code inside a template placeholder', () => {
    expect(stripStringsAndComments(`a('x') // y\nb`).replace(/\s+/g, ' ')).toBe('a( ) b');
    expect(stripStringsAndComments('`t ${c(1)} u`')).toContain('c(1)');
  });

  it('has one label per pattern', () => {
    const labels = FORBIDDEN.map(([, label]) => label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('is the list the catalog gate uses, not a copy of it', () => {
    const gate = readFileSync(join(ROOT, 'scripts', 'check-catalog.mjs'), 'utf8');
    expect(gate).toContain(`import { FORBIDDEN, stripStringsAndComments } from './lib/no-network-scan.mjs';`);
    expect(gate).not.toMatch(/const FORBIDDEN\b|function stripStringsAndComments\b/);
  });
});
