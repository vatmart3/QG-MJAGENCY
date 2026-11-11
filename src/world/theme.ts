/**
 * Style de la ville : « newyork » (gratte-ciel, avenues, taxis, brownstones) ou « sete » (l'île d'origine).
 * Seul le décor change : pôles, bureaux, agents, chemins et missions restent identiques.
 * Choix enregistré dans ce navigateur (Réglages → Ville, ou le bouton sur la carte).
 */

export type StyleVille = "newyork" | "sete";

const CLE = "leport.ville";
export const EVT_STYLE_VILLE = "leport:ville";

let choisi: StyleVille | null = null;

export function styleVille(): StyleVille {
  if (choisi) return choisi;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(CLE) === "sete" ? "sete" : "newyork";
  } catch {
    return "newyork";
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

export const NOM_STYLE: Record<StyleVille, string> = { newyork: "New York", sete: "Sète" };
