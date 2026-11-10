"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { agentToRow, poleToRow, routineToRow, settingsToRow } from "@/lib/supabase/rows";
import { SEED_CATALOG, catalogStore, setCatalog, type Catalog } from "./catalog";
import type { AgentDef, MemoryEntry, Pole, Routine, Settings } from "./types";

/**
 * Enregistrement du catalogue.
 * - démo : dans le navigateur (localStorage), réinitialisable ;
 * - direct : tables Supabase (RLS = allowlist des fondateurs).
 */

export interface Repo {
  kind: "demo" | "live";
  saveAgent(a: AgentDef): Promise<void>;
  deleteAgent(id: string): Promise<void>;
  savePole(p: Pole): Promise<void>;
  deletePole(id: string): Promise<void>;
  saveRoutine(r: Routine): Promise<void>;
  deleteRoutine(id: string): Promise<void>;
  saveMemory(m: MemoryEntry): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
}

const upsertBy = <T extends { id: string }>(list: T[], item: T): T[] => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const next = [...list];
  next[i] = item;
  return next;
};

/** Mise à jour locale du catalogue (commune aux deux modes). */
const local = {
  agent: (a: AgentDef) => setCatalog({ agents: upsertBy(catalogStore.getState().agents, a) }),
  dropAgent: (id: string) => setCatalog({ agents: catalogStore.getState().agents.filter((a) => a.id !== id) }),
  pole: (p: Pole) => setCatalog({ poles: upsertBy(catalogStore.getState().poles, p) }),
  dropPole: (id: string) => setCatalog({ poles: catalogStore.getState().poles.filter((p) => p.id !== id) }),
  routine: (r: Routine) => setCatalog({ routines: upsertBy(catalogStore.getState().routines, r) }),
  dropRoutine: (id: string) => setCatalog({ routines: catalogStore.getState().routines.filter((r) => r.id !== id) }),
  memory: (m: MemoryEntry) => setCatalog({ memory: upsertBy(catalogStore.getState().memory, m) }),
  dropMemory: (id: string) => setCatalog({ memory: catalogStore.getState().memory.filter((m) => m.id !== id) }),
  settings: (s: Settings) => setCatalog({ settings: s }),
};

// ------------------------------------------------------------------ démo
const KEY = "le-port:catalogue:v1";

export function loadDemoCatalog(): Catalog {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return SEED_CATALOG;
    const saved = JSON.parse(raw) as Partial<Catalog>;
    return {
      poles: saved.poles ?? SEED_CATALOG.poles,
      agents: saved.agents ?? SEED_CATALOG.agents,
      memory: saved.memory ?? SEED_CATALOG.memory,
      routines: saved.routines ?? SEED_CATALOG.routines,
      settings: { ...SEED_CATALOG.settings, ...saved.settings },
    };
  } catch {
    return SEED_CATALOG;
  }
}

export function resetDemoCatalog(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // stockage indisponible : rien à effacer
  }
  setCatalog(SEED_CATALOG);
}

function persist(): void {
  const { poles, agents, memory, routines, settings } = catalogStore.getState();
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ poles, agents, memory, routines, settings }));
  } catch {
    // navigation privée : les modifications restent en mémoire
  }
}

export const demoRepo: Repo = {
  kind: "demo",
  async saveAgent(a) { local.agent(a); persist(); },
  async deleteAgent(id) { local.dropAgent(id); persist(); },
  async savePole(p) { local.pole(p); persist(); },
  async deletePole(id) { local.dropPole(id); persist(); },
  async saveRoutine(r) { local.routine(r); persist(); },
  async deleteRoutine(id) { local.dropRoutine(id); persist(); },
  async saveMemory(m) { local.memory(m); persist(); },
  async deleteMemory(id) { local.dropMemory(id); persist(); },
  async saveSettings(s) { local.settings(s); persist(); },
};

// ------------------------------------------------------------------ direct (Supabase)
function check(error: { message: string } | null): void {
  if (error) throw new Error(traduireErreur(error.message));
}

export function traduireErreur(msg: string): string {
  if (/violates foreign key/i.test(msg)) return "Impossible : cet élément est encore utilisé ailleurs (agents, tâches…).";
  if (/duplicate key|unique/i.test(msg)) return "Cet identifiant ou cet emplacement est déjà pris.";
  if (/row-level security|permission denied/i.test(msg)) return "Accès refusé : ton adresse n'est pas dans l'allowlist.";
  if (/allowlist ne peut pas être vide/i.test(msg)) return "L'allowlist ne peut pas être vide.";
  return msg;
}

export function liveRepo(sb: SupabaseClient): Repo {
  return {
    kind: "live",
    async saveAgent(a) { check((await sb.from("agents").upsert(agentToRow(a))).error); local.agent(a); },
    async deleteAgent(id) { check((await sb.from("agents").delete().eq("id", id)).error); local.dropAgent(id); },
    async savePole(p) { check((await sb.from("poles").upsert(poleToRow(p))).error); local.pole(p); },
    async deletePole(id) { check((await sb.from("poles").delete().eq("id", id)).error); local.dropPole(id); },
    async saveRoutine(r) { check((await sb.from("routines").upsert(routineToRow(r))).error); local.routine(r); },
    async deleteRoutine(id) { check((await sb.from("routines").delete().eq("id", id)).error); local.dropRoutine(id); },
    async saveMemory(m) { check((await sb.from("company_memory").upsert(m)).error); local.memory(m); },
    async deleteMemory(id) { check((await sb.from("company_memory").delete().eq("id", id)).error); local.dropMemory(id); },
    async saveSettings(s) { check((await sb.from("settings").update(settingsToRow(s)).eq("id", 1)).error); local.settings(s); },
  };
}

let current: Repo = demoRepo;
export const getRepo = (): Repo => current;
export const setRepo = (r: Repo): void => {
  current = r;
};
