// Rebuilds cases.json from the vendored CMake files of editorconfig-core-test (see UPSTREAM.md).
//
//   node extract-cases.mjs            writes cases.json next to this file
//
// The CMake files hold one call per case: new_ec_test(name ec_file source_file regex), the same with
// new_ec_test_multiline (the command's output lines are sorted before the regex is applied), new_ec_test_version (a
// compatibility version flag is passed) and new_ec_test_full_ec_file_path (an absolute path is passed). For every case this
// script records the name, the folder of the CMake file, the EditorConfig files the command reads (the top file named by
// the case, and one file of the same name in each folder above the source file that has it), the path, and the regular
// expression the command's output must match, as a JavaScript regular expression source (CMake escapes resolved).
//
// Cases wrapped in `if((NOT WIN32) AND (NOT CYGWIN))` are kept: they describe the behaviour on every other system. Two
// cases cannot be run by a function that is given text and a path, and are excluded by name below.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMMIT = '895b3a65d0d823dbd0acf2bc402376381995d1b1';
export const FOLDERS = ['glob', 'parser', 'properties', 'filetree'];
export const EXCLUDED = [
  {
    name: 'indent_size_default_pre_0_9_0',
    reason: 'passes a compatibility version flag (-b 0.8.0) to the command line, which this page has no equivalent of',
  },
  {
    name: 'path_separator_backslash_in_cmd_line',
    reason: 'gives the command line a Windows absolute path with backslashes, and the answer depends on the operating system',
  },
];

const CALL = /^\s*(new_ec_test(?:_multiline|_version|_full_ec_file_path)?)\(\s*(.*)$/;
const TOKEN = /"((?:[^"\\]|\\.)*)"|(\S+)/g;

/** CMake string escapes: \t, \n and \r are the control characters, any other backslash pair is the second character. */
function cmakeUnescape(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      out += next === 't' ? '\t' : next === 'n' ? '\n' : next === 'r' ? '\r' : next;
      i += 1;
    } else {
      out += text[i];
    }
  }
  return out;
}

/** The regular expression of a case as JavaScript reads it: CMake's [\] is a class holding a backslash. */
function jsSource(cmakeRegex) {
  return cmakeUnescape(cmakeRegex).split('[\\]').join('[\\\\]');
}

export function extractCases(root = dirname(fileURLToPath(import.meta.url))) {
  const cases = [];
  const excluded = [];
  for (const folder of FOLDERS) {
    const lines = readFileSync(join(root, folder, 'CMakeLists.txt'), 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*#/.test(line)) continue;
      const match = CALL.exec(line);
      if (!match) continue;
      let call = match[2];
      while (!call.trim().endsWith(')')) {
        i += 1;
        call += ' ' + lines[i].trim();
      }
      call = call.trim().replace(/\)$/, '');
      const tokens = [];
      TOKEN.lastIndex = 0;
      let token;
      while ((token = TOKEN.exec(call))) tokens.push(token[1] !== undefined ? token[1] : token[2]);
      const [name, ecFile, source, regex] = tokens;
      const reason = EXCLUDED.find((e) => e.name === name);
      if (reason) {
        excluded.push({ name, reason: reason.reason });
        continue;
      }
      const path = cmakeUnescape(source);
      const files = [];
      if (existsSync(join(root, folder, ecFile))) files.push({ dir: '', source: `${folder}/${ecFile}` });
      const parts = path.split('/');
      for (let n = 1; n < parts.length; n++) {
        const dir = parts.slice(0, n).join('/');
        if (existsSync(join(root, folder, dir, ecFile))) files.push({ dir, source: `${folder}/${dir}/${ecFile}` });
      }
      cases.push({
        name,
        folder,
        files,
        path,
        expected: jsSource(regex),
        ordered: match[1] !== 'new_ec_test_multiline',
      });
    }
  }
  return { commit: COMMIT, cases, excluded };
}

/** The text of cases.json: ASCII only, one case per line, so a change shows up as a one line difference. */
export function serialise(result) {
  const nonAscii = new RegExp('[' + String.fromCharCode(0x80) + '-' + String.fromCharCode(0xffff) + ']', 'g');
  const ascii = (value) =>
    JSON.stringify(value).replace(nonAscii, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const rows = result.cases.map((c) => '    ' + ascii(c));
  const skipped = result.excluded.map((e) => '    ' + ascii(e));
  return (
    '{\n  "commit": ' +
    ascii(result.commit) +
    ',\n  "cases": [\n' +
    rows.join(',\n') +
    '\n  ],\n  "excluded": [\n' +
    skipped.join(',\n') +
    '\n  ]\n}\n'
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const result = extractCases(here);
  writeFileSync(join(here, 'cases.json'), serialise(result));
  console.log(`${result.cases.length} cases, ${result.excluded.length} excluded`);
}
