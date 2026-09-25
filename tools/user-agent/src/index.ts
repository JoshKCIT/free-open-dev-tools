import Bowser from 'bowser';
import meta from './meta.json';
import { tokenizeUserAgent, type ProductToken } from './tokens';

export { meta };

export class UserAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserAgentError';
  }
}

/** Above this many characters an input is refused rather than parsed. */
export const MAX_USER_AGENT_LENGTH = 8192;

export type Confidence = 'low' | 'medium' | 'high';

export interface BrowserInfo {
  name?: string;
  version?: string;
}

export interface EngineInfo {
  name?: string;
  version?: string;
}

export interface OsInfo {
  name?: string;
  version?: string;
  versionName?: string;
}

export interface DeviceInfo {
  type?: string;
  vendor?: string;
  model?: string;
}

export interface UserAgentReport {
  browser: BrowserInfo;
  engine: EngineInfo;
  os: OsInfo;
  device: DeviceInfo;
  tokens: ProductToken[];
  /** True for a Chromium-family string matching a reduced desktop or Android format. */
  reduced: boolean;
  confidence: Confidence;
  reasons: string[];
  note: string;
}

const SPOOF_NOTE =
  'A User-Agent string is whatever the client chose to send, so it can be spoofed, and Client Hints (the Sec-CH-UA headers) are not available from a pasted string.';

// Chromium User-Agent Reduction: a reduced string carries a Chromium-family
// major version followed by ".0.0.0", together with one of the frozen
// desktop platform strings or the frozen Android platform string.
const CHROME_FAMILY = new Set(['Chrome', 'Chromium', 'CriOS', 'HeadlessChrome', 'Chrome WebView', 'Chrome Headless']);
const REDUCED_MAJOR_VERSION = /^\d+\.0\.0\.0$/;
const REDUCED_DESKTOP_PLATFORMS = [
  'Windows NT 10.0; Win64; x64',
  'Macintosh; Intel Mac OS X 10_15_7',
  'X11; Linux x86_64',
];
const REDUCED_ANDROID_PLATFORM = 'Linux; Android 10; K';

function isReduced(ua: string, tokens: ProductToken[]): boolean {
  const chromeToken = tokens.find((t) => CHROME_FAMILY.has(t.product));
  if (!chromeToken?.version || !REDUCED_MAJOR_VERSION.test(chromeToken.version)) return false;
  return REDUCED_DESKTOP_PLATFORMS.some((p) => ua.includes(p)) || ua.includes(REDUCED_ANDROID_PLATFORM);
}

/**
 * Parses a pasted User-Agent string into its browser, rendering engine,
 * operating system and device, with a stated confidence level and the
 * reasons for it. Never throws for malformed or unrecognised input --
 * only an input over MAX_USER_AGENT_LENGTH characters is refused.
 */
export function parseUserAgent(ua: string): UserAgentReport {
  const trimmed = ua.trim();
  if (trimmed.length > MAX_USER_AGENT_LENGTH) {
    throw new UserAgentError(
      `This is longer than ${MAX_USER_AGENT_LENGTH} characters, so it was refused rather than risk freezing the tab.`,
    );
  }

  const { tokens, wellFormed } = tokenizeUserAgent(trimmed);

  let browser: BrowserInfo = {};
  let engine: EngineInfo = {};
  let os: OsInfo = {};
  let device: DeviceInfo = {};

  // Bowser.parse throws on an empty string, so the empty case is handled
  // without ever calling it -- an empty result is exactly what it would
  // report anyway.
  if (trimmed !== '') {
    const parsed = Bowser.parse(trimmed);
    browser = { name: parsed.browser.name, version: parsed.browser.version };
    engine = { name: parsed.engine.name, version: parsed.engine.version };
    os = { name: parsed.os.name, version: parsed.os.version, versionName: parsed.os.versionName };
    device = { type: parsed.platform.type, vendor: parsed.platform.vendor, model: parsed.platform.model };
  }

  const reduced = trimmed !== '' && isReduced(trimmed, tokens);

  const reasons: string[] = [];
  let confidence: Confidence;

  if (trimmed === '' || tokens.length === 0 || !browser.name) {
    confidence = 'low';
    if (trimmed === '') {
      reasons.push('The input is empty, so no browser could be recognised.');
    } else if (tokens.length === 0) {
      reasons.push('No RFC 9110 product token was found in this string.');
    } else {
      reasons.push('No browser was recognised in this string.');
    }
  } else {
    const downgrades: string[] = [];
    if (!engine.name) downgrades.push('The rendering engine was not recognised.');
    if (!os.name) downgrades.push('The operating system was not recognised.');
    if (reduced) downgrades.push('This is a reduced Chromium User-Agent, so some detail is deliberately hidden.');
    if (!browser.version) downgrades.push('The browser version is missing.');
    if (!wellFormed) downgrades.push('The product tokens are not well-formed RFC 9110 tokens.');

    if (downgrades.length > 0) {
      confidence = 'medium';
      reasons.push(...downgrades);
    } else {
      confidence = 'high';
    }
  }

  return { browser, engine, os, device, tokens, reduced, confidence, reasons, note: SPOOF_NOTE };
}
