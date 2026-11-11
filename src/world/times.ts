import { CanvasSource, Container, Sprite, Texture } from "pixi.js";
import { agentById, allAgents } from "@/data/catalog";
import type { WorldState } from "@/store/world";
import { iso, tourDe, type Prop } from "./layout";
import { ecransTimes, type EcranGeom } from "./sprites/newyork";

/**
 * « Times Square » du style New York : écrans géants sur la tour centrale du fond de la ville.
 * Écran droit : les infos du port en direct (agents au travail, Douane, tâches, dernière action).
 * Écran gauche : les offres de MJAGENCY (Carte des offres). Bandeau : ce que viennent de faire les agents.
 * Rendu dans un petit canvas (4 px de canvas par px du monde), posé sur la façade avec une inclinaison iso.
 */

const K = 4;
const FONT = '"Pixelify Sans", "Silkscreen", ui-monospace, monospace';
const SLIDE_S = 5;

const PUBS: { titre: string; prix: string; sous: string; fond: [string, string]; accent: string }[] = [
  { titre: "SITE VITRINE", prix: "DÈS 890 €", sous: "EN LIGNE EN 7 JOURS", fond: ["#1b1f6b", "#6b1fa8"], accent: "#ffd34d" },
  { titre: "PACK VISIBILITÉ", prix: "1 590 €", sous: "+ 329 €/MOIS · SITE + RÉSEAUX", fond: ["#7a1238", "#e0475f"], accent: "#ffffff" },
  { titre: "AVIS GOOGLE", prix: "149 €", sous: "CARTE NFC · UN TAP = UN AVIS", fond: ["#0b5d4b", "#18a07a"], accent: "#fff3a0" },
  { titre: "AGENT IA", prix: "490 €", sous: "+ 49 €/MOIS · RÉPOND 24 H/24", fond: ["#10243f", "#2f6fd6"], accent: "#8ff0ff" },
  { titre: "MJAGENCY.EU", prix: "SÈTE ⚓", sous: "L'AGENCE WEB DES COMMERÇANTS", fond: ["#2b1a0e", "#c8553d"], accent: "#ffd27a" },
];

interface Ecran {
  g: EcranGeom;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  source: CanvasSource;
  sprite: Sprite;
  glow: Sprite | null;
}

export class EcranGeant {
  private ecrans: Ecran[] = [];
  private t = 0;
  private dernier = -1;

  /** @param cache dit si un point du monde (x, y en px) est masqué par un bâtiment situé devant */
  constructor(objects: Container, lights: Container, tour: Prop, cache: (x: number, y: number) => boolean) {
    const w = tour.w ?? 3;
    const h = tour.h ?? 3;
    const { hauteur } = tourDe(tour.variant ?? 0);
    const zTour = iso(tour.x + w - 0.5, tour.y + h - 0.5).y;
    for (const g of ecransTimes(w, h, hauteur)) {
      const span = (g.a1 - g.a0) * 16;
      const haut = g.z1 - g.z0;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(8, Math.round(span * K));
      canvas.height = Math.max(8, Math.round(haut * K));
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      const source = new CanvasSource({ resource: canvas, scaleMode: "linear" });
      const tex = new Texture({ source });
      const theta = g.face === "R" ? Math.atan2(-8, 16) : Math.atan2(8, 16);
      // coin haut-gauche à l'écran : façade droite → bout « v » le plus grand ; façade gauche → bout « u » le plus petit
      const p0 = g.face === "R" ? iso(tour.x + w - 0.09, tour.y + g.a1) : iso(tour.x + g.a0, tour.y + h - 0.09);
      const place = (s: Sprite) => {
        s.position.set(p0.x, p0.y - g.z1);
        s.skew.set(0, theta);
        s.scale.set(span / (canvas.width * Math.cos(theta)), haut / canvas.height);
      };
      const sprite = new Sprite(tex);
      place(sprite);
      sprite.zIndex = zTour + 0.5;
      objects.addChild(sprite);
      // halo la nuit, sauf si un bâtiment devant cache l'écran
      const p1 = g.face === "R" ? iso(tour.x + w - 0.09, tour.y + g.a0) : iso(tour.x + g.a1, tour.y + h - 0.09);
      const coins = [
        [p0.x, p0.y - g.z1],
        [p0.x, p0.y - g.z0],
        [p1.x, p1.y - g.z1],
        [p1.x, p1.y - g.z0],
      ];
      let glow: Sprite | null = null;
      if (!coins.some(([x, y]) => cache(x!, y!))) {
        glow = new Sprite(tex);
        place(glow);
        glow.alpha = 0;
        lights.addChild(glow);
      }
      this.ecrans.push({ g, canvas, ctx, source, sprite, glow });
    }
  }

  update(dt: number, st: WorldState, night: number, heure: number): void {
    this.t += dt;
    for (const e of this.ecrans) if (e.glow) e.glow.alpha = night * 0.7;
    // 8 images par seconde suffisent (bandeau défilant)
    const frame = Math.floor(this.t * 8);
    if (frame === this.dernier) return;
    this.dernier = frame;
    for (const e of this.ecrans) {
      if (e.g.role === "infos") this.infos(e, st, heure);
      else if (e.g.role === "pubs") this.pubs(e);
      else this.bandeau(e, st);
      e.source.update();
    }
  }

  // ---------------------------------------------------------------- écran des infos du port
  private infos(e: Ecran, st: WorldState, heure: number): void {
    const { ctx, canvas } = e;
    const W = canvas.width, H = canvas.height;
    const agents = Object.values(st.agents);
    const auTravail = agents.filter((a) => a.state === "working").length;
    const enLigne = agents.filter((a) => a.state !== "offline").length;
    const enCours = st.tasks.filter((t) => t.status === "running" || t.status === "queued" || t.status === "waiting_tool").length;
    const douane = st.approvals.length;
    const dernier = st.journal.find((j) => j.agentId);
    const slides = ["port", "travail", "douane", "taches", ...(dernier ? ["action"] : [])];
    const i = Math.floor(this.t / SLIDE_S) % slides.length;
    const k = (this.t % SLIDE_S) / SLIDE_S;
    const fonds: Record<string, [string, string]> = { port: ["#0d1640", "#2a3fa8"], travail: ["#06302a", "#119c74"], douane: ["#3a0b14", "#c0392b"], taches: ["#24104a", "#7a3fd6"], action: ["#101423", "#3a4766"] };
    const [c1, c2] = fonds[slides[i]!]!;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // trame LED
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    const hh = String(Math.floor(heure)).padStart(2, "0"), mm = String(Math.floor((heure % 1) * 60)).padStart(2, "0");
    const titre = (t: string, y: number, size: number, col = "#ffffff") => texte(ctx, t, W / 2, y, size, col, W * 0.92);
    const s = slides[i]!;
    if (s === "port") {
      titre("LE PORT", H * 0.34, H * 0.26, "#ffd34d");
      titre("MJAGENCY · SÈTE", H * 0.58, H * 0.11);
      titre(`${hh}:${mm}`, H * 0.8, H * 0.15, "#8ff0ff");
    } else if (s === "travail") {
      titre("AU TRAVAIL", H * 0.2, H * 0.12, "#b8ffe4");
      titre(String(auTravail), H * 0.5, H * 0.36, "#ffffff");
      titre(`${enLigne} EN LIGNE SUR ${allAgents().length}`, H * 0.82, H * 0.1);
    } else if (s === "douane") {
      titre("LA DOUANE", H * 0.2, H * 0.12, "#ffd0c8");
      titre(douane ? String(douane) : "✓", H * 0.5, H * 0.36);
      titre(douane ? "À VALIDER" : "TOUT EST VALIDÉ", H * 0.82, H * 0.11);
    } else if (s === "taches") {
      titre("TÂCHES EN COURS", H * 0.2, H * 0.11, "#e2d0ff");
      titre(String(enCours), H * 0.5, H * 0.36);
      titre(`${st.missions.filter((m) => m.status !== "terminee" && m.status !== "annulee").length} MISSION(S)`, H * 0.82, H * 0.11);
    } else if (dernier) {
      const nom = (dernier.agentId && agentById(dernier.agentId)?.nom) || "LE PORT";
      titre("EN DIRECT", H * 0.15, H * 0.1, "#ff6b6b");
      titre(nom.toUpperCase(), H * 0.36, H * 0.17, "#ffd34d");
      const lignes = couper(ctx, dernier.title.replace(/^[^\p{L}\p{N}]+/u, ""), W * 0.88, H * 0.1);
      lignes.slice(0, 3).forEach((l, j) => titre(l, H * (0.58 + j * 0.14), H * 0.1));
    }
    // fondu entre deux images
    if (k < 0.08 || k > 0.94) {
      ctx.fillStyle = `rgba(0,0,0,${k < 0.08 ? 1 - k / 0.08 : (k - 0.94) / 0.06})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------------------------------------------------------- écran des pubs (offres de MJAGENCY)
  private pubs(e: Ecran): void {
    const { ctx, canvas } = e;
    const W = canvas.width, H = canvas.height;
    const i = Math.floor(this.t / SLIDE_S) % PUBS.length;
    const p = PUBS[i]!;
    const k = (this.t % SLIDE_S) / SLIDE_S;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, p.fond[0]);
    g.addColorStop(1, p.fond[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // rayons animés
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#ffffff";
    for (let j = 0; j < 6; j++) {
      const x = ((j / 6 + this.t * 0.08) % 1) * W * 1.6 - W * 0.3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + W * 0.12, 0);
      ctx.lineTo(x - W * 0.2, H);
      ctx.lineTo(x - W * 0.32, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    const entree = Math.min(1, k / 0.12);
    texte(ctx, p.titre, W / 2 - (1 - entree) * W, H * 0.27, H * 0.17, "#ffffff", W * 0.92);
    // le prix clignote doucement
    const pulse = 1 + Math.sin(this.t * 5) * 0.04;
    texte(ctx, p.prix, W / 2, H * 0.56, H * 0.25 * pulse, p.accent, W * 0.92);
    texte(ctx, p.sous, W / 2, H * 0.83, H * 0.09, "#ffffff", W * 0.92);
    if (k > 0.94) {
      ctx.fillStyle = `rgba(255,255,255,${(k - 0.94) / 0.06})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------------------------------------------------------- bandeau défilant
  private bandeau(e: Ecran, st: WorldState): void {
    const { ctx, canvas } = e;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#07080d";
    ctx.fillRect(0, 0, W, H);
    const items = st.journal
      .filter((j) => j.agentId)
      .slice(0, 8)
      .map((j) => `${(agentById(j.agentId!)?.nom ?? "").toUpperCase()} · ${j.title.replace(/^[^\p{L}\p{N}]+/u, "")}`);
    const msg = (items.length ? items : ["LE PORT · 39 AGENTS AU SERVICE DES COMMERÇANTS DE SÈTE", "SITE VITRINE DÈS 890 €", "MJAGENCY.EU"]).join("   ✦   ") + "   ✦   ";
    ctx.font = `600 ${Math.round(H * 0.7)}px ${FONT}`;
    ctx.textBaseline = "middle";
    const largeur = ctx.measureText(msg).width;
    const x = -((this.t * 26 * K) % largeur);
    ctx.fillStyle = "#ffcf4a";
    ctx.fillText(msg, x, H / 2 + 1);
    ctx.fillText(msg, x + largeur, H / 2 + 1);
  }
}

function texte(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, col: string, max: number): void {
  let s = Math.round(size);
  ctx.font = `700 ${s}px ${FONT}`;
  while (s > 6 && ctx.measureText(t).width > max) {
    s -= 1;
    ctx.font = `700 ${s}px ${FONT}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillText(t, x + Math.max(1, s * 0.06), y + Math.max(1, s * 0.06));
  ctx.fillStyle = col;
  ctx.fillText(t, x, y);
}

function couper(ctx: CanvasRenderingContext2D, t: string, max: number, size: number): string[] {
  ctx.font = `700 ${Math.round(size)}px ${FONT}`;
  const mots = t.toUpperCase().split(/\s+/);
  const out: string[] = [];
  let l = "";
  for (const m of mots) {
    const essai = l ? `${l} ${m}` : m;
    if (ctx.measureText(essai).width > max && l) {
      out.push(l);
      l = m;
    } else l = essai;
  }
  if (l) out.push(l);
  return out;
}
