import { Rng, floorSeed } from '../core/rng';
import { THEMES } from '../core/themes';
import { SHORT_RESTS_PER_LONG_REST } from '../core/types';
import type { AnimationSpeed, CompanionStance, Creature, GridPos, HelpMode, HudModel, PickResult, PlayerCharacter, UiIntent } from '../core/types';
import { MONSTERS } from '../data/monsters';
import { createNavGrid, generateFloor } from '../gen';
import { buildEncounters, enterFloor, syncFromCreature, toCreature } from '../rules';
import { CombatController } from './combatController';
import type { FloorOutcome, GameDeps, RunState } from './deps';
import { Explore } from './explore';
import { cellDistance, revealFrom } from './fog';
import { SHOVE_PUSH_ID, pushPreview } from '../rules';
import type { FloorState, SessionCtx } from './floorState';
import { creatureById, lookOf, shownVisual, isSeen, livingMonsters, monsterDef, setEntityVisible } from './floorState';
import { CAST_PREFIX, PRAYER_ID, buildHudModel } from './hudModel';
import { makeCompanionRuntime } from './party';
import { Playback } from './playback';
import { floorTheme } from './runPlan';
import { newSkill } from '../puzzles';
import { HintDirector } from './hints';
import { Prefs } from './prefs';
import { loadQuality, saveQuality, writeSave } from './save';

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
  playback!: Playback;
  /** The character as it entered the floor (what the save holds). */
  entryCharacter!: PlayerCharacter;
  entered = false;
  private menuOpen = false;
  private disposed = false;
  private promptToken = 0;
  private ctx!: SessionCtx;
  private lastMask = new Uint8Array(0);
  readonly prefs: Prefs;
  readonly hints: HintDirector;

  constructor(
    private readonly deps: GameDeps,
    private readonly run: RunState,
    private readonly attempt: number,
  ) {
    this.outcome = new Promise<FloorOutcome>((resolve) => {
      this.resolveOutcome = resolve;
    });
    this.prefs = new Prefs(deps.storage);
    this.hints = new HintDirector(deps.ui, this.prefs, () => this.state?.help ?? 'standard', () => (deps.now ? deps.now() : Date.now()));
  }

  /** The help level for this run: the run's own, else the dev option, else the device default. A bot plays without help. */
  private helpLevel(): HelpMode {
    if (this.deps.options.autoplay) return 'standard';
    return this.run.help ?? this.deps.options.help ?? this.prefs.help() ?? 'standard';
  }

  // -------------------------------------------------------------- entering

  async enter(): Promise<void> {
    const { deps, run } = this;
    const { renderer, ui } = deps;
    const depth = run.depth;
    const theme = floorTheme(run.runSeed, depth, deps.options);
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
      companion: null,
      help: this.helpLevel(),
      puzzleKinds: [],
      speed: this.deps.options.speed ?? this.prefs.speed(),
      noticed: new Set<string>(),
      monsters: placed.map((p) => ({
        creature: p.creature,
        roomId: p.roomId,
        def: monsterDef(p.creature.defId),
        // The floor's boss carries the engine's hidden _boss flag; elite boss-role monsters in ordinary rooms do not count.
        boss: p.creature.resources['_boss'] !== undefined,
      })),
      chests: plan.spawns
        .filter((s) => s.role === 'chest')
        .map((s, i) => ({ id: `chest_${i}`, pos: { ...s.pos }, opened: false })),
      restSites: [],
      restSpotted: false,
      restHintShown: false,
      seen: new Uint8Array(plan.width * plan.height),
      revealAll: deps.options.reveal === true,
      shortRestsLeft: SHORT_RESTS_PER_LONG_REST,
      mode: 'explore',
      stairsOpen: false,
      log: [],
      targetId: null,
      shownHp: new Map(),
      shownDead: new Set(),
      shownActive: null,
      lastHitBy: '',
      fallen: new Set(),
      entityVisible: new Map(),
      finished: false,
    };
    const state = this.state;
    state.stairsOpen = !state.monsters.some((m) => m.boss);
    state.companion = makeCompanionRuntime(state, run.companion);
    if (state.revealAll) state.seen.fill(1);

    this.ctx = this.makeCtx();
    const playback = (this.playback = new Playback(this.ctx));
    this.explore = new Explore(this.ctx, { beginCombat: (m) => this.combat.begin(m) });
    this.combat = new CombatController(this.ctx, playback, this.attempt, () => undefined);

    await renderer.loadFloor(plan);
    this.applySpeed(state.speed);
    // Warm the model cache (bounded) so entities show real models on the first frame, before the veil drops.
    const warm = (renderer as { preloadModels?: (keys: string[], timeoutMs?: number) => Promise<void> }).preloadModels;
    if (typeof warm === 'function') {
      const keys = new Set<string>([HERO_MODEL, 'chest', 'rest_site']);
      for (const m of state.monsters) keys.add(m.creature.visual.model);
      if (state.companion) keys.add(state.companion.creature.visual.model);
      try {
        await warm.call(renderer, [...keys], 2000);
      } catch (err) {
        console.warn('Model preload failed', err);
      }
    }
    const shown = shownVisual(state.player);
    renderer.spawnEntity('player', shown.visual, state.player.pos, { faction: 'player', size: shown.size });
    renderer.setEntityState('player', lookOf(state.player));
    state.entityVisible.set('player', true);
    if (state.companion) {
      const c = state.companion.creature;
      renderer.spawnEntity('companion', c.visual, c.pos, { faction: 'ally', size: c.size });
      state.entityVisible.set('companion', true);
    }
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
    (plan.restSpots ?? []).forEach((pos) => this.addRestSite(pos));
    this.ctx.reveal();
    renderer.followEntity('player');
    deps.audio.setAmbience(theme);
    ui.setLoading(null);
    ui.banner(`Floor ${depth}`, themeName);
    this.ctx.say(`Floor ${depth}: ${themeName}. ${THEMES[theme].tagline}`);
    this.entered = true;
    this.ctx.hud();
  }

  /** Place a rest site entity on a cell (the generator's spots, or a test's). */
  addRestSite(pos: GridPos): void {
    const state = this.state;
    const id = `rest_${state.restSites.length}`;
    state.restSites.push({ id, pos: { ...pos }, used: false });
    state.shortRestsLeft = state.restSites.length;
    this.deps.renderer.spawnEntity(id, { model: 'rest_site' }, pos, { faction: 'ally', size: 'small' });
    this.deps.renderer.setEntityState(id, { visible: false });
    state.entityVisible.set(id, false);
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
      puzzleSkill: () => this.run.puzzleSkill ?? newSkill(),
      setPuzzleSkill: (skill) => {
        this.run.puzzleSkill = skill;
      },
      hint: (def) => {
        if (!this.deps.options.autoplay) this.hints.offer(def, true);
      },
      areaCells: (actionId, point) => (this.combat?.combat ? this.combat.combat.areaCells(actionId, point) : []),
      finish: (o) => this.finish(o),
      rebuildPlayer: () => {
        const prev = this.state.player;
        this.state.player = this.makePlayer(this.state.pc, prev.pos);
        // Spell effects on the hero show on the figure: a new form (Polymorph), size, a see-through body, duplicates.
        const now = shownVisual(this.state.player);
        if (now.visual.model !== shownVisual(prev).visual.model) {
          this.deps.renderer.removeEntity('player');
          this.deps.renderer.spawnEntity('player', now.visual, this.state.player.pos, { faction: 'player', size: now.size });
        }
        this.deps.renderer.setEntityState('player', lookOf(this.state.player));
      },
    };
  }

  // ------------------------------------------------------------- plumbing

  pushHud(): void {
    if (this.disposed) return;
    const busy = this.combat.busy || this.explore.walking || this.explore.resting;
    const model = buildHudModel({
      state: this.state,
      combat: this.combat.combat,
      selectedActionId: this.combat.selectedActionId,
      previewActionId: this.combat.previewActionId,
      busy,
      help: this.state.help,
    });
    this.addBossChestPrompt(model);
    this.deps.ui.setHud(model);
    this.updateHints(model, busy);
  }

  /** Tell the renderer (when it can) and the playback pacing how fast animations play. */
  private applySpeed(speed: AnimationSpeed): void {
    this.state.speed = speed;
    const r = this.deps.renderer as { setAnimationSpeed?: (s: AnimationSpeed) => void };
    if (typeof r.setAnimationSpeed === 'function') r.setAnimationSpeed(speed);
  }

  /** Change the help level (the menu): saved with the run and as the device default; tips come back on. */
  setHelp(mode: HelpMode): void {
    this.state.help = mode;
    this.run.help = mode;
    this.prefs.setHelp(mode);
    this.prefs.setTipsOff(false);
    this.hints.reset();
    writeSave(this.deps.storage, { ...this.run, pc: this.entryCharacter });
    this.pushHud();
  }

  setSpeed(speed: AnimationSpeed): void {
    this.prefs.setSpeed(speed);
    this.applySpeed(speed);
  }

  /** The persistent nudge while the floor boss's chest is unopened. */
  private addBossChestPrompt(model: HudModel): void {
    if (model.prompt === undefined && this.state.mode === 'explore' && this.state.chests.some((c) => c.boss && !c.opened)) {
      model.prompt = "The boss's chest is waiting";
    }
  }

  /** Offer a first-time hint when the moment fits (never while things are playing), and clear one the player acted on. */
  private updateHints(model: HudModel, busy: boolean): void {
    if (this.deps.options.autoplay || this.state.finished || !this.entered) return;
    const state = this.state;
    const heroTurn = model.mode !== 'combat' || model.combat?.playerTurn === true;
    let edgeShove = false;
    const combat = this.combat.combat;
    if (state.help === 'guided' && combat && model.combat?.playerTurn) {
      edgeShove = combat
        .creatures()
        .some((c) => c.faction === 'enemy' && !c.dead && c.hp > 0 && cellDistance(c.pos, state.player.pos) <= 1 && pushPreview(combat, SHOVE_PUSH_ID, c.id) !== null);
    }
    this.hints.update({ model, state, edgeShove }, busy || !heroTurn || this.menuOpen);
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
    for (const m of state.monsters) {
      // A creature down in a pit stays out of sight, whatever the fog says.
      if (state.fallen.has(m.creature.id)) continue;
      setEntityVisible(this.ctx, m.creature.id, isSeen(state, m.creature.pos));
    }
    for (const c of state.chests) setEntityVisible(this.ctx, c.id, isSeen(state, c.pos));
    for (const r of state.restSites) setEntityVisible(this.ctx, r.id, isSeen(state, r.pos));
    if (!state.restSpotted && state.restSites.some((r) => isSeen(state, r.pos))) {
      state.restSpotted = true;
      this.ctx.say('You spot a safe place to rest.');
    }
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
    if (this.state.companion) r.removeEntity('companion');
    for (const m of this.state.monsters) r.removeEntity(m.creature.id);
    for (const c of this.state.chests) r.removeEntity(c.id);
    for (const rs of this.state.restSites) r.removeEntity(rs.id);
  }

  // ---------------------------------------------------------------- input

  /** Whether keys are being handled right now (not in a menu, not before entry, not after the floor ended). */
  get acceptsKeys(): boolean {
    return !this.inputBlocked;
  }

  private get inputBlocked(): boolean {
    // A lock puzzle holds the game still: no input reaches the floor while it is open.
    return this.disposed || this.menuOpen || !this.entered || this.state.finished || this.explore?.puzzleOpen === true;
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

  handleKey(key: string, shift = false): void {
    if (this.inputBlocked) return;
    if (key === 'Escape') this.handleIntent({ type: 'cancel' });
    else if (key === 'Tab') this.cycleTarget(shift ? -1 : 1);
  }

  /**
   * Tab / Shift+Tab: select the next (or previous) visible living monster, nearest first. While the hero is
   * choosing a target for an action it cycles only the creatures that action can hit.
   */
  cycleTarget(dir: 1 | -1): void {
    const state = this.state;
    const here = state.player.pos;
    const choosing = state.mode === 'combat' ? this.combat.targetableIds : [];
    const pool = livingMonsters(state)
      .map((m) => m.creature)
      .filter((c) => (choosing.length > 0 ? choosing.includes(c.id) : state.entityVisible.get(c.id) === true));
    if (pool.length === 0) return;
    pool.sort((a, b) => cellDistance(here, a.pos) - cellDistance(here, b.pos) || a.id.localeCompare(b.id));
    const at = pool.findIndex((c) => c.id === state.targetId);
    const next = pool[(at + dir + pool.length) % pool.length] as Creature;
    state.targetId = next.id;
    if (state.mode === 'combat' && !this.combat.busy) this.deps.renderer.focusCamera(next.pos);
    this.deps.audio.play('uiClick');
    this.pushHud();
  }

  handleIntent(intent: UiIntent): void {
    if (this.disposed || !this.entered || this.state.finished) return;
    if (this.menuOpen || this.explore.puzzleOpen) return;
    const state = this.state;
    switch (intent.type) {
      case 'openMenu':
        if (!this.combat.busy) {
          this.deps.audio.play('uiClick');
          this.safe(this.openMenu());
        }
        break;
      case 'shortRest':
        if (state.mode === 'explore') this.safe(this.explore.shortRest());
        break;
      case 'longRest':
        if (state.mode === 'explore') this.safe(this.explore.longRestHere());
        break;
      case 'cancel':
        if (state.mode === 'combat') {
          if (this.combat.selectedActionId) this.deps.audio.play('uiCancel');
          this.combat.cancel();
        }
        break;
      case 'endTurn':
        if (state.mode === 'combat' && this.combat.playerTurn) this.deps.audio.play('uiClick');
        if (state.mode === 'combat') this.safe(this.endTurnChecked());
        break;
      case 'selectAction':
        if (state.mode === 'combat') this.safe(this.combat.selectAction(intent.actionId));
        else if (intent.actionId === PRAYER_ID) this.safe(this.explore.prayer());
        else if (intent.actionId.startsWith(CAST_PREFIX)) this.safe(this.explore.castSpell(intent.actionId.slice(CAST_PREFIX.length)));
        else this.explore.useItem(intent.actionId);
        break;
      case 'setStance':
        this.setStance(intent.stance);
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

  /** Change the companion's stance, now and in the save (any time, also mid-fight). */
  setStance(stance: CompanionStance): void {
    const rt = this.state.companion;
    if (!rt || rt.state.stance === stance) return;
    rt.state.stance = stance;
    this.combat.setStance(stance);
    this.deps.audio.play('stanceChange');
    if (this.run.companion) {
      this.run.companion = { ...this.run.companion, stance };
      writeSave(this.deps.storage, { ...this.run, pc: this.entryCharacter });
    }
    this.pushHud();
  }

  /** Guided mode: ending a turn with the action unspent and an enemy in reach asks first. */
  private async endTurnChecked(): Promise<void> {
    const combat = this.combat.combat;
    if (this.state.help === 'guided' && combat && this.combat.playerTurn && !combat.turn.actionUsed && !this.deps.options.autoplay) {
      const canAttack = combat.availableActions().some((a) => a.cost === 'action' && a.attack !== undefined && combat.canUse(a.id).ok && combat.validTargets(a.id).length > 0);
      if (canAttack && !this.prefs.remembered('endTurnUnused')) {
        const answer = await this.deps.ui.confirm({
          title: 'End your turn?',
          lines: ['You still have your action. End turn anyway?'],
          confirmLabel: 'End turn',
          cancelLabel: 'Keep going',
          rememberKey: 'endTurnUnused',
        });
        if (!answer.ok) return;
        if (answer.remember) this.prefs.remember('endTurnUnused');
      }
    }
    await this.combat.endTurn();
  }

  private async openMenu(): Promise<void> {
    this.menuOpen = true;
    try {
      for (;;) {
        const quality = loadQuality(this.deps.storage) ?? this.deps.options.quality ?? 'medium';
        const result = await this.deps.ui.showMenu({
          quality,
          depth: this.state.depth,
          muted: this.deps.audio.isMuted(),
          help: this.state.help,
          speed: this.state.speed,
        });
        if (result.type === 'quality') {
          this.deps.renderer.setQuality(result.level);
          saveQuality(this.deps.storage, result.level);
        } else if (result.type === 'sound') {
          this.deps.audio.setMuted(result.muted);
        } else if (result.type === 'help') {
          this.setHelp(result.mode);
          continue;
        } else if (result.type === 'speed') {
          this.setSpeed(result.speed);
          continue;
        } else if (result.type === 'howToPlay') {
          await this.deps.ui.showHowToPlay();
          continue;
        } else if (result.type === 'abandon') {
          this.finish({ type: 'abandon' });
        }
        return;
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
