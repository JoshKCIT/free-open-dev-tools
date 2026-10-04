import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse } from 'yaml';
import { DockerRunError, convertDockerRun, toComposeYaml, tokenizeDockerCommand } from '../src/index';

// Every unusual character is built from its code point at run time, so no editor, shell or file tool can turn it into
// something else, and no raw one is ever written in this file.
const Q = String.fromCharCode(39);
const BS = String.fromCharCode(92);
const D = String.fromCharCode(36);

/** The characters a YAML reader may treat as a line break, refuse, or change: DEL, the C1 controls, two separators, a BOM and two non-characters. */
const POINTS: number[] = [];
for (let point = 0x7f; point <= 0x9f; point++) POINTS.push(point);
POINTS.push(0x2028, 0x2029, 0xfeff, 0xfffe, 0xffff);

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

/** `\u` and four hex digits written as text, the way a double-quoted YAML scalar spells a character. */
function escapeOf(point: number): string {
  return BS + 'u' + point.toString(16).toUpperCase().padStart(4, '0');
}

/** The commands that carry `c` in a value and in each kind of name that becomes a YAML key. */
function commandsWith(c: string): string[] {
  const q = (text: string): string => Q + text + Q;
  return [
    `docker run -e ${q('X=a' + c + 'b')} nginx`,
    `docker run -u ${q('a' + c + 'b')} nginx`,
    `docker run -l ${q('k=a' + c + 'b')} nginx`,
    `docker run -w ${q('/a' + c + 'b')} nginx`,
    `docker run --name ${q('a' + c + 'b')} nginx`,
    `docker run nginx ${q('a' + c + 'b')} ${q(c)}`,
    `docker run --log-opt ${q('a' + c + 'b=1')} nginx`,
    `docker run --storage-opt ${q('a' + c + 'b=1')} nginx`,
    `docker run --ulimit ${q('a' + c + 'b=1')} nginx`,
    `docker run --network ${q('a' + c + 'b')} nginx`,
    `docker run -v ${q('a' + c + 'b:/data')} nginx`,
    `docker run -e ${q(c + 'X=1')} nginx`,
  ];
}

it('a lone surrogate, raw or from an escape, is refused with a fixed sentence and its position', () => {
  const high = String.fromCharCode(0xd83d);
  const low = String.fromCharCode(0xde00);
  const raw = [
    `docker run -e X=a${high}b nginx`,
    `docker run -e X=a${low}b nginx`,
    `docker run -e ${Q}X=a${high}${Q} nginx`,
    `docker run nginx ${high}`,
    `docker run -e X=${high}${high}${low} nginx`,
  ];
  for (const text of raw) {
    const error = refusal(text);
    expect(error.message, text).toBe(
      'This paste holds half of a character pair (a lone surrogate), which is not a character. Remove it and retype the text.',
    );
    expect(error.line).toBe(1);
    // Every text above has only basic-plane characters before its first lone surrogate, so the place is the index plus one.
    const at = Array.from(text, (ch) => ch.codePointAt(0)!).findIndex((point) => point >= 0xd800 && point <= 0xdfff);
    expect(error.column, text).toBe(at + 1);
  }
  // The position counts lines and columns of the paste.
  const second = refusal(`docker run ${BS}\n  -e X=1 ${BS}\n  -e Y=a${low} nginx`);
  expect([second.line, second.column]).toEqual([3, 9]);
  // A surrogate pair that makes a real character is read.
  const pair = String.fromCodePoint(0x1f600);
  expect(tokenizeDockerCommand(`docker run -e X=${pair} nginx`)).toEqual(['docker', 'run', '-e', `X=${pair}`, 'nginx']);
  // The escapes in dollar-and-quote text name the surrogate range too, one at a time or as a pair, and above U+10FFFF.
  for (const escape of [BS + 'ud83d', BS + 'uDE00', BS + 'U0000d83d', BS + 'ud83d' + BS + 'ude00']) {
    const text = `docker run -e ${D}${Q}X=${escape}${Q} nginx`;
    const error = refusal(text);
    expect(error.message, escape).toBe(
      `This ${D}${Q}...${Q} ANSI-C quoted string holds a surrogate code, which is half of a character pair and not a character.`,
    );
    expect(error.line).toBe(1);
    // The place is the backslash that starts the escape.
    expect(error.column, escape).toBe(text.indexOf(BS) + 1);
  }
  expect(refusal(`docker run -e ${D}${Q}X=${BS}U00110000${Q} nginx`).message).toBe(
    `This ${D}${Q}...${Q} ANSI-C quoted string holds a character code that does not exist.`,
  );
  // Nothing of the refused text is repeated.
  expect(refusal(`docker run -e FODT-MARK-7731=${high} nginx`).message).not.toContain('FODT-MARK-7731');
});

it('each character a YAML reader could change or refuse is written as an escape inside a double-quoted scalar and reads back the same', () => {
  expect(POINTS).toHaveLength(0x9f - 0x7f + 1 + 5);
  for (const point of POINTS) {
    const c = String.fromCodePoint(point);
    for (const command of commandsWith(c)) {
      const result = convertDockerRun(command);
      // No raw character is in the file, and the escape is.
      expect(result.yaml.includes(c), `${point.toString(16)} in ${command}`).toBe(false);
      expect(result.yaml, command).toContain(escapeOf(point));
      // A YAML 1.1 reader gives back exactly the document, character for character, with every key a string.
      const read = parse(result.yaml, { version: '1.1' }) as unknown;
      expect(read, command).toEqual(JSON.parse(JSON.stringify(result.document)));
    }
  }
});

it('a character outside the YAML escapes is left as it is and every other double-quoted string reads back unchanged', () => {
  const plain = [0xe9, 0x4e2d, 0x1f600, 0xa0, 0x200b, 0x20].map((point) => String.fromCodePoint(point));
  for (const text of plain) {
    const yaml = toComposeYaml({ services: { web: { image: 'nginx', command: ['echo', text] } } });
    expect(yaml).toContain(text);
    expect(parse(yaml, { version: '1.1' }).services.web.command).toEqual(['echo', text]);
  }
  // A string that already holds a backslash and a letter u keeps both: only the unusual characters are replaced.
  const text = BS + 'u0085 and ' + BS + 'n';
  const yaml = toComposeYaml({ services: { web: { image: 'nginx', command: [text] } } });
  expect(parse(yaml, { version: '1.1' }).services.web.command).toEqual([text]);
});
