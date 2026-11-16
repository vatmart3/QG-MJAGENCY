"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatParis } from "@/lib/paris";
import { ui, uiStore, useUI } from "@/store/ui";
import { useWorld } from "@/store/world";
import { getGame } from "../gameRef";
import { useIsMobile, useNow } from "../hooks";

/**
 * Le téléphone de la visite à pied (touche G) : un petit écran où l'on retrouve tous les onglets du QG.
 * L'écran est une page du QG chargée « en mode téléphone » dans un cadre : chaque onglet s'y affiche dans sa
 * version mobile, et l'on navigue dedans comme sur un vrai téléphone (accueil → application → retour).
 */

export const NOM_CADRE = "leport-telephone";
const MSG = "leport-telephone";

export function ouvrirTelephone(): void {
  getGame()?.ouvrirTelephone?.();
}
export function fermerTelephone(): void {
  getGame()?.fermerTelephone?.();
}

// ------------------------------------------------------------------ côté visite : le téléphone tenu en main
export function Telephone() {
  const ouvert = useUI((s) => s.telephone);
  const visite = useUI((s) => s.visite !== "non");
  const mobile = useIsMobile();
  const cadre = useRef<HTMLIFrameElement>(null);
  // le cadre n'est chargé qu'à la première ouverture, puis gardé (on retrouve l'écran où on l'a laissé)
  const [charge, setCharge] = useState(false);
  useEffect(() => {
    if (ouvert) setCharge(true);
  }, [ouvert]);
  useEffect(() => {
    if (!visite) setCharge(false);
  }, [visite]);
  // le clavier va dans le téléphone tant qu'il est ouvert (écrire une mission, chercher…)
  useEffect(() => {
    if (!ouvert) return;
    const t = setTimeout(() => cadre.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [ouvert, charge]);
  // le téléphone demande à être rangé (touche G ou Échap dedans, bouton d'accueil maintenu…)
  useEffect(() => {
    const surMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.source !== MSG) return;
      if (e.data.action === "fermer") fermerTelephone();
    };
    window.addEventListener("message", surMessage);
    return () => window.removeEventListener("message", surMessage);
  }, []);
  if (!visite || !charge) return null;
  return (
    <div
      className={`fixed z-40 transition-[transform,opacity] duration-300 ease-out ${mobile ? "inset-0" : "right-[max(28px,4vw)] bottom-[max(20px,3vh)]"} ${ouvert ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-[110%] opacity-0"}`}
      aria-hidden={!ouvert}
    >
      <div className={mobile ? "flex h-full flex-col bg-ink" : "relative rounded-[46px] bg-[#16171d] p-[11px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.65),inset_0_0_0_2px_#3a3c48]"}>
        {!mobile && <div className="pointer-events-none absolute top-[19px] left-1/2 z-10 h-[22px] w-[92px] -translate-x-1/2 rounded-full bg-[#16171d]" />}
        <iframe
          ref={cadre}
          name={NOM_CADRE}
          src="/"
          title="Téléphone du QG : tous les onglets"
          className={mobile ? "min-h-0 w-full flex-1 border-0" : "block rounded-[36px] border-0 bg-white"}
          style={mobile ? undefined : { width: 384, height: "min(780px, calc(100dvh - 64px))" }}
        />
        {mobile ? (
          <button type="button" onClick={fermerTelephone} className="bg-ink py-3 text-[13px] font-medium text-white">
            Ranger le téléphone
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ côté cadre : l'écran du téléphone
const APPLIS: { href: string; nom: string; icone: string; fond: string }[] = [
  { href: "/equipe", nom: "Équipe", icone: "👥", fond: "#4b4bb0" },
  { href: "/taches", nom: "Tâches", icone: "✅", fond: "#2e9d62" },
  { href: "/calendrier", nom: "Calendrier", icone: "🗓️", fond: "#e04f9a" },
  { href: "/douane", nom: "Douane", icone: "🛂", fond: "#c0392b" },
  { href: "/commercial", nom: "Commercial", icone: "🎯", fond: "#e0812c" },
  { href: "/finances", nom: "Finances", icone: "💶", fond: "#d9a400" },
  { href: "/rapports", nom: "Rapports", icone: "📄", fond: "#355c8c" },
  { href: "/flux", nom: "Flux", icone: "🔀", fond: "#1f9aa8" },
  { href: "/atelier", nom: "Atelier", icone: "🛠️", fond: "#3a7bd5" },
  { href: "/journal", nom: "Journal", icone: "📓", fond: "#8a7a63" },
  { href: "/reglages", nom: "Réglages", icone: "⚙️", fond: "#6d7280" },
];

const dire = (action: string) => window.parent?.postMessage({ source: MSG, action }, window.location.origin);

/** Clavier dans le téléphone : G le range, Échap revient à l'accueil puis le range. */
export function useClavierTelephone(): void {
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const saisie = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.code === "KeyG" && !saisie && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        dire("fermer");
      } else if (e.key === "Escape" && !e.defaultPrevented) {
        const u = uiStore.getState();
        // une fiche ou une application ouverte se ferme d'abord (gérée par la fiche) ; à l'accueil, on range
        if (path === "/" && !u.selectedAgent && !u.selectedPole) dire("fermer");
      }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [path, router]);
}

/** Barre du bas du téléphone : retour à l'accueil (comme le bouton d'un vrai téléphone). */
export function BarreTelephone() {
  const path = usePathname();
  const router = useRouter();
  const selection = useUI((s) => !!s.selectedAgent || !!s.selectedPole);
  if (path === "/" && !selection) return null;
  return (
    <button
      type="button"
      onClick={() => {
        ui.closeSheets();
        router.push("/");
      }}
      className="fixed bottom-1.5 left-1/2 z-[60] h-[22px] w-[150px] -translate-x-1/2 rounded-full"
      aria-label="Revenir à l'accueil du téléphone"
      title="Accueil"
    >
      <span className="mx-auto block h-[5px] w-[120px] rounded-full bg-ink/55" />
    </button>
  );
}

/** Écran d'accueil du téléphone : l'heure, l'essentiel du port, puis une icône par onglet. */
export function AccueilTelephone() {
  const now = useNow(15_000);
  const conn = useUI((s) => s.conn);
  const douane = useWorld((s) => s.approvals.length);
  const auTravail = useWorld((s) => Object.values(s.agents).filter((a) => a.state === "working").length);
  const enCours = useWorld((s) => s.tasks.filter((t) => t.status === "running" || t.status === "queued").length);
  return (
    <div className="absolute inset-0 overflow-y-auto bg-gradient-to-b from-[#3b3f8f] via-[#7a5fb0] to-[#f0a57e] px-5 pt-9 pb-40 text-white select-none">
      <div className="flex items-center justify-between text-[12px] font-semibold opacity-90">
        <span className="tabular-nums">{formatParis(now, "HH:mm")}</span>
        <span>⚓ LE PORT{conn === "demo" ? " · démo" : ""}</span>
      </div>
      <div className="mt-7 text-center">
        <div className="font-pixel text-[58px] leading-none tabular-nums">{formatParis(now, "HH:mm")}</div>
        <div className="mt-1 text-[14px] capitalize opacity-90">{formatParis(now, "EEEE d MMMM")}</div>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2 text-center">
        <Link href="/equipe" className="rounded-2xl bg-white/18 px-2 py-2.5 backdrop-blur transition active:scale-95">
          <div className="text-[22px] leading-none font-bold tabular-nums">{auTravail}</div>
          <div className="mt-1 text-[11px] opacity-90">au travail</div>
        </Link>
        <Link href="/taches" className="rounded-2xl bg-white/18 px-2 py-2.5 backdrop-blur transition active:scale-95">
          <div className="text-[22px] leading-none font-bold tabular-nums">{enCours}</div>
          <div className="mt-1 text-[11px] opacity-90">tâches</div>
        </Link>
        <Link href="/douane" className={`rounded-2xl px-2 py-2.5 backdrop-blur transition active:scale-95 ${douane ? "bg-[#c0392b]/85" : "bg-white/18"}`}>
          <div className="text-[22px] leading-none font-bold tabular-nums">{douane}</div>
          <div className="mt-1 text-[11px] opacity-90">à valider</div>
        </Link>
      </div>
      <nav className="mt-7 grid grid-cols-4 gap-x-2 gap-y-5" aria-label="Applications du QG">
        {APPLIS.map((a) => (
          <Link key={a.href} href={a.href} className="group flex flex-col items-center gap-1.5">
            <span className="relative grid size-[58px] place-items-center rounded-[18px] text-[28px] shadow-[0_6px_14px_-6px_rgba(0,0,0,0.5)] transition group-active:scale-90" style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${a.fond} 78%, white), ${a.fond})` }}>
              {a.icone}
              {a.href === "/douane" && douane > 0 && <span className="absolute -top-1.5 -right-1.5 grid h-[20px] min-w-[20px] place-items-center rounded-full bg-[#ff3b30] px-1 text-[11px] font-bold">{douane}</span>}
            </span>
            <span className="text-[11.5px] font-medium drop-shadow">{a.nom}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
