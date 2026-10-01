import { it, expect } from 'vitest';
import { buildLink, meta } from '../src/index';
import { serialize, inert } from '../src/markup';
import { attrOf, findAll, parse, textOf } from './parse';

const LF = String.fromCharCode(10);

it('has the catalog id and name and states its limits', () => {
  expect(meta.id).toBe('link-builder');
  expect(meta.name).toBe('HTML Link Builder (mailto, tel, sms)');
  expect(meta.limits.length).toBeGreaterThan(0);
});

it('the link parses with parse5 with zero parse errors and the preview link has no href', () => {
  const link = buildLink({
    kind: 'mailto',
    to: 'infobot@example.com',
    body: 'send current-issue' + LF + 'send index',
  });
  expect(link).not.toBeNull();
  if (link === null) return;

  const literal = 'mailto:infobot@example.com?body=send%20current-issue%0D%0Asend%20index';
  expect(link.address).toBe(literal);

  const real = parse(link.html);
  expect(real.errors).toEqual([]);
  const anchors = findAll(real.frag, 'a');
  expect(anchors).toHaveLength(1);
  expect(attrOf(anchors[0]!, 'href')).toBe(literal);
  expect(textOf(anchors[0]!)).toBe('infobot@example.com');

  const shown = parse(link.preview);
  expect(shown.errors).toEqual([]);
  const previewAnchors = findAll(shown.frag, 'a');
  expect(previewAnchors).toHaveLength(1);
  expect(previewAnchors[0]!.attrs.map((a) => a.name)).not.toContain('href');
  expect(textOf(previewAnchors[0]!)).toBe('infobot@example.com');
  expect(link.preview).toBe(serialize(inert(link.tree)));
});

it('blank fields give no output', () => {
  expect(buildLink({ kind: 'mailto', to: '', body: '', text: '' })).toBeNull();
});
