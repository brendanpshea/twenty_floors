import { Rng, floorSeed } from '../core/rng';
import { THEMES, themeForDepth } from '../core/themes';
import type { GridPos, PickResult, PlayerCharacter, UiIntent } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { createNavGrid, generateFloor } from '../gen';
import { buildEncounters, enterFloor, syncFromCreature, toCreature } from '../rules';
import { CombatController } from './combatController';
import type { FloorOutcome, GameDeps, RunState } from './deps';
import { Explore } from './explore';
import { revealFrom } from './fog';
import type { FloorState, SessionCtx } from './floorState';
import { creatureById, isSeen, monsterDef, setEntityVisible } from './floorState';
import { buildHudModel } from './hudModel';
import { Playback } from './playback';
import { loadQuality, saveQuality } from './save';

/** The player's model, whatever the species. */
const HERO_MODEL = 'hero_knight';

/**
 * One visit to one floor: generates it, populates it, routes input to
 * exploration or combat, and resolves `outcome` when the floor is cleared, the
 * hero dies, or the run is abandoned.
 */
export class FloorSession {
  readonly outcome: Promise<FloorOutcome>;
  private resolveOutcome!: (o: FloorOutcome) => void;
  state!: FloorState;
  explore!: Explore;
  combat!: CombatController;
  /** The character as it entered the floor (what the save holds). */
  entryCharacter!: PlayerCharacter;
  entered = false;
  private menuOpen = false;
  private disposed = false;
  private promptToken = 0;
  private ctx!: SessionCtx;
  private lastMask = new Uint8Array(0);

  constructor(
    private readonly deps: GameDeps,
    private readonly run: RunState,
    private readonly attempt: number,
  ) {
    this.outcome = new Promise<FloorOutcome>((resolve) => {
      this.resolveOutcome = resolve;
    });
  }

  // -------------------------------------------------------------- entering

  async enter(): Promise<void> {
    const { deps, run } = this;
    const { renderer, ui } = deps;
    const depth = run.depth;
    const theme = themeForDepth(depth);
    const themeName = THEMES[theme].name;
    ui.setLoading(`Floor ${depth}: ${themeName}`);

    const seed = floorSeed(run.runSeed, depth);
    const plan = generateFloor({ seed, depth, theme });
    const nav = createNavGrid(plan);
    const floorRng = new Rng(seed);
    const placed = buildEncounters(plan, MONSTERS, floorRng.fork('encounters'));
    const pc = enterFloor(run.pc);
    this.entryCharacter = pc;

    const player = this.makePlayer(pc, plan.entrance);
    this.state = {
      runSeed: run.runSeed,
      depth,
      themeName,
      plan,
      nav,
      floorRng,
      pc,
      player,
      monsters: placed.map((p) => ({
        creature: p.creature,
        roomId: p.roomId,
        def: monsterDef(p.creature.defId),
        boss: monsterDef(p.creature.defId)?.role === 'boss',
      })),
      chests: plan.spawns
        .filter((s) => s.role === 'chest')
        .map((s, i) => ({ id: `chest_${i}`, pos: { ...s.pos }, opened: false })),
      seen: new Uint8Array(plan.width * plan.height),
      revealAll: deps.options.reveal === true,
      shortRestsLeft: run.shortRestsLeft,
      mode: 'explore',
      stairsOpen: false,
      log: [],
      targetId: null,
      shownHp: new Map(),
      shownDead: new Set(),
      shownActive: null,
      lastHitBy: '',
      entityVisible: new Map(),
      finished: false,
    };
    const state = this.state;
    state.stairsOpen = !state.monsters.some((m) => m.boss);
    if (state.revealAll) state.seen.fill(1);

    this.ctx = this.makeCtx();
    const playback = new Playback(this.ctx);
    this.explore = new Explore(this.ctx, { beginCombat: (m) => this.combat.begin(m) });
    this.combat = new CombatController(this.ctx, playback, this.attempt, () => undefined);

    await renderer.loadFloor(plan);
    renderer.spawnEntity('player', state.player.visual, state.player.pos, { faction: 'player', size: state.player.size });
    state.entityVisible.set('player', true);
    for (const m of state.monsters) {
      const c = m.creature;
      renderer.spawnEntity(c.id, c.visual, c.pos, { faction: c.faction, size: c.size });
      renderer.setEntityState(c.id, { visible: false, hpFraction: 1 });
      state.entityVisible.set(c.id, false);
    }
    for (const ch of state.chests) {
      renderer.spawnEntity(ch.id, { model: 'chest' }, ch.pos, { faction: 'ally', size: 'small' });
      renderer.setEntityState(ch.id, { visible: false });
      state.entityVisible.set(ch.id, false);
    }
    this.ctx.reveal();
    renderer.followEntity('player');
    deps.audio.setAmbience(theme);
    ui.setLoading(null);
    ui.banner(`Floor ${depth}`, themeName);
    this.ctx.say(`Floor ${depth}: ${themeName}. ${THEMES[theme].tagline}`);
    this.entered = true;
    this.ctx.hud();
  }

  private makePlayer(pc: PlayerCharacter, pos: GridPos) {
    const p = toCreature(pc, pos);
    p.visual = { ...p.visual, model: HERO_MODEL };
    return p;
  }

  private makeCtx(): SessionCtx {
    const self = this;
    return {
      deps: this.deps,
      get state() {
        return self.state;
      },
      hud: () => this.pushHud(),
      say: (text) => {
        this.state.log.push(text);
        if (this.state.log.length > 80) this.state.log.splice(0, this.state.log.length - 80);
      },
      prompt: (text, ttlMs) => this.setPrompt(text, ttlMs),
      reveal: () => this.reveal(),
      guard: (p, ms = 2500) => this.guard(p, ms),
      finish: (o) => this.finish(o),
      rebuildPlayer: () => {
        const prev = this.state.player;
        this.state.player = this.makePlayer(this.state.pc, prev.pos);
      },
    };
  }

  // ------------------------------------------------------------- plumbing

  pushHud(): void {
    if (this.disposed) return;
    this.deps.ui.setHud(
      buildHudModel({
        state: this.state,
        combat: this.combat.combat,
        selectedActionId: this.combat.selectedActionId,
        previewActionId: this.combat.previewActionId,
        busy: this.combat.busy || this.explore.walking,
      }),
    );
  }

  private setPrompt(text: string | undefined, ttlMs?: number): void {
    const token = ++this.promptToken;
    if (text === undefined) delete this.state.prompt;
    else this.state.prompt = text;
    this.pushHud();
    if (text !== undefined && ttlMs) {
      void this.deps.delay(ttlMs).then(() => {
        if (token === this.promptToken && !this.disposed) {
          delete this.state.prompt;
          this.pushHud();
        }
      });
    }
  }

  private async guard(p: Promise<unknown>, ms: number): Promise<void> {
    await Promise.race([p.then(() => undefined, () => undefined), this.deps.delay(ms)]);
  }

  private reveal(): void {
    const state = this.state;
    const { renderer } = this.deps;
    const changed = !state.revealAll && revealFrom(state.seen, state.plan.kinds, state.nav, state.player.pos);
    if (changed || this.lastMask.length === 0) {
      this.lastMask = state.seen.slice();
      renderer.setRevealed(this.lastMask);
    }
    for (const m of state.monsters) setEntityVisible(this.ctx, m.creature.id, isSeen(state, m.creature.pos));
    for (const c of state.chests) setEntityVisible(this.ctx, c.id, isSeen(state, c.pos));
  }

  private finish(outcome: FloorOutcome): void {
    if (this.state.finished) return;
    this.state.finished = true;
    this.explore.stop();
    this.resolveOutcome(outcome);
  }

  get finished(): boolean {
    return this.state?.finished === true;
  }

  /** Remove everything this floor put into the renderer. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const r = this.deps.renderer;
    r.setHighlights([]);
    r.followEntity(null);
    r.removeEntity('player');
    for (const m of this.state.monsters) r.removeEntity(m.creature.id);
    for (const c of this.state.chests) r.removeEntity(c.id);
  }

  // ---------------------------------------------------------------- input

  private get inputBlocked(): boolean {
    return this.disposed || this.menuOpen || !this.entered || this.state.finished;
  }

  private safe(p: Promise<void>): void {
    p.catch((err) => {
      console.error('Input handler failed', err);
      this.setPrompt(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`, 4000);
    });
  }

  handlePick(pick: PickResult): void {
    if (this.inputBlocked) return;
    this.safe(this.state.mode === 'combat' ? this.combat.tap(pick) : this.explore.tap(pick));
  }

  handleHover(pick: PickResult): void {
    if (this.inputBlocked) return;
    if (this.state.mode === 'combat') this.combat.hover(pick);
    else this.explore.hover(pick);
  }

  handleKey(key: string): void {
    if (this.inputBlocked) return;
    if (key === 'Escape') this.handleIntent({ type: 'cancel' });
  }

  handleIntent(intent: UiIntent): void {
    if (this.disposed || !this.entered || this.state.finished) return;
    if (this.menuOpen) return;
    const state = this.state;
    switch (intent.type) {
      case 'openMenu':
        if (!this.combat.busy) {
          this.deps.audio.play('uiClick');
          this.safe(this.openMenu());
        }
        break;
      case 'shortRest':
        if (state.mode === 'explore') this.explore.shortRest();
        break;
      case 'cancel':
        if (state.mode === 'combat') {
          if (this.combat.selectedActionId) this.deps.audio.play('uiCancel');
          this.combat.cancel();
        }
        break;
      case 'endTurn':
        if (state.mode === 'combat' && this.combat.playerTurn) this.deps.audio.play('uiClick');
        if (state.mode === 'combat') this.safe(this.combat.endTurn());
        break;
      case 'selectAction':
        if (state.mode === 'combat') this.safe(this.combat.selectAction(intent.actionId));
        else this.explore.useItem(intent.actionId);
        break;
      case 'selectCreature': {
        const c = creatureById(state, intent.creatureId);
        if (!c) break;
        state.targetId = c.id;
        if (!this.combat.busy && state.mode === 'combat' && state.entityVisible.get(c.id)) this.deps.renderer.focusCamera(c.pos);
        this.pushHud();
        break;
      }
    }
  }

  private async openMenu(): Promise<void> {
    this.menuOpen = true;
    try {
      const quality = loadQuality(this.deps.storage) ?? this.deps.options.quality ?? 'medium';
      const result = await this.deps.ui.showMenu({
        quality,
        depth: this.state.depth,
        muted: this.deps.audio.isMuted(),
      });
      if (result.type === 'quality') {
        this.deps.renderer.setQuality(result.level);
        saveQuality(this.deps.storage, result.level);
      } else if (result.type === 'sound') {
        this.deps.audio.setMuted(result.muted);
      } else if (result.type === 'abandon') {
        this.finish({ type: 'abandon' });
      }
    } finally {
      this.menuOpen = false;
    }
  }

  /** The hero's current character, in sync with the creature. */
  currentCharacter(): PlayerCharacter {
    return syncFromCreature(this.state.pc, this.state.player);
  }
}
