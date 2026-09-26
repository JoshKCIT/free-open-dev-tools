/**
 * Every package.json field this tool can write, transcribed in this
 * project's own words from npm's package.json documentation
 * (https://docs.npmjs.com/cli/v11/configuring-npm/package-json, fetched
 * this session) and, for `type`, `exports` and `packageManager`, the
 * Node.js packages documentation (https://nodejs.org/api/packages.html,
 * fetched this session; `packageManager` is read by Corepack, not npm
 * itself).
 */

export type ReadBy = 'npm' | 'Node.js' | 'Corepack';

export interface PackageField {
  name: string;
  readBy: ReadBy;
  explanation: string;
  docsUrl: string;
}

const NPM_URL = 'https://docs.npmjs.com/cli/v11/configuring-npm/package-json#';
const NODE_URL = 'https://nodejs.org/api/packages.html#';

export const FIELDS: readonly PackageField[] = [
  {
    name: 'name',
    readBy: 'npm',
    explanation:
      "The package's own identifier on the registry. Together with version it forms the unique thing npm installs, so publishing a new name is the only way to rename a package.",
    docsUrl: NPM_URL + 'name',
  },
  {
    name: 'version',
    readBy: 'npm',
    explanation: "The package's current release, in the form Semantic Versioning 2.0.0 describes.",
    docsUrl: NPM_URL + 'version',
  },
  {
    name: 'description',
    readBy: 'npm',
    explanation: "A one-line summary shown in npm search results and on the package's registry page.",
    docsUrl: NPM_URL + 'description',
  },
  {
    name: 'keywords',
    readBy: 'npm',
    explanation: 'Search terms that help other developers find this package in npm search.',
    docsUrl: NPM_URL + 'keywords',
  },
  {
    name: 'homepage',
    readBy: 'npm',
    explanation: "The URL of the package's own project page, shown on its registry page.",
    docsUrl: NPM_URL + 'homepage',
  },
  {
    name: 'author',
    readBy: 'npm',
    explanation: 'The single person who maintains this package, shown on its registry page.',
    docsUrl: NPM_URL + 'people-fields-author-contributors',
  },
  {
    name: 'license',
    readBy: 'npm',
    explanation:
      'The SPDX licence identifier under which this package is released, or UNLICENSED, or a SEE LICENSE IN <file> pointer to a licence file whose text does not fit an SPDX identifier.',
    docsUrl: NPM_URL + 'license',
  },
  {
    name: 'repository',
    readBy: 'npm',
    explanation: "The version control location the package's source lives in, shown as a link on its registry page.",
    docsUrl: NPM_URL + 'repository',
  },
  {
    name: 'main',
    readBy: 'Node.js',
    explanation:
      'The module a plain require or import of the package name resolves to, for a package with no exports map.',
    docsUrl: NODE_URL + 'main',
  },
  {
    name: 'type',
    readBy: 'Node.js',
    explanation:
      'Whether Node.js treats a .js file in this package as an ES module or a CommonJS module; omitting it defaults to CommonJS.',
    docsUrl: NODE_URL + 'type',
  },
  {
    name: 'exports',
    readBy: 'Node.js',
    explanation:
      "Maps each subpath this package allows importing (for example . for the package root) to the real file that serves it, and hides every file not listed from a package's own consumers.",
    docsUrl: NODE_URL + 'exports',
  },
  {
    name: 'bin',
    readBy: 'npm',
    explanation:
      "Maps a command name to the script that runs it; npm links each one onto the PATH of whatever installs this package (globally, or as a devDependency's own node_modules/.bin).",
    docsUrl: NPM_URL + 'bin',
  },
  {
    name: 'scripts',
    readBy: 'npm',
    explanation:
      'Named shell commands npm run can execute, plus the handful of lifecycle names (for example prepare) npm itself runs automatically at the right point.',
    docsUrl: NPM_URL + 'scripts',
  },
  {
    name: 'dependencies',
    readBy: 'npm',
    explanation: 'Packages this package needs to actually run, installed alongside it wherever it is installed.',
    docsUrl: NPM_URL + 'dependencies',
  },
  {
    name: 'devDependencies',
    readBy: 'npm',
    explanation:
      'Packages only needed to build or test this package during its own development; a consumer installing this package as a dependency never gets these.',
    docsUrl: NPM_URL + 'devdependencies',
  },
  {
    name: 'peerDependencies',
    readBy: 'npm',
    explanation:
      "A version range this package expects its own consumer to already provide (typically a plugin's host framework), rather than installing its own copy.",
    docsUrl: NPM_URL + 'peerdependencies',
  },
  {
    name: 'files',
    readBy: 'npm',
    explanation:
      'Which files and directories are included in the published tarball; everything else in the working tree is left out (a small set of files, such as package.json itself, is always included regardless).',
    docsUrl: NPM_URL + 'files',
  },
  {
    name: 'engines',
    readBy: 'npm',
    explanation:
      'The Node.js version range this package is written for; npm only warns (unless the installer opts into engine-strict) rather than refusing to install outside it.',
    docsUrl: NPM_URL + 'engines',
  },
  {
    name: 'packageManager',
    readBy: 'Corepack',
    explanation:
      'Pins the exact package manager and version this project uses; Corepack (bundled with Node.js) reads this to run that exact version without a separate global install.',
    docsUrl: NODE_URL + 'determining-module-system',
  },
  {
    name: 'private',
    readBy: 'npm',
    explanation: 'Refuses npm publish outright, for a package that must never be published to a registry by accident.',
    docsUrl: NPM_URL + 'private',
  },
];

export function findField(name: string): PackageField | undefined {
  return FIELDS.find((f) => f.name === name);
}
