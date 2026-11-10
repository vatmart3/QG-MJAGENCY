"use client";

import { agentById, poleById } from "@/data/catalog";
import { MIME, nomFichier, rapportHtmlDocument, rapportVersMarkdown, slug, type RapportFichier, type RapportMeta } from "@/lib/rapport";
import { makeZip } from "@/lib/zip";
import type { RapportItem } from "@/store/world";
import { world } from "@/store/world";

export function metaOf(item: RapportItem): RapportMeta {
  const a = agentById(item.agentId);
  const mission = item.missionId ? world.get().missions.find((m) => m.id === item.missionId)?.text : undefined;
  return { agentNom: a?.nom ?? item.agentId, agentRole: a?.role, pole: poleById(a?.pole ?? "")?.nom, date: item.at, mission, tache: item.tache };
}

function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const baseName = (item: RapportItem) => {
  const d = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date(item.at));
  return `${d}-${slug(agentById(item.agentId)?.nom ?? item.agentId)}-${slug(item.rapport.titre)}`;
};

export function downloadFichier(f: RapportFichier): void {
  // BOM pour que les accents d'un CSV s'ouvrent bien dans Excel
  saveBlob(nomFichier(f.nom, f.type), new Blob([f.type === "csv" ? "\uFEFF" : "", f.contenu], { type: MIME[f.type] }));
}

export function downloadMarkdown(item: RapportItem): void {
  saveBlob(`${baseName(item)}.md`, new Blob([rapportVersMarkdown(item.rapport, metaOf(item))], { type: MIME.md }));
}

/** Compte rendu + fichiers joints dans une seule archive .zip. */
export function downloadZip(item: RapportItem): void {
  const base = baseName(item);
  const used = new Set<string>();
  const files = [
    { name: `${base}/compte-rendu.html`, content: rapportHtmlDocument(item.rapport, metaOf(item), { boutonImprimer: true }) },
    { name: `${base}/compte-rendu.md`, content: rapportVersMarkdown(item.rapport, metaOf(item)) },
    ...(item.rapport.fichiers ?? []).map((f) => {
      let n = nomFichier(f.nom, f.type);
      for (let i = 2; used.has(n); i++) n = nomFichier(`${f.nom.replace(/\.[a-z0-9]+$/i, "")}-${i}`, f.type);
      used.add(n);
      return { name: `${base}/fichiers/${n}`, content: (f.type === "csv" ? "﻿" : "") + f.contenu };
    }),
  ];
  const zip = makeZip(files);
  saveBlob(`${base}.zip`, new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }));
}

/**
 * PDF : ouvre une page de compte rendu mise en forme et lance l'impression
 * (« Enregistrer au format PDF »). Si les fenêtres sont bloquées, on télécharge la page .html.
 */
export function printPdf(item: RapportItem): void {
  const html = rapportHtmlDocument(item.rapport, metaOf(item), { boutonImprimer: true });
  const w = window.open("", "_blank");
  if (!w) {
    saveBlob(`${baseName(item)}.html`, new Blob([html], { type: MIME.html }));
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
      // l'utilisateur garde le bouton « Imprimer / PDF » de la page
    }
  }, 350);
}
