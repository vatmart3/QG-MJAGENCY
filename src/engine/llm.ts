import { adresse } from "@/integrations/types";
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
  taskDescription?: string;
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

const finish = (titre: string, resume: string, contenu: string) =>
  toolUse("finish_task", { titre: titre.slice(0, 160), resume, sections: [{ titre: "Détail", contenu }], prochaines_etapes: [{ action: "Valider les envois en Douane", qui: "Fondateurs" }] });

/** Scénarios simulés du courrier : mêmes outils que les vrais agents. */
function mockCourrier(m: MockMeta, messages: Msg[]): Anthropic.Beta.BetaContentBlock[] | null {
  const desc = m.taskDescription ?? "";
  if (m.taskTitle.startsWith("Tri des mails")) {
    if (usedTool(messages, "label_email")) {
      return [finish(m.taskTitle, "Les nouveaux mails sont triés, les réponses confiées à Noé. (Tri simulé.)", lastToolResults(messages) || "Tri effectué.")];
    }
    const items = [...desc.matchAll(/id=(\S+) · De : (.+?) · Objet : (.+)/g)];
    return items.map(([, id, , objet], i) => {
      const o = (objet ?? "").toLowerCase();
      const spam = /vérifiez votre compte|verif|gagn|cadeau/.test(o);
      const urgent = /urgent/.test(o);
      const fournisseur = /devis|facture/.test(o) && !/site/.test(o);
      return toolUse(
        "label_email",
        spam
          ? { id, categorie: "spam", resume: "Mail piégé qui demande d'envoyer des données : ignoré.", urgence: 0, action: "aucune" }
          : fournisseur
            ? { id, categorie: "fournisseur", resume: `Proposition fournisseur : ${objet}`, urgence: 0, action: "aucune" }
            : { id, categorie: urgent ? "client" : "prospect", resume: `${urgent ? "Problème urgent signalé" : "Demande d'information"} : ${objet}`, urgence: urgent ? 2 : 1, action: "repondre", agent_id: "noe", consigne: i === 0 ? "Réponds avec nos tarifs indicatifs et propose un appel." : undefined },
      );
    });
  }
  if (m.taskTitle.startsWith("Répondre :")) {
    if (usedTool(messages, "send_email")) return [finish(m.taskTitle, "Réponse préparée et déposée en Douane. (Simulé.)", lastToolResults(messages))];
    const hit = desc.match(/Mail id=(\S+) de (.+)\.\n/);
    if (!hit) return null;
    const objet = m.taskTitle.replace(/^Répondre : /, "");
    return [
      toolUse("send_email", {
        a: adresse(hit[2]!),
        objet: /^re\s*:/i.test(objet) ? objet : `Re: ${objet}`,
        corps: "Bonjour,\n\nMerci pour votre message. Nous revenons vers vous très vite avec une proposition adaptée ; seriez-vous disponible pour un court appel cette semaine ?\n\nBien cordialement,\n\n(Réponse simulée : ajoute une clé API Anthropic pour une vraie réponse.)",
        repondre_a: hit[1],
      }),
    ];
  }
  if (m.taskTitle.startsWith("Relances :")) {
    if (usedTool(messages, "send_email")) return [finish(m.taskTitle, "Relances préparées et déposées en Douane. (Simulé.)", lastToolResults(messages))];
    const items = [...desc.matchAll(/id=(\S+) · À : (.+?) · Objet : (.+?) · envoyé/g)];
    if (!items.length) return null;
    return items.map(([, id, a, objet]) =>
      toolUse("send_email", { a: adresse(a!), objet: `Re: ${objet}`, corps: "Bonjour,\n\nJe me permets de revenir vers vous au sujet de notre proposition. Avez-vous eu le temps d'y jeter un œil ?\n\nBelle journée,\n\n(Relance simulée.)", repondre_a: id, type: "relance" }),
    );
  }
  return null;
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
            titre: `Synthèse — ${m.taskTitle.replace(/^Mission : /, "")}`.slice(0, 160),
            resume: `Les sous-tâches de la mission sont revenues : chaque pôle a rendu sa partie. La proposition est prête à être relue par Jérémy et Matheis. (Synthèse simulée.)`,
            points_cles: (m.team ?? []).slice(0, 5).map((t) => `${t.titre} — livré`),
            sections: [
              { titre: "Ce qui a été produit", contenu: resultats ? resultats.slice(0, 11_000) : "Mission traitée." },
              {
                titre: "Répartition",
                contenu: ["| Agent | Sous-tâche | État |", "|---|---|---|", ...(m.team ?? []).map((t) => `| ${t.agentId} | ${t.titre} | ✓ livré |`)].join("\n"),
              },
            ],
            prochaines_etapes: [
              { action: "Relire la proposition et la valider", qui: "Jérémy ou Matheis", echeance: "cette semaine" },
              { action: "Envoyer la version finale au client depuis La Douane", qui: "Fondateurs" },
            ],
            fichiers: [
              {
                nom: "synthese-mission.md",
                type: "md",
                description: "Synthèse prête à partager",
                contenu: `# ${m.taskTitle}\n\n${resultats || "Mission traitée."}\n\n_Document simulé._`,
              },
            ],
            important: true,
          }),
        ],
      };
    }

    // courrier (Phase 4) : tri de Lucie, réponses de Noé, relances de Firmin
    const courrier = mockCourrier(m, req.messages);
    if (courrier) return { ...base, content: courrier };

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
          titre: m.taskTitle.slice(0, 160),
          resume: `${m.agentNom} (${m.role}) a préparé « ${m.taskTitle} » : proposition prête, ton local et concret, à relire par les fondateurs. (Livrable simulé.)`,
          points_cles: ["Ton local, sétois et concret", "Message court, un seul appel à l'action", "À relire avant envoi"],
          sections: [
            { titre: "Proposition", contenu: `- Angle : un exemple de commerce sétois\n- Format : court, concret\n- **Appel à l'action** : prendre rendez-vous\n\n(Contenu simulé : ajoute une clé API Anthropic pour un vrai livrable.)` },
            { titre: "Chiffres", contenu: "| Élément | Valeur |\n|---|---|\n| Délai | 1 semaine |\n| Budget indicatif | à définir |" },
          ],
          prochaines_etapes: [{ action: "Relire et valider", qui: "Fondateurs", echeance: "sous 48 h" }],
          fichiers: [{ nom: `${m.agentNom.toLowerCase()}-proposition.md`, type: "md", description: "Brouillon prêt à l'emploi", contenu: `# ${m.taskTitle}\n\nBrouillon simulé rédigé par ${m.agentNom}.` }],
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
