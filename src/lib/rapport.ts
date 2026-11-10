import { z } from "zod";

/**
 * Compte rendu structuré d'une tâche (rendu par un agent avec finish_task).
 * Partagé entre le moteur (validation), la base (tasks.resultat.rapport) et l'interface (lecture, PDF, fichiers).
 */

export const FICHIER_TYPES = ["md", "txt", "csv", "html", "json"] as const;
export type FichierType = (typeof FICHIER_TYPES)[number];

export const rapportSchema = z.object({
  titre: z.string().min(1).max(160).describe("Titre court du compte rendu."),
  resume: z.string().min(1).max(1200).describe("L'essentiel en 2 à 4 phrases : ce qui a été fait et le résultat."),
  sections: z
    .array(
      z.object({
        titre: z.string().min(1).max(120),
        contenu: z.string().min(1).max(12_000).describe("Markdown simple : paragraphes, listes « - », **gras**, tableaux « | a | b | »."),
      }),
    )
    .min(1)
    .max(8)
    .describe("Le livrable détaillé, rangé en sections (ex. Contexte, Proposition, Chiffres, Points d'attention)."),
  points_cles: z.array(z.string().min(1).max(240)).max(6).optional().describe("3 à 6 points à retenir."),
  prochaines_etapes: z
    .array(
      z.object({
        action: z.string().min(1).max(240),
        qui: z.string().max(60).optional().describe("Jérémy, Matheis, un agent…"),
        echeance: z.string().max(60).optional().describe("ex. « cette semaine », « 15/11 »"),
      }),
    )
    .max(8)
    .optional(),
  fichiers: z
    .array(
      z.object({
        nom: z
          .string()
          .min(1)
          .max(80)
          .describe("ex. « offre-nfc-restaurant.md », « prospects.csv »"),
        type: z.enum(FICHIER_TYPES),
        description: z.string().max(200).optional(),
        contenu: z.string().min(1).max(30_000),
      }),
    )
    .max(5)
    .optional()
    .describe("Documents prêts à l'emploi joints au compte rendu (brouillon de mail, devis, tableau CSV…)."),
});

export type Rapport = z.infer<typeof rapportSchema>;
export type RapportFichier = NonNullable<Rapport["fichiers"]>[number];

export interface RapportMeta {
  agentNom?: string;
  agentRole?: string;
  pole?: string;
  date?: number;
  mission?: string;
  tache?: string;
}

/** Valide un rapport venu de la base (ancien format ou données partielles → null). */
export function lireRapport(v: unknown): Rapport | null {
  const r = rapportSchema.safeParse(v);
  return r.success ? r.data : null;
}

/** Rapport minimal à partir d'un texte libre (ancien livrable, réponse sans finish_task). */
export function rapportDepuisTexte(titre: string, texte: string): Rapport {
  const propre = texte.trim() || "(sans contenu)";
  const premier = propre.split(/\n\s*\n/)[0] ?? propre;
  return {
    titre: titre.slice(0, 160) || "Livrable",
    resume: premier.replace(/^#+\s*/, "").slice(0, 1200),
    sections: [{ titre: "Livrable", contenu: propre.slice(0, 12_000) }],
  };
}

const dateFr = (ms: number) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" }).format(new Date(ms));

/** Version Markdown complète (texte transmis aux autres agents, téléchargement .md). */
export function rapportVersMarkdown(r: Rapport, meta: RapportMeta = {}): string {
  const out: string[] = [`# ${r.titre}`, ""];
  const infos = [
    meta.agentNom && `**Par :** ${meta.agentNom}${meta.agentRole ? ` (${meta.agentRole})` : ""}`,
    meta.date && `**Date :** ${dateFr(meta.date)}`,
    meta.mission && `**Mission :** ${meta.mission}`,
  ].filter(Boolean);
  if (infos.length) out.push(infos.join("  \n"), "");
  out.push("## Résumé", "", r.resume, "");
  if (r.points_cles?.length) out.push("## Points clés", "", ...r.points_cles.map((p) => `- ${p}`), "");
  for (const s of r.sections) out.push(`## ${s.titre}`, "", s.contenu.trim(), "");
  if (r.prochaines_etapes?.length) {
    out.push("## Prochaines étapes", "", "| Action | Qui | Échéance |", "|---|---|---|");
    for (const e of r.prochaines_etapes) out.push(`| ${cell(e.action)} | ${cell(e.qui ?? "—")} | ${cell(e.echeance ?? "—")} |`);
    out.push("");
  }
  if (r.fichiers?.length) out.push("## Fichiers joints", "", ...r.fichiers.map((f) => `- ${f.nom}${f.description ? ` — ${f.description}` : ""}`), "");
  return out.join("\n").trim() + "\n";
}

const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");

// ------------------------------------------------------------------ Markdown → HTML (sûr : tout est échappé)

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

/** Markdown simple (titres, listes, tableaux, citations, gras/italique/code) → HTML échappé. */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(5, h[1]!.length + 2);
      html.push(`<h${lvl}>${inline(h[2]!)}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const cells = lines[i]!.trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      html.push(
        `<table><thead><tr>${(head ?? []).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^>\s?/, ""));
      html.push(`<blockquote>${q.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      html.push("<hr>");
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|\s*\||\s*([-*•]|\d+[.)])\s+|>|-{3,}\s*$)/.test(lines[i]!)) para.push(lines[i++]!);
    html.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return html.join("\n");
}

// ------------------------------------------------------------------ document autonome (impression PDF, .html)

const PRINT_CSS = `
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1f2433; font-size: 10.5pt; line-height: 1.5; margin: 0; padding: 24px; max-width: 820px; margin-inline: auto; background: #fff; }
@media print { body { padding: 0; } .no-print { display: none !important; } }
.cover { background: #fbf8f2; border: 1px solid #e3ddd0; border-radius: 12px; padding: 18px 22px; margin-bottom: 14px; }
.kicker { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .8px; color: #5b6275; margin: 0 0 4px; }
h1 { font-size: 20pt; margin: 0 0 8px; letter-spacing: -.3px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: #5b6275; font-size: 9.5pt; }
.meta b { color: #1f2433; font-weight: 600; }
h2 { font-size: 13pt; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #1f2433; break-after: avoid; }
h3, h4, h5 { font-size: 11pt; margin: 12px 0 4px; break-after: avoid; }
p { margin: 0 0 6px; }
ul, ol { margin: 0 0 6px; padding-left: 20px; }
li { margin-bottom: 2px; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 9.5pt; }
th { text-align: left; background: #fbf8f2; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .4px; color: #5b6275; }
th, td { border-bottom: 1px solid #e3ddd0; padding: 5px 7px; vertical-align: top; }
tr { break-inside: avoid; }
code { font-family: Menlo, Consolas, monospace; font-size: 9pt; background: #f2eee5; padding: 0 3px; border-radius: 3px; }
blockquote { margin: 6px 0; padding: 6px 12px; border-left: 3px solid #2f6f9f; background: #f3f7fb; }
.resume { border-left: 4px solid #3d8a5a; background: #f1f8f3; padding: 10px 14px; border-radius: 0 8px 8px 0; font-size: 11pt; }
.cles li { list-style: none; margin-left: -20px; padding-left: 22px; position: relative; }
.cles li::before { content: "✓"; position: absolute; left: 4px; color: #3d8a5a; font-weight: 700; }
.fichier { border: 1px solid #e3ddd0; border-radius: 8px; margin: 8px 0; break-inside: avoid; }
.fichier header { background: #fbf8f2; padding: 6px 10px; font-weight: 600; font-size: 9.5pt; border-bottom: 1px solid #e3ddd0; }
.fichier pre { margin: 0; padding: 8px 10px; white-space: pre-wrap; font-size: 8.8pt; font-family: Menlo, Consolas, monospace; }
.fichier .md { padding: 8px 12px; }
footer { margin-top: 18px; color: #8a8f9c; font-size: 8.5pt; border-top: 1px solid #e3ddd0; padding-top: 6px; }
.bar { position: sticky; top: 0; background: #1f2433; color: #fff; padding: 10px 14px; border-radius: 10px; margin-bottom: 14px; display: flex; gap: 10px; align-items: center; font-size: 10pt; }
.bar button { background: #fff; color: #1f2433; border: 0; border-radius: 999px; padding: 6px 14px; font-weight: 600; cursor: pointer; }
`;

/** Page HTML autonome du compte rendu : imprimable en PDF, téléchargeable telle quelle. */
export function rapportHtmlDocument(r: Rapport, meta: RapportMeta = {}, opts: { boutonImprimer?: boolean } = {}): string {
  const infos = [
    meta.agentNom && `<span><b>Par</b> ${escapeHtml(meta.agentNom)}${meta.agentRole ? ` · ${escapeHtml(meta.agentRole)}` : ""}</span>`,
    meta.pole && `<span><b>Pôle</b> ${escapeHtml(meta.pole)}</span>`,
    meta.date && `<span><b>Le</b> ${escapeHtml(dateFr(meta.date))}</span>`,
    meta.mission && `<span><b>Mission</b> ${escapeHtml(meta.mission)}</span>`,
  ]
    .filter(Boolean)
    .join("");
  const etapes = r.prochaines_etapes?.length
    ? `<h2>Prochaines étapes</h2><table><thead><tr><th>Action</th><th>Qui</th><th>Échéance</th></tr></thead><tbody>${r.prochaines_etapes
        .map((e) => `<tr><td>${inline(e.action)}</td><td>${escapeHtml(e.qui ?? "—")}</td><td>${escapeHtml(e.echeance ?? "—")}</td></tr>`)
        .join("")}</tbody></table>`
    : "";
  const fichiers = r.fichiers?.length
    ? `<h2>Fichiers joints</h2>${r.fichiers
        .map(
          (f) =>
            `<div class="fichier"><header>📎 ${escapeHtml(f.nom)}${f.description ? ` — <span style="font-weight:400">${escapeHtml(f.description)}</span>` : ""}</header>${
              f.type === "md" ? `<div class="md">${mdToHtml(f.contenu)}</div>` : `<pre>${escapeHtml(f.contenu.slice(0, 8000))}${f.contenu.length > 8000 ? "\n…" : ""}</pre>`
            }</div>`,
        )
        .join("")}`
    : "";
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(r.titre)} — Compte rendu</title><style>${PRINT_CSS}</style></head>
<body>
${opts.boutonImprimer ? `<div class="bar no-print"><span style="flex:1">Choisis « Enregistrer au format PDF » dans la fenêtre d'impression.</span><button onclick="window.print()">Imprimer / PDF</button></div>` : ""}
<div class="cover"><p class="kicker">⚓ LE PORT · Compte rendu</p><h1>${escapeHtml(r.titre)}</h1><div class="meta">${infos}</div></div>
<h2>Résumé</h2><div class="resume">${inline(r.resume)}</div>
${r.points_cles?.length ? `<h2>Points clés</h2><ul class="cles">${r.points_cles.map((p) => `<li>${inline(p)}</li>`).join("")}</ul>` : ""}
${r.sections.map((s) => `<h2>${escapeHtml(s.titre)}</h2>${mdToHtml(s.contenu)}`).join("\n")}
${etapes}
${fichiers}
<footer>MJAGENCY · LE PORT${meta.tache ? ` · tâche « ${escapeHtml(meta.tache)} »` : ""}</footer>
</body></html>`;
}

export const MIME: Record<FichierType, string> = {
  md: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
  csv: "text/csv;charset=utf-8",
  html: "text/html;charset=utf-8",
  json: "application/json;charset=utf-8",
};

/** Nom de fichier sûr, avec la bonne extension. */
export function nomFichier(nom: string, type: FichierType): string {
  const base = nom
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "fichier";
  return base.toLowerCase().endsWith(`.${type}`) ? base : `${base.replace(/\.[a-z0-9]{1,5}$/i, "")}.${type}`;
}

export function slug(s: string): string {
  return nomFichier(s, "md").replace(/\.md$/, "").toLowerCase().slice(0, 50);
}
