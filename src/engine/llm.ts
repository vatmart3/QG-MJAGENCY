import { adresse } from "@/integrations/types";
import Anthropic from "@anthropic-ai/sdk";
import { EFFORT, LIMITS, MODELS, SUPPORTS_FALLBACK } from "./config";
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

/** Résultat d'une recherche sur le web (outil web_search de Gabin, à la demande). */
export interface Recherche {
  texte: string;
  sources: { titre: string; url: string }[];
  recherches: number;
  model: string;
  usage: LLMResponse["usage"];
}

export interface LLM {
  readonly kind: "anthropic" | "mock";
  create(req: LLMRequest): Promise<LLMResponse>;
  /** recherche web (outil serveur d'Anthropic) : réponse courte et sourcée */
  search(question: string): Promise<Recherche>;
}

const SYSTEME_RECHERCHE =
  "Tu fais une recherche sur le web pour une agence web de Sète (MJAGENCY). Cherche (3 recherches au plus), puis réponds en français, en 10 lignes maximum : les faits utiles, datés, avec la source entre parenthèses. Si tu ne trouves rien de fiable, dis-le.";

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

  search(question: string): Promise<Recherche> {
    // le moins cher d'abord (Haiku), Sonnet si Haiku n'a pas la recherche web
    return rechercheAnthropic(this.client, question, [MODELS.light, MODELS.worker]);
  }
}

// ------------------------------------------------------------------ recherche web
async function rechercheAnthropic(client: Anthropic, question: string, models: string[]): Promise<Recherche> {
  let lastErr: unknown;
  for (const model of models) {
    try {
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: question }];
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let recherches = 0;
      const blocs: Anthropic.Beta.BetaContentBlock[] = [];
      // l'API peut suspendre un long tour de recherche (pause_turn) : on le relance au plus deux fois
      for (let i = 0; i < 3; i++) {
        const res = await client.beta.messages.create({
          model,
          max_tokens: 2000,
          system: SYSTEME_RECHERCHE,
          messages,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3, user_location: { type: "approximate", city: "Sète", region: "Occitanie", country: "FR", timezone: "Europe/Paris" } }],
          output_config: { effort: "low" },
        });
        usage.input += res.usage.input_tokens;
        usage.output += res.usage.output_tokens;
        usage.cacheRead += res.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
        recherches += res.usage.server_tool_use?.web_search_requests ?? 0;
        blocs.push(...res.content);
        if (res.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: res.content as unknown as Anthropic.Beta.BetaContentBlockParam[] });
      }
      const sources = new Map<string, string>();
      let texte = "";
      for (const b of blocs) {
        if (b.type === "text") {
          texte += b.text;
          for (const c of b.citations ?? []) if ("url" in c && c.url) sources.set(c.url, ("title" in c && c.title) || c.url);
        }
        if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (!sources.has(r.url) && sources.size < 12) sources.set(r.url, r.title);
      }
      return { texte: texte.trim() || "Aucun résultat exploitable.", sources: [...sources].map(([url, titre]) => ({ url, titre })).slice(0, 8), recherches, model, usage };
    } catch (e) {
      lastErr = e;
      // modèle sans recherche web : on retente avec le suivant ; autre erreur : on arrête
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
    }
  }
  throw lastErr;
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

function mockProspection(m: MockMeta, messages: Msg[]): Anthropic.Beta.BetaContentBlock[] | null {
  if (m.agentId !== "sacha" || !m.taskTitle.startsWith("Messages de prospection")) return null;
  if (usedTool(messages, "update_lead")) return [toolUse("finish_task", { titre: m.taskTitle, resume: "Messages prêts : DM Instagram enregistrés, mails déposés en Douane. (Simulé.)", sections: [{ titre: "Détail", contenu: lastToolResults(messages) || "Fait." }] })];
  const items = [...(m.taskDescription ?? "").matchAll(/- id ([0-9a-f-]{36}) · ([^·]+) ·.*?e-mail : (\S+)/g)];
  return items.flatMap(([, id, nom, email]) => [
    toolUse("update_lead", { prospect: id, dm_instagram: `Bonjour ! On adore ce que vous faites chez ${nom!.trim()} 🙌 On aide les commerces du coin à se faire trouver sur Google. Ça vous dirait qu'on en parle 10 minutes ? (DM simulé)`, statut: "a_contacter" }),
    ...(email && email !== "aucun" ? [toolUse("send_email", { a: email, objet: `${nom!.trim()} : une idée pour vos avis Google`, corps: "Bonjour,\n\nEn passant devant votre commerce, une idée nous est venue… (mail simulé)\n\nSeriez-vous disponible pour un appel de 15 minutes cette semaine ?" })] : []),
  ]);
}

function mockFinance(m: MockMeta, messages: Msg[]): Anthropic.Beta.BetaContentBlock[] | null {
  if (m.agentId !== "bastien" || !/factur/i.test(m.taskTitle)) return null;
  if (!usedTool(messages, "create_invoice"))
    return [
      toolUse("create_invoice", {
        client_nouveau: { nom: "Restaurant La Marée (test)", email: "bonjour@lamaree-sete.example", ville: "Sète", type: "pro" },
        objet: "Pack NFC avis Google",
        lignes: [
          { designation: "Pack NFC terrasse (10 chevalets)", quantite: 1, prix_unitaire: 349 },
          { designation: "Configuration et suivi des avis (mois)", quantite: 3, prix_unitaire: 29 },
        ],
      }),
    ];
  const id = (lastToolResults(messages).match(/id ([0-9a-f-]{36})/) ?? [])[1];
  if (!usedTool(messages, "render_pdf") && id) return [toolUse("render_pdf", { type: "facture", id })];
  if (!usedTool(messages, "send_document")) {
    const numero = (lastToolResults(messages).match(/F-\d{4}-\d{4}/) ?? [])[0];
    if (numero) return [toolUse("send_document", { type: "facture", id: numero, message: "Bonjour,\n\nVeuillez trouver ci-joint votre facture. Merci pour votre confiance ! (Message simulé.)" })];
  }
  return [toolUse("finish_task", { titre: m.taskTitle.slice(0, 160), resume: "Facture préparée, émise (PDF archivé) et déposée en Douane pour l'envoi. (Simulé.)", sections: [{ titre: "Détail", contenu: lastToolResults(messages) || "Fait." }] })];
}

export class MockLLM implements LLM {
  readonly kind = "mock" as const;

  async search(question: string): Promise<Recherche> {
    return {
      texte: `Recherche simulée sur « ${question.slice(0, 80)} » : ajoute une clé API Anthropic pour une vraie recherche sur le web.\n- Tendance (exemple) : les commerces locaux misent sur les avis Google et les fiches à jour.\n- Exemple : plusieurs agences de l'Hérault proposent des sites vitrines à partir de 900 € HT.`,
      sources: [{ titre: "Source de démonstration", url: "https://exemple.example/veille" }],
      recherches: 0,
      model: "simulé",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  }

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

    // prospection (Phase 7) : Sacha écrit les DM et les mails des prospects choisis
    const prospection = mockProspection(m, req.messages);
    if (prospection) return { ...base, content: prospection };

    // finance (Phase 6) : Bastien prépare, émet et dépose la facture en Douane
    const finance = mockFinance(m, req.messages);
    if (finance) return { ...base, content: finance };

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
