import { DataTexture, NearestFilter, RedFormat, UnsignedByteType } from 'three';
import type { Material, WebGLProgramParametersWithUniforms } from 'three';
import { CellKind } from '../core/types';
import { heroUniforms, occUniforms } from './occlusion';

/** Shared time uniform for shader animation (water, flicker, motes). */
export const timeUniform = { value: 0 };

/**
 * Fog of war as a small R8 texture (one texel per cell) sampled in the vertex
 * shader. Hidden vertices are pushed outside clip space; fades are animated by
 * easing the texel values on the CPU, so a reveal costs one tiny texture upload.
 */
export class Fow {
  readonly tex: DataTexture;
  readonly width: number;
  readonly height: number;
  private cur: Uint8Array;
  private target: Uint8Array;
  private dirty = false;
  private elapsedFade = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cur = new Uint8Array(width * height).fill(255);
    this.target = new Uint8Array(width * height).fill(255);
    this.tex = new DataTexture(this.cur, width, height, RedFormat, UnsignedByteType);
    this.tex.minFilter = NearestFilter;
    this.tex.magFilter = NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.unpackAlignment = 1;
    this.tex.needsUpdate = true;
  }

  /** Mask semantics as in Renderer3D.setRevealed. Solid cells show if any neighbour is seen. */
  setMask(mask: Uint8Array, kinds: Uint8Array): void {
    const w = this.width;
    const h = this.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let seen = mask[i] ? 1 : 0;
        const k = kinds[i];
        if (!seen && (k === CellKind.Wall || k === CellKind.Void || k === CellKind.Chasm)) {
          for (let dy = -1; dy <= 1 && !seen; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              if (mask[yy * w + xx]) {
                seen = 1;
                break;
              }
            }
          }
        }
        this.target[i] = seen ? 255 : 0;
      }
    }
    this.dirty = true;
  }

  setAllVisible(): void {
    this.target.fill(255);
    this.dirty = true;
  }

  /** Ease current values to the target. Returns quickly when nothing changes. */
  update(dt: number): void {
    if (!this.dirty) return;
    const step = Math.max(1, Math.round(dt * 700));
    const c = this.cur;
    const t = this.target;
    let changed = false;
    for (let i = 0; i < c.length; i++) {
      const a = c[i]!;
      const b = t[i]!;
      if (a === b) continue;
      changed = true;
      c[i] = a < b ? Math.min(b, a + step) : Math.max(b, a - step);
    }
    this.elapsedFade += dt;
    if (changed) this.tex.needsUpdate = true;
    else this.dirty = false;
  }

  /** CPU-side visibility of a cell (target state). */
  isVisible(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.target[y * this.width + x]! > 0;
  }

  dispose(): void {
    this.tex.dispose();
  }

  /**
   * Patch a vertex-coloured material to read the mask. `instanced` materials
   * derive the cell from the instance translation, others from a per-vertex
   * `cellIdx` attribute.
   */
  patch(
    mat: Material,
    opts: { instanced?: boolean; water?: boolean; flicker?: number; motes?: boolean; occlude?: boolean; hero?: boolean } = {},
  ): void {
    const instanced = !!opts.instanced;
    const w = this.width;
    const h = this.height;
    const tex = this.tex;
    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uFow = { value: tex };
      shader.uniforms.uFowSize = { value: [w, h] };
      shader.uniforms.uTime = timeUniform;
      if (opts.occlude) Object.assign(shader.uniforms, occUniforms);
      if (opts.hero) Object.assign(shader.uniforms, heroUniforms);
      let v = shader.vertexShader;
      v = v.replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uFow;
uniform vec2 uFowSize;
uniform float uTime;
${instanced ? '' : 'attribute float cellIdx;'}
${opts.hero ? 'uniform vec3 uHeroP; uniform vec3 uHeroC; uniform float uHeroR;' : ''}
${opts.occlude ? 'attribute float wbase; uniform vec2 uOccT; uniform vec2 uOccD; uniform vec2 uOccP;' : ''}
float fowVis = 1.0;`,
      );
      const fetch = instanced
        ? `ivec2 fc = ivec2(floor(instanceMatrix[3].xz * 0.5));
fc = clamp(fc, ivec2(0), ivec2(uFowSize) - 1);
fowVis = texelFetch(uFow, fc, 0).r;`
        : `int ci = int(cellIdx + 0.5);
int fw = int(uFowSize.x);
fowVis = texelFetch(uFow, ivec2(ci % fw, ci / fw), 0).r;`;
      let colorExtra = 'vColor.rgb *= fowVis;';
      if (opts.hero) colorExtra += `
float hq = 1.0 - smoothstep(0.0, uHeroR, distance(position.xz, uHeroP.xz));
vColor.rgb *= vec3(1.0) + uHeroC * hq * hq;`;
      if (opts.flicker !== undefined && instanced) {
        const amt = opts.flicker.toFixed(3);
        colorExtra += `
float fph = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 2.3;
vColor.rgb *= 1.0 + ${amt} * (sin(uTime * 11.0 + fph) * 0.6 + sin(uTime * 17.3 + fph * 2.1) * 0.4);`;
      }
      v = v.replace('#include <color_vertex>', `#include <color_vertex>\n${fetch}\n${colorExtra}`);
      v = v.replace('#include <project_vertex>', `#include <project_vertex>\nif (fowVis < 0.02) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
      if (opts.water) {
        v = v.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float wv = sin(uTime * 1.6 + position.x * 2.1 + position.z * 1.3) + sin(uTime * 2.3 - position.x * 1.1 + position.z * 2.7);
transformed.y += wv * 0.03;
vColor.rgb *= 1.0 + wv * 0.06;`,
        );
        // vColor is declared before begin_vertex in three's template? ensure order by moving shading after color_vertex
      }
      if (opts.occlude) {
        v = v.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
if (wbase > -900.0) {
  vec2 dv = transformed.xz - uOccT;
  float along = dot(dv, uOccD);
  float lat = abs(dv.x * uOccD.y - dv.y * uOccD.x);
  float of = (1.0 - smoothstep(uOccP.x * 0.6, uOccP.x, lat)) * smoothstep(-2.0, 1.0, along) * (1.0 - smoothstep(uOccP.y * 0.7, uOccP.y, along));
  transformed.y -= max(0.0, transformed.y - wbase - 0.2) * of * 0.85;
}`,
        );
      }
      if (opts.motes) {
        v = v.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
transformed.x += sin(uTime * 0.35 + position.z * 1.7) * 0.8;
transformed.y += sin(uTime * 0.5 + position.x * 2.3 + position.z) * 1.2;
transformed.z += cos(uTime * 0.3 + position.x * 1.3) * 0.8;`,
        );
      }
      shader.vertexShader = v;
    };
    mat.customProgramCacheKey = () =>
      `fow-${instanced ? 'i' : 'a'}-${opts.water ? 'w' : ''}${opts.motes ? 'm' : ''}${opts.occlude ? 'o' : ''}${opts.hero ? 'h' : ''}${opts.flicker ?? ''}`;
  }
}
