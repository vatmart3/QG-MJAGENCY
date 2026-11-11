import { Container, Sprite, type Texture } from "pixi.js";
import { agentById } from "@/data/catalog";
import { CAFE_LINES } from "@/data/mockContent";
import { world, type AgentRuntime } from "@/store/world";
import { GW, cellCenter, idx, iso, type Facing, type Layout, type Spot } from "../layout";
import type { FrameName } from "../sprites/characters";
import { findPath } from "./pathfinding";

/**
 * Bonhomme visuel : traduit l'état réel (store) en déplacements et poses.
 * Plan = suite d'étapes (marcher, poser, agir) recalculée à chaque changement d'état.
 */

export type Pose = "stand" | "walk" | "sit" | "type" | "talk" | "drink" | "sleep" | "cheer";

type Step =
  | { k: "walk"; x: number; y: number; onFail?: "teleport" | "skip" }
  | { k: "pose"; pose: Pose; facing?: Facing; dur?: number; carry?: boolean }
  | { k: "do"; fn: () => void }
  | { k: "fade"; to: 0 | 1; dur: number }
  | { k: "teleport"; x: number; y: number }
  | { k: "faceAgent"; id: string };

const SPEED = 2.1; // cases / s

const MIDI = ["Une tielle et je reviens 😋", "Poisson du jour, parfait !", "On mange ensemble ?", "Bon appétit !", "La terrasse est au soleil ☀️"];
const SPORT = ["10 minutes de course 🏃", "Ça défoule !", "Allez, une série de plus 💪"];
const LECTURE = ["Un peu de veille 📚", "Je lis un super article", "Petite pause lecture"];
const SOIR = ["Bonne soirée !", "Je rentre à la maison 🏠", "À demain !"];
const auHasard = (l: string[]) => l[Math.floor(Math.random() * l.length)]!;

export interface WorldServices {
  layout: Layout;
  frames: (key: string) => Texture;
  reserve: (spotKey: number, agentId: string) => boolean;
  release: (agentId: string) => void;
  isReserved: (spotKey: number) => boolean;
  occupiedBy: (cell: number, except: string) => boolean;
  agentCell: (id: string) => { x: number; y: number } | null;
  confetti: (x: number, y: number) => void;
  pileBump: () => void;
  hour: () => number;
  extraCost: Uint8Array;
}

export class AgentView {
  readonly id: string;
  readonly container = new Container();
  private body: Sprite;
  private shadow: Sprite;
  private carry: Sprite;
  private icon: Sprite;
  private zzz: Sprite;
  readonly ring: Sprite;

  // position continue en coordonnées de grille (centre de case = n + 0.5)
  u: number;
  v: number;
  cellX: number;
  cellY: number;
  facing: Facing = "y+";
  pose: Pose = "stand";
  private path: number[] = [];
  private plan: Step[] = [];
  private stepTime = 0;
  private stepStarted = false;
  private anim = 0;
  private jump = 0;
  private hidden = false;
  private alpha = 1;
  private lastState: string | null = null;
  private lastTalkWith: string | null = null;
  private initial = true;
  private carrying = false;
  private svc: WorldServices;
  private spot: Spot | null = null;
  private speaking = false;
  /** dernière date de célébration traitée */
  private celebratedAt = 0;

  constructor(id: string, svc: WorldServices, tex: { shadow: Texture; carry: Texture; hourglass: Texture; z: Texture; ring: Texture }) {
    this.id = id;
    this.svc = svc;
    this.shadow = new Sprite(tex.shadow);
    this.shadow.anchor.set(0.5, 0.5);
    this.ring = new Sprite(tex.ring);
    this.ring.anchor.set(0.5, 0.5);
    this.ring.visible = false;
    this.body = new Sprite(svc.frames(`${id}:F_walk0`));
    this.body.anchor.set(0.5, 23 / 24);
    this.carry = new Sprite(tex.carry);
    this.carry.anchor.set(0.5, 1);
    this.carry.visible = false;
    this.icon = new Sprite(tex.hourglass);
    this.icon.anchor.set(0.5, 1);
    this.icon.visible = false;
    this.zzz = new Sprite(tex.z);
    this.zzz.anchor.set(0.5, 1);
    this.zzz.visible = false;
    this.container.addChild(this.ring, this.shadow, this.body, this.carry, this.icon, this.zzz);

    const desk = svc.layout.deskOf[id];
    const start = desk ?? { x: 30, y: 27 };
    this.cellX = start.x;
    this.cellY = start.y;
    this.u = start.x + 0.5;
    this.v = start.y + 0.5;
  }

  get worldPos(): { x: number; y: number } {
    return iso(this.u, this.v);
  }

  get isHidden(): boolean {
    return this.hidden;
  }

  /** point de la tête (pour les bulles) */
  get headPos(): { x: number; y: number } {
    const p = this.worldPos;
    const sitting = this.pose === "sit" || this.pose === "type" || this.pose === "sleep";
    return { x: p.x, y: p.y - (sitting ? 22 : 26) + this.jump };
  }

  setSpeaking(on: boolean): void {
    this.speaking = on;
  }

  // ---------------------------------------------------------------- état → plan
  sync(rt: AgentRuntime, celebrationAt: number | undefined): void {
    if (celebrationAt && celebrationAt > this.celebratedAt) {
      this.celebratedAt = celebrationAt;
      if (!this.initial) {
        const p = this.worldPos;
        this.svc.confetti(p.x, p.y - 20);
      }
    }
    const key = `${rt.state}|${rt.offlineReason ?? ""}`;
    if (key === this.lastState && rt.talkWith === this.lastTalkWith) return;
    this.lastState = key;
    this.lastTalkWith = rt.talkWith;
    this.rebuild(rt);
    this.initial = false;
  }

  private rebuild(rt: AgentRuntime): void {
    this.svc.release(this.id);
    this.spot = null;
    this.carrying = false;
    const desk = this.svc.layout.deskOf[this.id];
    const plan: Step[] = [];
    const initial = this.initial;
    const go = (x: number, y: number) => plan.push(initial ? { k: "teleport", x, y } : { k: "walk", x, y, onFail: "teleport" });

    // revenir d'une absence : on sort de sa maison
    const nuitIdle = rt.state === "idle" && this.estNuit();
    if (this.hidden && rt.state !== "offline" && !nuitIdle) {
      const h = this.maison();
      plan.push({ k: "teleport", x: h.x, y: h.y }, { k: "fade", to: 1, dur: 0.6 });
    }

    switch (rt.state) {
      case "working": {
        if (desk) {
          go(desk.x, desk.y);
          plan.push({ k: "pose", pose: "type", facing: desk.facing });
        }
        break;
      }
      case "offline": {
        if (rt.offlineReason === "budget" && desk) {
          go(desk.x, desk.y);
          plan.push({ k: "pose", pose: "sleep", facing: desk.facing });
        } else {
          this.rentrer(plan, initial);
        }
        break;
      }
      case "meeting": {
        const m = Object.values(world.get().meetings).find((mm) => mm.participants.includes(this.id));
        const seat = this.findSpot("criee");
        if (seat) {
          this.spot = seat;
          go(seat.x, seat.y);
          plan.push({ k: "pose", pose: "sit", facing: seat.facing, dur: 0.05 });
          if (m) plan.push({ k: "do", fn: () => world.meetingArrived(m.id, this.id) });
          plan.push({ k: "pose", pose: "sit", facing: seat.facing });
        } else if (m) {
          plan.push({ k: "do", fn: () => world.meetingArrived(m.id, this.id) });
        }
        break;
      }
      case "talking": {
        const conv = Object.values(world.get().conversations).find((c) => c.a === this.id || c.b === this.id);
        const other = rt.talkWith;
        if (!conv || !other) break;
        if (conv.a === this.id) {
          // l'initiateur rejoint l'autre
          const target = this.meetingCellNear(other);
          if (target) {
            go(target.x, target.y);
          }
          plan.push({ k: "faceAgent", id: other }, { k: "do", fn: () => world.conversationReady(conv.id) }, { k: "pose", pose: "talk" });
        } else {
          // l'autre s'arrête où il est (assis s'il est à son bureau)
          const atDesk = desk && this.cellX === desk.x && this.cellY === desk.y && this.path.length === 0;
          if (atDesk && desk) plan.push({ k: "pose", pose: "sit", facing: desk.facing });
          else plan.push({ k: "walk", x: this.cellX, y: this.cellY, onFail: "skip" }, { k: "faceAgent", id: other }, { k: "pose", pose: "talk" });
        }
        break;
      }
      case "waiting_approval": {
        const spot = this.findSpot("douane");
        if (spot) {
          this.spot = spot;
          this.carrying = true;
          plan.push({ k: "walk", x: spot.x, y: spot.y, onFail: "teleport" });
          plan.push({
            k: "do",
            fn: () => {
              this.carrying = false;
              if (rt.approvalId) world.markDelivered(rt.approvalId);
              this.svc.pileBump();
            },
          });
          plan.push({ k: "pose", pose: "stand", facing: spot.facing, dur: 1.4 });
          plan.push({ k: "do", fn: () => this.svc.release(this.id) });
        } else if (rt.approvalId) {
          const id = rt.approvalId;
          plan.push({ k: "do", fn: () => world.markDelivered(id) });
        }
        if (desk) {
          plan.push({ k: "walk", x: desk.x, y: desk.y, onFail: "teleport" });
          plan.push({ k: "pose", pose: "sit", facing: desk.facing });
        }
        break;
      }
      case "done": {
        plan.push({ k: "pose", pose: "cheer", dur: 2.4 });
        if (desk) plan.push({ k: "pose", pose: "sit", facing: desk.facing });
        break;
      }
      case "idle":
      default:
        this.idlePlan(plan, initial);
    }
    this.plan = plan;
    this.stepStarted = false;
  }

  /** Porte de sa maison (quartier résidentiel), ou le ponton s'il n'en a pas. */
  private maison(): { x: number; y: number } {
    return this.svc.layout.homeOf[this.id] ?? this.svc.layout.home;
  }

  private estNuit(): boolean {
    const h = this.svc.hour();
    return h >= 21 || h < 7;
  }

  /** Rentre chez soi et disparaît dans la maison. */
  private rentrer(plan: Step[], initial: boolean): void {
    const h = this.maison();
    if (initial) plan.push({ k: "teleport", x: h.x, y: h.y }, { k: "fade", to: 0, dur: 0 });
    else plan.push({ k: "walk", x: h.x, y: h.y, onFail: "teleport" }, { k: "fade", to: 0, dur: 0.8 });
  }

  /** Va s'asseoir (ou se poser) sur un emplacement d'un type donné ; false s'il n'y en a pas de libre. */
  private allerA(plan: Step[], kind: Spot["kind"], dur: number, phrases?: string[]): boolean {
    const s = this.findSpot(kind);
    if (!s) return false;
    this.spot = s;
    plan.push({ k: "walk", x: s.x, y: s.y, onFail: "skip" });
    if (phrases && Math.random() < 0.4) plan.push({ k: "do", fn: () => world.say(this.id, auHasard(phrases), 2800) });
    plan.push({ k: "pose", pose: s.pose === "sit" ? "sit" : kind === "sport" ? "cheer" : "stand", facing: s.facing, dur });
    return true;
  }

  private idlePlan(plan: Step[], initial: boolean): void {
    const desk = this.svc.layout.deskOf[this.id];
    const r = Math.random();
    const h = this.svc.hour();
    // la nuit : chacun rentre dormir chez soi (une tâche le fait revenir au bureau)
    if (this.estNuit()) {
      if (this.hidden) {
        plan.push({ k: "pose", pose: "stand", dur: 20 + Math.random() * 20 });
        return;
      }
      if (!initial && Math.random() < 0.3) plan.push({ k: "do", fn: () => world.say(this.id, auHasard(SOIR), 2400) });
      this.rentrer(plan, initial);
      return;
    }
    // midi : déjeuner au restaurant
    if (!initial && h >= 12 && h < 13.75 && r < 0.75 && this.allerA(plan, "resto", 25 + Math.random() * 25, MIDI)) return;
    // fin de journée : sport ou dîner
    if (!initial && h >= 18.5 && h < 21 && r < 0.4 && (this.allerA(plan, r < 0.2 ? "sport" : "resto", 20 + Math.random() * 20, r < 0.2 ? SPORT : MIDI) || this.allerA(plan, "terrasse", 15))) return;
    if (initial || r < 0.3) {
      if (desk) {
        plan.push(initial ? { k: "teleport", x: desk.x, y: desk.y } : { k: "walk", x: desk.x, y: desk.y, onFail: "teleport" });
        plan.push({ k: "pose", pose: "sit", facing: desk.facing, dur: 6 + Math.random() * 14 });
      }
      return;
    }
    if (r < 0.55) {
      // flânerie près du pôle
      const c = this.wanderCell();
      if (c) {
        plan.push({ k: "walk", x: c.x, y: c.y, onFail: "skip" });
        plan.push({ k: "pose", pose: "stand", dur: 2 + Math.random() * 5 });
      }
      return;
    }
    if (r < 0.82) {
      // café au Quai
      const counter = this.findSpot("cafe");
      if (counter) {
        this.spot = counter;
        plan.push({ k: "walk", x: counter.x, y: counter.y, onFail: "skip" });
        plan.push({ k: "pose", pose: "stand", facing: counter.facing, dur: 2.5 });
        if (Math.random() < 0.35) plan.push({ k: "do", fn: () => world.say(this.id, CAFE_LINES[Math.floor(Math.random() * CAFE_LINES.length)]!, 2800) });
        plan.push({
          k: "do",
          fn: () => {
            this.svc.release(this.id);
            const seat = this.findSpot("terrasse");
            const extra: Step[] = [];
            if (seat) {
              this.spot = seat;
              extra.push({ k: "walk", x: seat.x, y: seat.y, onFail: "skip" }, { k: "pose", pose: "sit", facing: seat.facing, dur: 8 + Math.random() * 10 });
            } else {
              extra.push({ k: "pose", pose: "drink", facing: "x+", dur: 6 + Math.random() * 6 });
            }
            this.plan.unshift(...extra);
          },
        });
      }
      return;
    }
    // dans la journée : un peu de lecture, de sport, ou la détente
    if (r < 0.88 && this.allerA(plan, "lecture", 12 + Math.random() * 12, LECTURE)) return;
    if (r < 0.94 && this.allerA(plan, "sport", 10 + Math.random() * 10, SPORT)) return;
    const spot = this.findSpot("detente") ?? this.findSpot("archives");
    if (spot) {
      this.spot = spot;
      plan.push({ k: "walk", x: spot.x, y: spot.y, onFail: "skip" });
      plan.push({ k: "pose", pose: spot.pose === "sit" ? "sit" : "stand", facing: spot.facing, dur: 8 + Math.random() * 10 });
    }
  }

  private findSpot(kind: Spot["kind"]): Spot | null {
    const spots = this.svc.layout.spots.filter((s) => s.kind === kind);
    // le plus proche parmi les libres, avec un peu d'aléatoire
    const free = spots.filter((s) => !this.svc.isReserved(idx(s.x, s.y)) && !this.svc.occupiedBy(idx(s.x, s.y), this.id));
    if (!free.length) return null;
    free.sort((a, b) => Math.abs(a.x - this.cellX) + Math.abs(a.y - this.cellY) - (Math.abs(b.x - this.cellX) + Math.abs(b.y - this.cellY)) + (Math.random() - 0.5) * 4);
    const s = free[0]!;
    this.svc.reserve(idx(s.x, s.y), this.id);
    return s;
  }

  private wanderCell(): { x: number; y: number } | null {
    const desk = this.svc.layout.deskOf[this.id];
    const cx = desk?.x ?? this.cellX;
    const cy = desk?.y ?? this.cellY;
    const cells = this.svc.layout.wanderCells;
    for (let i = 0; i < 30; i++) {
      const c = cells[Math.floor(Math.random() * cells.length)]!;
      const x = c % GW;
      const y = (c / GW) | 0;
      if (Math.abs(x - cx) + Math.abs(y - cy) < 14 && !this.svc.occupiedBy(c, this.id)) return { x, y };
    }
    return null;
  }

  private meetingCellNear(otherId: string): { x: number; y: number } | null {
    const oc = this.svc.agentCell(otherId);
    if (!oc) return null;
    const { blocked } = this.svc.layout;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const md = Math.abs(dx) + Math.abs(dy);
        if (md === 0 || md > 2) continue;
        const x = oc.x + dx;
        const y = oc.y + dy;
        if (x < 0 || y < 0 || x >= GW || y >= GW) continue;
        const i = idx(x, y);
        if (blocked[i] || this.svc.isReserved(i) || this.svc.occupiedBy(i, this.id)) continue;
        const isDesk = Object.values(this.svc.layout.deskOf).some((d) => d.x === x && d.y === y);
        const d = md * 10 + (isDesk ? 25 : 0) + (Math.abs(x - this.cellX) + Math.abs(y - this.cellY)) * 0.1;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    return best;
  }

  // ---------------------------------------------------------------- mise à jour
  update(dt: number, rt: AgentRuntime | undefined): void {
    this.anim += dt;
    this.runPlan(dt, rt);
    this.render(rt);
  }

  private runPlan(dt: number, rt: AgentRuntime | undefined): void {
    let guard = 0;
    while (this.plan.length && guard++ < 8) {
      const step = this.plan[0]!;
      if (!this.stepStarted) {
        this.stepStarted = true;
        this.stepTime = 0;
        if (step.k === "walk") {
          const p = findPath(this.svc.layout.blocked, this.svc.extraCost, this.cellX, this.cellY, step.x, step.y);
          if (p === null) {
            if (step.onFail === "teleport") this.teleport(step.x, step.y);
            this.next();
            continue;
          }
          this.path = p;
        }
      }
      switch (step.k) {
        case "teleport":
          this.teleport(step.x, step.y);
          this.next();
          continue;
        case "do":
          this.next();
          step.fn();
          continue;
        case "faceAgent": {
          const oc = this.svc.agentCell(step.id);
          if (oc) this.facing = faceToward(this.cellX, this.cellY, oc.x, oc.y, this.facing);
          this.next();
          continue;
        }
        case "fade": {
          this.stepTime += dt;
          const t = step.dur <= 0 ? 1 : Math.min(1, this.stepTime / step.dur);
          this.alpha = step.to === 1 ? t : 1 - t;
          this.hidden = step.to === 0 && t >= 1;
          if (step.to === 1) this.hidden = false;
          if (t >= 1) {
            this.next();
            continue;
          }
          return;
        }
        case "walk": {
          if (this.moveAlongPath(dt)) {
            this.next();
            continue;
          }
          this.pose = "walk";
          return;
        }
        case "pose": {
          this.pose = step.pose;
          if (step.facing) this.facing = step.facing;
          this.stepTime += dt;
          if (step.dur !== undefined && this.stepTime >= step.dur) {
            this.next();
            if (!this.plan.length && rt && (rt.state === "idle" || rt.state === "done")) {
              if (rt.state === "idle") this.rebuild(rt);
            }
            continue;
          }
          return;
        }
      }
    }
    if (!this.plan.length && rt?.state === "idle") this.rebuild(rt);
  }

  private next(): void {
    this.plan.shift();
    this.stepStarted = false;
  }

  private teleport(x: number, y: number): void {
    this.cellX = x;
    this.cellY = y;
    this.u = x + 0.5;
    this.v = y + 0.5;
    this.path = [];
  }

  /** @returns true quand l'arrivée est atteinte */
  private moveAlongPath(dt: number): boolean {
    let budget = SPEED * dt;
    while (budget > 0) {
      // d'abord rejoindre le centre de la case courante
      const tx = this.cellX + 0.5;
      const ty = this.cellY + 0.5;
      const dx = tx - this.u;
      const dy = ty - this.v;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > 1e-4) {
        const m = Math.min(budget, d);
        // déplacement axe par axe (pas de diagonale)
        if (Math.abs(dx) > 1e-4) {
          const s = Math.min(m, Math.abs(dx));
          this.u += Math.sign(dx) * s;
          budget -= s;
          this.facing = dx > 0 ? "x+" : "x-";
        } else {
          const s = Math.min(m, Math.abs(dy));
          this.v += Math.sign(dy) * s;
          budget -= s;
          this.facing = dy > 0 ? "y+" : "y-";
        }
        continue;
      }
      const nextCell = this.path.shift();
      if (nextCell === undefined) return true;
      this.cellX = nextCell % GW;
      this.cellY = (nextCell / GW) | 0;
    }
    return false;
  }

  // ---------------------------------------------------------------- rendu
  private render(rt: AgentRuntime | undefined): void {
    const p = iso(this.u, this.v);
    // célébration : petits sauts
    this.jump = this.pose === "cheer" ? -Math.round(Math.abs(Math.sin(this.anim * 7)) * 4) : 0;
    this.container.x = Math.round(p.x);
    this.container.y = Math.round(p.y);
    this.container.zIndex = p.y + 0.5;
    this.container.visible = !this.hidden;
    this.container.alpha = this.alpha;

    const front = this.facing === "x+" || this.facing === "y+";
    const flip = this.facing === "y+" || this.facing === "x-";
    let frame: FrameName;
    const a = this.anim;
    switch (this.pose) {
      case "walk": {
        const f = Math.floor(a * 8) % 4;
        frame = (front ? `F_walk${f}` : `B_walk${f}`) as FrameName;
        break;
      }
      case "sit":
        frame = front ? "F_sit" : "B_sit";
        break;
      case "type":
        frame = front ? (Math.floor(a * 4) % 2 ? "F_type1" : "F_type0") : "B_sit";
        break;
      case "talk": {
        const t = this.speaking ? Math.floor(a * 4) % 2 : 1;
        frame = front ? (t ? "F_talk1" : "F_talk0") : t ? "B_talk1" : "B_talk0";
        break;
      }
      case "drink":
        frame = front ? (a % 4 < 1.2 ? "F_drink0" : "F_drink1") : "B_walk0";
        break;
      case "sleep":
        frame = "F_sleep";
        break;
      case "cheer":
        frame = Math.floor(a * 6) % 2 ? "F_cheer1" : "F_cheer0";
        break;
      default:
        frame = front ? "F_walk0" : "B_walk0";
    }
    this.body.texture = this.svc.frames(`${this.id}:${frame}`);
    this.body.scale.x = flip ? -1 : 1;
    this.body.y = this.jump;
    const sitting = this.pose === "sit" || this.pose === "type" || this.pose === "sleep";
    this.shadow.visible = !sitting;
    this.carry.visible = this.carrying;
    this.carry.x = flip ? -6 : 6;
    this.carry.y = -9;
    const waiting = rt?.state === "waiting_approval";
    this.icon.visible = waiting && !this.carrying;
    this.icon.y = (sitting ? -26 : -29) + Math.round(Math.sin(a * 3) * 1);
    this.zzz.visible = this.pose === "sleep";
    if (this.zzz.visible) {
      const t = (a * 0.6) % 1;
      this.zzz.x = 4 + Math.round(t * 6);
      this.zzz.y = -24 - Math.round(t * 10);
      this.zzz.alpha = 1 - t;
    }
  }
}

function faceToward(x: number, y: number, tx: number, ty: number, cur: Facing): Facing {
  const dx = tx - x;
  const dy = ty - y;
  if (dx === 0 && dy === 0) return cur;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "x+" : "x-";
  return dy > 0 ? "y+" : "y-";
}

export const agentName = (id: string): string => agentById(id)?.nom ?? id;
export { cellCenter };
