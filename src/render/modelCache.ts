import { AnimationClip, AnimationMixer, Box3, Color, Group, LoopOnce, LoopRepeat, Mesh } from 'three';
import type { Material, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimName, AssetManifest, ModelEntry } from '../core/types';
import type { Figure } from './standins';

interface Loaded {
  scene: Object3D;
  clips: AnimationClip[];
}

const ANIMS: AnimName[] = ['idle', 'walk', 'attack', 'hit', 'death', 'cast'];

/** Loads the asset manifest and glTF models, caching per URL. Any failure yields null (use a stand-in). */
export class ModelCache {
  private manifest: AssetManifest = { models: {} };
  private manifestReady: Promise<void>;
  private loader = new GLTFLoader();
  private cache = new Map<string, Promise<Loaded | null>>();
  private disposed = false;

  constructor(manifestUrl: string) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.manifestReady = fetch(new URL(manifestUrl, document.baseURI).href)
      .then((r) => (r.ok ? (r.json() as Promise<AssetManifest>) : null))
      .then((m) => {
        if (m && typeof m === 'object' && m.models) this.manifest = m;
      })
      .catch(() => undefined);
  }

  /** Resolves with a model figure for the key, or null if unavailable. */
  async create(key: string, tint: number | undefined): Promise<Figure | null> {
    await this.manifestReady;
    if (this.disposed) return null;
    const entry: ModelEntry | undefined = this.manifest.models[key];
    if (!entry) return null;
    const p = this.fetchEntry(key, entry);
    const loaded = await p;
    if (!loaded || this.disposed) return null;
    return this.instantiate(loaded, entry, tint);
  }

  private fetchEntry(key: string, entry: ModelEntry): Promise<Loaded | null> {
    const url = new URL(entry.url, document.baseURI).href;
    let p = this.cache.get(url);
    if (!p) {
      p = this.loader
        .loadAsync(url)
        .then((gltf): Loaded => ({ scene: gltf.scene, clips: gltf.animations }))
        .catch((err: unknown) => {
          console.warn(`[render] model "${key}" failed to load (${url}); using stand-in`, err);
          return null;
        });
      this.cache.set(url, p);
    }
    return p;
  }

  /** Warm the cache for these model keys; resolves when all are loaded or after `timeoutMs`, whichever is first (never rejects). */
  async preload(keys: string[], timeoutMs: number): Promise<void> {
    await this.manifestReady;
    if (this.disposed) return;
    const jobs: Promise<unknown>[] = [];
    for (const k of new Set(keys)) {
      const entry = this.manifest.models[k];
      if (entry) jobs.push(this.fetchEntry(k, entry));
    }
    if (jobs.length === 0) return;
    await Promise.race([Promise.all(jobs), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  }

  private instantiate(loaded: Loaded, entry: ModelEntry, tint: number | undefined): Figure {
    const root = new Group();
    const inner = cloneSkinned(loaded.scene);
    inner.rotation.y = entry.rotationY ?? 0;
    const s = entry.scale ?? 1;
    inner.scale.setScalar(s);
    root.add(inner);
    const mats: Material[] = [];
    // Real models keep their own colours: only 35% of the tint is multiplied in (ghosts take more, to read as a dark wraith).
    const ghost = entry.url.includes('ghost');
    const tintColor = tint !== undefined ? new Color(1, 1, 1).lerp(new Color(tint), ghost ? 0.85 : 0.35) : null;
    const baseOpacity = ghost ? 0.72 : 1;
    inner.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const clone = (m: Material): Material => {
        const c = m.clone();
        const cc = c as Material & { color?: Color };
        if (tintColor && cc.color) cc.color.multiply(tintColor);
        if (ghost) {
          c.transparent = true;
          c.opacity = baseOpacity;
          c.depthWrite = false;
        }
        mats.push(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    });
    root.updateMatrixWorld(true);
    const height = Math.max(0.3, new Box3().setFromObject(root).max.y);
    const mixer = new AnimationMixer(inner);
    const actions: Figure['actions'] = {};
    for (const a of ANIMS) {
      const name = entry.animations?.[a];
      if (!name) continue;
      const clip = AnimationClip.findByName(loaded.clips, name);
      if (!clip) continue;
      const act = mixer.clipAction(clip);
      if (a === 'idle' || a === 'walk') act.setLoop(LoopRepeat, Infinity);
      else {
        act.setLoop(LoopOnce, 1);
        act.clampWhenFinished = true;
      }
      actions[a] = act;
    }
    return {
      root,
      parts: {},
      materials: mats,
      height,
      baseOpacity,
      kind: 'model',
      mixer,
      actions,
      dispose() {
        mixer.stopAllAction();
        mixer.uncacheRoot(inner);
        for (const m of mats) m.dispose();
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
  }
}
