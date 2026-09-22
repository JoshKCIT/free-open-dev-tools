import type { ToolPage } from './tool-ui';
import catalog from '../generated-catalog.json';
import toolMeta from '../generated-tools.json';

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  tier: number;
  summary: string;
  implemented: boolean;
}

export interface ToolMeta {
  id: string;
  version: string;
  license: string;
  dependencies: Record<string, string>;
  keywords: string[];
}

/** Every tool page module, code-split so a visitor downloads only what they open. */
const modules = import.meta.glob('../tools/*.ts') as Record<string, () => Promise<{ default: ToolPage }>>;

const idFromPath = (path: string) => path.replace('../tools/', '').replace(/\.ts$/, '');

/** Ids that actually have a page wired up in this build. */
export const IMPLEMENTED_IDS: ReadonlySet<string> = new Set(Object.keys(modules).map(idFromPath));

export const CATALOG: CatalogEntry[] = (catalog.tools as CatalogEntry[]).map((c) => ({
  ...c,
  implemented: IMPLEMENTED_IDS.has(c.id),
}));

export const TOOL_META = toolMeta as Record<string, ToolMeta>;

/** Only tools that are built and wired up are ever shown as usable. */
export const LIVE_TOOLS: CatalogEntry[] = CATALOG.filter((c) => c.implemented);

export const CATEGORY_ORDER = [
  'encoding',
  'json-data',
  'text',
  'code',
  'hashing',
  'generators',
  'datetime',
  'network',
  'devops',
  'css',
  'color',
  'media',
  'reference',
];

export function byCategory(tools: CatalogEntry[]): { category: string; label: string; tools: CatalogEntry[] }[] {
  const groups = new Map<string, CatalogEntry[]>();
  for (const t of tools) {
    const list = groups.get(t.category) ?? [];
    list.push(t);
    groups.set(t.category, list);
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({
    category: c,
    label: groups.get(c)![0]!.categoryLabel,
    tools: groups.get(c)!.sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export function getEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((c) => c.id === id);
}

export async function loadTool(id: string): Promise<ToolPage | null> {
  const loader = modules[`../tools/${id}.ts`];
  if (!loader) return null;
  const mod = await loader();
  return mod.default;
}

/** Simple substring and token scoring. No network, no analytics. */
export function searchTools(query: string, tools: CatalogEntry[] = LIVE_TOOLS): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return tools;
  const terms = q.split(/\s+/);
  return tools
    .map((t) => {
      const keywords = TOOL_META[t.id]?.keywords ?? [];
      const haystack = `${t.name} ${t.id} ${t.summary} ${t.categoryLabel} ${keywords.join(' ')}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (!haystack.includes(term)) return { tool: t, score: -1 };
        if (t.name.toLowerCase().startsWith(term)) score += 6;
        else if (t.name.toLowerCase().includes(term)) score += 4;
        else if (t.id.includes(term)) score += 3;
        else score += 1;
      }
      return { tool: t, score };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .map((r) => r.tool);
}
