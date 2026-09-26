import { meta, buildReadme, renderPreview, ReadmeError, type PackageManager } from '@fodt/readme-generator';
import { defineTool, str, bool, type OutputBlock, type ToolResult } from '../lib/tool-ui';

const PACKAGE_MANAGER_OPTIONS: { value: PackageManager; label: string }[] = [
  { value: 'npm', label: 'npm' },
  { value: 'pnpm', label: 'pnpm' },
  { value: 'yarn', label: 'yarn' },
  { value: 'bun', label: 'bun' },
];

/**
 * A small, commonly-reached-for subset of the SPDX License List
 * (spdx.org/licenses/), not a bundled snapshot of the whole list -- this
 * tool only needs to name the identifier in a sentence, never validate or
 * reproduce licence text.
 */
const LICENSE_OPTIONS = [
  { value: 'MIT', label: 'MIT' },
  { value: 'Apache-2.0', label: 'Apache License 2.0' },
  { value: 'GPL-3.0-only', label: 'GNU GPL v3.0' },
  { value: 'BSD-3-Clause', label: 'BSD 3-Clause' },
  { value: 'BSD-2-Clause', label: 'BSD 2-Clause' },
  { value: 'ISC', label: 'ISC' },
  { value: 'MPL-2.0', label: 'Mozilla Public License 2.0' },
  { value: 'Unlicense', label: 'The Unlicense' },
  { value: '(none)', label: '(no licence section)' },
];

export default defineTool({
  id: 'readme-generator',
  docs: { about: meta.about, supports: meta.supports, limits: meta.limits, standards: meta.standards },
  fields: [
    { name: 'name', label: 'Project name', type: 'text', default: '', placeholder: 'my-lib' },
    {
      name: 'description',
      label: 'Description',
      type: 'textarea',
      rows: 2,
      placeholder: 'One line about the project.',
    },
    { name: 'owner', label: 'GitHub owner or org', type: 'text', default: '' },
    { name: 'repo', label: 'GitHub repository name', type: 'text', default: '' },
    { name: 'packageName', label: 'Package name (npm)', type: 'text', default: '' },
    { name: 'workflowFile', label: 'CI workflow file (e.g. ci.yml)', type: 'text', default: '' },
    { name: 'badgeNpm', label: 'npm version badge', type: 'checkbox', default: false },
    { name: 'badgeLicense', label: 'GitHub licence badge', type: 'checkbox', default: false },
    { name: 'badgeWorkflow', label: 'GitHub Actions workflow status badge', type: 'checkbox', default: false },
    { name: 'badgeRelease', label: 'GitHub release badge', type: 'checkbox', default: false },
    {
      name: 'packageManager',
      label: 'Package manager',
      type: 'select',
      default: 'npm',
      options: PACKAGE_MANAGER_OPTIONS,
    },
    { name: 'installation', label: 'Installation (extra notes, optional)', type: 'textarea', rows: 3 },
    { name: 'usage', label: 'Usage', type: 'textarea', rows: 4 },
    { name: 'features', label: 'Features (one per line)', type: 'textarea', rows: 4 },
    { name: 'contributing', label: 'Contributing', type: 'textarea', rows: 3 },
    { name: 'license', label: 'Licence', type: 'select', default: 'MIT', options: LICENSE_OPTIONS },
    { name: 'toc', label: 'Table of contents', type: 'checkbox', default: false },
  ],
  examples: [
    {
      label: 'A name, an npm badge and an MIT licence',
      values: { name: 'my-lib', description: 'A tiny library.', packageName: 'my-lib', badgeNpm: true, license: 'MIT' },
    },
  ],
  run(values): ToolResult {
    const name = str(values, 'name', '');
    if (name.trim() === '') return { outputs: [] };

    const owner = str(values, 'owner', '');
    const repo = str(values, 'repo', '');
    const packageName = str(values, 'packageName', '');
    const workflowFile = str(values, 'workflowFile', '');

    const badges: { id: 'npm' | 'license' | 'workflow' | 'release'; params: Record<string, string> }[] = [];
    if (bool(values, 'badgeNpm', false)) badges.push({ id: 'npm', params: { packageName } });
    if (bool(values, 'badgeLicense', false)) badges.push({ id: 'license', params: { owner, repo } });
    if (bool(values, 'badgeWorkflow', false)) badges.push({ id: 'workflow', params: { owner, repo, workflowFile } });
    if (bool(values, 'badgeRelease', false)) badges.push({ id: 'release', params: { owner, repo } });

    const licenseValue = str(values, 'license', 'MIT');

    try {
      const { markdown, headings } = buildReadme({
        name,
        description: str(values, 'description', ''),
        badges,
        toc: bool(values, 'toc', false),
        packageManager: str(values, 'packageManager', 'npm') as PackageManager,
        packageName: packageName || undefined,
        sections: {
          installation: str(values, 'installation', ''),
          usage: str(values, 'usage', ''),
          features: str(values, 'features', ''),
          contributing: str(values, 'contributing', ''),
        },
        license: licenseValue === '(none)' ? undefined : licenseValue,
      });

      const outputs: OutputBlock[] = [
        { kind: 'code', label: 'README.md', language: 'markdown', value: markdown, download: 'README.md' },
      ];

      // The Markdown itself has no size limit; only the sanitised preview
      // does (freeze risk, see renderPreview's own MAX_LIST_ITEMS). A README
      // over that limit still downloads fine -- it just skips the preview.
      try {
        const { html } = renderPreview(markdown, window);
        outputs.push({ kind: 'sandboxed-html', label: 'Preview', html });
      } catch (previewErr) {
        if (!(previewErr instanceof ReadmeError)) throw previewErr;
        outputs.push({ kind: 'note', tone: 'warn', value: previewErr.message });
      }

      return { outputs, stats: [['Sections', String(headings.length)]] };
    } catch (err) {
      if (err instanceof ReadmeError) return { outputs: [], errors: [{ message: err.message }] };
      const message = err instanceof Error ? err.message : 'Could not build that README.';
      return { outputs: [], errors: [{ message }] };
    }
  },
});
