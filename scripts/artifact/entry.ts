/**
 * Point d'entrée autonome de la ville (mode démo) pour la page de présentation.
 * Même code que l'appli : Game + directeur de démo, sans Next.js ni Supabase.
 */
import { SEED_CATALOG, agentById, poleById, setCatalog } from "@/data/catalog";
import { STATE_ICON, STATE_LABEL } from "@/data/types";
import { getDirector } from "@/sim/director";
import { uiStore } from "@/store/ui";
import { world, worldStore } from "@/store/world";
import { Game } from "@/world/Game";

declare global {
  interface Window {
    LePort: {
      mission(text: string): void;
      heure(h: number | null): void;
      zoom(dir: 1 | -1): void;
    };
  }
}

async function boot() {
  const host = document.getElementById("ville");
  const overlay = document.getElementById("ville-overlay");
  const card = document.getElementById("fiche");
  if (!host || !overlay || !card) return;
  setCatalog(SEED_CATALOG);
  const game = await Game.create(host, overlay, {
    onZoneClick: (zoneId) => {
      game.flyToZone(zoneId);
      const p = poleById(zoneId === "phare" ? "douane" : zoneId);
      if (p) showPole(p.nom, p.description, p.icone);
    },
  });
  getDirector().start("demo");
  document.getElementById("ville-chargement")?.remove();

  const showPole = (nom: string, desc: string, icone: string) => {
    card.hidden = false;
    card.innerHTML = `<div class="fiche-tete"><span class="fiche-ico">${icone}</span><div><b>${nom}</b><small>Pôle</small></div></div><p>${desc}</p>`;
  };

  const renderAgent = () => {
    const id = uiStore.getState().selectedAgent;
    if (!id) return;
    const a = agentById(id);
    const rt = worldStore.getState().agents[id];
    if (!a || !rt) return;
    const pole = poleById(a.pole);
    const steps = rt.task?.steps.map((s) => `<li class="${s.done ? "ok" : ""}">${s.done ? "✓" : "·"} ${s.label}</li>`).join("") ?? "";
    card.hidden = false;
    card.innerHTML = `<div class="fiche-tete"><span class="fiche-ico">${pole?.icone ?? ""}</span><div><b>${a.nom}</b><small>${a.role} · ${pole?.nom ?? ""}</small></div></div>
      <p class="etat">${STATE_ICON[rt.state]} ${STATE_LABEL[rt.state]}</p>
      <p class="perso">« ${a.personnalite} »</p>
      ${rt.task ? `<p class="tache">${rt.task.title}</p><ul>${steps}</ul>` : ""}`;
  };
  uiStore.subscribe((s, p) => {
    if (s.selectedAgent !== p.selectedAgent) {
      if (s.selectedAgent) {
        game.flyToAgent(s.selectedAgent);
        renderAgent();
      } else card.hidden = true;
    }
  });
  setInterval(renderAgent, 1000);

  const pending = document.getElementById("compteur-douane");
  const online = document.getElementById("compteur-ligne");
  setInterval(() => {
    const s = worldStore.getState();
    if (pending) pending.textContent = String(s.approvals.length);
    if (online) online.textContent = String(Object.values(s.agents).filter((x) => x.state !== "offline").length);
  }, 800);

  window.LePort = {
    mission(text) {
      getDirector().submitMission(text);
      const tag = text.match(/@([\p{L}]+)/u)?.[1]?.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
      setTimeout(() => game.flyToAgent(tag && agentById(tag) ? tag : "marius"), 250);
    },
    heure(h) {
      world.setClockOverride(h);
    },
    zoom(dir) {
      game.zoomStep(dir);
    },
  };
}

void boot();
