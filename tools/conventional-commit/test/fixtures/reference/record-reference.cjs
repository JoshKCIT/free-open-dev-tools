'use strict';
/**
 * Records what the specification's reference parser, @conventional-commits/parser 0.4.1 (ISC), says about the messages of
 * make-corpus.mjs: whether it accepts each one and, when it does, the parts it reads (type, scope, the ! mark, description,
 * body and footers).
 *
 * Run by hand from a scratch folder that already has the package (nothing is installed by this script, and the package is
 * not part of this repository):
 *
 *   node record-reference.cjs <folder holding node_modules/@conventional-commits/parser> <output file>
 *
 * Unit tests only read the output file; they never load the parser.
 *
 * The parts are the parser's own tree flattened to plain strings: `type`, `scope`, `bang` (the ! after the type or scope),
 * `description` (the summary's text), `body` (every value inside the body node joined, which gives the original text),
 * `footers` (token, separator and value, a value being the text and its indented continuation lines joined), and
 * `breaking` (a ! mark, or a breaking-change node in the body or in a footer token).
 */
const fs = require('node:fs');
const path = require('node:path');

function flatten(node) {
  if (node.children === undefined) return typeof node.value === 'string' ? node.value : '';
  return node.children.map(flatten).join('');
}

function partsOf(ast) {
  const parts = { type: null, scope: null, bang: false, description: '', body: '', footers: [], breaking: false };
  for (const child of ast.children) {
    if (child.type === 'summary') {
      for (const item of child.children) {
        if (item.type === 'type') parts.type = item.value;
        else if (item.type === 'scope') parts.scope = item.value;
        else if (item.type === 'breaking-change') parts.bang = true;
        else if (item.type === 'text') parts.description = item.value;
      }
    } else if (child.type === 'body') {
      parts.body = flatten(child);
      if (child.children.some((item) => item.type === 'breaking-change')) parts.breaking = true;
    } else if (child.type === 'footer') {
      const token = child.children.find((item) => item.type === 'token');
      const separator = child.children.find((item) => item.type === 'separator');
      const value = child.children.find((item) => item.type === 'value');
      const tokenText = token === undefined ? '' : flatten(token);
      if (token !== undefined && token.children.some((item) => item.type === 'breaking-change' && item.value !== '!')) {
        parts.breaking = true;
      }
      parts.footers.push({
        token: tokenText,
        separator: separator === undefined ? '' : separator.value,
        value: value === undefined ? '' : flatten(value),
      });
    }
  }
  if (parts.bang) parts.breaking = true;
  return parts;
}

/**
 * Writes every character above U+007E as a JSON escape (a backslash, u and four hexadecimal digits, per UTF-16 unit), so
 * the recorded file holds ASCII only: a no-break space, a byte order mark or a look-alike letter in a message can then be
 * read in the file and survives any editor.
 */
function asciiOnly(json) {
  const backslash = String.fromCharCode(92);
  let out = '';
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    out += code > 126 ? backslash + 'u' + code.toString(16).padStart(4, '0') : json[i];
  }
  return out;
}

async function main() {
  const modules = process.argv[2];
  const out = process.argv[3];
  if (!modules || !out) {
    console.error('usage: node record-reference.cjs <folder holding node_modules/@conventional-commits/parser> <output file>');
    process.exit(1);
  }
  const packageFolder = path.join(path.resolve(modules), 'node_modules', '@conventional-commits', 'parser');
  const version = JSON.parse(fs.readFileSync(path.join(packageFolder, 'package.json'), 'utf8')).version;
  const { parser } = require(packageFolder);
  const { makeCorpus, SEED } = await import('./make-corpus.mjs');

  const rows = makeCorpus().map((message) => {
    try {
      return { message, accepted: true, parts: partsOf(parser(message)) };
    } catch (error) {
      return { message, accepted: false, parts: null };
    }
  });
  const recorded = {
    recordedAt: new Date().toISOString().replace(/[.]\d{3}Z$/, 'Z'),
    parser: '@conventional-commits/parser ' + version,
    node: process.version,
    seed: SEED,
    generator: 'make-corpus.mjs',
  };
  const head = JSON.stringify(recorded).slice(0, -1);
  const text = head + ',"rows":[\n' + rows.map((row) => JSON.stringify(row)).join(',\n') + '\n]}\n';
  fs.writeFileSync(out, asciiOnly(text), 'utf8');
  const accepted = rows.filter((row) => row.accepted).length;
  console.log(rows.length + ' rows recorded with @conventional-commits/parser ' + version + ' (' + accepted + ' accepted)');
}

main();
