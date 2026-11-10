import { Container, Sprite, type Texture } from "pixi.js";
import { GW, T, WORLD_W, idx, iso, type Layout } from "./layout";
import { PHARE_LANTERN } from "./sprites/props";

type Frames = (key: string) => Texture;

// ------------------------------------------------------------------ barques sur le canal
interface Boat {
  s: Sprite;
  u: number;
  min: number;
  max: number;
  dir: number;
  pause: number;
  speed: number;
}

export class Boats {
  private boats: Boat[] = [];
  private t = 0;
  constructor(objects: Container, layout: Layout, frames: Frames) {
    // segments d'eau libre entre les ponts (rangée 29)
    const segs: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= GW; x++) {
      const water = x < GW && layout.tiles[idx(x, 29)] === T.WATER;
      if (water && start < 0) start = x;
      if (!water && start >= 0) {
        if (x - start > 5) segs.push([start + 1.3, x - 1.3]);
        start = -1;
      }
    }
    segs.forEach(([min, max], i) => {
      const s = new Sprite(frames(`boat:${i % 3}`));
      const f = frames(`boat:${i % 3}`);
      s.pivot.set(22, 18);
      void f;
      objects.addChild(s);
      this.boats.push({ s, u: min + (max - min) * Math.random(), min, max, dir: Math.random() < 0.5 ? 1 : -1, pause: 0, speed: 0.35 + Math.random() * 0.25 });
    });
  }
  update(dt: number): void {
    this.t += dt;
    for (const b of this.boats) {
      if (b.pause > 0) b.pause -= dt;
      else {
        b.u += b.dir * b.speed * dt;
        if (b.u > b.max || b.u < b.min) {
          b.u = Math.max(b.min, Math.min(b.max, b.u));
          b.dir *= -1;
          b.pause = 3 + Math.random() * 6;
        } else if (Math.random() < dt * 0.02) b.pause = 2 + Math.random() * 4;
      }
      const p = iso(b.u, 30);
      b.s.x = Math.round(p.x);
      b.s.y = Math.round(p.y + Math.sin(this.t * 1.6 + b.min) * 0.8);
      b.s.zIndex = p.y + 4;
    }
  }
}

// ------------------------------------------------------------------ mouettes
interface Gull {
  s: Sprite;
  x: number;
  y: number;
  vx: number;
  phase: number;
  wait: number;
}

export class Gulls {
  private gulls: Gull[] = [];
  constructor(
    private fx: Container,
    private frames: Frames,
  ) {
    for (let i = 0; i < 4; i++) {
      const s = new Sprite(frames("fx:gull0"));
      s.anchor.set(0.5);
      fx.addChild(s);
      const g: Gull = { s, x: 0, y: 0, vx: 0, phase: Math.random() * 10, wait: Math.random() * 12 };
      this.respawn(g);
      g.x = Math.random() * WORLD_W;
      this.gulls.push(g);
    }
  }
  private respawn(g: Gull): void {
    const ltr = Math.random() < 0.5;
    g.vx = (ltr ? 1 : -1) * (28 + Math.random() * 22);
    g.x = ltr ? -40 : WORLD_W + 40;
    g.y = 120 + Math.random() * 700;
    g.s.scale.x = ltr ? 1 : -1;
  }
  update(dt: number): void {
    for (const g of this.gulls) {
      if (g.wait > 0) {
        g.wait -= dt;
        g.s.visible = false;
        continue;
      }
      g.s.visible = true;
      g.phase += dt;
      g.x += g.vx * dt;
      const flap = Math.floor(g.phase * 5) % 2 === 0 && g.phase % 4 < 2.6;
      g.s.texture = this.frames(flap ? "fx:gull0" : "fx:gull1");
      g.s.x = Math.round(g.x);
      g.s.y = Math.round(g.y + Math.sin(g.phase * 1.3) * 6);
      if (g.x < -60 || g.x > WORLD_W + 60) {
        this.respawn(g);
        g.wait = 6 + Math.random() * 18;
      }
    }
  }
}

// ------------------------------------------------------------------ reflets sur le canal
export class Sparkles {
  private items: { s: Sprite; life: number; max: number }[] = [];
  private cells: number[] = [];
  constructor(layer: Container, layout: Layout, frames: Frames) {
    for (let i = 0; i < layout.tiles.length; i++) if (layout.tiles[i] === T.WATER) this.cells.push(i);
    for (let i = 0; i < 16; i++) {
      const s = new Sprite(frames("fx:sparkle"));
      s.anchor.set(0.5);
      s.alpha = 0;
      layer.addChild(s);
      this.items.push({ s, life: Math.random() * 2, max: 0 });
    }
  }
  update(dt: number): void {
    for (const it of this.items) {
      it.life -= dt;
      if (it.life <= 0) {
        const c = this.cells[Math.floor(Math.random() * this.cells.length)];
        if (c === undefined) continue;
        const p = iso((c % GW) + Math.random(), Math.floor(c / GW) + Math.random());
        it.s.x = Math.round(p.x);
        it.s.y = Math.round(p.y);
        it.max = 0.6 + Math.random() * 0.9;
        it.life = it.max + Math.random() * 1.5;
      }
      const t = it.life / Math.max(0.01, it.max);
      it.s.alpha = t > 0 && t <= 1 ? Math.sin(t * Math.PI) * 0.9 : 0;
    }
  }
}

// ------------------------------------------------------------------ particules (vapeur, confettis)
interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  fade: boolean;
}

const CONFETTI = [0xff6f61, 0xffd166, 0x06d6a0, 0x118ab2, 0x8b5cf6, 0xff8fab];

export class Particles {
  private pool: Particle[] = [];
  constructor(
    private layer: Container,
    private frames: Frames,
  ) {}
  private get(key: string): Particle {
    let p = this.pool.find((x) => x.life <= 0);
    if (!p) {
      const s = new Sprite(this.frames(key));
      s.anchor.set(0.5);
      this.layer.addChild(s);
      p = { s, vx: 0, vy: 0, g: 0, life: 0, max: 1, fade: true };
      this.pool.push(p);
    }
    p.s.texture = this.frames(key);
    p.s.visible = true;
    p.s.tint = 0xffffff;
    p.s.scale.set(1);
    return p;
  }
  confetti(x: number, y: number): void {
    for (let i = 0; i < 22; i++) {
      const p = this.get("fx:px");
      p.s.x = x;
      p.s.y = y;
      p.vx = (Math.random() - 0.5) * 70;
      p.vy = -40 - Math.random() * 50;
      p.g = 110;
      p.max = p.life = 1 + Math.random() * 0.6;
      p.s.tint = CONFETTI[i % CONFETTI.length]!;
      p.fade = true;
    }
  }
  steam(x: number, y: number): void {
    const p = this.get("fx:steam");
    p.s.x = x + (Math.random() - 0.5) * 2;
    p.s.y = y;
    p.vx = (Math.random() - 0.5) * 3;
    p.vy = -7 - Math.random() * 4;
    p.g = 0;
    p.max = p.life = 1.6 + Math.random();
    p.fade = true;
  }
  update(dt: number): void {
    for (const p of this.pool) {
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      p.life -= dt;
      p.vy += p.g * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      if (p.fade) p.s.alpha = Math.max(0, Math.min(1, (p.life / p.max) * 1.5));
      if (p.s.texture === this.frames("fx:steam")) p.s.scale.set(1 + (1 - p.life / p.max) * 0.8);
    }
  }
}

// ------------------------------------------------------------------ pile de colis de La Douane
export class Pile {
  readonly container = new Container();
  private count = -1;
  private bump = 0;
  constructor(
    objects: Container,
    layout: Layout,
    private frames: Frames,
  ) {
    const c = iso(layout.pileCell.x + 0.5, layout.pileCell.y + 0.5);
    this.container.x = Math.round(c.x);
    this.container.y = Math.round(c.y);
    this.container.zIndex = c.y;
    objects.addChild(this.container);
  }
  set(n: number): void {
    const count = Math.min(16, n);
    if (count === this.count) return;
    this.count = count;
    this.container.removeChildren().forEach((c) => c.destroy());
    // colis et enveloppes empilés en quinconce
    const spots = [
      [0, 0], [-6, -3], [6, -3], [0, -6], [-3, -9], [4, -9], [0, -12], [-6, -12],
      [5, -15], [-1, -16], [-4, -19], [3, -20], [0, -23], [-5, -24], [4, -26], [0, -29],
    ] as const;
    for (let i = 0; i < count; i++) {
      const [x, y] = spots[i]!;
      const s = new Sprite(this.frames(i % 3 === 1 ? "item:envelope" : "item:parcel"));
      s.anchor.set(0.5, 1);
      s.x = x;
      s.y = y + 3;
      this.container.addChild(s);
    }
  }
  bumpIt(): void {
    this.bump = 0.35;
  }
  update(dt: number): void {
    if (this.bump > 0) {
      this.bump -= dt;
      this.container.scale.y = 1 + Math.sin((this.bump / 0.35) * Math.PI) * 0.12;
    } else this.container.scale.y = 1;
  }
}

// ------------------------------------------------------------------ phare
export class Lighthouse {
  private beam: Sprite;
  private glow: Sprite;
  private angle = 0;
  private t = 0;
  readonly lantern: { x: number; y: number };
  constructor(lights: Container, layout: Layout, beamTex: Texture, glowTex: Texture) {
    const c = iso(layout.pharePos.x + 0.5, layout.pharePos.y + 0.5);
    this.lantern = { x: c.x + PHARE_LANTERN.dx, y: c.y + PHARE_LANTERN.dy };
    this.beam = new Sprite(beamTex);
    this.beam.anchor.set(0, 0.5);
    this.beam.blendMode = "add";
    this.beam.position.set(this.lantern.x, this.lantern.y);
    this.glow = new Sprite(glowTex);
    this.glow.anchor.set(0.5);
    this.glow.blendMode = "add";
    this.glow.tint = 0xfff1b8;
    this.glow.position.set(this.lantern.x, this.lantern.y);
    lights.addChild(this.beam, this.glow);
  }
  update(dt: number, night: number, pending: number): void {
    this.t += dt;
    const urgent = pending > 0;
    this.angle += dt * (urgent ? 2.6 + Math.min(pending, 8) * 0.25 : 0.7);
    const c = Math.cos(this.angle);
    this.beam.scale.set(c * 1.15, 0.5 + 0.5 * Math.abs(Math.sin(this.angle)));
    const vis = 0.18 + night * 0.7;
    this.beam.alpha = vis * (0.35 + 0.65 * Math.abs(c));
    const blink = urgent ? 0.5 + 0.5 * Math.sign(Math.sin(this.t * (4 + Math.min(pending, 8)))) : 1;
    this.glow.alpha = (0.35 + night * 0.65) * (urgent ? 0.4 + blink * 0.6 : 0.8);
    this.glow.scale.set(urgent ? 1.6 + blink * 0.5 : 1.4);
    this.glow.tint = urgent && blink > 0.5 ? 0xffb199 : 0xfff1b8;
  }
}
