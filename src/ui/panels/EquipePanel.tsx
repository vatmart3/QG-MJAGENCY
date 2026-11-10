"use client";

import { AGENTS, POLES } from "@/data/seed";
import { STATE_ICON, STATE_LABEL } from "@/data/types";
import { useWorld } from "@/store/world";
import { ui } from "@/store/ui";
import { getGame } from "../gameRef";
import { useIsMobile } from "../hooks";
import { Portrait } from "../Portrait";
import { AgentSearch } from "../TopBar";
import { RoutePanel } from "./RoutePanel";

export function EquipePanel() {
  const agents = useWorld((s) => s.agents);
  const mobile = useIsMobile();
  const online = Object.values(agents).filter((a) => a.state !== "offline").length;

  return (
    <RoutePanel title="L'équipe" kicker={`${AGENTS.length} agents · ${online} en ligne`} icon="👥" accent="#4b4bb0">
      {mobile && (
        <div className="mb-3">
          <AgentSearch />
        </div>
      )}
      <div className="space-y-4">
        {POLES.map((p) => {
          const members = AGENTS.filter((a) => a.pole === p.id);
          return (
            <section key={p.id}>
              <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
                <span className="grid size-6 place-items-center rounded-lg text-sm" style={{ background: `color-mix(in srgb, ${p.couleur} 18%, white)` }}>
                  {p.icone}
                </span>
                {p.nom}
              </h3>
              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {members.map((a) => {
                  const rt = agents[a.id];
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          getGame()?.flyToAgent(a.id);
                          ui.selectAgent(a.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-xl border border-transparent px-2 py-1 text-left transition hover:border-paper-edge hover:bg-white/70"
                      >
                        <Portrait agentId={a.id} size={1.5} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold leading-tight">{a.nom}</span>
                          <span className="block truncate text-[11px] text-ink-soft">{a.role}</span>
                        </span>
                        <span title={rt ? STATE_LABEL[rt.state] : ""}>{rt ? STATE_ICON[rt.state] : ""}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </RoutePanel>
  );
}
