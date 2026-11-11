"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { makeZip } from "@/lib/zip";

/**
 * Carrousel Instagram / LinkedIn écrit par Chloé (fichier JSON joint au compte rendu), dessiné ici en images
 * 1080 × 1350 aux couleurs de MJAGENCY : aperçu et téléchargement des PNG. Gratuit, aucun outil externe.
 *
 * Format : { "format": "carrousel", "theme": "bleu" | "nuit" | "soleil" | "menthe", "slides": [{ "titre", "texte", "emoji" }] }
 */

export interface Slide {
  titre: string;
  texte?: string;
  emoji?: string;
}
export interface CarrouselSpec {
  theme?: string;
  slides: Slide[];
}

export function lireCarrousel(contenu: string): CarrouselSpec | null {
  try {
    const j = JSON.parse(contenu) as { format?: string; theme?: string; slides?: unknown };
    if (!Array.isArray(j.slides) || !j.slides.length) return null;
    const slides = (j.slides as Record<string, unknown>[])
      .map((s) => ({ titre: String(s.titre ?? "").slice(0, 120), texte: s.texte ? String(s.texte).slice(0, 400) : undefined, emoji: s.emoji ? String(s.emoji).slice(0, 8) : undefined }))
      .filter((s) => s.titre)
      .slice(0, 10);
    return slides.length ? { theme: j.theme, slides } : null;
  } catch {
    return null;
  }
}

const THEMES: Record<string, { fond: [string, string]; texte: string; accent: string; doux: string }> = {
  bleu: { fond: ["#0071E3", "#003f80"], texte: "#ffffff", accent: "#ffd34d", doux: "rgba(255,255,255,.78)" },
  nuit: { fond: ["#16171b", "#2a2e36"], texte: "#f4f5f8", accent: "#2f95ff", doux: "rgba(244,245,248,.72)" },
  soleil: { fond: ["#fff4e0", "#ffd9a8"], texte: "#16171b", accent: "#0071E3", doux: "rgba(22,23,27,.72)" },
  menthe: { fond: ["#e5f4ea", "#bfe6d0"], texte: "#123222", accent: "#0071E3", doux: "rgba(18,50,34,.75)" },
};

function lignes(ctx: CanvasRenderingContext2D, texte: string, largeur: number): string[] {
  const out: string[] = [];
  for (const para of texte.split("\n")) {
    let l = "";
    for (const mot of para.split(/\s+/)) {
      const essai = l ? `${l} ${mot}` : mot;
      if (ctx.measureText(essai).width > largeur && l) {
        out.push(l);
        l = mot;
      } else l = essai;
    }
    out.push(l);
  }
  return out;
}

/** Dessine une diapositive 1080 × 1350 dans le canvas. */
export function dessinerSlide(c: HTMLCanvasElement, s: Slide, i: number, n: number, theme = "bleu"): void {
  const W = 1080;
  const H = 1350;
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const t = THEMES[theme] ?? THEMES.bleu!;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, t.fond[0]);
  g.addColorStop(1, t.fond[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // formes décoratives
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = t.texte;
  ctx.beginPath();
  ctx.arc(W - 120, 170, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(80, H - 120, 180, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const font = '"Space Grotesk", "Poppins", system-ui, sans-serif';
  // en-tête
  ctx.fillStyle = t.texte;
  ctx.font = `700 46px ${font}`;
  ctx.fillText("MJ", 90, 130);
  ctx.fillStyle = t.accent;
  ctx.fillText(".", 90 + ctx.measureText("MJ").width, 130);
  ctx.fillStyle = t.doux;
  ctx.font = `500 30px ${font}`;
  ctx.textAlign = "right";
  ctx.fillText(`${i + 1} / ${n}`, W - 90, 128);
  ctx.textAlign = "left";
  // emoji
  let y = 330;
  if (s.emoji) {
    ctx.font = `150px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.fillText(s.emoji, 86, y);
    y += 120;
  }
  // titre
  ctx.fillStyle = t.texte;
  const tailleTitre = s.titre.length > 60 ? 70 : s.titre.length > 35 ? 84 : 100;
  ctx.font = `700 ${tailleTitre}px ${font}`;
  for (const l of lignes(ctx, s.titre, W - 180)) {
    y += tailleTitre * 1.08;
    ctx.fillText(l, 90, y);
  }
  // soulignement
  y += 34;
  ctx.fillStyle = t.accent;
  ctx.fillRect(90, y, 120, 10);
  // texte
  if (s.texte) {
    y += 70;
    ctx.fillStyle = t.doux;
    ctx.font = `500 40px ${font}`;
    for (const l of lignes(ctx, s.texte, W - 180).slice(0, 10)) {
      ctx.fillText(l, 90, y);
      y += 56;
    }
  }
  // pied
  ctx.fillStyle = t.doux;
  ctx.font = `600 30px ${font}`;
  ctx.fillText("mjagency.eu · Sète", 90, H - 90);
  if (i < n - 1) {
    ctx.textAlign = "right";
    ctx.fillStyle = t.texte;
    ctx.fillText("Glisse →", W - 90, H - 90);
    ctx.textAlign = "left";
  }
}

function blob(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error("image"))), "image/png"));
}

export function CarrouselView({ spec, nom }: { spec: CarrouselSpec; nom: string }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [busy, setBusy] = useState(false);
  const theme = useMemo(() => spec.theme ?? "bleu", [spec.theme]);
  useEffect(() => {
    // les polices doivent être prêtes avant de dessiner
    void (document.fonts?.ready ?? Promise.resolve()).then(() => spec.slides.forEach((s, i) => refs.current[i] && dessinerSlide(refs.current[i]!, s, i, spec.slides.length, theme)));
  }, [spec, theme]);
  const telecharger = async () => {
    setBusy(true);
    try {
      const files = await Promise.all(refs.current.slice(0, spec.slides.length).map(async (c, i) => ({ name: `${nom.replace(/\.json$/i, "")}-${i + 1}.png`, content: await blob(c!) })));
      const z = makeZip(files);
      const url = URL.createObjectURL(new Blob([z as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nom.replace(/\.json$/i, "")}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-t border-paper-edge px-3 py-2">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {spec.slides.map((_, i) => (
          <canvas key={i} ref={(el) => void (refs.current[i] = el)} className="h-[200px] w-[160px] shrink-0 rounded-lg shadow" style={{ aspectRatio: "1080 / 1350" }} />
        ))}
      </div>
      <button type="button" disabled={busy} onClick={() => void telecharger()} className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50">
        {busy ? "Préparation…" : `🖼️ Télécharger les ${spec.slides.length} images (PNG)`}
      </button>
      <span className="ml-2 text-[11px] text-ink-soft">1080 × 1350, prêtes pour Instagram et LinkedIn</span>
    </div>
  );
}
