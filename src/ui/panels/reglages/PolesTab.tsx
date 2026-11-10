"use client";

import { Fragment, useState } from "react";
import { slugify, useCatalog } from "@/data/catalog";
import { getRepo } from "@/data/repo";
import type { Pole } from "@/data/types";
import { firstError, poleSchema } from "@/lib/schemas";
import { SLOTS } from "@/world/slots";
import { Field, ListRow, SaveBar, Toggle, inputCls, linesToList, useSaver } from "./fields";

const blank = (position: string, ordre: number): Pole => ({
  id: "",
  nom: "",
  court: "",
  icone: "✨",
  couleur: "#3a7bd5",
  sol: "#dce8f8",
  description: "",
  missions: [],
  kind: "pole",
  position,
  style: "muret",
  actif: true,
  ordre,
});

/** Mini-plan des emplacements (5 colonnes × 5 rangées, canal entre r3 et r4). */
function SlotPicker({ value, taken, onChange }: { value: string; taken: Map<string, string>; onChange: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-paper-edge bg-white/50 p-2">
      <div className="grid grid-cols-5 gap-1">
        {SLOTS.map((s, i) => {
          const owner = taken.get(s.id);
          const mine = s.id === value;
          return (
            <Fragment key={s.id}>
              {i === 15 && <div className="col-span-5 my-1 h-1.5 rounded-full bg-sea/40" aria-hidden />}
              <button
                type="button"
                disabled={!!owner && !mine}
                onClick={() => onChange(s.id)}
                title={owner ? `Occupé : ${owner}` : s.label}
                className={`h-7 rounded-md text-[10px] transition ${mine ? "bg-ink text-white" : owner ? "cursor-not-allowed bg-ink/10 text-ink-soft" : "bg-moss/15 text-moss hover:bg-moss/30"}`}
              >
                {mine ? "ici" : owner ? owner.slice(0, 6) : "libre"}
              </button>
            </Fragment>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-ink-soft">Rangées 1 à 3 : rive nord · 4 et 5 : rive sud (le trait bleu = le canal).</p>
    </div>
  );
}

export function PolesTab() {
  const poles = useCatalog((s) => s.poles);
  const [editing, setEditing] = useState<{ draft: Pole; isNew: boolean } | null>(null);
  const taken = new Set(poles.filter((p) => p.actif).map((p) => p.position));
  const free = SLOTS.find((s) => !taken.has(s.id));

  if (editing) return <PoleForm key={editing.draft.id || "nouveau"} initial={editing.draft} isNew={editing.isNew} onDone={() => setEditing(null)} />;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-ink-soft">{SLOTS.length - taken.size} emplacement(s) libre(s) sur l&apos;île</p>
        <button
          type="button"
          disabled={!free}
          onClick={() => free && setEditing({ draft: blank(free.id, poles.length), isNew: true })}
          className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
        >
          + Nouveau pôle
        </button>
      </div>
      <h4 className="mb-1 text-[12px] font-bold">Pôles</h4>
      <div className="grid grid-cols-2 gap-0.5">
        {poles
          .filter((p) => p.kind === "pole")
          .sort((a, b) => a.ordre - b.ordre)
          .map((p) => (
            <ListRow key={p.id} onClick={() => setEditing({ draft: p, isNew: false })}>
              <span className="size-3 rounded-full" style={{ background: p.couleur }} />
              <span className={`truncate ${p.actif ? "" : "line-through opacity-50"}`}>
                {p.icone} {p.nom}
              </span>
            </ListRow>
          ))}
      </div>
      <h4 className="mt-3 mb-1 text-[12px] font-bold">Lieux communs</h4>
      <div className="grid grid-cols-2 gap-0.5">
        {poles
          .filter((p) => p.kind === "lieu")
          .map((p) => (
            <ListRow key={p.id} onClick={() => setEditing({ draft: p, isNew: false })}>
              <span>{p.icone}</span>
              <span className="truncate">{p.nom}</span>
            </ListRow>
          ))}
      </div>
    </div>
  );
}

function PoleForm({ initial, isNew, onDone }: { initial: Pole; isNew: boolean; onDone: () => void }) {
  const [p, setP] = useState<Pole>(initial);
  const [missions, setMissions] = useState(initial.missions.join("\n"));
  const poles = useCatalog((s) => s.poles);
  const agents = useCatalog((s) => s.agents);
  const saver = useSaver();
  const set = <K extends keyof Pole>(k: K, v: Pole[K]) => setP((x) => ({ ...x, [k]: v }));
  const lieu = p.kind === "lieu";
  const members = agents.filter((a) => a.pole === p.id);
  const taken = new Map(poles.filter((x) => x.actif && x.id !== p.id).map((x) => [x.position, x.nom]));

  const save = () => {
    const draft: Pole = { ...p, id: isNew ? p.id || slugify(p.nom) : p.id, court: p.court || p.nom.slice(0, 24), missions: linesToList(missions) };
    const parsed = poleSchema.safeParse(draft);
    if (!parsed.success) return saver.fail(firstError(parsed.error));
    if (isNew && poles.some((x) => x.id === draft.id)) return saver.fail("Cet identifiant est déjà pris.");
    if (draft.actif && taken.has(draft.position)) return saver.fail("Cet emplacement est déjà occupé.");
    if (!draft.actif && members.some((a) => a.actif)) return saver.fail("Déplace ou désactive d'abord les agents de ce pôle.");
    void saver.run(async () => {
      await getRepo().savePole(draft);
      if (isNew) onDone();
    }, "Enregistré ✓ — la ville se redessine");
  };

  const remove = () => {
    if (!window.confirm(`Supprimer le pôle ${p.nom} ?`)) return;
    void saver.run(async () => {
      await getRepo().deletePole(p.id);
      onDone();
    }, "Supprimé");
  };

  return (
    <div>
      <button type="button" onClick={onDone} className="mb-3 text-sm text-sea">
        ← Tous les pôles
      </button>
      {lieu && <p className="mb-3 rounded-xl bg-sea/10 px-3 py-2 text-[12px]">Lieu commun : son mobilier est fixe, on peut changer son nom, son icône et sa description.</p>}
      <div className="grid grid-cols-[1fr_88px] gap-3">
        <Field label="Nom">
          <input className={inputCls} value={p.nom} onChange={(e) => set("nom", e.target.value)} maxLength={80} />
        </Field>
        <Field label="Icône">
          <input className={`${inputCls} text-center text-lg`} value={p.icone} onChange={(e) => set("icone", e.target.value)} maxLength={8} />
        </Field>
        <Field label="Nom court" hint="Mini-carte et étiquettes compactes">
          <input className={inputCls} value={p.court} onChange={(e) => set("court", e.target.value)} maxLength={24} />
        </Field>
        <Field label="Identifiant">
          <input className={inputCls} value={p.id} placeholder={slugify(p.nom)} disabled={!isNew} onChange={(e) => set("id", slugify(e.target.value))} />
        </Field>
      </div>
      <div className="mt-3 space-y-3">
        <Field label="Description">
          <textarea className={inputCls} rows={2} value={p.description} onChange={(e) => set("description", e.target.value)} maxLength={400} />
        </Field>
        {!lieu && (
          <>
            <Field label="Missions du pôle (une par ligne)">
              <textarea className={inputCls} rows={3} value={missions} onChange={(e) => setMissions(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Couleur (murets, tenues)">
                <div className="flex gap-2">
                  <input type="color" value={p.couleur} onChange={(e) => set("couleur", e.target.value)} className="h-9 w-12 rounded-lg border border-paper-edge" />
                  <input className={inputCls} value={p.couleur} onChange={(e) => set("couleur", e.target.value)} />
                </div>
              </Field>
              <Field label="Sol (pastel)">
                <div className="flex gap-2">
                  <input type="color" value={p.sol} onChange={(e) => set("sol", e.target.value)} className="h-9 w-12 rounded-lg border border-paper-edge" />
                  <input className={inputCls} value={p.sol} onChange={(e) => set("sol", e.target.value)} />
                </div>
              </Field>
              <Field label="Murs">
                <select className={inputCls} value={p.style} onChange={(e) => set("style", e.target.value as Pole["style"])}>
                  <option value="muret">Murets</option>
                  <option value="verre">Verrière</option>
                </select>
              </Field>
              <div className="pt-5">
                <Toggle checked={p.actif} onChange={(v) => set("actif", v)} label="Actif" />
              </div>
            </div>
            <Field label="Emplacement sur l'île">
              <SlotPicker value={p.position} taken={taken} onChange={(id) => set("position", id)} />
            </Field>
            {!isNew && <p className="text-[12px] text-ink-soft">{members.length} agent(s) dans ce pôle.</p>}
          </>
        )}
      </div>
      <SaveBar
        saver={saver}
        onSave={save}
        onCancel={onDone}
        onDelete={isNew || lieu ? undefined : remove}
        deleteDisabled={members.length ? "Déplace d'abord les agents de ce pôle" : undefined}
      />
    </div>
  );
}
