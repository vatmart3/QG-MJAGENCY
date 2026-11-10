import type { FluxType } from "@/store/world";

/** Apparence des échanges (vue Flux, liaisons dans la ville). */
export const FLUX_STYLE: Record<FluxType, { label: string; icon: string; color: string; verbe: string }> = {
  mission: { label: "Mission", icon: "🎯", color: "#7c5cd6", verbe: "confie une mission à" },
  delegation: { label: "Délégation", icon: "📌", color: "#e0812c", verbe: "délègue à" },
  question: { label: "Question", icon: "❓", color: "#3a7bd5", verbe: "demande à" },
  reponse: { label: "Réponse", icon: "💬", color: "#3d8a5a", verbe: "répond à" },
  livrable: { label: "Livrable", icon: "📄", color: "#c2930f", verbe: "livre à" },
  douane: { label: "Douane", icon: "📦", color: "#d8433a", verbe: "soumet aux" },
};
