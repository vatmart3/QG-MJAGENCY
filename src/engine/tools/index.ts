import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { EAgent } from "../db";
import { askAgent } from "./ask_agent";
import { askFounder } from "./ask_founder";
import { createEmailDraft } from "./create_email_draft";
import { createEvent } from "./create_event";
import { createFounderTodo } from "./create_founder_todo";
import { delegateTask } from "./delegate_task";
import { findFreeSlots } from "./find_free_slots";
import { ATELIER_TOOLS } from "./atelier_tools";
import { COMMERCIAL_TOOLS } from "./commercial_tools";
import { FINANCE_TOOLS } from "./finance_tools";
import { finishTask } from "./finish_task";
import { labelEmail } from "./label_email";
import { listEvents } from "./list_events";
import { listInbox } from "./list_inbox";
import { planMission } from "./plan_mission";
import { postToJournal } from "./post_to_journal";
import { proposeCompanyMemoryUpdate } from "./propose_company_memory_update";
import { readEmail } from "./read_email";
import { readCompanyMemory } from "./read_company_memory";
import { requestMeeting } from "./request_meeting";
import { searchEmails } from "./search_emails";
import { searchMemory } from "./search_memory";
import { sendEmail } from "./send_email";
import type { ToolDef } from "./types";
import { writeAgentNote } from "./write_agent_note";

/** Outils construits : communication interne, mémoire, orchestration (Phase 3), mails et agenda (Phase 4). */
export const TOOLS: ToolDef[] = [
  askAgent,
  askFounder,
  createEmailDraft,
  createEvent,
  createFounderTodo,
  delegateTask,
  findFreeSlots,
  finishTask,
  labelEmail,
  listEvents,
  listInbox,
  planMission,
  postToJournal,
  proposeCompanyMemoryUpdate,
  readCompanyMemory,
  readEmail,
  requestMeeting,
  searchEmails,
  searchMemory,
  sendEmail,
  writeAgentNote,
  ...FINANCE_TOOLS,
  ...COMMERCIAL_TOOLS,
  ...ATELIER_TOOLS,
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
