"use client";

import { useEffect, useState, type ReactNode } from "react";
import { allAgents, catalogStore, setCatalog, useCatalog } from "@/data/catalog";
import { demoRepo, loadDemoCatalog, setRepo } from "@/data/repo";
import { browserSupabase } from "@/lib/supabase/client";
import { getDirector } from "@/sim/director";
import { startLive } from "@/sync/live";
import { uiStore, useUI } from "@/store/ui";
import { world } from "@/store/world";
import { AgentSheet } from "./AgentSheet";
import { Ambiance } from "./Ambiance";
import { Toasts } from "./Toasts";
import { CityCanvas } from "./CityCanvas";
import { CommandBar } from "./CommandBar";
import { MiniMap } from "./MiniMap";
import { PoleSheet } from "./PoleSheet";
import { TopBar } from "./TopBar";

/** La ville EST l'interface : tout le reste flotte au-dessus. */
export function PortShell({ children }: { children: ReactNode }) {
  const ready = useUI((s) => s.ready);
  const loaded = useCatalog((s) => s.loaded);
  const structure = useCatalog((s) => s.structure);
  const [fail, setFail] = useState<{ reason: string; message: string } | null>(null);

  useEffect(() => {
    // ?heure=22.5 pour prévisualiser une autre heure de la journée
    const h = new URLSearchParams(window.location.search).get("heure");
    if (h !== null && !Number.isNaN(Number(h))) world.setClockOverride(Number(h));

    // tout ajout / retrait d'agent dans le catalogue se répercute sur l'état « runtime »
    const unsub = catalogStore.subscribe((s, prev) => {
      if (s.agents !== prev.agents) world.syncAgents(allAgents().map((a) => a.id));
    });

    let stop = () => {};
    let cancelled = false;
    const sb = browserSupabase();
    if (!sb) {
      // mode démo : seed local + modifications enregistrées dans ce navigateur
      setCatalog(loadDemoCatalog());
      world.syncAgents(allAgents().map((a) => a.id));
      setRepo(demoRepo);
      uiStore.setState({ conn: "demo" });
      getDirector().start("demo");
      return () => {
        unsub();
        getDirector().stop();
      };
    }
    (async () => {
      const res = await startLive(sb);
      if (cancelled) {
        if (res.ok) res.stop();
        return;
      }
      if (!res.ok) {
        if (res.reason === "non_connecte") window.location.href = "/login";
        else setFail(res);
        return;
      }
      stop = res.stop;
    })();
    return () => {
      cancelled = true;
      unsub();
      stop();
    };
  }, []);

  if (fail) return <AccessProblem reason={fail.reason} message={fail.message} />;

  return (
    <main className="fixed inset-0 overflow-hidden select-none">
      {loaded && <CityCanvas key={structure} />}
      {(!ready || !loaded) && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-lavender">
          <div className="text-center">
            <div className="animate-bounce text-4xl">⚓</div>
            <p className="mt-2 font-pixel text-lg">Le port se réveille…</p>
          </div>
        </div>
      )}
      <TopBar />
      <MiniMap />
      <CommandBar />
      <AgentSheet />
      <PoleSheet />
      <Ambiance />
      <Toasts />
      {children}
    </main>
  );
}

function AccessProblem({ reason, message }: { reason: string; message: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-b from-lavender to-peach p-6">
      <div className="paper relative w-full max-w-md rounded-[22px] p-6">
        <div className="tape" />
        <div className="text-3xl">{reason === "non_autorise" ? "🚧" : "🌫️"}</div>
        <h1 className="mt-2 font-pixel text-2xl">{reason === "non_autorise" ? "Accès refusé" : "Le port est dans la brume"}</h1>
        <p className="mt-2 text-sm">{message}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => window.location.reload()} className="rounded-full border border-ink/15 px-4 py-2 text-sm">
            Réessayer
          </button>
          <form action="/api/auth/signout" method="post">
            <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white">
              Se déconnecter
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
