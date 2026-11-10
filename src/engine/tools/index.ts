import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { EAgent } from "../db";
import { askAgent } from "./ask_agent";
import { askFounder } from "./ask_founder";
import { createFounderTodo } from "./create_founder_todo";
import { delegateTask } from "./delegate_task";
import { finishTask } from "./finish_task";
import { planMission } from "./plan_mission";
import { postToJournal } from "./post_to_journal";
import { proposeCompanyMemoryUpdate } from "./propose_company_memory_update";
import { readCompanyMemory } from "./read_company_memory";
import { requestMeeting } from "./request_meeting";
import { searchMemory } from "./search_memory";
import type { ToolDef } from "./types";
import { writeAgentNote } from "./write_agent_note";

/** Outils disponibles en Phase 3 (communication interne, mémoire, orchestration). */
export const TOOLS: ToolDef[] = [
  askAgent,
  askFounder,
  createFounderTodo,
  delegateTask,
  finishTask,
  planMission,
  postToJournal,
  proposeCompanyMemoryUpdate,
  readCompanyMemory,
  requestMeeting,
  searchMemory,
  writeAgentNote,
] as ToolDef[];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const toolByName = (name: string): ToolDef | undefined => BY_NAME.get(name);

/** Outils autorisés pour un agent : sa liste (Réglages) ∩ outils déjà construits, + finish_task. */
export function toolsFor(agent: EAgent): ToolDef[] {
  const allowed = new Set([...agent.outils, "finish_task"]);
  if (agent.modele === "planner") allowed.add("plan_mission");
  return TOOLS.filter((t) => allowed.has(t.name) && (!t.plannerOnly || agent.modele === "planner"));
}

/** Définitions envoyées à l'API, dans un ordre stable (cache de prompt). */
export function apiTools(defs: ToolDef[]): Anthropic.Beta.BetaTool[] {
  return [...defs]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const schema = z.toJSONSchema(t.schema) as Record<string, unknown>;
      delete schema.$schema;
      return { name: t.name, description: t.description, input_schema: schema as Anthropic.Beta.BetaTool.InputSchema };
    });
}
