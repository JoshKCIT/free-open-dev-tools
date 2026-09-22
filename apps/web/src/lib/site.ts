/** Single place that knows where the source lives, so no page invents a URL. */
export const GITHUB_OWNER = 'JoshKCIT';
export const REPO_NAME = 'free-open-dev-tools';
export const REPO_URL = `https://github.com/${GITHUB_OWNER}/${REPO_NAME}`;

/** Deep link to a single tool's self-contained folder. */
export function toolSourceUrl(id: string): string {
  return `${REPO_URL}/tree/main/tools/${id}`;
}

/** Pre-filled issue link. Deliberately carries no tool input, only the tool id. */
export function issueUrl(id: string, name: string): string {
  const params = new URLSearchParams({
    labels: 'bug',
    title: `[${id}] `,
    body: `**Tool:** ${name} (\`${id}\`)\n\n**What happened**\n\n\n**What you expected**\n\n\n**Steps to reproduce**\n\n\n> Please do not paste sensitive input. Replace secrets with placeholder values before filing.`,
  });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

export const COMMIT = (import.meta.env.VITE_COMMIT as string | undefined) ?? 'development';
export const BUILD_DATE = (import.meta.env.VITE_BUILD_DATE as string | undefined) ?? 'unbuilt';
