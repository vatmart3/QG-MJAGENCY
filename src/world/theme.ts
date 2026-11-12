/**
 * Style de la ville : « newyork » (gratte-ciel, avenues, taxis, immeubles), « futur » (ville futuriste : tours de
 * verre et néons, voitures volantes) ou « sete » (l'île d'origine).
 * Seul le décor change : pôles, bureaux, agents, chemins et missions restent identiques.
 * Choix enregistré dans ce navigateur (Réglages → Ville, ou le bouton sur la carte).
 */

export type StyleVille = "newyork" | "futur" | "sete";

/** Styles « ville » (île carrée, gratte-ciel, avenues, immeubles) : New York et Futuriste. */
export const urbain = (s: StyleVille): boolean => s !== "sete";

const CLE = "leport.ville";
export const EVT_STYLE_VILLE = "leport:ville";

let choisi: StyleVille | null = null;

export function styleVille(): StyleVille {
  if (choisi) return choisi;
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(CLE) : null;
    return v === "sete" || v === "newyork" ? v : "futur";
  } catch {
    return "futur";
  }
}

export function choisirStyleVille(s: StyleVille): void {
  choisi = s;
  try {
    localStorage.setItem(CLE, s);
  } catch {
    // navigation privée : le choix ne dure que le temps de la page
  }
  window.dispatchEvent(new CustomEvent<StyleVille>(EVT_STYLE_VILLE, { detail: s }));
}

export const NOM_STYLE: Record<StyleVille, string> = { newyork: "New York", futur: "Futuriste", sete: "Sète" };
/** ordre du bouton sur la carte */
export const STYLE_SUIVANT: Record<StyleVille, StyleVille> = { newyork: "futur", futur: "sete", sete: "newyork" };
