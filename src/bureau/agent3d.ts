import { CAFE_LINES } from "@/data/mockContent";
import { world, type AgentRuntime } from "@/store/world";
import type { Nav, Pt } from "./nav";
import { Perso, type Pose3 } from "./perso";
import type { Plan, Spot3, TypeSpot } from "./plan";

/**
 * Un agent dans le bureau : traduit son état réel (au travail, en discussion, en réunion, à la Douane, en pause…)
 * en déplacements et en poses. Même logique que la ville en 2D : un plan d'étapes recalculé à chaque changement.
 */

type Etape =
  | { k: "marche"; x: number; z: number; echec?: "teleport" | "saute"; angle?: number }
  | { k: "pose"; pose: Pose3; angle?: number; dur?: number }
  | { k: "fait"; fn: () => void }
  | { k: "fondu"; vers: 0 | 1; dur: number }
  | { k: "teleport"; x: number; z: number; angle?: number }
  | { k: "face"; id: string };

const VITESSE = 1.55;
const MIDI = ["Une tielle et je reviens 😋", "Poisson du jour, parfait !", "On mange ensemble ?", "Bon appétit !"];
const SPORT = ["10 minutes de course 🏃", "Ça défoule !", "Allez, une série de plus 💪"];
const LECTURE = ["Un peu de veille 📚", "Je lis un super article", "Petite pause lecture"];
const SOIR = ["Bonne soirée !", "Je file, à demain !", "À demain !"];
const auHasard = <T,>(l: T[]): T => l[Math.floor(Math.random() * l.length)]!;

export interface Services3 {
  plan: Plan;
  nav: Nav;
  reserver(spot: number, id: string): boolean;
  liberer(id: string): void;
  estReserve(spot: number): boolean;
  posDe(id: string): (Pt & { cache: boolean }) | null;
  heure(): number;
  confetti(x: number, z: number): void;
  pileBump(): void;
}

export class Agent3D {
  readonly perso: Perso;
  x: number;
  z: number;
  angle = 0;
  cache = false;
  private plan: Etape[] = [];
  private chemin: Pt[] = [];
  private tEtape = 0;
  private demarree = false;
  private dernier: string | null = null;
  private dernierAvec: string | null = null;
  private initial = true;
  private porte = false;
  private fete = 0;
  private echelle = 1;

  constructor(
    readonly id: string,
    private svc: Services3,
  ) {
    this.perso = new Perso(id);
    const d = svc.plan.deskOf[id];
    this.x = d?.x ?? svc.plan.entree.x;
    this.z = d?.z ?? svc.plan.entree.z;
    this.angle = d?.angle ?? Math.PI;
  }

  get pose(): Pose3 {
    return this.perso.pose;
  }

  // ---------------------------------------------------------------- état → plan
  sync(rt: AgentRuntime, celebration: number | undefined): void {
    if (celebration && celebration > this.fete) {
      this.fete = celebration;
      if (!this.initial) this.svc.confetti(this.x, this.z);
    }
    const cle = `${rt.state}|${rt.offlineReason ?? ""}`;
    if (cle === this.dernier && rt.talkWith === this.dernierAvec) return;
    this.dernier = cle;
    this.dernierAvec = rt.talkWith;
    this.reconstruire(rt);
    this.initial = false;
  }

  private nuit(): boolean {
    const h = this.svc.heure();
    return h >= 21 || h < 7;
  }

  private reconstruire(rt: AgentRuntime): void {
    this.svc.liberer(this.id);
    this.porte = false;
    const bureau = this.svc.plan.deskOf[this.id];
    const plan: Etape[] = [];
    const initial = this.initial;
    const aller = (s: { x: number; z: number; angle?: number }) => plan.push(initial ? { k: "teleport", x: s.x, z: s.z, angle: s.angle } : { k: "marche", x: s.x, z: s.z, echec: "teleport", angle: s.angle });
    const entree = this.svc.plan.entree;

    // retour d'absence : on arrive par l'entrée
    const nuitIdle = rt.state === "idle" && this.nuit();
    if (this.cache && rt.state !== "offline" && !nuitIdle) plan.push({ k: "teleport", x: entree.x, z: entree.z, angle: Math.PI }, { k: "fondu", vers: 1, dur: 0.5 });

    switch (rt.state) {
      case "working":
        if (bureau) {
          aller(bureau);
          plan.push({ k: "pose", pose: "type", angle: bureau.angle });
        }
        break;
      case "offline":
        if (rt.offlineReason === "budget" && bureau) {
          aller(bureau);
          plan.push({ k: "pose", pose: "sleep", angle: bureau.angle });
        } else this.partir(plan, initial);
        break;
      case "meeting": {
        const m = Object.values(world.get().meetings).find((mm) => mm.participants.includes(this.id));
        const siege = this.trouver("criee");
        if (siege) {
          aller(siege);
          plan.push({ k: "pose", pose: "sit", angle: siege.angle, dur: 0.05 });
          if (m) plan.push({ k: "fait", fn: () => world.meetingArrived(m.id, this.id) });
          plan.push({ k: "pose", pose: "sit", angle: siege.angle });
        } else if (m) plan.push({ k: "fait", fn: () => world.meetingArrived(m.id, this.id) });
        break;
      }
      case "talking": {
        const conv = Object.values(world.get().conversations).find((c) => c.a === this.id || c.b === this.id);
        const autre = rt.talkWith;
        if (!conv || !autre) break;
        if (conv.a === this.id) {
          // l'initiateur rejoint l'autre
          const cible = this.presDe(autre);
          if (cible) aller(cible);
          plan.push({ k: "face", id: autre }, { k: "fait", fn: () => world.conversationReady(conv.id) }, { k: "pose", pose: "talk" });
        } else {
          const auBureau = bureau && Math.hypot(this.x - bureau.x, this.z - bureau.z) < 0.2 && !this.chemin.length;
          if (auBureau && bureau) plan.push({ k: "pose", pose: "sit", angle: bureau.angle });
          else plan.push({ k: "face", id: autre }, { k: "pose", pose: "talk" });
        }
        break;
      }
      case "waiting_approval": {
        const spot = this.trouver("douane");
        if (spot) {
          this.porte = true;
          plan.push({ k: "marche", x: spot.x, z: spot.z, echec: "teleport", angle: spot.angle });
          plan.push({
            k: "fait",
            fn: () => {
              this.porte = false;
              if (rt.approvalId) world.markDelivered(rt.approvalId);
              this.svc.pileBump();
            },
          });
          plan.push({ k: "pose", pose: "stand", angle: spot.angle, dur: 1.4 }, { k: "fait", fn: () => this.svc.liberer(this.id) });
        } else if (rt.approvalId) {
          const id = rt.approvalId;
          plan.push({ k: "fait", fn: () => world.markDelivered(id) });
        }
        if (bureau) plan.push({ k: "marche", x: bureau.x, z: bureau.z, echec: "teleport", angle: bureau.angle }, { k: "pose", pose: "sit", angle: bureau.angle });
        break;
      }
      case "done":
        plan.push({ k: "pose", pose: "cheer", dur: 2.4 });
        if (bureau) plan.push({ k: "pose", pose: "sit", angle: bureau.angle });
        break;
      default:
        this.planLibre(plan, initial);
    }
    // rien à faire (aucune place libre) : on patiente un instant avant de réessayer
    if (!plan.length && rt.state === "idle") plan.push({ k: "pose", pose: "stand", dur: 3 });
    this.plan = plan;
    this.demarree = false;
  }

  /** Quitte le bureau par l'entrée et disparaît. */
  private partir(plan: Etape[], initial: boolean): void {
    const e = this.svc.plan.entree;
    if (initial) plan.push({ k: "teleport", x: e.x, z: e.z }, { k: "fondu", vers: 0, dur: 0 });
    else plan.push({ k: "marche", x: e.x, z: e.z, echec: "teleport" }, { k: "fondu", vers: 0, dur: 0.6 });
  }

  private allerA(plan: Etape[], kind: TypeSpot, dur: number, phrases?: string[]): boolean {
    const s = this.trouver(kind);
    if (!s) return false;
    plan.push({ k: "marche", x: s.x, z: s.z, echec: "saute", angle: s.angle });
    if (phrases && Math.random() < 0.4) plan.push({ k: "fait", fn: () => world.say(this.id, auHasard(phrases), 2800) });
    plan.push({ k: "pose", pose: s.pose === "sit" ? "sit" : kind === "sport" ? "cheer" : "stand", angle: s.angle, dur });
    return true;
  }

  private planLibre(plan: Etape[], initial: boolean): void {
    const bureau = this.svc.plan.deskOf[this.id];
    const r = Math.random();
    const h = this.svc.heure();
    if (this.nuit()) {
      if (this.cache) {
        plan.push({ k: "pose", pose: "stand", dur: 20 + Math.random() * 20 });
        return;
      }
      if (!initial && Math.random() < 0.3) plan.push({ k: "fait", fn: () => world.say(this.id, auHasard(SOIR), 2400) });
      this.partir(plan, initial);
      return;
    }
    if (!initial && h >= 12 && h < 13.75 && r < 0.75 && this.allerA(plan, "resto", 25 + Math.random() * 25, MIDI)) return;
    if (!initial && h >= 18.5 && h < 21 && r < 0.4 && (this.allerA(plan, r < 0.2 ? "sport" : "resto", 20 + Math.random() * 20, r < 0.2 ? SPORT : MIDI) || this.allerA(plan, "terrasse", 15))) return;
    if (initial || r < 0.3) {
      if (bureau) {
        plan.push(initial ? { k: "teleport", x: bureau.x, z: bureau.z, angle: bureau.angle } : { k: "marche", x: bureau.x, z: bureau.z, echec: "teleport", angle: bureau.angle });
        plan.push({ k: "pose", pose: "sit", angle: bureau.angle, dur: 6 + Math.random() * 14 });
      }
      return;
    }
    if (r < 0.55) {
      // quelques pas dans la rue des pôles, près de son bureau
      const rue = this.svc.plan.couloirs[0]!;
      const cx = bureau?.x ?? this.x;
      const p = this.svc.nav.auHasard(Math.max(rue.x0 + 0.6, cx - 12), rue.z0 + 0.8, Math.min(rue.x1 - 0.6, cx + 12), rue.z1 - 0.8);
      if (p) plan.push({ k: "marche", x: p.x, z: p.z, echec: "saute" }, { k: "pose", pose: "stand", dur: 2 + Math.random() * 5 });
      return;
    }
    if (r < 0.82) {
      // un café, puis une table
      const comptoir = this.trouver("cafe");
      if (comptoir) {
        plan.push({ k: "marche", x: comptoir.x, z: comptoir.z, echec: "saute", angle: comptoir.angle }, { k: "pose", pose: "stand", angle: comptoir.angle, dur: 2.5 });
        if (Math.random() < 0.35) plan.push({ k: "fait", fn: () => world.say(this.id, auHasard(CAFE_LINES), 2800) });
        plan.push({
          k: "fait",
          fn: () => {
            this.svc.liberer(this.id);
            const siege = this.trouver("terrasse");
            if (siege) this.plan.unshift({ k: "marche", x: siege.x, z: siege.z, echec: "saute", angle: siege.angle }, { k: "pose", pose: "sit", angle: siege.angle, dur: 8 + Math.random() * 10 });
            else this.plan.unshift({ k: "pose", pose: "drink", dur: 6 + Math.random() * 6 });
          },
        });
      }
      return;
    }
    if (r < 0.88 && this.allerA(plan, "lecture", 12 + Math.random() * 12, LECTURE)) return;
    if (r < 0.94 && this.allerA(plan, "sport", 10 + Math.random() * 10, SPORT)) return;
    if (!this.allerA(plan, "detente", 8 + Math.random() * 10)) this.allerA(plan, "archives", 8);
  }

  /** Place libre la plus proche d'un type donné (réservée pour cet agent). */
  private trouver(kind: TypeSpot): Spot3 | null {
    const { spots } = this.svc.plan;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      if (s.kind !== kind || this.svc.estReserve(i)) continue;
      const d = Math.abs(s.x - this.x) + Math.abs(s.z - this.z) + Math.random() * 3;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return null;
    this.svc.reserver(best, this.id);
    return spots[best]!;
  }

  /** Un point libre à côté d'un autre agent, du côté d'où l'on vient. */
  private presDe(autre: string): Pt | null {
    const o = this.svc.posDe(autre);
    if (!o) return null;
    let best: Pt | null = null;
    let bestD = Infinity;
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const p = { x: o.x + Math.sin(a) * 1.0, z: o.z + Math.cos(a) * 1.0 };
      if (!this.svc.nav.estLibre(p.x, p.z)) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- mise à jour
  update(dt: number, rt: AgentRuntime | undefined, parle: boolean): void {
    this.executer(dt, rt);
    const r = this.perso.racine;
    r.position.set(this.x, 0, this.z);
    r.rotation.y = this.angle;
    r.visible = !this.cache;
    r.scale.setScalar(this.echelle);
    this.perso.animer(dt, parle);
  }

  private suivante(): void {
    this.plan.shift();
    this.demarree = false;
  }

  private tourner(vers: number, dt: number): void {
    let d = vers - this.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.angle += d * Math.min(1, dt * 10);
  }

  private executer(dt: number, rt: AgentRuntime | undefined): void {
    let garde = 0;
    while (this.plan.length && garde++ < 8) {
      const e = this.plan[0]!;
      if (!this.demarree) {
        this.demarree = true;
        this.tEtape = 0;
        if (e.k === "marche") {
          const c = this.svc.nav.chemin({ x: this.x, z: this.z }, { x: e.x, z: e.z });
          if (!c) {
            if (e.echec === "teleport") {
              this.x = e.x;
              this.z = e.z;
              if (e.angle !== undefined) this.angle = e.angle;
            }
            this.suivante();
            continue;
          }
          this.chemin = c;
        }
      }
      switch (e.k) {
        case "teleport":
          this.x = e.x;
          this.z = e.z;
          if (e.angle !== undefined) this.angle = e.angle;
          this.chemin = [];
          this.suivante();
          continue;
        case "fait":
          this.suivante();
          e.fn();
          continue;
        case "face": {
          const o = this.svc.posDe(e.id);
          if (o) this.angle = Math.atan2(o.x - this.x, o.z - this.z);
          this.suivante();
          continue;
        }
        case "fondu": {
          this.tEtape += dt;
          const t = e.dur <= 0 ? 1 : Math.min(1, this.tEtape / e.dur);
          this.echelle = Math.max(0.01, e.vers === 1 ? t : 1 - t);
          this.cache = e.vers === 0 && t >= 1;
          if (e.vers === 1) this.cache = false;
          if (t >= 1) {
            this.suivante();
            continue;
          }
          return;
        }
        case "marche": {
          this.perso.pose = this.porte ? "carry" : "walk";
          let reste = VITESSE * dt;
          while (reste > 0 && this.chemin.length) {
            const p = this.chemin[0]!;
            const dx = p.x - this.x;
            const dz = p.z - this.z;
            const d = Math.hypot(dx, dz);
            if (d <= reste) {
              this.x = p.x;
              this.z = p.z;
              reste -= d;
              this.chemin.shift();
            } else {
              this.x += (dx / d) * reste;
              this.z += (dz / d) * reste;
              this.tourner(Math.atan2(dx, dz), dt);
              reste = 0;
            }
          }
          if (!this.chemin.length) {
            if (e.angle !== undefined) this.angle = e.angle;
            this.perso.pose = "stand";
            this.suivante();
            continue;
          }
          return;
        }
        case "pose": {
          this.perso.pose = e.pose;
          if (e.angle !== undefined) this.tourner(e.angle, dt * 1.5);
          this.tEtape += dt;
          if (e.dur !== undefined && this.tEtape >= e.dur) {
            this.suivante();
            if (!this.plan.length && rt?.state === "idle") this.reconstruire(rt);
            continue;
          }
          return;
        }
      }
    }
  }
}
