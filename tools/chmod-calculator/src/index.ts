import meta from './meta.json';

export { meta };

export type Who = 'user' | 'group' | 'other';

export interface Permissions {
  user: { read: boolean; write: boolean; execute: boolean };
  group: { read: boolean; write: boolean; execute: boolean };
  other: { read: boolean; write: boolean; execute: boolean };
  setuid: boolean;
  setgid: boolean;
  sticky: boolean;
}

export class ChmodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChmodError';
  }
}

export function emptyPermissions(): Permissions {
  return {
    user: { read: false, write: false, execute: false },
    group: { read: false, write: false, execute: false },
    other: { read: false, write: false, execute: false },
    setuid: false,
    setgid: false,
    sticky: false,
  };
}

/** Converts permissions to the numeric mode, including the three special bits. */
export function toMode(p: Permissions): number {
  const triad = (t: { read: boolean; write: boolean; execute: boolean }) =>
    (t.read ? 4 : 0) | (t.write ? 2 : 0) | (t.execute ? 1 : 0);
  const special = (p.setuid ? 4 : 0) | (p.setgid ? 2 : 0) | (p.sticky ? 1 : 0);
  return (special << 9) | (triad(p.user) << 6) | (triad(p.group) << 3) | triad(p.other);
}

export function fromMode(mode: number): Permissions {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) {
    throw new ChmodError('A mode must be a whole number between 0 and 7777 in octal.');
  }
  const bit = (shift: number, mask: number) => ((mode >> shift) & mask) !== 0;
  return {
    user: { read: bit(8, 1), write: bit(7, 1), execute: bit(6, 1) },
    group: { read: bit(5, 1), write: bit(4, 1), execute: bit(3, 1) },
    other: { read: bit(2, 1), write: bit(1, 1), execute: bit(0, 1) },
    setuid: bit(11, 1),
    setgid: bit(10, 1),
    sticky: bit(9, 1),
  };
}

export function parseOctal(text: string): number {
  const trimmed = text.trim().replace(/^0o/i, '');
  if (!/^[0-7]{1,4}$/.test(trimmed)) {
    throw new ChmodError(
      `"${text}" is not an octal mode. Use three digits such as 755, or four to include the special bits, such as 4755.`,
    );
  }
  return parseInt(trimmed, 8);
}

/**
 * Renders the nine-character form `ls -l` shows.
 *
 * The special bits replace the matching execute character: `s` when execute is
 * also set, uppercase `S` when it is not. An uppercase letter is almost always
 * a mistake, because the bit has no effect without execute.
 */
export function toSymbolic(p: Permissions): string {
  const chars = [
    p.user.read ? 'r' : '-',
    p.user.write ? 'w' : '-',
    p.setuid ? (p.user.execute ? 's' : 'S') : p.user.execute ? 'x' : '-',
    p.group.read ? 'r' : '-',
    p.group.write ? 'w' : '-',
    p.setgid ? (p.group.execute ? 's' : 'S') : p.group.execute ? 'x' : '-',
    p.other.read ? 'r' : '-',
    p.other.write ? 'w' : '-',
    p.sticky ? (p.other.execute ? 't' : 'T') : p.other.execute ? 'x' : '-',
  ];
  return chars.join('');
}

export function parseSymbolic(text: string): Permissions {
  let s = text.trim();
  // Accept the ten character form from ls, where the first character is the type.
  if (s.length === 10 && /^[-dlbcpsD]/.test(s)) s = s.slice(1);
  if (s.length !== 9) {
    throw new ChmodError(`A symbolic mode has nine characters, such as rwxr-xr-x. "${text}" has ${s.length}.`);
  }

  const p = emptyPermissions();
  const triads: Who[] = ['user', 'group', 'other'];
  for (let t = 0; t < 3; t++) {
    const who = triads[t]!;
    const r = s[t * 3]!;
    const w = s[t * 3 + 1]!;
    const x = s[t * 3 + 2]!;

    if (r !== 'r' && r !== '-') throw new ChmodError(`Position ${t * 3 + 1} must be r or -, not "${r}".`);
    if (w !== 'w' && w !== '-') throw new ChmodError(`Position ${t * 3 + 2} must be w or -, not "${w}".`);

    p[who].read = r === 'r';
    p[who].write = w === 'w';

    const special = t === 2 ? ['t', 'T'] : ['s', 'S'];
    if (x === 'x') p[who].execute = true;
    else if (x === '-') p[who].execute = false;
    else if (x === special[0]) {
      p[who].execute = true;
      if (t === 0) p.setuid = true;
      else if (t === 1) p.setgid = true;
      else p.sticky = true;
    } else if (x === special[1]) {
      p[who].execute = false;
      if (t === 0) p.setuid = true;
      else if (t === 1) p.setgid = true;
      else p.sticky = true;
    } else {
      throw new ChmodError(`Position ${t * 3 + 3} must be x, -, ${special[0]} or ${special[1]}, not "${x}".`);
    }
  }
  return p;
}

/**
 * Applies a chmod expression such as `u+x,go-w` or `a=r` to an existing mode.
 *
 * This is the half of chmod people get wrong: `+` adds, `-` removes and `=`
 * replaces the whole triad, and omitting the who defaults to all three.
 */
export function applyExpression(mode: number, expression: string): number {
  const p = fromMode(mode);

  for (const clause of expression
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)) {
    const match = /^([ugoa]*)([+\-=])([rwxstugo]*)$/.exec(clause);
    if (!match) {
      throw new ChmodError(`"${clause}" is not a chmod clause. Expected something like u+x, go-w or a=rw.`);
    }
    const [, whoText = '', op = '+', permText = ''] = match;
    const targets: Who[] =
      whoText === '' || whoText.includes('a')
        ? ['user', 'group', 'other']
        : ([...whoText].map((c) => (c === 'u' ? 'user' : c === 'g' ? 'group' : 'other')) as Who[]);

    const wants = {
      read: permText.includes('r'),
      write: permText.includes('w'),
      execute: permText.includes('x'),
    };

    for (const who of targets) {
      if (op === '=') {
        p[who] = { ...wants };
      } else {
        const on = op === '+';
        if (wants.read) p[who].read = on;
        if (wants.write) p[who].write = on;
        if (wants.execute) p[who].execute = on;
      }
    }

    if (permText.includes('s')) {
      const on = op !== '-';
      if (whoText === '' || whoText.includes('a')) {
        p.setuid = on;
        p.setgid = on;
      } else {
        if (whoText.includes('u')) p.setuid = on;
        if (whoText.includes('g')) p.setgid = on;
      }
    }
    if (permText.includes('t')) p.sticky = op !== '-';
    if (op === '=' && !permText.includes('s')) {
      if (whoText.includes('u')) p.setuid = false;
      if (whoText.includes('g')) p.setgid = false;
    }
    if (op === '=' && !permText.includes('t') && (whoText === '' || whoText.includes('a') || whoText.includes('o'))) {
      p.sticky = false;
    }
  }

  return toMode(p);
}

export interface ModeReport {
  mode: number;
  octal: string;
  octalFull: string;
  symbolic: string;
  lsStyle: string;
  chmodCommand: string;
  description: string[];
  warnings: string[];
}

function describeTriad(label: string, t: { read: boolean; write: boolean; execute: boolean }): string {
  const allowed = [t.read && 'read', t.write && 'write', t.execute && 'execute'].filter(Boolean) as string[];
  return allowed.length === 0 ? `${label} can do nothing` : `${label} can ${allowed.join(', ')}`;
}

export function report(mode: number, isDirectory = false): ModeReport {
  const p = fromMode(mode);
  const symbolic = toSymbolic(p);
  const octalFull = mode.toString(8).padStart(4, '0');
  const warnings: string[] = [];

  if (p.other.write && !p.sticky) {
    warnings.push(
      isDirectory
        ? 'Anyone can create and delete files in this directory. Add the sticky bit (chmod +t) so only the owner of a file can remove it, as /tmp does.'
        : 'Anyone on the system can modify this file.',
    );
  }
  if (p.setuid) {
    warnings.push(
      isDirectory
        ? 'The setuid bit has no defined effect on a directory on Linux.'
        : 'This file runs as its owner rather than as whoever starts it. On a file owned by root that is a privilege escalation waiting to happen.',
    );
  }
  if (p.setgid && !isDirectory) {
    warnings.push("This file runs with the permissions of its group rather than the caller's group.");
  }
  if (p.setuid && !p.user.execute) {
    warnings.push(
      'The setuid bit is set but the owner cannot execute the file, so the bit does nothing. That is what the capital S means.',
    );
  }
  if (p.setgid && !p.group.execute && !isDirectory) {
    warnings.push('The setgid bit is set but the group cannot execute the file, so the bit does nothing.');
  }
  if (isDirectory && (p.user.read || p.group.read || p.other.read)) {
    const missing: string[] = [];
    if (p.user.read && !p.user.execute) missing.push('the owner');
    if (p.group.read && !p.group.execute) missing.push('the group');
    if (p.other.read && !p.other.execute) missing.push('others');
    if (missing.length > 0) {
      warnings.push(
        `On a directory, read without execute lets ${missing.join(' and ')} list the names but not open anything inside. That is almost never what is intended.`,
      );
    }
  }
  if (mode === 0o777) {
    warnings.push(
      '777 gives everyone full control. It is almost never the right answer, and it is the usual sign that a permissions problem was worked around rather than solved.',
    );
  }

  const description = [
    describeTriad('The owner', p.user),
    describeTriad('The group', p.group),
    describeTriad('Everyone else', p.other),
  ];
  if (p.setuid) description.push('setuid: an executable runs as its owner');
  if (p.setgid)
    description.push(
      isDirectory ? 'setgid: new files inherit this directory group' : 'setgid: an executable runs as its group',
    );
  if (p.sticky)
    description.push(
      isDirectory
        ? 'sticky: only a file owner may delete their own files here'
        : 'sticky: no effect on a regular file on Linux',
    );

  return {
    mode,
    octal: (mode & 0o777).toString(8).padStart(3, '0'),
    octalFull,
    symbolic,
    lsStyle: (isDirectory ? 'd' : '-') + symbolic,
    chmodCommand: `chmod ${mode > 0o777 ? octalFull : (mode & 0o777).toString(8).padStart(3, '0')} ${isDirectory ? 'directory' : 'file'}`,
    description,
    warnings,
  };
}

/** The mode a newly created file or directory gets under a given umask. */
export function applyUmask(umask: number, isDirectory: boolean): number {
  const base = isDirectory ? 0o777 : 0o666;
  return base & ~umask & 0o777;
}

export const COMMON_MODES: { mode: number; label: string; use: string }[] = [
  { mode: 0o644, label: '644 rw-r--r--', use: 'An ordinary file: the owner edits, everyone reads.' },
  { mode: 0o600, label: '600 rw-------', use: 'A private file such as an SSH private key or a .env file.' },
  { mode: 0o755, label: '755 rwxr-xr-x', use: 'A script or a directory everyone may use.' },
  { mode: 0o700, label: '700 rwx------', use: 'A private directory such as ~/.ssh.' },
  { mode: 0o664, label: '664 rw-rw-r--', use: 'A file a group collaborates on.' },
  { mode: 0o775, label: '775 rwxrwxr-x', use: 'A directory a group collaborates in.' },
  { mode: 0o777, label: '777 rwxrwxrwx', use: 'Everything to everyone. Almost always wrong.' },
  { mode: 0o1777, label: '1777 rwxrwxrwt', use: 'A world-writable directory with the sticky bit, as /tmp uses.' },
  { mode: 0o4755, label: '4755 rwsr-xr-x', use: 'A setuid binary. Rare and worth scrutiny.' },
  { mode: 0o2775, label: '2775 rwxrwsr-x', use: 'A shared directory where new files inherit the group.' },
];
