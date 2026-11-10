import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { AGENTS, DEFAULT_SETTINGS, LIEUX, MEMORY, POLES, ROUTINES } from "./seed";
import type { AgentDef, MemoryEntry, Pole, Routine, Settings } from "./types";

/**
 * Catalogue vivant de l'entreprise : pôles, lieux, agents, mémoire, routines, réglages.
 * Démo : seed local (+ modifications enregistrées dans le navigateur).
 * Supabase : tables poles, agents, company_memory, routines, settings.
 */

export interface Catalog {
  poles: Pole[]; // pôles ET lieux communs (kind)
  agents: AgentDef[];
  memory: MemoryEntry[];
  routines: Routine[];
  settings: Settings;
}

export interface CatalogState extends Catalog {
  /** empreinte de tout ce qui change la carte ou les sprites → la ville se reconstruit si elle change */
  structure: string;
  loaded: boolean;
}

export const SEED_CATALOG: Catalog = {
  poles: [...POLES, ...LIEUX],
  agents: AGENTS,
  memory: MEMORY,
  routines: ROUTINES,
  settings: DEFAULT_SETTINGS,
};

export function structureKey(c: Pick<Catalog, "poles" | "agents">): string {
  const p = c.poles
    .filter((x) => x.actif)
    .map((x) => [x.id, x.position, x.style, x.couleur, x.sol, x.nom, x.icone, x.kind].join(":"))
    .sort()
    .join("|");
  const a = c.agents
    .filter((x) => x.actif)
    .sort((x, y) => x.ordre - y.ordre)
    .map((x) => [x.id, x.pole, x.apparenceSeed, x.nom].join(":"))
    .join("|");
  // petit hash lisible
  let h = 2166136261;
  const s = p + "#" + a;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export const catalogStore = createStore<CatalogState>(() => ({
  ...SEED_CATALOG,
  structure: structureKey(SEED_CATALOG),
  loaded: false,
}));

export const useCatalog = <T>(selector: (s: CatalogState) => T): T => useStore(catalogStore, selector);

export function setCatalog(c: Partial<Catalog>): void {
  const cur = catalogStore.getState();
  const next = { ...cur, ...c };
  catalogStore.setState({ ...next, structure: structureKey(next), loaded: true });
}

// ------------------------------------------------------------------ accès rapides (hors React)
const st = () => catalogStore.getState();

/** agents actifs, dans l'ordre */
export const allAgents = (): AgentDef[] => st().agents.filter((a) => a.actif).sort((a, b) => a.ordre - b.ordre);
export const agentById = (id: string | null | undefined): AgentDef | undefined => (id ? st().agents.find((a) => a.id === id) : undefined);
export const allPoles = (): Pole[] => st().poles.filter((p) => p.actif && p.kind === "pole").sort((a, b) => a.ordre - b.ordre);
export const allLieux = (): Pole[] => st().poles.filter((p) => p.actif && p.kind === "lieu");
export const poleById = (id: string | null | undefined): Pole | undefined => (id ? st().poles.find((p) => p.id === id) : undefined);
export const agentsOfPole = (poleId: string): AgentDef[] => allAgents().filter((a) => a.pole === poleId);
export const settings = (): Settings => st().settings;

/** Abonne un composant à toute modification du catalogue (nom, rôle, couleur…). */
export function useCatalogVersion(): void {
  useCatalog((s) => s.agents);
  useCatalog((s) => s.poles);
}

/** Hooks React équivalents */
export function useAgents(): AgentDef[] {
  return useCatalog((s) => s.agents).filter((a) => a.actif).sort((a, b) => a.ordre - b.ordre);
}
export function usePoles(): Pole[] {
  return useCatalog((s) => s.poles).filter((p) => p.actif && p.kind === "pole").sort((a, b) => a.ordre - b.ordre);
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
