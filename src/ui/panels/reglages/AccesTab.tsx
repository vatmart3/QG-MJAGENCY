"use client";

import { useState } from "react";
import { useCatalog } from "@/data/catalog";
import { getRepo } from "@/data/repo";
import type { Settings } from "@/data/types";
import { firstError, settingsSchema } from "@/lib/schemas";
import { browserSupabase } from "@/lib/supabase/client";
import { useUI } from "@/store/ui";
import { world } from "@/store/world";
import { Field, SaveBar, Toggle, inputCls, useSaver } from "./fields";

function EmailList({ value, onChange, protect, label }: { value: string[]; onChange: (v: string[]) => void; protect?: string | null; label: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const e = draft.trim().toLowerCase();
    if (!e || value.includes(e)) return;
    onChange([...value, e]);
    setDraft("");
  };
  return (
    <div className="rounded-xl border border-paper-edge bg-white/60 p-2">
      <ul className="space-y-1">
        {value.map((e) => (
          <li key={e} className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-2 py-1 text-sm">
            <span className="truncate">{e}</span>
            {e === protect ? (
              <span className="text-[11px] text-ink-soft">toi</span>
            ) : (
              <button type="button" onClick={() => onChange(value.filter((x) => x !== e))} className="text-[12px] text-phare/80 hover:text-phare" aria-label={`Retirer ${e}`}>
                Retirer
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input
          type="email"
          className={inputCls}
          value={draft}
          placeholder="ajouter@exemple.fr"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          aria-label={label}
        />
        <button type="button" onClick={add} className="shrink-0 rounded-full border border-ink/15 px-3 text-sm">
          Ajouter
        </button>
      </div>
    </div>
  );
}

/** Choisir ou changer son mot de passe (connexion sans attendre de mail). */
function PasswordBox() {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const saver = useSaver();
  const save = () => {
    if (pwd.length < 10) return saver.fail("10 caractères minimum.");
    if (pwd !== pwd2) return saver.fail("Les deux mots de passe ne sont pas identiques.");
    void saver.run(async () => {
      const sb = browserSupabase();
      if (!sb) throw new Error("Supabase n'est pas configuré.");
      const { error } = await sb.auth.updateUser({ password: pwd });
      if (error) throw new Error(error.message);
      setPwd("");
      setPwd2("");
    }, "Mot de passe enregistré ✓ — tu peux te connecter avec");
  };
  return (
    <Field label="Mon mot de passe" hint="Pour te connecter sans attendre de mail. 10 caractères minimum.">
      <div className="grid grid-cols-2 gap-2">
        <input type="password" autoComplete="new-password" className={inputCls} value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Nouveau mot de passe" aria-label="Nouveau mot de passe" />
        <input type="password" autoComplete="new-password" className={inputCls} value={pwd2} onChange={(e) => setPwd2(e.target.value)} placeholder="Confirmer" aria-label="Confirmer le mot de passe" />
      </div>
      <button type="button" onClick={save} disabled={saver.status === "saving"} className="mt-2 rounded-full border border-ink/15 px-3 py-1.5 text-[13px]">
        Enregistrer le mot de passe
      </button>
      {saver.message && <span className={`ml-2 text-[12px] ${saver.status === "error" ? "text-phare" : "text-moss"}`}>{saver.message}</span>}
    </Field>
  );
}

export function AccesTab() {
  const current = useCatalog((s) => s.settings);
  const conn = useUI((s) => s.conn);
  const me = useUI((s) => s.userEmail);
  const [s, setS] = useState<Settings>(current);
  const saver = useSaver();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));

  const save = () => {
    const parsed = settingsSchema.safeParse(s);
    if (!parsed.success) return saver.fail(firstError(parsed.error));
    if (me && !s.allowlistEmails.includes(me)) return saver.fail("Tu ne peux pas te retirer toi-même de l'allowlist.");
    void saver.run(async () => {
      await getRepo().saveSettings(parsed.data);
      world.setChatter(parsed.data.bavardageActif);
    });
  };

  return (
    <div className="space-y-4">
      <Field label="Qui peut entrer au port (allowlist)" hint={conn === "demo" ? "Appliquée dès que Supabase est branché (connexion par lien magique)." : "Vérifiée à l'envoi du lien magique et par la sécurité de chaque table."}>
        <EmailList value={s.allowlistEmails} onChange={(v) => set("allowlistEmails", v)} protect={me} label="Ajouter une adresse autorisée" />
      </Field>
      <Field label="Destinataires du récap quotidien (07:30)" hint="Envoyé depuis mjagency.officiel@gmail.com à partir de la Phase 5.">
        <EmailList value={s.recapDestinataires} onChange={(v) => set("recapDestinataires", v)} label="Ajouter un destinataire du récap" />
      </Field>
      <Field label="Signature des mails sortants" hint="Les agents ne signent jamais sous leur propre nom vers l'extérieur.">
        <select className={inputCls} value={s.signataire} onChange={(e) => set("signataire", e.target.value as Settings["signataire"])}>
          <option>Jérémy</option>
          <option>Matheis</option>
          <option>L&apos;équipe MJAGENCY</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget IA par jour (€)" hint="À 80 % : alerte. À 100 % : seuls les agents critiques continuent.">
          <input type="number" min={0} step={0.5} className={inputCls} value={s.budgetJour} onChange={(e) => set("budgetJour", Number(e.target.value))} />
        </Field>
        <Field label="Budget IA par mois (€)">
          <input type="number" min={0} step={1} className={inputCls} value={s.budgetMois} onChange={(e) => set("budgetMois", Number(e.target.value))} />
        </Field>
      </div>
      <Toggle checked={s.bavardageActif} onChange={(v) => set("bavardageActif", v)} label="Bavardage d'ambiance" hint="Petites répliques légères entre agents (Haiku, ~1 appel / 10 min)" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contraintes fixes de Jérémy" hint="Cours, autre emploi… (pour Céleste)">
          <textarea className={inputCls} rows={3} value={s.contraintesAgenda.jeremy} onChange={(e) => set("contraintesAgenda", { ...s.contraintesAgenda, jeremy: e.target.value })} />
        </Field>
        <Field label="Contraintes fixes de Matheis">
          <textarea className={inputCls} rows={3} value={s.contraintesAgenda.matheis} onChange={(e) => set("contraintesAgenda", { ...s.contraintesAgenda, matheis: e.target.value })} />
        </Field>
      </div>
      <SaveBar saver={saver} onSave={save} />
      {conn !== "demo" && <PasswordBox />}
      {conn !== "demo" && (
        <form action="/api/auth/signout" method="post" className="pt-1">
          <p className="mb-2 text-[12px] text-ink-soft">Connecté : {me}</p>
          <button type="submit" className="rounded-full border border-ink/15 px-4 py-2 text-sm">
            Se déconnecter
          </button>
        </form>
      )}
    </div>
  );
}
