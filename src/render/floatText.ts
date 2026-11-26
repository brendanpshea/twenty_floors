import { CanvasTexture, Sprite, SpriteMaterial } from 'three';
import type { Group } from 'three';
import type { FloatTextStyle } from '../core/types';

interface StyleDef {
  fill: string;
  stroke: string;
  font: string;
  scale: number;
  life: number;
  rise: number;
  pop: boolean;
}

const STYLES: Record<FloatTextStyle, StyleDef> = {
  damage: { fill: '#ffffff', stroke: '#b01818', font: 'bold 60px system-ui, sans-serif', scale: 1.0, life: 1.1, rise: 1.8, pop: false },
  crit: { fill: '#ffd820', stroke: '#8a3a00', font: 'bold 84px system-ui, sans-serif', scale: 1.5, life: 1.4, rise: 2.0, pop: true },
  heal: { fill: '#6af08a', stroke: '#0f4a22', font: 'bold 60px system-ui, sans-serif', scale: 1.0, life: 1.2, rise: 1.7, pop: false },
  miss: { fill: '#c4c4c4', stroke: '#2a2a2a', font: 'italic 52px system-ui, sans-serif', scale: 0.9, life: 1.0, rise: 1.2, pop: false },
  info: { fill: '#bfe0ff', stroke: '#1a3a5a', font: 'bold 46px system-ui, sans-serif', scale: 0.9, life: 1.5, rise: 1.2, pop: false },
};

const W = 384;
const H = 128;

interface Item {
  sprite: Sprite;
  mat: SpriteMaterial;
  tex: CanvasTexture;
  canvas: HTMLCanvasElement;
  active: boolean;
  t: number;
  life: number;
  rise: number;
  scale: number;
  pop: boolean;
  x: number;
  y: number;
  z: number;
}

/** Pooled canvas-texture billboards for rising, fading text. */
export class FloatText {
  private pool: Item[] = [];
  private counter = 0;

  constructor(
    private readonly parent: Group,
    size = 24,
  ) {
    for (let i = 0; i < size; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const tex = new CanvasTexture(canvas);
      const mat = new SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false });
      const sprite = new Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 20;
      parent.add(sprite);
      this.pool.push({ sprite, mat, tex, canvas, active: false, t: 0, life: 1, rise: 1, scale: 1, pop: false, x: 0, y: 0, z: 0 });
    }
  }

  spawn(x: number, y: number, z: number, text: string, style: FloatTextStyle): void {
    let item = this.pool.find((p) => !p.active);
    if (!item) {
      // Recycle the oldest.
      item = this.pool.reduce((a, b) => (a.t > b.t ? a : b));
    }
    const def = STYLES[style];
    const ctx = item.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.font = def.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 12;
    ctx.strokeStyle = def.stroke;
    ctx.strokeText(text, W / 2, H / 2, W - 16);
    ctx.fillStyle = def.fill;
    ctx.fillText(text, W / 2, H / 2, W - 16);
    item.tex.needsUpdate = true;
    const n = this.counter++;
    item.x = x + ((n % 3) - 1) * 0.35;
    item.y = y + (n % 2) * 0.25;
    item.z = z;
    item.t = 0;
    item.life = def.life;
    item.rise = def.rise;
    item.scale = def.scale;
    item.pop = def.pop;
    item.active = true;
    item.mat.opacity = 1;
    item.sprite.visible = true;
    item.sprite.position.set(item.x, item.y, item.z);
    item.sprite.scale.set(item.scale * 3, item.scale * 1, 1);
  }

  update(dt: number): void {
    for (const it of this.pool) {
      if (!it.active) continue;
      it.t += dt;
      const u = it.t / it.life;
      if (u >= 1) {
        it.active = false;
        it.sprite.visible = false;
        continue;
      }
      const ease = 1 - (1 - u) * (1 - u);
      it.sprite.position.y = it.y + it.rise * ease;
      it.mat.opacity = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
      let s = it.scale;
      if (it.pop) s *= 1 + 0.35 * Math.max(0, 1 - u * 6);
      it.sprite.scale.set(s * 3, s, 1);
    }
  }

  dispose(): void {
    for (const it of this.pool) {
      this.parent.remove(it.sprite);
      it.mat.dispose();
      it.tex.dispose();
    }
    this.pool.length = 0;
  }
}
