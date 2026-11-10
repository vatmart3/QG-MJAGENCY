import type { z } from "zod";
import type { EAgent, ERun, ETask, EngineDb } from "../db";
import type { LLM } from "../llm";

export interface ToolCtx {
  db: EngineDb;
  llm: LLM;
  task: ETask;
  agent: EAgent;
  run: ERun;
  team: EAgent[];
  poles: Map<string, string>;
  memory: { cle: string; contenu: string }[];
  now: Date;
}

export interface ToolOutcome {
  /** texte renvoyé au modèle dans le tool_result */
  content: string;
  isError?: boolean;
  /** l'outil attend quelque chose (sous-tâches, décision d'un fondateur) */
  wait?: { kind: "tasks"; ids: string[] } | { kind: "approval"; id: string };
  /** la tâche est terminée */
  finish?: { texte: string; important: boolean };
  /** libellé de l'étape, affiché dans la fiche de l'agent */
  etape?: string;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** réservé au DG (modèle « planner ») */
  plannerOnly?: boolean;
  run(ctx: ToolCtx, input: z.infer<S>): Promise<ToolOutcome>;
}

export const defineTool = <S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> => t;

/** Retrouve un agent de l'équipe par identifiant ou par nom (le modèle écrit parfois « Mila »). */
export function findAgent(team: EAgent[], ref: string): EAgent | undefined {
  const n = ref.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  return team.find((a) => a.actif && (a.id === n || a.nom.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase() === n));
}
