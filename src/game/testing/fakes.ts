import type { GameAudio, SfxId } from '../../audio';
import type {
  CellHighlight,
  CharacterBuild,
  AnimationSpeed,
  CreationOptions,
  FloorPlan,
  GameUi,
  GridPos,
  HelpMode,
  HintRequest,
  HubIntent,
  HubModel,
  HudModel,
  MenuResult,
  PickResult,
  QualityLevel,
  Renderer3D,
  UiIntent,
  PuzzleRequest,
  PuzzleResult,
  VisualEffect,
} from '../../core/types';
import type { GameDeps, GameOptions, StorageLike } from '../deps';
import { quickBuild } from '../quickBuild';

/** A renderer that resolves instantly and records misuse (calls about entities that do not exist). */
export class FakeRenderer implements Renderer3D {
  entities = new Map<string, { pos: GridPos; visible: boolean; dead: boolean }>();
  plans: FloorPlan[] = [];
  errors: string[] = [];
  calls = 0;
  highlights: CellHighlight[] = [];
  revealed: Uint8Array = new Uint8Array(0);
  quality: QualityLevel = 'medium';
  following: string | null = null;
  floats: { text: string; style: string; at?: string }[] = [];
  pickCb: (p: PickResult) => void = () => undefined;
  hoverCb: (p: PickResult) => void = () => undefined;

  private need(id: string, what: string): void {
    this.calls++;
    if (!this.entities.has(id)) this.errors.push(`${what}: unknown entity ${id}`);
  }

  async loadFloor(plan: FloorPlan): Promise<void> {
    this.plans.push(plan);
  }
  /** The model each entity was spawned with. */
  models = new Map<string, string>();
  spawnEntity(id: string, visual: unknown, pos: GridPos): void {
    this.calls++;
    this.models.set(id, (visual as { model?: string } | undefined)?.model ?? '');
    if (this.entities.has(id)) this.errors.push(`spawnEntity: duplicate ${id}`);
    this.entities.set(id, { pos: { ...pos }, visible: true, dead: false });
  }
  removeEntity(id: string): void {
    this.need(id, 'removeEntity');
    this.entities.delete(id);
  }
  async moveEntity(id: string, path: GridPos[]): Promise<void> {
    this.need(id, 'moveEntity');
    const e = this.entities.get(id);
    const end = path[path.length - 1];
    if (e && end) e.pos = { ...end };
  }
  /** The off-interface hazard effects of the real renderer (makeHarness can take them away to test the fallback). */
  drops: { id: string; into: string }[] = [];
  rises: { id: string; at: GridPos }[] = [];
  async dropEntity(id: string, into: 'fall' | 'lava'): Promise<void> {
    this.need(id, 'dropEntity');
    this.drops.push({ id, into });
    const e = this.entities.get(id);
    if (e) e.visible = false;
  }
  async riseEntity(id: string, at: GridPos): Promise<void> {
    this.need(id, 'riseEntity');
    this.rises.push({ id, at: { ...at } });
    const e = this.entities.get(id);
    if (e) {
      e.pos = { ...at };
      e.visible = true;
    }
  }
  /** Entities put somewhere without walking (teleports, spawns), in order. */
  placed: string[] = [];
  placeEntity(id: string, pos: GridPos): void {
    this.need(id, 'placeEntity');
    this.placed.push(id);
    const e = this.entities.get(id);
    if (e) e.pos = { ...pos };
  }
  anims: { id: string; anim: string; facing?: GridPos }[] = [];
  async playAnim(id: string, anim: string, opts?: { facing?: GridPos }): Promise<void> {
    this.need(id, 'playAnim');
    this.anims.push(opts?.facing ? { id, anim, facing: opts.facing } : { id, anim });
  }
  setEntityState(id: string, state: { visible?: boolean; dead?: boolean }): void {
    this.need(id, 'setEntityState');
    const e = this.entities.get(id);
    if (!e) return;
    if (state.visible !== undefined) e.visible = state.visible;
    if (state.dead !== undefined) e.dead = state.dead;
  }
  floatText(at: string | GridPos, text: string, style: string): void {
    if (typeof at === 'string') this.need(at, 'floatText');
    this.floats.push(typeof at === 'string' ? { text, style, at } : { text, style });
  }
  setHighlights(cells: CellHighlight[]): void {
    this.highlights = cells;
  }
  setRevealed(mask: Uint8Array): void {
    this.revealed = mask;
  }
  focusCamera(): void {}
  followEntity(id: string | null): void {
    if (id !== null) this.need(id, 'followEntity');
    this.following = id;
  }
  onPick(cb: (p: PickResult) => void): void {
    this.pickCb = cb;
  }
  onHover(cb: (p: PickResult) => void): void {
    this.hoverCb = cb;
  }
  setQuality(level: QualityLevel): void {
    this.quality = level;
  }
  /** Effects played, in order (the game does not send any yet). */
  effects: VisualEffect[] = [];
  async playEffect(effect: VisualEffect): Promise<void> {
    this.effects.push(effect);
  }
  animationSpeed: AnimationSpeed = 'normal';
  setAnimationSpeed(speed: AnimationSpeed): void {
    this.animationSpeed = speed;
  }
  start(): void {}
  stop(): void {}
  dispose(): void {}
}

export interface FakeUiScript {
  title?: ('new' | 'continue')[];
  death?: ('retry' | 'quit')[];
  /** Called for every hub model; return the intents to send, in order. */
  hub?: (model: HubModel) => HubIntent[];
  menu?: MenuResult[];
  /** Answers to confirm() questions, in order; the default is to confirm. */
  confirm?: { ok: boolean; remember: boolean }[];
  /** Results of lock puzzles, in order; the default is solved for silver. */
  puzzle?: PuzzleResult[];
  /** The answer to the help-mode question (default 'standard'). */
  help?: HelpMode;
}

export class FakeUi implements GameUi {
  huds: HudModel[] = [];
  onHud: (m: HudModel) => void = () => undefined;
  banners: string[] = [];
  hubModels: HubModel[] = [];
  deaths: { depth: number; killedBy: string }[] = [];
  victories = 0;
  titles = 0;
  hudHidden = false;
  loading: string | null = null;
  intentCb: (i: UiIntent) => void = () => undefined;
  /** Called when the title screen is requested after the script ran out. */
  onIdle: () => void = () => undefined;

  constructor(
    public script: FakeUiScript = {},
    private build: () => CharacterBuild = quickBuild,
  ) {}

  get hud(): HudModel | undefined {
    return this.huds[this.huds.length - 1];
  }

  async showTitle(): Promise<'new' | 'continue'> {
    this.titles++;
    const next = this.script.title?.shift();
    if (next) return next;
    this.onIdle();
    return new Promise<never>(() => undefined);
  }
  async showCreation(_options: CreationOptions): Promise<CharacterBuild> {
    return this.build();
  }
  setHud(model: HudModel): void {
    this.hudHidden = false;
    this.huds.push(model);
    this.onHud(model);
    if (this.huds.length > 400) this.huds.splice(0, 200);
  }
  hideHud(): void {
    this.hudHidden = true;
  }
  onIntent(cb: (i: UiIntent) => void): void {
    this.intentCb = cb;
  }
  async showHub(model: HubModel, onIntent: (intent: HubIntent) => HubModel): Promise<void> {
    this.hubModels.push(model);
    let m = model;
    for (const intent of this.script.hub?.(model) ?? []) {
      m = onIntent(intent);
      this.hubModels.push(m);
    }
    onIntent({ type: 'descend' });
  }
  async showDeath(info: { depth: number; killedBy: string }): Promise<'retry' | 'quit'> {
    this.deaths.push(info);
    return this.script.death?.shift() ?? 'quit';
  }
  async showVictory(): Promise<void> {
    this.victories++;
  }
  banner(text: string): void {
    this.banners.push(text);
  }
  setLoading(message: string | null): void {
    this.loading = message;
  }
  async showMenu(): Promise<MenuResult> {
    return this.script.menu?.shift() ?? { type: 'resume' };
  }
  async showHelpChoice(): Promise<HelpMode> {
    return this.script.help ?? 'standard';
  }
  confirms: unknown[] = [];
  async confirm(q?: unknown): Promise<{ ok: boolean; remember: boolean }> {
    this.confirms.push(q);
    return this.script.confirm?.shift() ?? { ok: true, remember: false };
  }
  hints: HintRequest[] = [];
  showHint(hint: HintRequest): void {
    this.hints.push(hint);
  }
  clearHint(): void {}
  async showHowToPlay(): Promise<void> {}
  /** Every lock puzzle that was put to the player. */
  puzzles: PuzzleRequest[] = [];
  async playPuzzle(req: PuzzleRequest): Promise<PuzzleResult> {
    this.puzzles.push(req);
    return this.script.puzzle?.shift() ?? { outcome: 'solved', grade: 'silver', seconds: 20, mistakes: 0, hintsUsed: 0, moves: 0 };
  }
}

/** Records every sound the game asked for. */
export class FakeAudio implements GameAudio {
  plays: SfxId[] = [];
  ambience: string | null = null;
  combat = false;
  muted = false;
  unlocked = false;
  unlock(): void {
    this.unlocked = true;
  }
  play(id: SfxId): void {
    this.plays.push(id);
  }
  setAmbience(theme: string | null): void {
    this.ambience = theme;
  }
  setCombat(active: boolean): void {
    this.combat = active;
  }
  setMuted(m: boolean): void {
    this.muted = m;
  }
  isMuted(): boolean {
    return this.muted;
  }
  setVolume(): void {}
  dispose(): void {}
}

export class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.data.set(key, value);
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}

export interface Harness {
  renderer: FakeRenderer;
  ui: FakeUi;
  audio: FakeAudio;
  storage: MemoryStorage;
  deps: GameDeps;
}

export function makeHarness(options: GameOptions = {}, script: FakeUiScript = {}, extras: { hazardFx?: boolean } = {}): Harness {
  const renderer = new FakeRenderer();
  if (extras.hazardFx === false) {
    // An older renderer without the drop and rise effects: the game falls back to hiding and placing.
    (renderer as { dropEntity?: unknown }).dropEntity = undefined;
    (renderer as { riseEntity?: unknown }).riseEntity = undefined;
  }
  const ui = new FakeUi(script);
  const audio = new FakeAudio();
  const storage = new MemoryStorage();
  let seed = 100;
  const deps: GameDeps = {
    renderer,
    ui,
    audio,
    storage,
    delay: () => Promise.resolve(),
    newSeed: () => seed++,
    options,
  };
  return { renderer, ui, audio, storage, deps };
}

/** Let queued promise callbacks run until `cond` holds (or give up). */
export async function until(cond: () => boolean, maxTurns = 200000): Promise<boolean> {
  for (let i = 0; i < maxTurns; i++) {
    if (cond()) return true;
    await Promise.resolve();
    if (i % 1000 === 999) await new Promise((r) => setTimeout(r, 0));
  }
  return cond();
}
