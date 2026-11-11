import { CanvasSource, Container, Graphics, Sprite, Texture, TilingSprite } from "pixi.js";
import { mulberry32 } from "@/lib/rng";
import type { Ambiance } from "./daynight";
import type { StyleVille } from "./theme";

/**
 * Fond en espace écran : dégradé de ciel, étoiles, montagnes violettes,
 * plan d'eau de l'étang, nuages en parallaxe (3 couches, la plus proche floutée).
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible");
  return [c, ctx];
}

const linearTex = (c: HTMLCanvasElement) => new Texture({ source: new CanvasSource({ resource: c, scaleMode: "linear" }) });
const nearestTex = (c: HTMLCanvasElement) => new Texture({ source: new CanvasSource({ resource: c, scaleMode: "nearest" }) });

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** Halo doux (lumières de nuit, phare). */
export function makeGlowTexture(): Texture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(0.6, "rgba(255,255,255,0.15)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return linearTex(c);
}

/** Faisceau du phare (cône horizontal, origine à gauche). */
export function makeBeamTexture(): Texture {
  const [c, ctx] = canvas(256, 64);
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, "rgba(255,246,200,0.9)");
  g.addColorStop(0.5, "rgba(255,246,200,0.25)");
  g.addColorStop(1, "rgba(255,246,200,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 30);
  ctx.lineTo(256, 0);
  ctx.lineTo(256, 64);
  ctx.lineTo(0, 34);
  ctx.closePath();
  ctx.fill();
  return linearTex(c);
}

function makeCloudTexture(seed: number, w: number, h: number, soft: boolean): Texture {
  const pad = soft ? 24 : 2;
  const [c, ctx] = canvas(w + pad * 2, h + pad * 2);
  const r = mulberry32(seed);
  const blobs: [number, number, number][] = [];
  const n = 5 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const rx = h * (0.35 + r() * 0.35);
    const x = pad + rx + r() * (w - rx * 2);
    const y = pad + h - rx * 0.7 - r() * h * 0.3;
    blobs.push([x, y, rx]);
  }
  if (soft) ctx.filter = "blur(10px)";
  // ombre puis corps
  for (const [x, y, rr] of blobs) {
    ctx.fillStyle = "#e9e2f7";
    ctx.beginPath();
    ctx.arc(x, y + 3, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [x, y, rr] of blobs) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x - 1, y - 1, rr * 0.92, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = "none";
  // fond plat
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillRect(0, pad + h + 2, w + pad * 2, pad);
  ctx.globalCompositeOperation = "source-over";
  if (!soft) {
    // pixelise : seuil alpha
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i]! > 110 ? 255 : 0;
    ctx.putImageData(img, 0, 0);
    return nearestTex(c);
  }
  return linearTex(c);
}

function makeMountainTexture(seed: number, w: number, h: number, peak: number): Texture {
  const [c, ctx] = canvas(w, h);
  const r = mulberry32(seed);
  const pts: number[] = [];
  let y = h * 0.6;
  for (let x = 0; x <= w; x += 4) {
    y += (r() - 0.5) * 6;
    // pics périodiques (raccord horizontal)
    const crest = Math.sin((x / w) * Math.PI * 2 * 3 + seed) * peak + Math.sin((x / w) * Math.PI * 2 * 7) * peak * 0.35;
    pts.push(Math.max(4, Math.min(h - 2, h * 0.55 - crest + (y - h * 0.6) * 0.3)));
  }
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < pts.length; i++) {
    const x = i * 4;
    ctx.fillRect(x, Math.round(pts[i]!), 4, h);
  }
  return nearestTex(c);
}

/** Skyline lointaine (style New York) : silhouette blanche (teintée comme les montagnes), raccord horizontal. */
function makeSkylineTexture(seed: number, w: number, h: number, maxH: number, lumieres: boolean): Texture {
  const [c, ctx] = canvas(w, h);
  const r = mulberry32(seed);
  const rr = mulberry32(seed + 1);
  let x = 0;
  while (x < w) {
    const bw = 6 + Math.floor(r() * 18);
    const bh = Math.floor(10 + r() * r() * maxH);
    const left = Math.min(bw, w - x);
    if (!lumieres) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, h - bh, left, bh);
      // gradins et flèches sur quelques tours
      if (bh > maxH * 0.55 && left > 8) {
        ctx.fillRect(x + 2, h - bh - 6, left - 4, 6);
        if (r() < 0.5) ctx.fillRect(x + Math.floor(left / 2), h - bh - 18, 1, 12);
      }
    } else {
      // fenêtres allumées (calque de nuit)
      for (let k = 0; k < (bw * bh) / 26; k++) {
        ctx.fillStyle = rr() < 0.7 ? "rgba(255,214,140,0.95)" : "rgba(190,220,255,0.85)";
        ctx.fillRect(x + 1 + Math.floor(rr() * Math.max(1, left - 2)), h - bh + 2 + Math.floor(rr() * Math.max(1, bh - 4)), 1, 1);
      }
    }
    x += bw + Math.floor(r() * 3);
  }
  return nearestTex(c);
}

function makeShimmerTexture(): Texture {
  const [c, ctx] = canvas(128, 64);
  const r = mulberry32(42);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (let i = 0; i < 26; i++) {
    const w = 4 + Math.floor(r() * 18);
    ctx.fillRect(Math.floor(r() * 128), Math.floor(r() * 32) * 2, w, 1);
  }
  return nearestTex(c);
}

interface Cloud {
  s: Sprite;
  speed: number;
  baseY: number;
  x: number;
  layer: number;
}

export class SkyLayer {
  readonly back = new Container();
  readonly front = new Container();
  private grad: Sprite;
  private gradCanvas: HTMLCanvasElement;
  private gradCtx: CanvasRenderingContext2D;
  private gradSource: CanvasSource;
  private stars = new Graphics();
  private mountainsFar: TilingSprite;
  private mountainsNear: TilingSprite;
  private skylineLights: TilingSprite | null = null;
  private water: Sprite;
  private waterCanvas: HTMLCanvasElement;
  private waterCtx: CanvasRenderingContext2D;
  private waterSource: CanvasSource;
  private shimmer: TilingSprite;
  private clouds: Cloud[] = [];
  private w = 1;
  private h = 1;
  private lastAmb = "";
  private t = 0;

  constructor(private style: StyleVille = "sete") {
    [this.gradCanvas, this.gradCtx] = canvas(2, 256);
    this.gradSource = new CanvasSource({ resource: this.gradCanvas, scaleMode: "linear" });
    this.grad = new Sprite(new Texture({ source: this.gradSource }));
    [this.waterCanvas, this.waterCtx] = canvas(2, 128);
    this.waterSource = new CanvasSource({ resource: this.waterCanvas, scaleMode: "linear" });
    this.water = new Sprite(new Texture({ source: this.waterSource }));

    if (style === "newyork") {
      // l'autre rive : une skyline à l'horizon (et ses fenêtres allumées la nuit)
      this.mountainsFar = new TilingSprite({ texture: makeSkylineTexture(3, 700, 140, 120, false), width: 100, height: 140 });
      this.mountainsNear = new TilingSprite({ texture: makeSkylineTexture(11, 900, 110, 70, false), width: 100, height: 110 });
      this.skylineLights = new TilingSprite({ texture: makeSkylineTexture(11, 900, 110, 70, true), width: 100, height: 110 });
    } else {
      this.mountainsFar = new TilingSprite({ texture: makeMountainTexture(3, 512, 140, 34), width: 100, height: 140 });
      this.mountainsNear = new TilingSprite({ texture: makeMountainTexture(11, 640, 110, 22), width: 100, height: 110 });
    }
    this.shimmer = new TilingSprite({ texture: makeShimmerTexture(), width: 100, height: 64 });
    this.shimmer.alpha = 0.22;

    this.back.addChild(this.grad, this.stars, this.mountainsFar, this.mountainsNear, this.water, this.shimmer);
    if (this.skylineLights) this.back.addChildAt(this.skylineLights, this.back.getChildIndex(this.mountainsNear) + 1);

    // étoiles
    const r = mulberry32(7);
    for (let i = 0; i < 140; i++) {
      const size = r() < 0.15 ? 2 : 1;
      this.stars.rect(Math.floor(r() * 2400), Math.floor(r() * 900), size, size).fill({ color: 0xffffff, alpha: 0.5 + r() * 0.5 });
    }

    // nuages : couche lointaine (pixel), moyenne (pixel), proche (floue)
    const specs: [number, number, number, boolean, number][] = [
      // couche, nombre, échelle, flou, vitesse
      [0, 6, 1, false, 4],
      [1, 5, 2, false, 9],
      [2, 3, 1, true, 18],
    ];
    let seed = 100;
    for (const [layer, n, scale, soft, speed] of specs) {
      for (let i = 0; i < n; i++) {
        const tex = makeCloudTexture(seed++, soft ? 260 : 70 + (seed % 3) * 20, soft ? 70 : 22 + (seed % 2) * 8, soft);
        const s = new Sprite(tex);
        s.scale.set(scale);
        s.alpha = layer === 0 ? 0.75 : layer === 1 ? 0.9 : 0.35;
        (layer === 2 ? this.front : this.back).addChild(s);
        this.clouds.push({ s, speed: speed * (0.7 + Math.random() * 0.6), baseY: Math.random(), x: Math.random() * 2400, layer });
      }
    }
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.grad.width = w;
    this.grad.height = h;
    const horizon = Math.round(h * 0.64);
    this.mountainsFar.width = w;
    this.mountainsFar.y = horizon - 140;
    this.mountainsNear.width = w;
    this.mountainsNear.y = horizon - 110;
    if (this.skylineLights) this.skylineLights.width = w;
    this.water.x = 0;
    this.water.y = horizon;
    this.water.width = w;
    this.water.height = h - horizon;
    this.shimmer.width = w;
    this.shimmer.y = horizon + 8;
    this.shimmer.height = h - horizon;
    this.lastAmb = "";
  }

  /** @param camX déplacement de caméra normalisé (-1..1) pour la parallaxe, tilt = inclinaison souris/gyro */
  update(dt: number, amb: Ambiance, camX: number, camY: number, tiltX: number, tiltY: number): void {
    this.t += dt;
    const key = `${amb.skyTop}-${amb.skyBottom}-${amb.water}`;
    if (key !== this.lastAmb) {
      this.lastAmb = key;
      const g = this.gradCtx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, hex(amb.skyTop));
      g.addColorStop(0.64, hex(amb.skyBottom));
      g.addColorStop(1, hex(amb.skyBottom));
      this.gradCtx.fillStyle = g;
      this.gradCtx.fillRect(0, 0, 2, 256);
      this.gradSource.update();
      const wg = this.waterCtx.createLinearGradient(0, 0, 0, 128);
      wg.addColorStop(0, hex(amb.skyBottom));
      wg.addColorStop(0.15, hex(amb.water));
      wg.addColorStop(1, hex(amb.water));
      this.waterCtx.fillStyle = wg;
      this.waterCtx.fillRect(0, 0, 2, 128);
      this.waterSource.update();
    }
    this.mountainsFar.tint = amb.mountains;
    this.mountainsFar.alpha = 0.55;
    this.mountainsNear.tint = amb.mountains;
    this.mountainsNear.alpha = 0.9;
    this.stars.alpha = amb.night * (0.85 + Math.sin(this.t * 1.7) * 0.15);
    this.stars.x = -camX * 20 + tiltX * 6;
    this.stars.y = -camY * 10 + tiltY * 4;

    const ox = (f: number) => Math.round(-camX * f + tiltX * f * 0.4);
    this.mountainsFar.tilePosition.x = ox(30);
    this.mountainsNear.tilePosition.x = ox(60);
    this.mountainsFar.y = Math.round(this.h * 0.64 - 140 - camY * 8 + tiltY * 3);
    this.mountainsNear.y = Math.round(this.h * 0.64 - 110 - camY * 12 + tiltY * 5);
    if (this.skylineLights) {
      this.skylineLights.tilePosition.x = this.mountainsNear.tilePosition.x;
      this.skylineLights.y = this.mountainsNear.y;
      this.skylineLights.alpha = amb.night;
    }
    this.shimmer.tilePosition.x = Math.round(this.t * 6 + ox(80));

    const cloudTint = amb.night > 0.5 ? 0x8f8fc8 : amb.night > 0.1 ? 0xffd9e6 : 0xffffff;
    const span = this.w + 700;
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      const par = c.layer === 0 ? 25 : c.layer === 1 ? 70 : 260;
      let x = ((c.x + ox(par) + 350) % span + span) % span - 350;
      if (c.layer < 2) x = Math.round(x);
      c.s.x = x;
      const band = c.layer === 2 ? this.h * (0.1 + c.baseY * 0.8) : this.h * (0.04 + c.baseY * (c.layer === 0 ? 0.32 : 0.48));
      c.s.y = Math.round(band - camY * (c.layer === 2 ? 60 : 14) + tiltY * (c.layer + 1) * 3);
      c.s.tint = cloudTint;
    }
  }
}

export { linearTex, nearestTex };
