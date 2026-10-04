import type { ProcessedManifest } from './process';

function isLocal(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}

/** True when some icon is scalable (any) or at least `pixels` on both sides. */
function hasIconOfSize(manifest: ProcessedManifest, pixels: number): boolean {
  return manifest.icons.some((icon) =>
    icon.sizes.some((size) => {
      if (size === 'any') return true;
      const [width, height] = size.split('x').map(Number);
      return (width ?? 0) >= pixels && (height ?? 0) >= pixels;
    }),
  );
}

/**
 * What browsers commonly look for before they offer to install a web app, listed only where it is missing. This is
 * advice, not part of the W3C Web Application Manifest specification, and it is never written into the manifest.
 */
export function installAdvice(manifest: ProcessedManifest): string[] {
  const advice: string[] = [];
  if (!hasIconOfSize(manifest, 192)) advice.push('Add an icon that is at least 192 by 192 pixels.');
  if (!hasIconOfSize(manifest, 512)) advice.push('Add an icon that is at least 512 by 512 pixels.');
  if (manifest.name === null && manifest.shortName === null) advice.push('Give the app a name or a short_name.');
  if (manifest.display !== 'standalone' && manifest.display !== 'fullscreen' && manifest.display !== 'minimal-ui') {
    advice.push(
      'Set display to standalone, fullscreen or minimal-ui; with browser the app opens as a normal browser tab.',
    );
  }
  const insecure = [manifest.pageUrl, manifest.manifestUrl].some((address) => {
    const url = new URL(address);
    return url.protocol !== 'https:' && !isLocal(url.hostname);
  });
  if (insecure) {
    advice.push('Serve the page and the manifest over HTTPS (a local address such as localhost is treated as secure).');
  }
  return advice;
}
