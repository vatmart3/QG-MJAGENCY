"use client";

import { useCallback, useEffect, useState } from "react";
import { activerSons, sonsActifs } from "../../sons";

const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const deB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Téléphone : installer LE PORT, notifications de la Douane, sons discrets. */
export function TelephoneCard() {
  const [srv, setSrv] = useState<{ configure: boolean; cle: string | null } | null>(null);
  const [abonne, setAbonne] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sons, setSons] = useState(true);
  const supporte = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const installee = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  const load = useCallback(async () => {
    setSons(sonsActifs());
    const r = (await fetch("/api/push").then((x) => x.json())) as { configure: boolean; cle: string | null };
    setSrv(r);
    if (supporte) {
      const reg = await navigator.serviceWorker.getRegistration();
      setAbonne(!!(await reg?.pushManager.getSubscription()));
    }
  }, [supporte]);
  useEffect(() => {
    void load();
  }, [load]);

  const abonner = async () => {
    if (!srv?.cle) return;
    setBusy(true);
    setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications refusées : autorise-les pour LE PORT dans les réglages du navigateur.");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: deB64url(srv.cle) }));
      const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ abonnement: sub.toJSON() }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Erreur ${r.status}`);
      setAbonne(true);
      setMsg({ ok: true, t: "Cet appareil recevra les demandes de la Douane et les alertes." });
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };
  const desabonner = async () => {
    setBusy(true);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setAbonne(false);
    setMsg({ ok: true, t: "Notifications coupées sur cet appareil." });
    setBusy(false);
  };
  const essai = async () => {
    setBusy(true);
    const r = (await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ essai: true }) }).then((x) => x.json())) as { ok: boolean };
    setMsg(r.ok ? { ok: true, t: "Notification d'essai envoyée." } : { ok: false, t: "Aucun appareil n'a reçu l'essai : réactive les notifications ici." });
    setBusy(false);
  };

  return (
    <section className="rounded-2xl border border-paper-edge bg-white/60 p-4">
      <h3 className="font-pixel text-lg">📱 Téléphone</h3>
      <p className="mt-1 text-[12.5px] text-ink-soft">
        {installee
          ? "LE PORT est installé comme une application sur cet appareil ✓"
          : ios
            ? "Sur iPhone : ouvre LE PORT dans Safari → bouton Partager → « Sur l'écran d'accueil ». Les notifications marchent ensuite depuis l'icône."
            : "Sur Android (Chrome) : menu ⋮ → « Installer l'application ». Sur ordinateur : icône d'installation dans la barre d'adresse."}
      </p>

      <div className="mt-3 rounded-xl bg-white/70 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <b className="mr-auto text-[13px]">Notifications de la Douane et des alertes</b>
          {srv?.configure && supporte && abonne !== null && (
            <>
              {abonne ? (
                <>
                  <button type="button" disabled={busy} onClick={() => void essai()} className="rounded-full border border-ink/15 bg-white px-3 py-1 text-[12px]">
                    Essai
                  </button>
                  <button type="button" disabled={busy} onClick={() => void desabonner()} className="rounded-full border border-ink/15 bg-white px-3 py-1 text-[12px]">
                    Couper
                  </button>
                </>
              ) : (
                <button type="button" disabled={busy} onClick={() => void abonner()} className="rounded-full bg-ink px-3 py-1 text-[12px] text-white">
                  Activer sur cet appareil
                </button>
              )}
            </>
          )}
        </div>
        {!supporte && <p className="mt-1 text-[12px] text-ink-soft">Ce navigateur ne gère pas les notifications{ios ? " : installe d'abord LE PORT sur l'écran d'accueil" : ""}.</p>}
        {srv && !srv.configure && <VapidMaker />}
        {msg && <p className={`mt-1.5 text-[12px] ${msg.ok ? "text-moss" : "text-phare"}`}>{msg.t}</p>}
      </div>

      <label className="mt-3 flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={sons}
          onChange={(e) => {
            setSons(e.target.checked);
            activerSons(e.target.checked);
          }}
        />
        Sons discrets (Douane, célébrations, alertes) sur cet appareil
      </label>
    </section>
  );
}

/** Clés VAPID créées dans le navigateur (jamais envoyées) : à coller dans Vercel. */
function VapidMaker() {
  const [k, setK] = useState<{ pub: string; priv: string } | null>(null);
  const [copie, setCopie] = useState<string | null>(null);
  const creer = async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const pub = await crypto.subtle.exportKey("raw", pair.publicKey);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    setK({ pub: b64url(pub), priv: jwk.d! });
  };
  const copier = (nom: string, v: string) => void navigator.clipboard.writeText(v).then(() => setCopie(nom));
  return (
    <div className="mt-2 text-[12px] text-ink-soft">
      <p>Pas encore activé côté serveur. Une fois : crée les deux clés ci-dessous, mets-les dans Vercel → Settings → Environment Variables, puis Redeploy.</p>
      <button type="button" onClick={() => void creer()} className="mt-1.5 rounded-full border border-ink/15 bg-white px-3 py-1 text-[12px] text-ink">
        🔑 Créer les clés de notification
      </button>
      {k &&
        (
          [
            ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", k.pub],
            ["VAPID_PRIVATE_KEY", k.priv],
          ] as const
        ).map(([nom, v]) => (
          <div key={nom} className="mt-1.5 flex items-center gap-2">
            <code className="w-56 shrink-0 text-[11px] text-ink">{nom}</code>
            <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-[11px]">{v}</code>
            <button type="button" onClick={() => copier(nom, v)} className="shrink-0 rounded-full bg-ink px-3 py-1 text-[12px] text-white">
              {copie === nom ? "Copiée ✓" : "Copier"}
            </button>
          </div>
        ))}
      {k && <p className="mt-1 text-[11px]">Créées sur ton appareil, envoyées nulle part. La clé privée ne va que dans Vercel.</p>}
    </div>
  );
}
