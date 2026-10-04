import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DockerRunError,
  MAX_INPUT_LENGTH,
  MAX_SHOWN,
  parseDockerCommand,
  readDockerCommand,
  tokenizeDockerCommand,
  visible,
} from '../src/index';

// Shell text is built from these in the cases below, so that no title or literal holds a dollar sign, a backslash or a
// backtick that an editor or a shell could change.
const BS = String.fromCharCode(92);
const BT = String.fromCharCode(96);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const D = String.fromCharCode(36);

const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, name).mockImplementation(() => {}));
  }
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function refusal(text: string): DockerRunError {
  try {
    tokenizeDockerCommand(text);
  } catch (error) {
    expect(error).toBeInstanceOf(DockerRunError);
    return error as DockerRunError;
  }
  throw new Error('expected the command to be refused');
}

it('dollar variables stay as text, pwd substitution becomes the current folder, any other substitution is refused', () => {
  const kept: [string, string[]][] = [
    [`docker run -e KEY=${D}KEY nginx`, ['docker', 'run', '-e', `KEY=${D}KEY`, 'nginx']],
    [`docker run -e A=${D}{B} nginx`, ['docker', 'run', '-e', `A=${D}{B}`, 'nginx']],
    [`docker run -e "A=${D}{B:-x y}" nginx`, ['docker', 'run', '-e', `A=${D}{B:-x y}`, 'nginx']],
    [`docker run -e "A=${D}{B:-${D}{C}}" nginx`, ['docker', 'run', '-e', `A=${D}{B:-${D}{C}}`, 'nginx']],
    [
      `docker run -e A=${D}{B-1} -e C=${D}{D:?no} -e E=${D}{F:+yes} nginx`,
      ['docker', 'run', '-e', `A=${D}{B-1}`, '-e', `C=${D}{D:?no}`, '-e', `E=${D}{F:+yes}`, 'nginx'],
    ],
    [`docker run -v ${D}(pwd):/app nginx`, ['docker', 'run', '-v', '.:/app', 'nginx']],
    [`docker run -v ${D}(PWD)/data:/d nginx`, ['docker', 'run', '-v', './data:/d', 'nginx']],
    [`docker run -v "${D}(pwd)/data":/d nginx`, ['docker', 'run', '-v', './data:/d', 'nginx']],
    [
      `docker run --mount type=bind,source=${D}(pwd),target=/x nginx`,
      ['docker', 'run', '--mount', 'type=bind,source=.,target=/x', 'nginx'],
    ],
    [`docker run -e 'A=${D}HOME' nginx`, ['docker', 'run', '-e', `A=${D}${D}HOME`, 'nginx']],
    [`docker run -e A=${BS}${D}HOME nginx`, ['docker', 'run', '-e', `A=${D}${D}HOME`, 'nginx']],
    [`docker run -e "A=${BS}${D}HOME" nginx`, ['docker', 'run', '-e', `A=${D}${D}HOME`, 'nginx']],
    [`docker run -e ${D}'A=${D}B' nginx`, ['docker', 'run', '-e', `A=${D}${D}B`, 'nginx']],
    [`docker run -e A=${D} -e "B=${D} c" nginx`, ['docker', 'run', '-e', `A=${D}${D}`, '-e', `B=${D}${D} c`, 'nginx']],
  ];
  for (const [text, words] of kept) expect(tokenizeDockerCommand(text), text).toEqual(words);

  expect(readDockerCommand(`docker run -v ${D}(pwd):/app nginx`).usesPwd).toBe(true);
  expect(readDockerCommand(`docker run -v ${D}PWD:/app nginx`).usesPwd).toBe(false);

  const refused: [string, number][] = [
    [`docker run -e A=${D}(whoami) nginx`, 17],
    [`docker run -e "A=${D}(whoami)" nginx`, 18],
    [`docker run -e A=${D}((1+2)) nginx`, 17],
    [`docker run -v ${D}(pwd)x:/a nginx`, 15],
    [`docker run -v ${D}(pwd ):/a nginx`, 15],
    [`docker run -e A=${BT}id${BT} nginx`, 17],
    [`docker run -e "A=${BT}id${BT}" nginx`, 18],
    [`docker run nginx | sh`, 18],
    [`docker run nginx; ls`, 17],
    [`docker run nginx && ls`, 18],
    [`docker run nginx > out`, 18],
    [`docker run nginx < in`, 18],
    [`docker run (nginx)`, 12],
    [`docker run -e A=${D}1 nginx`, 17],
    [`docker run -e A=${D}@ nginx`, 17],
    [`docker run -e A=${D}${D} nginx`, 17],
    [`docker run -e A=${D}? nginx`, 17],
    [`docker run -e A=${D}{#X} nginx`, 17],
    [`docker run -e A=${D}{X%y} nginx`, 17],
    [`docker run -e A=${D}{X:2} nginx`, 17],
    [`docker run -e A=${D}{X:-${D}(id)} nginx`, 17],
    [`docker run -e A=${D}{X:-${BT}id${BT}} nginx`, 17],
    [`docker run -e A=${D}{X nginx`, 17],
    [`docker run -e A=${D}{} nginx`, 17],
  ];
  for (const [text, column] of refused) {
    const error = refusal(text);
    expect(error.line, text).toBe(1);
    expect(error.column, text).toBe(column);
  }
});

it('quotes, ANSI-C quoting and line continuations follow POSIX and Bash rules and Windows continuations are refused', () => {
  expect(tokenizeDockerCommand(`docker run -e 'A B' "C D" E${BS} F nginx`)).toEqual([
    'docker',
    'run',
    '-e',
    'A B',
    'C D',
    'E F',
    'nginx',
  ]);
  expect(tokenizeDockerCommand(`docker run -e "q=${BS}"x${BS}" b=${BS}${BS} c=${BS}n d=${BS}${D}" nginx`)).toEqual([
    'docker',
    'run',
    '-e',
    `q="x" b=${BS} c=${BS}n d=${D}${D}`,
    'nginx',
  ]);
  expect(
    tokenizeDockerCommand(`docker run -e ${D}'a${BS}nb${BS}tc${BS}x41${BS}u00e9${BS}101${BS}'${BS}${BS}' nginx`),
  ).toEqual(['docker', 'run', '-e', `a${LF}b${String.fromCharCode(9)}cA${String.fromCodePoint(0xe9)}A'${BS}`, 'nginx']);
  expect(tokenizeDockerCommand(`docker run ${BS}${LF}  -p 80:80 ${BS}${LF}  nginx`)).toEqual([
    'docker',
    'run',
    '-p',
    '80:80',
    'nginx',
  ]);
  expect(tokenizeDockerCommand(`docker run ${BS}${CR}${LF}  -p 80:80 ${BS}${CR}${LF}  nginx`)).toEqual([
    'docker',
    'run',
    '-p',
    '80:80',
    'nginx',
  ]);
  expect(tokenizeDockerCommand(`docker run "a${BS}${LF}b" nginx`)).toEqual(['docker', 'run', 'ab', 'nginx']);
  expect(tokenizeDockerCommand(`docker run nginx # a comment${LF}`)).toEqual(['docker', 'run', 'nginx']);
  expect(tokenizeDockerCommand(`# first${LF}docker run nginx#x`)).toEqual(['docker', 'run', 'nginx#x']);
  expect(tokenizeDockerCommand('docker run -e A= nginx')).toEqual(['docker', 'run', '-e', 'A=', 'nginx']);
  expect(tokenizeDockerCommand('docker run -e "" nginx')).toEqual(['docker', 'run', '-e', '', 'nginx']);

  const caret = refusal(`docker run ^${LF}nginx`);
  expect(caret.message).toContain('cmd.exe');
  expect([caret.line, caret.column]).toEqual([1, 12]);
  const powershell = refusal(`docker run ${BT}${LF}nginx`);
  expect(powershell.message).toContain('PowerShell');
  expect([powershell.line, powershell.column]).toEqual([1, 12]);

  expect(refusal(`docker run -e 'A${LF}B nginx`).message).toContain('never closed');
  expect(refusal(`docker run -e "A${LF}B nginx`).message).toContain('never closed');
  expect(refusal(`docker run -e ${D}'A nginx`).message).toContain('never closed');
  const secondLine = refusal(`docker run ${BS}${LF}  -e A=${D}(id) ${BS}${LF}  nginx`);
  expect([secondLine.line, secondLine.column]).toEqual([2, 8]);
});

it('words carry the line and column where they start', () => {
  const read = readDockerCommand(`docker run ${BS}${LF}  -p 80:80 nginx`);
  expect(read.words.map((word) => [word.text, word.line, word.column])).toEqual([
    ['docker', 1, 1],
    ['run', 1, 8],
    ['-p', 2, 3],
    ['80:80', 2, 6],
    ['nginx', 2, 12],
  ]);
});

it('inputs over 65536 characters are refused before parsing', () => {
  expect(MAX_INPUT_LENGTH).toBe(65_536);
  const filler = 'a'.repeat(MAX_INPUT_LENGTH - 'docker run nginx '.length);
  expect(tokenizeDockerCommand(`docker run nginx ${filler}`)).toHaveLength(4);

  const tooLong = `docker run nginx ${filler}a`;
  expect(tooLong.length).toBe(MAX_INPUT_LENGTH + 1);
  for (const refuse of [() => tokenizeDockerCommand(tooLong), () => parseDockerCommand(tooLong)]) {
    let caught: unknown;
    try {
      refuse();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DockerRunError);
    const error = caught as DockerRunError;
    expect(error.message).toBe(
      'This paste is 65,537 characters. The limit is 65,536 because a longer command would make the page slow to answer.',
    );
    expect([error.line, error.column]).toEqual([1, 1]);
  }

  // The size is checked before anything is read: a shell operator at the start does not change the answer.
  const withOperator = `| ${filler}${filler}`;
  expect(() => tokenizeDockerCommand(withOperator)).toThrow('This paste is');
});

it('messages never repeat a marker placed inside a refused construct', () => {
  const marker = 'FODT-MARK-7731';
  const texts = [
    `docker run -e A=${D}(echo ${marker}) nginx`,
    `docker run -e "A=${D}(echo ${marker})" nginx`,
    `docker run nginx | grep ${marker}`,
    `docker run nginx ; echo ${marker}`,
    `docker run -e A=${BT}echo ${marker}${BT} nginx`,
    `docker run -e A=${D}{#${marker}} nginx`,
    `docker run -e A=${D}{X:-${BT}${marker}${BT}} nginx`,
    `docker run -e A=${D}{X:-"${marker}"} nginx`,
    `docker run -e '${marker} nginx`,
    `docker run -e "${marker} nginx`,
    `docker run -e ${D}'${marker} nginx`,
    `docker run -e A=${D}@${marker} nginx`,
    `docker run -e A=${D}(pwd)${marker} nginx`,
    `docker run ${marker}${BS}`,
  ];
  for (const text of texts) {
    const error = refusal(text);
    expect(error.message, text).not.toContain(marker);
    expect(
      JSON.stringify({ name: error.name, message: error.message, line: error.line, column: error.column }),
      text,
    ).not.toContain(marker);
  }
});

it('shown text has control and direction-changing characters escaped and is cut at 40 characters', () => {
  expect(MAX_SHOWN).toBe(40);
  expect(visible('plain')).toBe('plain');
  expect(visible(`a${String.fromCharCode(0)}b${String.fromCharCode(0x7f)}`)).toBe(`a${BS}u{0}b${BS}u{7F}`);
  expect(visible(`x${String.fromCodePoint(0x202e)}y${String.fromCodePoint(0x2066)}`)).toBe(
    `x${BS}u{202E}y${BS}u{2066}`,
  );
  expect(visible('a'.repeat(40))).toBe('a'.repeat(40));
  expect(visible('a'.repeat(41))).toBe('a'.repeat(40) + String.fromCodePoint(0x2026));
  expect(visible(String.fromCodePoint(0x1f600).repeat(41))).toBe(
    String.fromCodePoint(0x1f600).repeat(40) + String.fromCodePoint(0x2026),
  );
});

it('nothing is written to the console while reading a command', () => {
  const texts = [
    `docker run -itd --name web -p8080:80 -e KEY=${D}KEY -v ${D}(pwd):/app nginx:1.27 nginx -g 'daemon off;'`,
    `docker run nginx | sh`,
    `docker run --nonexistent nginx`,
  ];
  for (const text of texts) {
    try {
      parseDockerCommand(text);
    } catch {
      // A refusal is fine; only the console is checked.
    }
  }
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it('a dollar sign straight before a double quote is dropped, as Bash reads a locale-translated string', () => {
  const Q2 = String.fromCharCode(34);
  expect(tokenizeDockerCommand(`docker run -e ${D}${Q2}A=b c${Q2} nginx`)).toEqual([
    'docker',
    'run',
    '-e',
    'A=b c',
    'nginx',
  ]);
  expect(tokenizeDockerCommand(`docker run --name ${D}${Q2}web${Q2}x nginx`)).toEqual([
    'docker',
    'run',
    '--name',
    'webx',
    'nginx',
  ]);
  // Variables inside still stay for Compose, and an escaped dollar sign is still doubled.
  expect(tokenizeDockerCommand(`docker run -e ${D}${Q2}A=${D}B${Q2} nginx`)).toEqual([
    'docker',
    'run',
    '-e',
    `A=${D}B`,
    'nginx',
  ]);
  expect(tokenizeDockerCommand(`docker run -e ${D}${Q2}A=${BS}${D}${Q2} nginx`)).toEqual([
    'docker',
    'run',
    '-e',
    `A=${D}${D}`,
    'nginx',
  ]);
  // A dollar sign inside double quotes, even before the closing quote, is still a plain dollar sign.
  expect(tokenizeDockerCommand(`docker run -e ${Q2}A=${D}${Q2} nginx`)).toEqual([
    'docker',
    'run',
    '-e',
    `A=${D}${D}`,
    'nginx',
  ]);
  // The position of a refusal inside the string is still right.
  expect(refusal(`docker run -e ${D}${Q2}A=${D}(whoami)${Q2} nginx`).column).toBe(19);
  // A string that never closes is refused at its opening quote.
  const open = refusal(`docker run -e ${D}${Q2}A=b nginx`);
  expect(open.message).toBe('This double-quoted string is never closed.');
  expect(open.column).toBe(16);
});
