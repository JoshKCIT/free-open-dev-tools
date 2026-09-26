import { it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DockerfileParser } from 'dockerfile-ast';
import { parseDockerfile } from '../src/parse';
import { lintDockerfile, DockerfileLintError } from '../src/index';
import { readUpstreamShas, gitBlobShaOfFile } from './upstream';

const AWESOME_DIR = join(__dirname, 'fixtures', 'awesome-compose');

it('instructions, flags, arguments and line continuations are read as the Dockerfile reference defines', () => {
  // "RUN apt-get update && \" followed by a continuation joins into one logical line (Dockerfile reference, Format).
  const text = [
    'FROM node:18 AS build',
    'RUN apt-get update && \\',
    '    apt-get install -y curl',
    'COPY --from=build /app /app',
    '',
  ].join('\n');
  const parsed = parseDockerfile(text);
  expect(parsed.problems).toEqual([]);
  expect(parsed.instructions).toHaveLength(3);

  const [from, run, copy] = parsed.instructions;
  expect(from!.keyword).toBe('FROM');
  expect(from!.line).toBe(1);
  expect(from!.endLine).toBe(1);
  expect(from!.args).toBe('node:18 AS build');

  expect(run!.keyword).toBe('RUN');
  expect(run!.line).toBe(2);
  expect(run!.endLine).toBe(3);
  expect(run!.form).toBe('shell');
  expect(run!.args).toContain('apt-get install -y curl');

  expect(copy!.keyword).toBe('COPY');
  expect(copy!.flags).toEqual([{ name: 'from', value: 'build' }]);
  expect(copy!.args).toBe('/app /app');
});

it('flags are split before the arguments for --flag and --flag=value forms', () => {
  const text = 'FROM alpine:3.19\nRUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt\n';
  const parsed = parseDockerfile(text);
  const run = parsed.instructions[1]!;
  expect(run.flags).toEqual([{ name: 'mount', value: 'type=cache,target=/root/.cache/pip' }]);
  expect(run.args).toBe('pip install -r requirements.txt');
});

it('exec form is recognised when the arguments open with a JSON array', () => {
  const text = 'FROM alpine:3.19\nCMD ["node", "server.js"]\n';
  const parsed = parseDockerfile(text);
  expect(parsed.instructions[1]!.form).toBe('exec');
});

it('a malformed exec-form JSON array is reported as a problem at its instruction', () => {
  const text = 'FROM alpine:3.19\nCMD ["node", "server.js"\n';
  const parsed = parseDockerfile(text);
  expect(parsed.problems).toHaveLength(1);
  expect(parsed.problems[0]!.line).toBe(2);
  expect(parsed.problems[0]!.path).toBe('CMD');
  expect(parsed.problems[0]!.message).toContain('malformed');
});

it('an instruction other than ARG before the first FROM is a problem', () => {
  const text = 'RUN echo hi\nFROM alpine:3.19\n';
  const parsed = parseDockerfile(text);
  expect(parsed.problems.some((p) => p.line === 1 && p.message.includes('before the first FROM'))).toBe(true);
});

it('ARG is allowed before the first FROM', () => {
  const text = 'ARG VERSION=3.19\nFROM alpine:$VERSION\n';
  const parsed = parseDockerfile(text);
  expect(parsed.problems).toEqual([]);
});

it('an unrecognised instruction keyword is a problem', () => {
  const text = 'FROM alpine:3.19\nFOOBAR do-something\n';
  const parsed = parseDockerfile(text);
  expect(parsed.problems.some((p) => p.line === 2 && p.message.includes('FOOBAR'))).toBe(true);
});

it('the escape parser directive changes the continuation character as the Dockerfile reference describes', () => {
  // "the escape parser directive is included in a Dockerfile" (Dockerfile reference, Parser directives, escape).
  const backslashText = ['# escape=`', 'FROM alpine:3.19', 'RUN echo hello \\', '    world', ''].join('\n');
  const backslashParsed = parseDockerfile(backslashText);
  // Under the backtick escape directive, a trailing backslash no longer continues the line.
  expect(backslashParsed.instructions).toHaveLength(3);
  expect(backslashParsed.instructions[1]!.raw).toBe('RUN echo hello \\');

  const backtickText = ['# escape=`', 'FROM alpine:3.19', 'RUN echo hello `', '    world', ''].join('\n');
  const backtickParsed = parseDockerfile(backtickText);
  expect(backtickParsed.instructions).toHaveLength(2);
  const run = backtickParsed.instructions[1]!;
  expect(run.line).toBe(3);
  expect(run.endLine).toBe(4);
  expect(run.raw).toBe('RUN echo hello world');
});

it('a directive-shaped comment after the first blank line or ordinary comment is treated as an ordinary comment', () => {
  const text = ['', '# escape=`', 'FROM alpine:3.19', 'RUN echo hello \\', '    world', ''].join('\n');
  const parsed = parseDockerfile(text);
  expect(parsed.directives).toEqual([]);
  // The default backslash escape still applies, since the directive above the blank line was never read.
  expect(parsed.instructions[1]!.endLine).toBe(5);
});

it('a comment or blank line inside a continuation is skipped rather than ending it', () => {
  // Dockerfile reference, Format: "RUN echo hello \" then "# comment" then "world" behaves like "RUN echo hello \" then "world" directly.
  const text = ['FROM alpine:3.19', 'RUN echo hello \\', '# comment', '', 'world', ''].join('\n');
  const parsed = parseDockerfile(text);
  const run = parsed.instructions[1]!;
  expect(run.line).toBe(2);
  expect(run.endLine).toBe(5);
  expect(run.raw).toBe('RUN echo hello world');
});

it('here-documents are read to their terminator as the Dockerfile reference describes', () => {
  const text = ['FROM alpine:3.19', 'RUN <<EOF', 'apk update', 'apk add git', 'EOF', 'USER app', ''].join('\n');
  const parsed = parseDockerfile(text);
  expect(parsed.problems).toEqual([]);
  const run = parsed.instructions[1]!;
  expect(run.line).toBe(2);
  expect(run.endLine).toBe(5);
  const user = parsed.instructions[2]!;
  expect(user.keyword).toBe('USER');
  expect(user.line).toBe(6);
});

it('<<-WORD strips leading whitespace from the terminator line before comparing it', () => {
  const text = ['FROM alpine:3.19', 'RUN <<-EOF', 'echo hi', '  EOF', 'USER app', ''].join('\n');
  const parsed = parseDockerfile(text);
  expect(parsed.problems).toEqual([]);
  expect(parsed.instructions[1]!.endLine).toBe(4);
});

it('an unterminated here-document is reported as a problem', () => {
  const text = ['FROM alpine:3.19', 'RUN <<EOF', 'echo hi', ''].join('\n');
  const parsed = parseDockerfile(text);
  expect(parsed.problems.some((p) => p.message.includes('no line containing only its terminator'))).toBe(true);
});

it('input over the size limit is refused before parsing', () => {
  const big = 'FROM alpine:3.19\n' + '# '.repeat(600_000);
  expect(() => lintDockerfile(big)).toThrow(DockerfileLintError);
});

it('the parser agrees with dockerfile-ast on instruction names and line ranges for every fixture', () => {
  const files = readdirSync(AWESOME_DIR).filter((f) => f.endsWith('.Dockerfile'));
  expect(files.length).toBeGreaterThanOrEqual(8);
  for (const file of files) {
    const text = readFileSync(join(AWESOME_DIR, file), 'utf8');
    const ours = parseDockerfile(text);
    const theirs = DockerfileParser.parse(text).getInstructions();
    expect(ours.instructions.length, file).toBe(theirs.length);
    for (let i = 0; i < ours.instructions.length; i++) {
      const mine = ours.instructions[i]!;
      const ast = theirs[i]!;
      const range = ast.getRange();
      expect(mine.keyword, `${file} instruction ${i} keyword`).toBe(ast.getInstruction());
      expect(mine.line, `${file} instruction ${i} start line`).toBe(range.start.line + 1);
      expect(mine.endLine, `${file} instruction ${i} end line`).toBe(range.end.line + 1);
    }
  }
});

it('the vendored awesome-compose Dockerfiles give no syntax errors', () => {
  const files = readdirSync(AWESOME_DIR).filter((f) => f.endsWith('.Dockerfile'));
  expect(files.length).toBeGreaterThanOrEqual(8);
  for (const file of files) {
    const text = readFileSync(join(AWESOME_DIR, file), 'utf8');
    const parsed = parseDockerfile(text);
    expect(parsed.problems, file).toEqual([]);
  }
});

it('every vendored upstream file matches the git blob SHA recorded in UPSTREAM.md', () => {
  const upstreamText = readFileSync(join(AWESOME_DIR, 'UPSTREAM.md'), 'utf8');
  const entries = readUpstreamShas(upstreamText);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    const actualSha = gitBlobShaOfFile(join(AWESOME_DIR, entry.path));
    expect(actualSha, entry.path).toBe(entry.sha);
  }
});
