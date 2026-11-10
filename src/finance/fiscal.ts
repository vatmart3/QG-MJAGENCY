import type { FinanceSettings } from "./types";

/**
 * Calendrier des obligations d'une micro-entreprise (dates usuelles : à vérifier chaque année sur
 * autoentrepreneur.urssaf.fr et impots.gouv.fr). Rien n'est déclaré automatiquement.
 */

export interface Echeance {
  date: string;
  titre: string;
  detail: string;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const finDeMois = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function calendrierFiscal(aujourdhui: string, s: FinanceSettings, horizonJours = 120): Echeance[] {
  const t0 = Date.parse(aujourdhui);
  const fin = t0 + horizonJours * 86400_000;
  const y0 = Number(aujourdhui.slice(0, 4));
  const out: Echeance[] = [];
  for (const y of [y0, y0 + 1]) {
    if (s.periodicite === "mensuelle") {
      for (let m = 1; m <= 12; m++) {
        // déclaration du CA de M avant la fin de M+1
        const dm = m === 12 ? 1 : m + 1;
        const dy = m === 12 ? y + 1 : y;
        out.push({ date: iso(dy, dm, finDeMois(dy, dm)), titre: `Déclaration URSSAF du CA de ${MOIS[m - 1]} ${y}`, detail: "Chiffre d'affaires encaissé du mois, sur autoentrepreneur.urssaf.fr (même à 0 €)." });
      }
    } else {
      const trimestres: [string, number, number, number][] = [
        ["janvier–mars", y, 4, 30],
        ["avril–juin", y, 7, 31],
        ["juillet–septembre", y, 10, 31],
        ["octobre–décembre", y + 1, 1, 31],
      ];
      for (const [t, dy, dm, dd] of trimestres) out.push({ date: iso(dy, dm, dd), titre: `Déclaration URSSAF du trimestre ${t} ${y}`, detail: "Chiffre d'affaires encaissé du trimestre, sur autoentrepreneur.urssaf.fr." });
    }
    out.push({ date: iso(y, 12, 15), titre: `CFE ${y}`, detail: "Cotisation foncière des entreprises : avis dans l'espace professionnel impots.gouv.fr (exonération la 1re année)." });
    out.push({ date: iso(y, 5, 31), titre: `Déclaration des revenus ${y - 1}`, detail: "Report du CA annuel dans la déclaration de revenus (case micro-entrepreneur). Date selon le département." });
  }
  return out.filter((e) => Date.parse(e.date) >= t0 - 86400_000 && Date.parse(e.date) <= fin).sort((a, b) => a.date.localeCompare(b.date));
}
