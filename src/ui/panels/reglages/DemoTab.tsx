"use client";

import { useState } from "react";
import { useCatalog } from "@/data/catalog";
import { getRepo, resetDemoCatalog } from "@/data/repo";
import { STATE_LABEL, type AgentState } from "@/data/types";
import { hhmm } from "@/lib/paris";
import { browserSupabase } from "@/lib/supabase/client";
import { testBench } from "@/sync/live";
import { useUI } from "@/store/ui";
import { useWorld, world } from "@/store/world";
import { Field, Toggle, inputCls, useSaver } from "./fields";

const HOURS: { label: string; h: number | null }[] = [
  { label: "Heure réelle (Paris)", h: null },
  { label: "06:20 — Aube", h: 6.33 },
  { label: "08:29 — Juste avant le stand-up", h: 8.48 },
  { label: "12:00 — Plein jour", h: 12 },
  { label: "18:30 — Coucher de soleil", h: 18.5 },
  { label: "19:45 — Crépuscule", h: 19.75 },
  { label: "23:00 — Nuit", h: 23 },
];

export function DemoTab() {
  const override = useWorld((s) => s.clockOverride);
  const chatter = useWorld((s) => s.chatterEnabled);
  const fps = useUI((s) => s.fps);
  const conn = useUI((s) => s.conn);
  const live = conn !== "demo";

  return (
    <div className="space-y-4">
      <Field label="Heure affichée dans la ville" hint="Change seulement le ciel et l'éclairage (ici, sur cet écran).">
        <select className={inputCls} value={override === null ? "" : String(override)} onChange={(e) => world.setClockOverride(e.target.value === "" ? null : Number(e.target.value))}>
          {HOURS.map((h) => (
            <option key={h.label} value={h.h === null ? "" : String(h.h)}>
              {h.label}
            </option>
          ))}
        </select>
      </Field>
      {override !== null && <p className="-mt-2 text-xs text-ink-soft">Heure forcée : {hhmm(override)}.</p>}
      {!live && <Toggle checked={chatter} onChange={(v) => world.setChatter(v)} label="Bavardage de démo" hint="Répliques d'exemple entre agents" />}
      <p className="font-silk text-[9px] text-ink-soft">Rendu : {fps} i/s</p>

      {live ? <TestBench /> : <DemoReset />}
    </div>
  );
}

function DemoReset() {
  const saver = useSaver();
  return (
    <div className="rounded-2xl border border-paper-edge bg-white/60 p-3">
      <h4 className="text-sm font-bold">Mode démo</h4>
      <p className="mt-1 text-[13px] text-ink-soft">
        Supabase n&apos;est pas branché : tes modifications (agents, pôles, routines, mémoire, réglages) sont enregistrées dans ce navigateur seulement.
      </p>
      <button
        type="button"
        onClick={() => window.confirm("Revenir au seed d'origine ? Les modifications faites dans ce navigateur seront perdues.") && void saver.run(async () => resetDemoCatalog(), "Seed d'origine restauré")}
        className="mt-2 rounded-full border border-ink/15 px-3 py-1.5 text-[13px]"
      >
        Réinitialiser le seed
      </button>
      {saver.message && <p className="mt-1 text-[12px] text-moss">{saver.message}</p>}
      <p className="mt-2 text-[11px] text-ink-soft">Dépôt actuel : {getRepo().kind === "demo" ? "navigateur" : "Supabase"}</p>
    </div>
  );
}

/** Banc d'essai temps réel : écrit dans la base pour voir la ville réagir (ici et sur les autres appareils). */
function TestBench() {
  const agents = useCatalog((s) => s.agents).filter((a) => a.actif);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [other, setOther] = useState(agents[1]?.id ?? "");
  const [etat, setEtat] = useState<AgentState>("working");
  const saver = useSaver();
  const sb = browserSupabase();
  if (!sb) return null;
  const nom = (id: string) => agents.find((a) => a.id === id)?.nom ?? id;
  const btn = "rounded-full border border-ink/15 px-3 py-1.5 text-[13px] transition hover:bg-ink/5 active:scale-95";

  return (
    <div className="rounded-2xl border border-paper-edge bg-white/60 p-3">
      <h4 className="text-sm font-bold">Banc d&apos;essai temps réel</h4>
      <p className="mt-1 text-[12px] text-ink-soft">
        Ces boutons écrivent dans Supabase, comme le fera le moteur d&apos;agents en Phase 3. Ouvre LE PORT sur ton téléphone en même temps : les deux écrans doivent bouger ensemble.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field label="Agent">
          <select className={inputCls} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nom}
              </option>
            ))}
          </select>
        </Field>
        <Field label="État">
          <div className="flex gap-1">
            <select className={inputCls} value={etat} onChange={(e) => setEtat(e.target.value as AgentState)}>
              {(["idle", "working", "meeting", "waiting_approval", "done", "offline"] as AgentState[]).map((s) => (
                <option key={s} value={s}>
                  {STATE_LABEL[s]}
                </option>
              ))}
            </select>
            <button type="button" className={btn} onClick={() => void saver.run(() => testBench.setState(sb, agentId, etat), `${nom(agentId)} → ${STATE_LABEL[etat]}`)}>
              OK
            </button>
          </div>
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={btn} onClick={() => void saver.run(() => testBench.task(sb, agentId, "Tâche de test temps réel"), "Tâche créée")}>
          ✍️ Lui donner une tâche test
        </button>
        <button type="button" className={btn} onClick={() => void saver.run(() => testBench.approval(sb, agentId), "Élément déposé en Douane")}>
          📦 Déposer en Douane
        </button>
        <button type="button" className={btn} onClick={() => void saver.run(() => testBench.setState(sb, agentId, "idle"), "Retour au calme")}>
          ☕ Remettre au calme
        </button>
      </div>
      <div className="mt-3 flex items-end gap-2">
        <Field label="Conversation avec">
          <select className={inputCls} value={other} onChange={(e) => setOther(e.target.value)}>
            {agents
              .filter((a) => a.id !== agentId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nom}
                </option>
              ))}
          </select>
        </Field>
        <button
          type="button"
          className={`${btn} shrink-0`}
          onClick={() =>
            void saver.run(async () => {
              await testBench.conversation(sb, agentId, other, [
                [agentId, `${nom(other)}, tu m'entends ? C'est un test du temps réel.`],
                [other, "Cinq sur cinq ! La bulle vient de la base."],
                [agentId, "Parfait, on retourne au travail."],
              ]);
              await testBench.setState(sb, agentId, "idle");
              await testBench.setState(sb, other, "idle");
            }, "Conversation jouée")
          }
        >
          💬 Lancer
        </button>
      </div>
      {saver.message && <p className={`mt-2 text-[12px] ${saver.status === "error" ? "text-phare" : "text-moss"}`}>{saver.message}</p>}
    </div>
  );
}
