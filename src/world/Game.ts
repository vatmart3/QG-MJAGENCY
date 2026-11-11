import { Application, CanvasSource, Container, Rectangle, Sprite, Texture, TextureSource, type FederatedPointerEvent } from "pixi.js";
import { Viewport } from "pixi-viewport";
import { agentById, allAgents } from "@/data/catalog";
import { parisHour } from "@/lib/paris";
import { ui, uiStore } from "@/store/ui";
import { world } from "@/store/world";
import { AgentView, type WorldServices } from "./agents/AgentView";
import { Balises, Boats, Gulls, Lighthouse, Particles, Pile, Sparkles, Traffic } from "./ambient";
import { ambianceAt } from "./daynight";
import { T, WORLD_H, WORLD_W, getLayout, idx, iso, tourDe, worldToCell, zoneAt, type Layout, type Prop } from "./layout";
import type { StyleVille } from "./theme";
import { tourSommet } from "./sprites/newyork";
import { Overlay } from "./overlay";
import { makeBeamTexture, makeGlowTexture, SkyLayer } from "./sky";
import { buildAtlas, type AtlasFrame } from "./sprites/atlas";
import { characterAtlasDefs } from "./sprites/characters";
import { renderGround } from "./sprites/ground";
import { carDefs, dessinerEnStyle, litKeyAt, miscDefs, propDefs, propKey, slabDefs, slabKey, towerLitDefs } from "./sprites/props";

/**
 * LE PORT — la ville. Une instance par page.
 * Scène : ciel (écran) → viewport [reflet, monde teinté (sol, objets triés), lumières, effets] → nuages proches (écran).
 */

export interface GameOptions {
  onZoneClick: (zoneId: string) => void;
  /** décor de la ville (par défaut : le choix enregistré dans ce navigateur) */
  style?: StyleVille;
}

const MULTI_FLAT: Prop["kind"][] = ["bigTable", "babyfoot", "pingpong", "counter", "stampDesk"];

export class Game {
  private app: Application;
  private viewport!: Viewport;
  private layout: Layout;
  private frameTex = new Map<string, Texture>();
  private atlasSource!: CanvasSource;
  private groundSource!: CanvasSource;
  private sky!: SkyLayer;
  private snap = new Container();
  private tinted = new Container();
  private objects = new Container();
  private waterFx = new Container();
  private lights = new Container();
  private fx = new Container();
  private agents = new Map<string, AgentView>();
  private reservations = new Map<number, string>();
  private overlay!: Overlay;
  private boats!: Boats;
  private gulls!: Gulls;
  private sparkles!: Sparkles;
  private particles!: Particles;
  private pile!: Pile;
  private phare!: Lighthouse;
  private traffic: Traffic | null = null;
  private balises: Balises | null = null;
  private towerLights: Sprite[] = [];
  private agentCells = new Set<number>();
  private lampGlows: Sprite[] = [];
  private deskGlows = new Map<string, Sprite>();
  private glowTex!: Texture;
  private extraCost: Uint8Array;
  private zoomLevels: number[] = [];
  private zoomTween: { s0: number; s1: number; t: number; dur: number; sx: number; sy: number; wx: number; wy: number } | null = null;
  private wheelAcc = 0;
  private tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  private lastPresence = 0;
  private lastHourCheck = 0;
  private hour = 12;
  private steamT = 0;
  private coffeePos = { x: 0, y: 0 };
  private destroyed = false;
  private cleanup: (() => void)[] = [];
  private pixelMode: "nearest" | "linear" = "nearest";

  private constructor(
    private host: HTMLElement,
    private overlayEl: HTMLElement,
    private opts: GameOptions,
  ) {
    this.app = new Application();
    this.layout = getLayout(opts.style);
    // allées un peu moins chères que l'herbe → les bonshommes suivent les chemins
    // (New York : trottoirs d'abord, la chaussée est aux taxis, les pelouses en dernier)
    this.extraCost = new Uint8Array(this.layout.tiles.length);
    const ny = this.layout.style === "newyork";
    for (let i = 0; i < this.layout.tiles.length; i++) {
      const t = this.layout.tiles[i];
      this.extraCost[i] = ny ? (t === T.GRASS ? (this.layout.parc[i] ? 2 : 0) : t === T.PATH ? 1 : 0) : t === T.GRASS ? 2 : 0;
    }
  }

  static async create(host: HTMLElement, overlayEl: HTMLElement, opts: GameOptions): Promise<Game> {
    TextureSource.defaultOptions.scaleMode = "nearest";
    const g = new Game(host, overlayEl, opts);
    await g.init();
    return g;
  }

  private frames = (key: string): Texture => {
    const t = this.frameTex.get(key);
    if (!t) throw new Error(`Sprite manquant : ${key}`);
    return t;
  };

  private async init(): Promise<void> {
    const res = Math.min(window.devicePixelRatio || 1, 3);
    await this.app.init({
      resizeTo: this.host,
      antialias: false,
      background: 0xb7b3f2,
      resolution: res,
      autoDensity: true,
      preference: "webgl",
      powerPreference: "high-performance",
    });
    if (this.destroyed) return;
    this.app.canvas.style.imageRendering = "pixelated";
    this.app.canvas.style.touchAction = "none";
    this.host.appendChild(this.app.canvas);

    // ---- textures procédurales
    const L = this.layout;
    const ny = L.style === "newyork";
    dessinerEnStyle(L.style);
    const atlas = buildAtlas([
      ...propDefs(L.props),
      ...slabDefs(L.slabs, L.zones),
      ...miscDefs(),
      ...characterAtlasDefs(allAgents().map((a) => a.id)),
      ...(ny ? [...towerLitDefs(L.props, L.zones), ...carDefs()] : []),
    ]);
    this.atlasSource = new CanvasSource({ resource: atlas.canvas, scaleMode: "nearest" });
    const frameData = new Map<string, AtlasFrame>();
    for (const [key, f] of atlas.frames) {
      frameData.set(key, f);
      this.frameTex.set(key, new Texture({ source: this.atlasSource, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
    }
    this.groundSource = new CanvasSource({ resource: renderGround(L), scaleMode: "nearest" });
    const groundTex = new Texture({ source: this.groundSource });
    this.glowTex = makeGlowTexture();

    // ---- scène
    this.sky = new SkyLayer(L.style);
    this.viewport = new Viewport({
      screenWidth: this.app.screen.width,
      screenHeight: this.app.screen.height,
      worldWidth: WORLD_W,
      worldHeight: WORLD_H,
      events: this.app.renderer.events,
      passiveWheel: false,
      threshold: 6,
    });
    this.app.stage.addChild(this.sky.back, this.viewport, this.sky.front);
    this.viewport.addChild(this.snap);

    // reflet de l'île dans l'étang
    const reflection = new Sprite(groundTex);
    reflection.scale.set(1, -0.32);
    reflection.y = WORLD_H + 300;
    reflection.alpha = 0.1;
    reflection.tint = 0x6f7fd0;
    this.snap.addChild(reflection);

    const ground = new Sprite(groundTex);
    this.tinted.addChild(ground, this.waterFx, this.objects);
    this.objects.sortableChildren = true;
    this.snap.addChild(this.tinted, this.lights, this.fx);
    this.lights.blendMode = "add";

    this.placeProps(frameData);
    this.placeAgents();

    this.boats = new Boats(this.objects, L, this.frames);
    this.gulls = new Gulls(this.fx, this.frames);
    this.sparkles = new Sparkles(this.waterFx, L, this.frames);
    this.particles = new Particles(this.fx, this.frames);
    this.pile = new Pile(this.objects, L, this.frames);
    this.phare = new Lighthouse(this.lights, L, makeBeamTexture(), this.glowTex);
    if (ny) {
      this.traffic = new Traffic(this.objects, this.lights, L, this.frames, this.glowTex, (cell) => this.agentCells.has(cell));
      const sommets = L.props
        .filter((p) => p.kind === "tower" && tourSommet(p.variant ?? 0) > 0)
        .map((p) => {
          const c = iso(p.x + (p.w ?? 1) / 2, p.y + (p.h ?? 1) / 2);
          return { x: c.x, y: c.y - tourSommet(p.variant ?? 0) };
        });
      this.balises = new Balises(this.lights, sommets, this.glowTex);
    }

    this.overlay = new Overlay(this.overlayEl, L, (z) => this.opts.onZoneClick(z), iso(L.pharePos.x + 0.5, L.pharePos.y + 0.5));

    this.setupCamera();
    this.setupInput();
    this.sky.resize(this.app.screen.width, this.app.screen.height);

    const onResize = () => {
      this.viewport.resize(this.app.screen.width, this.app.screen.height, WORLD_W, WORLD_H);
      this.sky.resize(this.app.screen.width, this.app.screen.height);
    };
    this.app.renderer.on("resize", onResize);
    this.cleanup.push(() => this.app.renderer.off("resize", onResize));

    this.app.ticker.add((t) => this.update(Math.min(0.1, t.deltaMS / 1000)));
    uiStore.setState({ ready: true });
  }

  // ---------------------------------------------------------------- décor
  private placeProps(frameData: Map<string, AtlasFrame>): void {
    const L = this.layout;
    for (const p of L.props) {
      if (p.kind === "pile") continue;
      const key = propKey(p);
      const f = frameData.get(key);
      if (!f) continue;
      const s = new Sprite(this.frames(key));
      const o = iso(p.x, p.y);
      s.x = o.x - f.ax;
      s.y = o.y - f.ay;
      const fw = p.w ?? 1;
      const fh = p.h ?? 1;
      const flat = MULTI_FLAT.includes(p.kind);
      const ref = flat ? iso(p.x + 0.5, p.y + 0.5) : iso(p.x + fw - 0.5, p.y + fh - 0.5);
      s.zIndex = ref.y + (p.zBias ?? 0);
      this.objects.addChild(s);
      if (p.kind === "tower") {
        // fenêtres allumées la nuit (calque ajouté en lumière, masqué derrière ce qui est devant)
        const lk = litKeyAt(p);
        const lf = frameData.get(lk);
        if (lf) {
          const l = new Sprite(this.frames(lk));
          l.x = o.x - lf.ax;
          l.y = o.y - lf.ay;
          l.alpha = 0;
          this.lights.addChild(l);
          this.towerLights.push(l);
        }
      }
      if (p.kind === "lamp") {
        // un lampadaire caché derrière un gratte-ciel n'éclaire pas sa façade
        if (this.derriereUneTour(p.x + 0.5, p.y + 0.5, 31)) continue;
        const g = new Sprite(this.glowTex);
        g.anchor.set(0.5);
        const c = iso(p.x + 0.5, p.y + 0.5);
        g.position.set(c.x, c.y - 31);
        g.tint = 0xffc870;
        g.scale.set(1.5);
        this.lights.addChild(g);
        this.lampGlows.push(g);
      }
      if (p.kind === "coffee") {
        const c = iso(p.x + 0.5, p.y + 0.5);
        this.coffeePos = { x: c.x, y: c.y - 27 };
      }
    }
    const zmap = new Map(L.zones.map((z) => [z.id, z]));
    for (const sl of L.slabs) {
      const z = zmap.get(sl.zone);
      if (!z) continue;
      const key = slabKey(sl, z);
      const f = frameData.get(key);
      if (!f) continue;
      const s = new Sprite(this.frames(key));
      const o = iso(sl.x, sl.y);
      s.x = o.x - f.ax;
      s.y = o.y - f.ay;
      const c = iso(sl.x + 0.5, sl.y + 0.5);
      s.zIndex = c.y + (sl.side === "x+" || sl.side === "y+" ? 4 : -4);
      this.objects.addChild(s);
    }
    // lueur de la verrière la nuit
    const dg = L.zones.find((z) => z.id === "direction");
    if (dg) {
      const g = new Sprite(this.glowTex);
      g.anchor.set(0.5);
      const c = iso(dg.x + dg.w / 2, dg.y + dg.h / 2);
      g.position.set(c.x, c.y - 10);
      g.scale.set(4, 2.4);
      g.tint = 0xffd9a0;
      this.lights.addChild(g);
      this.lampGlows.push(g);
    }
  }

  /** Le point (case u, v, hauteur z) est-il masqué par un gratte-ciel situé devant ? */
  private derriereUneTour(u: number, v: number, z: number): boolean {
    const q = iso(u, v);
    const y = q.y - z;
    for (const t of this.layout.props) {
      if (t.kind !== "tower") continue;
      const w = t.w ?? 1, h = t.h ?? 1;
      if (t.x + w + t.y + h <= u + v + 0.5) continue;
      const g = iso(t.x, t.y + h).x, d = iso(t.x + w, t.y).x;
      const haut = iso(t.x, t.y).y - tourDe(t.variant ?? 0).hauteur, bas = iso(t.x + w, t.y + h).y;
      if (q.x > g + 2 && q.x < d - 2 && y > haut + 4 && y < bas - 4) return true;
    }
    return false;
  }

  private placeAgents(): void {
    const svc: WorldServices = {
      layout: this.layout,
      frames: this.frames,
      reserve: (k, id) => {
        const cur = this.reservations.get(k);
        if (cur && cur !== id) return false;
        this.reservations.set(k, id);
        return true;
      },
      release: (id) => {
        for (const [k, v] of this.reservations) if (v === id) this.reservations.delete(k);
      },
      isReserved: (k) => this.reservations.has(k),
      occupiedBy: (cell, except) => {
        for (const a of this.agents.values()) if (a.id !== except && !a.isHidden && idx(a.cellX, a.cellY) === cell) return true;
        return false;
      },
      agentCell: (id) => {
        const a = this.agents.get(id);
        return a ? { x: a.cellX, y: a.cellY } : null;
      },
      confetti: (x, y) => this.particles.confetti(x, y),
      pileBump: () => this.pile.bumpIt(),
      hour: () => this.hour,
      extraCost: this.extraCost,
    };
    const tex = {
      shadow: this.frames("fx:shadow"),
      carry: this.frames("fx:carry"),
      hourglass: this.frames("fx:hourglass"),
      z: this.frames("fx:z"),
      ring: this.frames("fx:ring"),
    };
    for (const a of allAgents()) {
      const v = new AgentView(a.id, svc, tex);
      this.agents.set(a.id, v);
      this.objects.addChild(v.container);
      const g = new Sprite(this.glowTex);
      g.anchor.set(0.5);
      g.tint = 0x8fd8ff;
      g.scale.set(0.55, 0.4);
      g.alpha = 0;
      const d = this.layout.deskOf[a.id];
      if (d) {
        const c = iso(d.x + 0.5, d.y + 1.5);
        g.position.set(c.x, c.y - 16);
      }
      this.lights.addChild(g);
      this.deskGlows.set(a.id, g);
    }
  }

  // ---------------------------------------------------------------- caméra
  private setupCamera(): void {
    const res = this.app.renderer.resolution;
    const ks = [0.5, 1];
    for (let k = 2; k <= Math.round(4 * res); k++) ks.push(k);
    this.zoomLevels = [...new Set(ks.map((k) => k / res))].filter((s) => s >= 0.15 && s <= 4).sort((a, b) => a - b);

    const vp = this.viewport;
    vp.drag({ pressDrag: true, clampWheel: false, wheel: false }).pinch().decelerate({ friction: 0.92 });
    vp.clamp({ left: -WORLD_W * 0.15, right: WORLD_W * 1.15, top: -WORLD_H * 0.25, bottom: WORLD_H * 1.1, underflow: "center" });

    const sw = this.app.screen.width;
    const mobile = sw < 700;
    // desktop : 1 px d'art = 1 px CSS au minimum ; mobile : 2 px physiques par px d'art
    let s = this.zoomLevels.find((z) => z >= 1 - 1e-3) ?? 1;
    if (sw >= 2400) s = this.zoomLevels.find((z) => z >= 1.5 - 1e-3) ?? s;
    if (mobile) s = this.zoomLevels.find((z) => z * res >= 2) ?? s;
    vp.setZoom(s, true);
    const target = mobile ? iso(26, 16) : iso(27, 24);
    vp.moveCenter(target.x, target.y);
    this.updatePixelMode();

    vp.on("pinch-end", () => {
      const sc = vp.scale.x;
      const nearest = this.zoomLevels.reduce((a, b) => (Math.abs(b - sc) < Math.abs(a - sc) ? b : a));
      this.zoomAround(nearest, this.app.screen.width / 2, this.app.screen.height / 2);
    });
  }

  private zoomAround(s1: number, sx: number, sy: number, dur = 0.18): void {
    const vp = this.viewport;
    const w = vp.toWorld(sx, sy);
    this.zoomTween = { s0: vp.scale.x, s1, t: 0, dur, sx, sy, wx: w.x, wy: w.y };
  }

  /** tests : place la caméra sur une case avec une échelle donnée */
  debugView(u: number, v: number, scale: number): void {
    this.viewport.setZoom(scale, true);
    const p = iso(u, v);
    this.viewport.moveCenter(p.x, p.y);
  }

  zoomStep(dir: 1 | -1, sx?: number, sy?: number): void {
    const cur = this.zoomTween?.s1 ?? this.viewport.scale.x;
    const i = this.zoomLevels.findIndex((z) => z >= cur - 1e-3);
    const base = i < 0 ? this.zoomLevels.length - 1 : i;
    const next = this.zoomLevels[Math.max(0, Math.min(this.zoomLevels.length - 1, base + dir))]!;
    this.zoomAround(next, sx ?? this.app.screen.width / 2, sy ?? this.app.screen.height / 2);
  }

  flyTo(wx: number, wy: number, minScale = 2): void {
    const res = this.app.renderer.resolution;
    const target = Math.max(this.viewport.scale.x, this.zoomLevels.find((z) => z >= minScale - 1e-3) ?? minScale);
    const s = Math.round(target * res) / res;
    this.zoomTween = null;
    this.viewport.animate({ position: { x: wx, y: wy }, scale: s, time: 700, ease: "easeInOutSine", removeOnInterrupt: true });
  }

  flyToAgent(id: string): void {
    const a = this.agents.get(id);
    if (!a) return;
    if (a.isHidden) {
      const d = this.layout.deskOf[id];
      if (d) {
        const p = iso(d.x + 0.5, d.y + 0.5);
        this.flyTo(p.x, p.y - 10);
      }
      return;
    }
    const p = a.worldPos;
    this.flyTo(p.x, p.y - 12);
  }

  flyToZone(zoneId: string): void {
    if (zoneId === "phare") {
      const p = iso(this.layout.pharePos.x + 0.5, this.layout.pharePos.y + 0.5);
      this.flyTo(p.x, p.y - 40, 1.5);
      return;
    }
    const z = this.layout.zones.find((zz) => zz.id === zoneId);
    if (!z) return;
    const p = iso(z.x + z.w / 2, z.y + z.h / 2);
    this.flyTo(p.x, p.y - 10, 1.5);
  }

  private updatePixelMode(): void {
    const k = this.viewport.scale.x * this.app.renderer.resolution;
    const mode = k < 0.99 ? "linear" : "nearest";
    if (mode !== this.pixelMode) {
      this.pixelMode = mode;
      this.atlasSource.scaleMode = mode;
      this.groundSource.scaleMode = mode;
    }
  }

  // ---------------------------------------------------------------- entrées
  private setupInput(): void {
    const canvas = this.app.canvas;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.wheelAcc += e.deltaY * (e.ctrlKey ? 3 : 1);
      if (Math.abs(this.wheelAcc) >= 60) {
        const rect = canvas.getBoundingClientRect();
        this.zoomStep(this.wheelAcc < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
        this.wheelAcc = 0;
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    this.cleanup.push(() => canvas.removeEventListener("wheel", onWheel));

    const onMouse = (e: MouseEvent) => {
      this.tilt.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      this.tilt.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMouse);
    this.cleanup.push(() => window.removeEventListener("mousemove", onMouse));
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      this.tilt.tx = Math.max(-1, Math.min(1, e.gamma / 30));
      this.tilt.ty = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
    };
    window.addEventListener("deviceorientation", onOrient);
    this.cleanup.push(() => window.removeEventListener("deviceorientation", onOrient));

    this.viewport.on("clicked", (e) => {
      const id = this.pickAgent(e.world.x, e.world.y);
      if (id) {
        ui.selectAgent(id);
        return;
      }
      const c = worldToCell(e.world.x, e.world.y);
      const z = zoneAt(c.x, c.y);
      if (z) {
        this.opts.onZoneClick(z.id);
        return;
      }
      const ph = this.layout.pharePos;
      if (Math.abs(c.x - ph.x) <= 1 && Math.abs(c.y - ph.y) <= 1) {
        this.opts.onZoneClick("phare");
        return;
      }
      ui.closeSheets();
    });

    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointermove", (e: FederatedPointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const w = this.viewport.toWorld(e.global.x, e.global.y);
      const id = this.pickAgent(w.x, w.y);
      ui.setHover(id);
      canvas.style.cursor = id ? "pointer" : "grab";
    });
    const onLeave = () => ui.setHover(null);
    canvas.addEventListener("pointerleave", onLeave);
    this.cleanup.push(() => canvas.removeEventListener("pointerleave", onLeave));
  }

  private pickAgent(wx: number, wy: number): string | null {
    let best: string | null = null;
    let bestZ = -Infinity;
    for (const a of this.agents.values()) {
      if (a.isHidden) continue;
      const p = a.worldPos;
      if (wx >= p.x - 8 && wx <= p.x + 8 && wy >= p.y - 27 && wy <= p.y + 2 && p.y > bestZ) {
        best = a.id;
        bestZ = p.y;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- boucle
  private update(dt: number): void {
    if (this.destroyed) return;
    const now = Date.now();
    const st = world.get();
    const vp = this.viewport;

    // heure de Paris (ou forcée)
    if (now - this.lastHourCheck > 1000 || st.clockOverride !== null) {
      this.hour = st.clockOverride ?? parisHour();
      this.lastHourCheck = now;
    }
    const amb = ambianceAt(this.hour);

    // zoom animé autour d'un point
    if (this.zoomTween) {
      const z = this.zoomTween;
      z.t += dt;
      const k = Math.min(1, z.t / z.dur);
      const e = 1 - Math.pow(1 - k, 3);
      const s = z.s0 + (z.s1 - z.s0) * e;
      vp.scale.set(s);
      vp.x = z.sx - z.wx * s;
      vp.y = z.sy - z.wy * s;
      if (k >= 1) this.zoomTween = null;
      vp.emit("zoomed", { viewport: vp, type: "wheel" });
    }
    this.updatePixelMode();

    // pixel parfait : compense la partie fractionnaire de la translation
    const res = this.app.renderer.resolution;
    const s = vp.scale.x;
    const integral = Math.abs(s * res - Math.round(s * res)) < 1e-3;
    if (integral) {
      this.snap.x = (Math.round(vp.x * res) / res - vp.x) / s;
      this.snap.y = (Math.round(vp.y * res) / res - vp.y) / s;
    } else {
      this.snap.x = 0;
      this.snap.y = 0;
    }
    if (uiStore.getState().zoom !== s) uiStore.setState({ zoom: s });

    // jour / nuit
    this.tinted.tint = amb.tint;
    this.fx.tint = amb.tint;
    const night = amb.night;
    for (const g of this.lampGlows) g.alpha = night * 0.85;
    for (const l of this.towerLights) l.alpha = Math.min(1, night * 1.1);

    // agents
    const hover = uiStore.getState().hoverAgent;
    const selected = uiStore.getState().selectedAgent;
    for (const a of this.agents.values()) {
      const rt = st.agents[a.id];
      if (rt) a.sync(rt, st.celebrations[a.id]);
      const b = st.bubbles[a.id];
      a.setSpeaking(!!b && b.until > now);
      a.update(dt, rt);
      a.ring.visible = a.id === selected;
      const g = this.deskGlows.get(a.id);
      if (g) g.alpha = rt?.state === "working" && (a.pose === "type") ? 0.25 + night * 0.6 : 0;
    }

    // ambiance
    if (this.traffic) {
      this.agentCells.clear();
      for (const a of this.agents.values()) if (!a.isHidden) this.agentCells.add(idx(a.cellX, a.cellY));
      this.traffic.update(dt, night);
    }
    this.balises?.update(dt, night);
    this.boats.update(dt);
    this.gulls.update(dt);
    this.sparkles.update(dt);
    this.particles.update(dt);
    const pending = st.approvals.length;
    this.pile.set(st.approvals.filter((a) => a.delivered).length);
    this.pile.update(dt);
    this.phare.update(dt, night, pending);
    this.steamT -= dt;
    if (this.steamT <= 0) {
      const busy = (st.presence.quai ?? 0) > 0;
      this.steamT = busy ? 0.25 : 1.6;
      if (busy || Math.random() < 0.3) this.particles.steam(this.coffeePos.x, this.coffeePos.y);
    }

    // présence par pôle
    if (now - this.lastPresence > 800) {
      this.lastPresence = now;
      const presence: Record<string, number> = {};
      for (const a of this.agents.values()) {
        if (a.isHidden) continue;
        const z = zoneAt(a.cellX, a.cellY);
        if (!z) continue;
        const def = agentById(a.id);
        if (z.walls === "back" || z.id === "criee" || z.id === "douane" || z.id === "archives" || def?.pole === z.id) presence[z.id] = (presence[z.id] ?? 0) + 1;
      }
      world.setPresence(presence);
      uiStore.setState({ fps: Math.round(this.app.ticker.FPS) });
    }

    // fond : parallaxe caméra + inclinaison
    this.tilt.x += (this.tilt.tx - this.tilt.x) * Math.min(1, dt * 3);
    this.tilt.y += (this.tilt.ty - this.tilt.y) * Math.min(1, dt * 3);
    const c = vp.center;
    this.sky.update(dt, amb, (c.x - WORLD_W / 2) / WORLD_W, (c.y - WORLD_H / 2) / WORLD_H, this.tilt.x, this.tilt.y);

    // DOM
    const heads = new Map<string, { x: number; y: number; hidden: boolean }>();
    for (const a of this.agents.values()) heads.set(a.id, { ...a.headPos, hidden: a.isHidden });
    this.overlay.update({
      toScreen: (x, y) => vp.toScreen(x, y),
      scale: s,
      heads,
      bubbles: st.bubbles,
      presence: st.presence,
      pending,
      agents: st.agents,
      hover,
      now,
      links: st.links,
    });
  }

  destroy(): void {
    this.destroyed = true;
    for (const c of this.cleanup) c();
    this.overlay?.destroy();
    try {
      this.app.destroy(true, { children: true, texture: true, textureSource: true });
    } catch {
      // l'application n'était peut-être pas initialisée
    }
  }
}
