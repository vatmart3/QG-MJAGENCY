import { agentById, agentsOfPole, poleById } from "@/data/catalog";
import { STATE_ICON, STATE_LABEL } from "@/data/types";
import { FLUX_STYLE } from "@/lib/flux";
import type { AgentRuntime, Bubble, FlowLink } from "@/store/world";
import { iso, type Layout } from "./layout";

/**
 * Couche DOM au-dessus du canvas : étiquettes des pôles, bulles de dialogue,
 * info-bulle au survol. Texte net quel que soit le zoom.
 */

interface Label {
  el: HTMLButtonElement;
  count: HTMLSpanElement;
  wx: number;
  wy: number;
  lastCount: string;
  zone: string;
}

interface LinkEl {
  g: SVGGElement;
  path: SVGPathElement;
  glow: SVGPathElement;
  dot: SVGCircleElement;
  chip: HTMLDivElement;
}

const SVG_NS = "http://www.w3.org/2000/svg";

interface BubbleEl {
  el: HTMLDivElement;
  id: number;
}

export class Overlay {
  private labels: Label[] = [];
  private bubbles = new Map<string, BubbleEl>();
  private tooltip: HTMLDivElement;
  private lastTooltip = "";
  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private links = new Map<string, LinkEl>();

  constructor(
    host: HTMLElement,
    layout: Layout,
    onZoneClick: (zoneId: string) => void,
    pharePos: { x: number; y: number },
  ) {
    const root = document.createElement("div");
    root.className = "overlay-layer";
    host.appendChild(root);
    this.root = root;
    // liaisons entre agents (sous les étiquettes et les bulles)
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "flow-layer");
    this.svg.setAttribute("aria-hidden", "true");
    root.appendChild(this.svg);
    for (const z of layout.zones) {
      const pole = poleById(z.id);
      if (!pole) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = `pole-label ${pole.kind === "lieu" ? "is-lieu" : ""}`;
      el.style.setProperty("--pole", pole.couleur);
      el.setAttribute("aria-label", `Ouvrir la fiche ${pole.nom}`);
      el.innerHTML = `<span class="pl-ico">${pole.icone}</span><span class="pl-name">${pole.nom}</span>`;
      const count = document.createElement("span");
      count.className = "pl-count";
      el.appendChild(count);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onZoneClick(z.id);
      });
      root.appendChild(el);
      const glass = z.walls === "verre";
      const c = iso(z.x + z.w / 2, z.y + z.h / 2);
      this.labels.push({ el, count, wx: c.x, wy: c.y - (glass ? 64 : 50), lastCount: "", zone: z.id });
    }
    // le phare
    const el = document.createElement("button");
    el.type = "button";
    el.className = "pole-label is-lieu is-phare";
    el.style.setProperty("--pole", "#d8433a");
    el.innerHTML = `<span class="pl-ico">🗼</span><span class="pl-name">Le Phare</span>`;
    const count = document.createElement("span");
    count.className = "pl-count";
    el.appendChild(count);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      onZoneClick("phare");
    });
    root.appendChild(el);
    this.labels.push({ el, count, wx: pharePos.x, wy: pharePos.y - 130, lastCount: "", zone: "phare" });

    this.tooltip = document.createElement("div");
    this.tooltip.className = "agent-tooltip";
    this.tooltip.style.display = "none";
    root.appendChild(this.tooltip);
  }

  update(params: {
    toScreen: (x: number, y: number) => { x: number; y: number };
    scale: number;
    heads: Map<string, { x: number; y: number; hidden: boolean }>;
    bubbles: Record<string, Bubble>;
    presence: Record<string, number>;
    pending: number;
    agents: Record<string, AgentRuntime>;
    hover: string | null;
    now: number;
    links: FlowLink[];
  }): void {
    const { toScreen, scale, heads, bubbles, presence, pending, agents, hover, now, links } = params;
    this.updateLinks(links, heads, toScreen, scale, now);
    const compact = scale < 0.9;
    this.root.dataset.compact = compact ? "1" : "0";
    this.root.dataset.medium = !compact && scale < 1.5 ? "1" : "0";
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;

    for (const l of this.labels) {
      const s = toScreen(l.wx, l.wy);
      const visible = s.x > -120 && s.x < W + 120 && s.y > -40 && s.y < H + 60;
      l.el.style.visibility = visible ? "visible" : "hidden";
      if (visible) l.el.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0) translate(-50%, -100%)`;
      let text: string;
      if (l.zone === "phare") text = pending > 0 ? `${pending} en attente` : "calme";
      else if (l.zone === "douane") text = `${pending} à valider`;
      else {
        const pole = poleById(l.zone);
        if (pole?.kind === "pole") text = `${presence[l.zone] ?? 0}/${agentsOfPole(l.zone).length} au poste`;
        else text = `${presence[l.zone] ?? 0} présent${(presence[l.zone] ?? 0) > 1 ? "s" : ""}`;
      }
      if (text !== l.lastCount) {
        l.lastCount = text;
        l.count.textContent = text;
        l.el.classList.toggle("is-alert", (l.zone === "douane" || l.zone === "phare") && pending > 0);
      }
    }

    // bulles
    const seen = new Set<string>();
    for (const [agentId, b] of Object.entries(bubbles)) {
      if (b.until < now) continue;
      const head = heads.get(agentId);
      if (!head || head.hidden) continue;
      seen.add(agentId);
      let be = this.bubbles.get(agentId);
      if (!be || be.id !== b.id) {
        be?.el.remove();
        const el = document.createElement("div");
        el.className = "speech";
        el.innerHTML = `<b>${agentById(agentId)?.nom ?? ""}</b><span></span>`;
        (el.querySelector("span") as HTMLSpanElement).textContent = b.text;
        el.style.setProperty("--pole", poleById(agentById(agentId)?.pole ?? "")?.couleur ?? "#888");
        this.root.appendChild(el);
        be = { el, id: b.id };
        this.bubbles.set(agentId, be);
      }
      const s = toScreen(head.x, head.y);
      be.el.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y - 6)}px, 0) translate(-50%, -100%)`;
      be.el.classList.toggle("is-leaving", b.until - now < 250);
    }
    for (const [id, be] of this.bubbles) {
      if (!seen.has(id)) {
        be.el.remove();
        this.bubbles.delete(id);
      }
    }

    // info-bulle
    if (hover) {
      const head = heads.get(hover);
      const rt = agents[hover];
      const a = agentById(hover);
      if (head && rt && a && !head.hidden) {
        const key = `${hover}|${rt.state}|${rt.task?.title ?? ""}`;
        if (key !== this.lastTooltip) {
          this.lastTooltip = key;
          const task = rt.task ? `<em>${escapeHtml(rt.task.title)}</em>` : "";
          this.tooltip.innerHTML = `<b>${STATE_ICON[rt.state]} ${a.nom}</b><small>${a.role} · ${STATE_LABEL[rt.state]}</small>${task}`;
        }
        const s = toScreen(head.x, head.y);
        this.tooltip.style.display = "flex";
        this.tooltip.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y + 34 * scale + 8)}px, 0) translate(-50%, 0)`;
        return;
      }
    }
    if (this.tooltip.style.display !== "none") {
      this.tooltip.style.display = "none";
      this.lastTooltip = "";
    }
  }

  private updateLinks(
    links: FlowLink[],
    heads: Map<string, { x: number; y: number; hidden: boolean }>,
    toScreen: (x: number, y: number) => { x: number; y: number },
    scale: number,
    now: number,
  ): void {
    const seen = new Set<string>();
    for (const l of links) {
      if (l.until < now) continue;
      const a = heads.get(l.from);
      const b = heads.get(l.to);
      if (!a || !b || a.hidden || b.hidden) continue;
      seen.add(l.id);
      let el = this.links.get(l.id);
      const st = FLUX_STYLE[l.type];
      if (!el) {
        const g = document.createElementNS(SVG_NS, "g");
        const glow = document.createElementNS(SVG_NS, "path");
        glow.setAttribute("class", "flow-glow");
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("class", "flow-path");
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("class", "flow-dot");
        dot.setAttribute("r", "4.5");
        g.style.setProperty("--flow", st.color);
        g.append(glow, path, dot);
        this.svg.appendChild(g);
        const chip = document.createElement("div");
        chip.className = "flow-chip";
        chip.style.setProperty("--flow", st.color);
        chip.innerHTML = `<span>${st.icon}</span><span class="fc-l"> ${st.label}</span>`;
        this.root.appendChild(chip);
        el = { g, path, glow, dot, chip };
        this.links.set(l.id, el);
      }
      const s = toScreen(a.x, a.y - 4);
      const e = toScreen(b.x, b.y - 4);
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      const dist = Math.hypot(dx, dy) || 1;
      // arc vers le haut, proportionnel à la distance
      const lift = Math.min(160, 24 + dist * 0.28) * Math.max(0.6, Math.min(1.4, scale));
      const cx = (s.x + e.x) / 2;
      const cy = (s.y + e.y) / 2 - lift;
      const d = `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)}`;
      el.path.setAttribute("d", d);
      el.glow.setAttribute("d", d);
      // point lumineux qui voyage de l'émetteur au destinataire
      const t = ((now - l.at) % 1300) / 1300;
      const u = 1 - t;
      el.dot.setAttribute("cx", (u * u * s.x + 2 * u * t * cx + t * t * e.x).toFixed(1));
      el.dot.setAttribute("cy", (u * u * s.y + 2 * u * t * cy + t * t * e.y).toFixed(1));
      const life = Math.min(1, (now - l.at) / 300, (l.until - now) / 600);
      el.g.style.opacity = String(Math.max(0, life));
      // étiquette au sommet de l'arc
      const mx = 0.25 * s.x + 0.5 * cx + 0.25 * e.x;
      const my = 0.25 * s.y + 0.5 * cy + 0.25 * e.y;
      el.chip.style.opacity = String(Math.max(0, life));
      el.chip.style.transform = `translate3d(${Math.round(mx)}px, ${Math.round(my)}px, 0) translate(-50%, -50%)`;
    }
    for (const [id, el] of this.links) {
      if (seen.has(id)) continue;
      el.g.remove();
      el.chip.remove();
      this.links.delete(id);
    }
  }

  destroy(): void {
    this.root.remove();
    this.links.clear();
    this.bubbles.clear();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
