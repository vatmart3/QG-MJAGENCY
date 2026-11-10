import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { AGENTS } from "@/data/seed";
import type { AgentState } from "@/data/types";

/**
 * État « réel » de l'entreprise côté client.
 * Phase 1 : alimenté par le directeur de démo (src/sim/director.ts).
 * Phase 2+ : alimenté par Supabase Realtime (tables agents, agent_messages, approvals, journal, tasks).
 * La ville (src/world) ne fait que refléter cet état.
 */

export interface TaskStep {
  label: string;
  done: boolean;
}

export interface TaskRef {
  id: string;
  title: string;
  steps: TaskStep[];
  startedAt: number;
  missionId?: string;
  important?: boolean;
}

export interface AgentRuntime {
  id: string;
  state: AgentState;
  task: TaskRef | null;
  talkWith: string | null;
  offlineReason: "nuit" | "budget" | null;
  /** approbation en cours d'acheminement vers La Douane */
  approvalId: string | null;
  since: number;
}

export interface Bubble {
  text: string;
  until: number;
  id: number;
}

export interface Line {
  from: string;
  text: string;
}

export interface Conversation {
  id: string;
  a: string;
  b: string;
  lines: Line[];
  phase: "gathering" | "playing" | "done";
  idx: number;
  startedAt: number;
  ready: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  participants: string[];
  lines: Line[];
  phase: "gathering" | "playing" | "done";
  idx: number;
  startedAt: number;
  arrived: string[];
}

export type ApprovalType = "email" | "facture" | "devis" | "relance" | "rdv" | "question";

export interface Approval {
  id: string;
  agentId: string;
  type: ApprovalType;
  title: string;
  to?: string;
  subject?: string;
  preview: string;
  createdAt: number;
  /** l'enveloppe a été déposée sur la pile de La Douane (animation) */
  delivered: boolean;
}

export interface JournalEntry {
  id: string;
  at: number;
  agentId?: string;
  poleId?: string;
  type: "action" | "echange" | "decision" | "mission" | "alerte" | "validation";
  title: string;
  detail?: string;
}

export interface TaskItem {
  id: string;
  agentId: string;
  title: string;
  status: "queued" | "running" | "waiting_approval" | "done" | "failed";
  createdAt: number;
  updatedAt: number;
  missionId?: string;
}

export interface Mission {
  id: string;
  text: string;
  target: string;
  plan: { agentId: string; title: string }[];
  status: "planification" | "en_cours" | "terminee";
  createdAt: number;
  synthese?: string;
}

export interface ChatMessage {
  from: "fondateur" | "agent";
  text: string;
  at: number;
}

export interface WorldState {
  agents: Record<string, AgentRuntime>;
  bubbles: Record<string, Bubble>;
  conversations: Record<string, Conversation>;
  meetings: Record<string, Meeting>;
  approvals: Approval[];
  journal: JournalEntry[];
  tasks: TaskItem[];
  missions: Mission[];
  chats: Record<string, ChatMessage[]>;
  /** agents présents dans la zone de leur pôle (calculé par la ville) */
  presence: Record<string, number>;
  /** heure forcée (démo), null = heure réelle de Paris */
  clockOverride: number | null;
  chatterEnabled: boolean;
  celebrations: Record<string, number>;
}

let bubbleSeq = 1;
let idSeq = 1;
export const uid = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(idSeq++).toString(36)}`;

export const worldStore = createStore<WorldState>(() => ({
  agents: Object.fromEntries(
    AGENTS.map((a) => [a.id, { id: a.id, state: "idle", task: null, talkWith: null, offlineReason: null, approvalId: null, since: Date.now() } satisfies AgentRuntime]),
  ),
  bubbles: {},
  conversations: {},
  meetings: {},
  approvals: [],
  journal: [],
  tasks: [],
  missions: [],
  chats: {},
  presence: {},
  clockOverride: null,
  chatterEnabled: true,
  celebrations: {},
}));

export const useWorld = <T>(selector: (s: WorldState) => T): T => useStore(worldStore, selector);

// ------------------------------------------------------------------ actions
const set = worldStore.setState;
const get = worldStore.getState;

export const world = {
  get,
  patchAgent(id: string, patch: Partial<AgentRuntime>): void {
    const cur = get().agents[id];
    if (!cur) return;
    const next = { ...cur, ...patch };
    if (patch.state && patch.state !== cur.state) next.since = Date.now();
    set((s) => ({ agents: { ...s.agents, [id]: next } }));
  },
  say(id: string, text: string, ms = 4200): void {
    set((s) => ({ bubbles: { ...s.bubbles, [id]: { text, until: Date.now() + ms, id: bubbleSeq++ } } }));
  },
  clearBubble(id: string): void {
    set((s) => {
      const b = { ...s.bubbles };
      delete b[id];
      return { bubbles: b };
    });
  },
  celebrate(id: string): void {
    set((s) => ({ celebrations: { ...s.celebrations, [id]: Date.now() } }));
  },
  log(entry: Omit<JournalEntry, "id" | "at"> & { at?: number }): void {
    const e: JournalEntry = { id: uid("j"), at: entry.at ?? Date.now(), ...entry };
    set((s) => ({ journal: [e, ...s.journal].slice(0, 400) }));
  },
  addApproval(a: Omit<Approval, "id" | "createdAt" | "delivered"> & { delivered?: boolean }): Approval {
    const ap: Approval = { delivered: false, ...a, id: uid("ap"), createdAt: Date.now() };
    set((s) => ({ approvals: [...s.approvals, ap] }));
    return ap;
  },
  markDelivered(id: string): void {
    if (get().approvals.some((a) => a.id === id && !a.delivered))
      set((s) => ({ approvals: s.approvals.map((a) => (a.id === id ? { ...a, delivered: true } : a)) }));
  },
  removeApproval(id: string): Approval | undefined {
    const ap = get().approvals.find((a) => a.id === id);
    set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) }));
    return ap;
  },
  upsertTask(t: TaskItem): void {
    set((s) => {
      const i = s.tasks.findIndex((x) => x.id === t.id);
      const tasks = [...s.tasks];
      if (i >= 0) tasks[i] = t;
      else tasks.unshift(t);
      return { tasks: tasks.slice(0, 300) };
    });
  },
  addMission(m: Mission): void {
    set((s) => ({ missions: [m, ...s.missions] }));
  },
  patchMission(id: string, patch: Partial<Mission>): void {
    set((s) => ({ missions: s.missions.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  },
  setConversation(c: Conversation): void {
    set((s) => ({ conversations: { ...s.conversations, [c.id]: c } }));
  },
  dropConversation(id: string): void {
    set((s) => {
      const c = { ...s.conversations };
      delete c[id];
      return { conversations: c };
    });
  },
  setMeeting(m: Meeting): void {
    set((s) => ({ meetings: { ...s.meetings, [m.id]: m } }));
  },
  dropMeeting(id: string): void {
    set((s) => {
      const m = { ...s.meetings };
      delete m[id];
      return { meetings: m };
    });
  },
  /** appelé par la ville quand deux interlocuteurs se sont rejoints */
  conversationReady(id: string): void {
    const c = get().conversations[id];
    if (c && !c.ready) set((s) => ({ conversations: { ...s.conversations, [id]: { ...c, ready: true } } }));
  },
  /** appelé par la ville quand un participant est assis dans La Criée */
  meetingArrived(id: string, agentId: string): void {
    const m = get().meetings[id];
    if (m && !m.arrived.includes(agentId)) set((s) => ({ meetings: { ...s.meetings, [id]: { ...m, arrived: [...m.arrived, agentId] } } }));
  },
  setPresence(p: Record<string, number>): void {
    const cur = get().presence;
    const same = Object.keys(p).length === Object.keys(cur).length && Object.entries(p).every(([k, v]) => cur[k] === v);
    if (!same) set({ presence: p });
  },
  setClockOverride(h: number | null): void {
    set({ clockOverride: h });
  },
  setChatter(on: boolean): void {
    set({ chatterEnabled: on });
  },
  pushChat(agentId: string, m: ChatMessage): void {
    set((s) => ({ chats: { ...s.chats, [agentId]: [...(s.chats[agentId] ?? []), m] } }));
  },
};
