import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DockerRunError, convertDockerRun, tokenizeDockerCommand } from '../src/index';

const BS = String.fromCharCode(92);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const Q = String.fromCharCode(39);

const MORE_THAN_ONE = 'This paste holds more than one command. Paste one docker run command.';

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
  throw new Error('expected the paste to be refused');
}

it('a line break outside quotes followed by anything but white space or a comment is a second command and is refused', () => {
  const cases: [string, number, number][] = [
    [`docker run --name a nginx${LF}docker run --name b nginx`, 2, 1],
    [`docker run --name a nginx${LF}rm -rf /tmp/x`, 2, 1],
    [`docker run nginx${LF}# a comment${LF} arg`, 3, 2],
    [`docker run nginx${LF}${LF}${LF}   rm`, 4, 4],
    [`docker run nginx ${LF}${LF}x`, 3, 1],
    [`docker run nginx${CR}${LF}rm -rf x`, 2, 1],
    // A comment line inside a continued command still ends the command at its line break, as in a shell.
    [`docker run ${BS}${LF}# a comment${LF}  nginx`, 3, 3],
    // A blank line after a continuation ends the command too.
    [`docker run ${BS}${LF}${LF}nginx`, 3, 1],
    // The second line may start with anything a shell would run.
    [`docker run nginx${LF}${Q}quoted${Q}`, 2, 1],
    [`docker run nginx${LF}$HOME/bin/tool`, 2, 1],
    [`docker run nginx${LF}| tee out`, 2, 1],
  ];
  for (const [text, line, column] of cases) {
    const error = refusal(text);
    expect(error.message, text).toBe(MORE_THAN_ONE);
    expect([error.line, error.column], text).toEqual([line, column]);
    // The conversion refuses it the same way.
    expect(() => convertDockerRun(text)).toThrow(MORE_THAN_ONE);
  }
  // Nothing of the second line is repeated.
  expect(refusal(`docker run nginx${LF}FODT-MARK-7731 --x`).message).not.toContain('FODT-MARK-7731');
});

it('white space, comments and a backslash line continuation around one command are still read', () => {
  const same = ['docker', 'run', '--name', 'a', 'nginx'];
  const accepted = [
    `docker run --name a nginx`,
    `docker run --name a nginx${LF}`,
    `docker run --name a nginx${LF}${LF}   ${LF}`,
    `${LF}${LF}docker run --name a nginx`,
    `# the command${LF}docker run --name a nginx`,
    `docker run --name a nginx${LF}# done${LF}   # also done${LF}`,
    `docker run --name a nginx # trailing${LF}`,
    `docker run ${BS}${LF}  --name a ${BS}${LF}  nginx`,
    `docker run ${BS}${CR}${LF}  --name a ${BS}${CR}${LF}  nginx${CR}${LF}`,
    `docker run --name a nginx${CR}${LF}`,
    `docker run --name a ${BS}${LF}  nginx${LF}${LF}# end`,
  ];
  for (const text of accepted) expect(tokenizeDockerCommand(text), text).toEqual(same);
  // A line break inside quotes belongs to the value.
  expect(tokenizeDockerCommand(`docker run -e ${Q}A=1${LF}2${Q} nginx`)).toEqual([
    'docker',
    'run',
    '-e',
    `A=1${LF}2`,
    'nginx',
  ]);
  expect(tokenizeDockerCommand(`docker run -e "A=1${LF}2" nginx`)).toEqual([
    'docker',
    'run',
    '-e',
    `A=1${LF}2`,
    'nginx',
  ]);
  // The page's own second example, with its continuations, still converts.
  const converted = convertDockerRun(
    ['docker run -d --name db ' + BS, '  -e POSTGRES_DB=app ' + BS, '  postgres:16'].join(LF),
  );
  expect(converted.validation.valid).toBe(true);
});
