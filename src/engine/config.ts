import type { ModelTier } from "@/data/types";

/** Réglages du moteur d'agents (§7). Surchargeables par variables d'environnement. */

export const MODELS: Record<ModelTier, string> = {
  // Sonnet par défaut pour Marius (2× moins cher qu'Opus) ; MODEL_PLANNER=claude-opus-5-5 pour revenir à Opus
  planner: process.env.MODEL_PLANNER || "claude-sonnet-5-5",
  worker: process.env.MODEL_WORKER || "claude-sonnet-5-5",
  light: process.env.MODEL_LIGHT || "claude-haiku-5-5",
};

/** Profondeur de réflexion par niveau : volontairement économe (moins de jetons de réflexion facturés). */
export const EFFORT: Record<ModelTier, "low" | "medium" | "high"> = {
  planner: (process.env.EFFORT_PLANNER as "low" | "medium" | "high") || "medium",
  worker: (process.env.EFFORT_WORKER as "low" | "medium" | "high") || "low",
  light: "low",
};

/** Prix en dollars par million de jetons : entrée, sortie, lecture de cache. Écriture de cache = 1,25 × entrée. */
const PRICES: Record<string, [number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-fable-5-2": [8, 40, 0.2],
};
const USD_TO_EUR = Number(process.env.USD_TO_EUR || 0.92);

export function costEur(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const [i, o, r] = PRICES[model] ?? PRICES["claude-sonnet-5-5"]!;
  const usd = (u.input * i + u.output * o + u.cacheRead * r + u.cacheWrite * i * 1.25) / 1_000_000;
  return Math.round(usd * USD_TO_EUR * 100_000) / 100_000;
}

/** Recherche web (outil serveur d'Anthropic) : 10 $ les 1 000 recherches, en plus des jetons. */
export const COUT_RECHERCHE_EUR = 0.01 * USD_TO_EUR;

/** Modèles qui acceptent le repli côté serveur en cas de refus (`fallbacks: "default"`). */
export const SUPPORTS_FALLBACK = (model: string): boolean => model === "claude-opus-5-5" || model === "claude-sonnet-5-5";

export const LIMITS = {
  /** itérations d'outils maximum par tâche */
  maxIterations: 12,
  /** profondeur maximum de délégation */
  maxDepth: 3,
  /** une tâche non terminée au bout de 24 h échoue */
  taskTimeoutMs: 24 * 3600_000,
  /** pas exécutés au maximum par appel à /api/engine/tick */
  stepsPerTick: Number(process.env.ENGINE_STEPS_PER_TICK || 8),
  /** tâches traitées en parallèle */
  parallel: Number(process.env.ENGINE_PARALLEL || 3),
  /** temps maximum passé dans un tick (les fonctions Vercel s'arrêtent à 60 s) */
  tickBudgetMs: Number(process.env.ENGINE_TICK_BUDGET_MS || 40_000),
  /** verrou posé sur une tâche pendant son pas */
  lockSeconds: 150,
  /** délai laissé à la réunion de lancement avant que les sous-tâches démarrent */
  meetingDelayMs: Number(process.env.ENGINE_MEETING_DELAY_MS || 45_000),
  /** erreurs d'API consécutives avant d'abandonner une tâche */
  maxErrors: 3,
  maxTokens: 8_000,
};

/** La nuit (heure de Paris), les agents sans tâche rentrent chez eux ; ceux de garde restent au port. */
export const NUIT = { debut: process.env.NUIT_DEBUT || "20:00", fin: process.env.NUIT_FIN || "08:00", deGarde: ["lucie", "jade"], parPassage: 8 };

/** Agents qui continuent même quand le budget du jour est épuisé (§7.6). */
export const CRITICAL_FALLBACK = ["lucie", "diane", "remi"];
