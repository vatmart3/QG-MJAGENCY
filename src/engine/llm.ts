import Anthropic from "@anthropic-ai/sdk";
import { EFFORT, LIMITS, SUPPORTS_FALLBACK } from "./config";
import type { Msg } from "./db";
import type { ModelTier } from "@/data/types";

/**
 * Appel au modèle. `AnthropicLLM` parle à l'API Claude ; `MockLLM` simule des réponses
 * réalistes pour faire tourner tout le moteur sans clé (mode démo / tests).
 */

export interface LLMRequest {
  model: string;
  tier: ModelTier;
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Msg[];
  tools: Anthropic.Beta.BetaTool[];
  /** informations pour la simulation (ignorées par l'API) */
  meta: MockMeta;
  maxTokens?: number;
}

export interface LLMResponse {
  content: Anthropic.Beta.BetaContentBlock[];
  stopReason: string | null;
  refusal: string | null;
  /** modèle qui a réellement répondu (différent en cas de repli) */
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface LLM {
  readonly kind: "anthropic" | "mock";
  create(req: LLMRequest): Promise<LLMResponse>;
}

export class AnthropicLLM implements LLM {
  readonly kind = "anthropic" as const;
  private client: Anthropic;
  constructor(apiKey: string) {
    // délai court : un pas d'agent doit tenir dans un appel /api/engine/tick
    this.client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 1 });
  }

  async create(req: LLMRequest): Promise<LLMResponse> {
    const fallback = SUPPORTS_FALLBACK(req.model);
    const res = await this.client.beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? LIMITS.maxTokens,
      system: req.system,
      messages: req.messages,
      ...(req.tools.length ? { tools: req.tools, tool_choice: { type: "auto" as const } } : {}),
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT[req.tier] },
      // en cas de refus, l'API rejoue la requête sur un modèle de repli adapté
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const u = res.usage;
    return {
      content: res.content,
      stopReason: res.stop_reason,
      refusal: res.stop_reason === "refusal" ? (res.stop_details?.explanation ?? res.stop_details?.category ?? "refus") : null,
      model: res.model,
      usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
    };
  }
}

// ------------------------------------------------------------------ simulation
export interface MockMeta {
  agentId: string;
  agentNom: string;
  role: string;
  planner: boolean;
  /** équipe proposée pour une mission (simulation de la planification) */
  team?: { agentId: string; titre: string; consigne: string }[];
  /** collègue à qui poser une question pendant la tâche */
  colleague?: { id: string; nom: string } | null;
  taskTitle: string;
  /** mini-boucle « ask_agent » : on répond à une question, sans outils */
  answering?: boolean;
  chat?: boolean;
}

let seq = 0;
const toolUse = (name: string, input: Record<string, unknown>): Anthropic.Beta.BetaToolUseBlock =>
  ({ type: "tool_use", id: `toolu_simule_${Date.now().toString(36)}_${seq++}`, name, input, caller: { type: "direct" } }) as unknown as Anthropic.Beta.BetaToolUseBlock;
const text = (t: string): Anthropic.Beta.BetaTextBlock => ({ type: "text", text: t, citations: null }) as Anthropic.Beta.BetaTextBlock;

function lastToolResults(messages: Msg[]): string {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || typeof last.content === "string") return "";
  return last.content
    .map((b) => (b.type === "tool_result" ? (typeof b.content === "string" ? b.content : "") : ""))
    .join("\n");
}

function usedTool(messages: Msg[], name: string): boolean {
  return messages.some((m) => m.role === "assistant" && typeof m.content !== "string" && m.content.some((b) => b.type === "tool_use" && b.name === name));
}

export class MockLLM implements LLM {
  readonly kind = "mock" as const;

  async create(req: LLMRequest): Promise<LLMResponse> {
    const m = req.meta;
    const base = { stopReason: "tool_use", refusal: null, model: `${req.model} (simulé)`, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

    if (m.chat) {
      return { ...base, stopReason: "end_turn", content: [text(`Bien noté ! Côté ${m.role.toLowerCase()}, je m'en occupe. (Réponse simulée : ajoute une clé API Anthropic pour que je réponde vraiment.)`)] };
    }
    if (m.answering) {
      return {
        ...base,
        stopReason: "end_turn",
        content: [text(`Je partirais sur une approche simple et locale.\nCôté ${m.role.toLowerCase()}, je te propose de garder le message court, concret, avec un exemple de commerce sétois. (Réponse simulée.)`)],
      };
    }

    if (m.planner) {
      if (!usedTool(req.messages, "plan_mission") && m.team?.length) {
        return {
          ...base,
          content: [
            text("Je découpe la mission et je répartis entre les pôles."),
            toolUse("plan_mission", {
              besoin: m.taskTitle.replace(/^Mission : /, ""),
              etapes: m.team.map((t, i) => ({ agent_id: t.agentId, titre: t.titre, consigne: t.consigne, apres: i === m.team!.length - 1 && m.team!.length > 2 ? [0] : [] })),
            }),
          ],
        };
      }
      const resultats = lastToolResults(req.messages);
      return {
        ...base,
        content: [
          toolUse("finish_task", {
            resultat: `Synthèse pour Jérémy et Matheis — ${m.taskTitle}\n\n${resultats || "Mission traitée."}\n\nProchaine étape : valider la proposition en Douane. (Synthèse simulée.)`,
            important: true,
          }),
        ],
      };
    }

    // agent « travailleur » : une question à un collègue, puis le livrable
    if (m.colleague && !usedTool(req.messages, "ask_agent")) {
      return {
        ...base,
        content: [
          toolUse("ask_agent", {
            agent_id: m.colleague.id,
            question: `${m.colleague.nom}, pour « ${m.taskTitle} », tu partirais sur quel angle ?`,
          }),
        ],
      };
    }
    return {
      ...base,
      content: [
        toolUse("finish_task", {
          resultat: `${m.agentNom} (${m.role}) — ${m.taskTitle} : proposition prête, ton local et concret, à relire par les fondateurs. (Livrable simulé.)`,
          important: false,
        }),
      ],
    };
  }
}

export function llmFromEnv(): LLM {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && process.env.MOCK_MODE !== "true") return new AnthropicLLM(key);
  return new MockLLM();
}
