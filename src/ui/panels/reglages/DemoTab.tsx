"use client";

import { useEffect, useState } from "react";
import { useCatalog } from "@/data/catalog";
import { getRepo, resetDemoCatalog } from "@/data/repo";
import { STATE_LABEL, type AgentState } from "@/data/types";
import { hhmm } from "@/lib/paris";
import { browserSupabase } from "@/lib/supabase/client";
import { kickEngine, spentToday, testBench } from "@/sync/live";
import { useUI } from "@/store/ui";
import { useWorld, world } from "@/store/world";
import { useNow, useStyleVille } from "../../hooks";
import { choisirStyleVille, NOM_STYLE, type StyleVille } from "@/world/theme";
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
  const style = useStyleVille();

  return (
    <div className="space-y-4">
      <Field label="Style de la ville" hint="Change seulement le décor (sur cet appareil) : pôles, agents et missions restent les mêmes.">
        <select className={inputCls} value={style} onChange={(e) => choisirStyleVille(e.target.value as StyleVille)}>
          {(["newyork", "sete"] as StyleVille[]).map((s) => (
            <option key={s} value={s}>
              {s === "newyork" ? `${NOM_STYLE[s]} — gratte-ciel, avenues, taxis, brownstones` : `${NOM_STYLE[s]} — l'île d'origine, maisons et jardins`}
            </option>
          ))}
        </select>
      </Field>
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

      {live && <MoteurCard />}
      {live ? <TestBench /> : <DemoReset />}
    </div>
  );
}

/** État du moteur d'agents (mode direct). */
function MoteurCard() {
  const moteur = useUI((s) => s.moteur);
  const settings = useCatalog((s) => s.settings);
  const [depense, setDepense] = useState<number | null>(null);
  useEffect(() => {
    const sb = browserSupabase();
    if (!sb) return;
    let alive = true;
    const load = () => void spentToday(sb).then((v) => alive && setDepense(v));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [moteur.dernier]);
  const pct = depense === null ? 0 : Math.min(100, (depense / Math.max(0.01, settings.budgetJour)) * 100);
  return (
    <div className="rounded-2xl border border-paper-edge bg-white/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold">Moteur d&apos;agents</h4>
        <span className={`rounded-full px-2 py-0.5 font-silk text-[9px] ${moteur.kind === "anthropic" ? "bg-moss/15 text-moss" : "bg-phare/10 text-phare"}`}>
          {moteur.kind === "anthropic" ? "CLAUDE" : moteur.kind === "mock" ? "SIMULÉ" : "—"}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-ink-soft">
        {moteur.kind === "mock"
          ? "Sans clé API Anthropic, les agents suivent un scénario simulé (plans, échanges, livrables marqués « simulé »)."
          : moteur.kind === "anthropic"
            ? "Les agents réfléchissent avec Claude (Opus pour Marius, Sonnet pour la rédaction, Haiku pour le tri)."
            : "Le moteur n'a pas encore tourné depuis l'ouverture de cette page."}
      </p>
      <p className="mt-1 text-[12px] text-ink-soft">
        Dernier passage : {moteur.dernier ? new Date(moteur.dernier).toLocaleTimeString("fr-FR") : "jamais"}
        {moteur.erreur && <span className="block text-phare">⚠️ {moteur.erreur}</span>}
      </p>
      <div className="mt-2">
        <div className="flex justify-between text-[12px]">
          <span>Dépense IA du jour</span>
          <span className="tabular-nums">
            {depense === null ? "…" : `${depense.toFixed(2)} €`} / {settings.budgetJour} €
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/8">
          <div className={`h-full rounded-full ${pct >= 100 ? "bg-phare" : pct >= 80 ? "bg-amber-500" : "bg-moss"}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button type="button" disabled={moteur.enCours} onClick={() => void kickEngine()} className="mt-3 rounded-full border border-ink/15 px-3 py-1.5 text-[13px] disabled:opacity-50">
        {moteur.enCours ? "Le moteur tourne…" : "⚙️ Faire avancer le moteur"}
      </button>
      <PiloteAuto />
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

/** Pilote automatique : la base réveille le moteur toutes les 2 min, même LE PORT fermé. */
function PiloteAuto() {
  const now = useNow(30_000);
  const [p, setP] = useState<{ at: string; erreurs?: string[] } | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetch("/api/engine/status")
      .then((r) => r.json())
      .then((d: { pilote?: { at: string; erreurs?: string[] } | null }) => alive && setP(d.pilote ?? null))
      .catch(() => alive && setP(null));
    return () => {
      alive = false;
    };
  }, [now]);
  const age = p ? Math.round((now - new Date(p.at).getTime()) / 60_000) : null;
  const ok = age !== null && age <= 6;
  return (
    <div className={`mt-3 rounded-xl px-3 py-2 text-[12px] ${ok ? "bg-moss/10 text-moss" : "bg-amber-50 text-amber-800"}`}>
      {p === undefined
        ? "Pilote automatique : vérification…"
        : ok
          ? `✈️ Pilote automatique actif : dernier passage il y a ${age! < 1 ? "moins d'une minute" : `${age} min`}. Les agents travaillent même LE PORT fermé.`
          : p
            ? `Pilote automatique : dernier passage il y a ${age} min (attendu toutes les 2 min).`
            : "Pilote automatique : pas encore de passage enregistré."}
      {p?.erreurs?.length ? <span className="block text-phare">⚠️ {p.erreurs[0]}</span> : null}
    </div>
  );
}
