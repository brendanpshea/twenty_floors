import type { CellHighlight, GridPos, PickResult } from '../core/types';
import { CellKind, SHORT_RESTS_PER_LONG_REST } from '../core/types';
import {
  castOutOfCombat,
  chestLoot,
  companionPrayer,
  companionShortRest,
  previewRest,
  getItem,
  isChasmEdge,
  isChokepoint,
  isHiddenResource,
  longRest,
  nextToHazard,
  longRestGain,
  rollDice,
  syncFromCreature,
  takeShortRest,
} from '../rules';
import type { Rng } from '../core/rng';
import type { PuzzleGrade, PuzzleRequest, PuzzleResult, PuzzleSpec } from '../core/types';
import { nextDifficulty, pickKind, updateSkill } from '../puzzles';
import { PRAYER_ID } from './hudModel';
import { describeLoot, gradeWords, lootFor, rewardWords } from './puzzle';
import { Prefs } from './prefs';
import { companionSpot, companionWantsLongRest, longRested, rebuildCompanion } from './party';
import { adjacentRestSite, shortRestBlock } from './hudModel';
import { cellDistance } from './fog';
import type { ChestState, MonsterState, SessionCtx } from './floorState';
import {
  blockedAt,
  isEntityVisible,
  isSeen,
  livingMonsters,
  samePos,
} from './floorState';

/** Combat starts when a living monster is this close by walking, with line of sight. */
export const AGGRO_RANGE = 7;

interface Goal {
  cell: GridPos;
  /** Open this chest on arrival. */
  chestId?: string;
  /** Rest at this site on arrival. */
  restId?: string;
}

export interface ExploreHooks {
  /** Start a fight with these monsters. Resolves when exploration resumes (or the floor ends). */
  beginCombat(monsters: MonsterState[]): Promise<void>;
}

/** Exploration: walking, fog-driven combat triggers, chests, rests, the stairs. */
/** A chest's name by theme (the boss's hoard is named for the boss). */
const CHEST_NAMES: Partial<Record<string, string>> = {
  sewers: 'Rusted Strongbox',
  crypt: 'Sealed Reliquary',
  library: 'Locked Book Chest',
  hold: 'Bandit Lockbox',
  foundry: 'Forge-bound Coffer',
  ice: 'Frost-sealed Chest',
  hell: 'Brimstone Coffer',
  lair: "Dragon's Cache",
};

export class Explore {
  /** A lock puzzle is on screen: the floor holds still and takes no input. */
  puzzleOpen = false;
  private goal: Goal | null = null;
  walking = false;
  private hoverKey = '';
  private itemUses = 0;
  resting = false;
  private shortRests = 0;

  constructor(
    private readonly ctx: SessionCtx,
    private readonly hooks: ExploreHooks,
  ) {}

  /** Monsters that join a fight if one starts at the player's current cell, else null. */
  combatTrigger(at?: GridPos): MonsterState[] | null {
    const { state, deps } = this.ctx;
    // ?peace=1: monsters stand where they were placed and never notice the hero.
    if (deps.options.peace) return null;
    const p = at ?? state.player.pos;
    const here = state.plan.roomIds[p.y * state.plan.width + p.x] ?? -1;
    const inEntrance = here >= 0 && state.plan.rooms.find((r) => r.id === here)?.role === 'entrance';
    const alive = livingMonsters(state);
    const rooms = new Set<number>();
    for (const m of alive) {
      const mp = m.creature.pos;
      if (here >= 0 && m.roomId === here) rooms.add(m.roomId);
      else if (
        !inEntrance &&
        cellDistance(p, mp) <= AGGRO_RANGE &&
        state.nav.hasLineOfSight(p, mp) &&
        state.nav.findPath(p, mp, { maxCost: AGGRO_RANGE }) !== null
      ) {
        rooms.add(m.roomId);
      }
    }
    if (rooms.size === 0) return null;
    return alive.filter((m) => rooms.has(m.roomId));
  }

  // ---------------------------------------------------------------- input

  hover(pick: PickResult): void {
    const { state, deps } = this.ctx;
    if (this.walking || this.puzzleOpen) return;
    let targetId: string | null = null;
    if (pick.entityId && state.monsters.some((m) => m.creature.id === pick.entityId) && isEntityVisible(state, pick.entityId)) {
      targetId = pick.entityId;
    } else if (pick.entityId === 'companion' && state.companion) {
      targetId = 'companion';
    }
    const key = pick.cell ? `${pick.cell.x},${pick.cell.y}` : '';
    if (targetId !== state.targetId) {
      state.targetId = targetId;
      this.ctx.hud();
    }
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    deps.renderer.setHighlights(this.pathHighlights(pick.cell));
  }

  private pathHighlights(cell: GridPos | null): CellHighlight[] {
    const { state } = this.ctx;
    if (!cell || !state.nav.isWalkable(cell) || blockedAt(state)(cell) || samePos(cell, state.player.pos)) return [];
    const path = state.nav.findPath(state.player.pos, cell, { blocked: blockedAt(state) });
    return path ? path.map((pos) => ({ pos, style: 'path' as const })) : [];
  }

  async tap(pick: PickResult): Promise<void> {
    const { state } = this.ctx;
    if (this.puzzleOpen) return;
    const chest =
      state.chests.find((c) => c.id === pick.entityId) ??
      (pick.cell ? state.chests.find((c) => samePos(c.pos, pick.cell as GridPos)) : undefined);
    if (chest) {
      if (isSeen(state, chest.pos)) await this.approachChest(chest.id);
      return;
    }
    const site =
      state.restSites.find((r) => r.id === pick.entityId) ??
      (pick.cell ? state.restSites.find((r) => samePos(r.pos, pick.cell as GridPos)) : undefined);
    if (site) {
      if (isSeen(state, site.pos)) await this.approachRest(site.id);
      return;
    }
    const mon =
      state.monsters.find((m) => m.creature.id === pick.entityId) ??
      (pick.cell
        ? livingMonsters(state).find((m) => samePos(m.creature.pos, pick.cell as GridPos))
        : undefined);
    if (mon && isEntityVisible(state, mon.creature.id)) {
      state.targetId = mon.creature.id;
      this.ctx.hud();
      return;
    }
    if (pick.entityId === 'companion') {
      state.targetId = 'companion';
      this.ctx.hud();
      return;
    }
    if (pick.entityId === 'player') {
      if (samePos(state.player.pos, state.plan.exit)) await this.takeStairs();
      return;
    }
    if (!pick.cell) return;
    await this.walkToCell(pick.cell);
  }

  async walkToCell(cell: GridPos): Promise<void> {
    const { state } = this.ctx;
    if (samePos(cell, state.player.pos)) {
      // Standing on the stairs when they open (the boss died next to them): choosing the cell descends.
      if (samePos(cell, state.plan.exit)) await this.takeStairs();
      return;
    }
    if (!state.nav.isWalkable(cell) || !state.nav.findPath(state.player.pos, cell, { blocked: blockedAt(state) })) {
      this.ctx.prompt("You can't get there.", 1800);
      return;
    }
    this.ctx.prompt(undefined);
    await this.walk({ cell });
  }

  /** Walk next to a chest and open it. */
  async approachChest(chestId: string): Promise<void> {
    const { state } = this.ctx;
    const chest = state.chests.find((c) => c.id === chestId);
    if (!chest || chest.opened) return;
    if (cellDistance(state.player.pos, chest.pos) <= 1) {
      await this.openChest(chestId);
      return;
    }
    const best = this.approachCell(chest.pos);
    if (!best) {
      this.ctx.prompt("You can't reach the chest.", 1800);
      return;
    }
    await this.walk({ cell: best.cell, chestId });
  }

  /** The nearest free cell next to `pos` that the hero can walk to, with its path length. */
  approachCell(pos: GridPos): { cell: GridPos; path: GridPos[] } | null {
    const { state } = this.ctx;
    let best: { cell: GridPos; path: GridPos[] } | null = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = { x: pos.x + dx, y: pos.y + dy };
        if ((dx === 0 && dy === 0) || !state.nav.isWalkable(n) || blockedAt(state)(n)) continue;
        const path = samePos(n, state.player.pos) ? [] : state.nav.findPath(state.player.pos, n, { blocked: blockedAt(state) });
        if (path && (!best || path.length < best.path.length)) best = { cell: n, path };
      }
    }
    return best;
  }

  /** Walk next to a rest site and rest there. */
  async approachRest(siteId: string): Promise<void> {
    const { state } = this.ctx;
    const site = state.restSites.find((r) => r.id === siteId);
    if (!site || state.mode !== 'explore') return;
    if (site.used) {
      this.ctx.deps.audio.play('uiError');
      this.ctx.prompt('This site has been used.', 2500);
      return;
    }
    if (!longRestGain(syncFromCreature(state.pc, state.player)) && !companionWantsLongRest(state)) {
      this.ctx.deps.audio.play('uiError');
      this.ctx.prompt('You are already rested.', 2500);
      return;
    }
    if (cellDistance(state.player.pos, site.pos) <= 1) {
      await this.restAt(siteId);
      return;
    }
    const best = this.approachCell(site.pos);
    if (!best) {
      this.ctx.prompt("You can't reach the rest site.", 1800);
      return;
    }
    await this.walk({ cell: best.cell, restId: siteId });
  }

  /** True if walking to the site would not start a fight on the way. */
  restPathSafe(siteId: string): boolean {
    const site = this.ctx.state.restSites.find((r) => r.id === siteId);
    if (!site) return false;
    const best = this.approachCell(site.pos);
    if (!best) return false;
    return [this.ctx.state.player.pos, ...best.path].every((c) => this.combatTrigger(c) === null);
  }

  // -------------------------------------------------------------- walking

  /** Walk toward the goal one cell at a time. A new goal while walking re-targets in place. */
  private async walk(goal: Goal): Promise<void> {
    const { state, deps } = this.ctx;
    this.goal = goal;
    if (this.walking) return;
    this.walking = true;
    deps.renderer.setHighlights([]);
    this.hoverKey = '';
    state.targetId = null;
    let arrived: Goal | null = null;
    try {
      while (this.goal && !state.finished) {
        const g: Goal = this.goal;
        const pos = state.player.pos;
        if (samePos(pos, g.cell)) {
          arrived = g;
          this.goal = null;
          break;
        }
        const path = state.nav.findPath(pos, g.cell, { blocked: blockedAt(state) });
        const step = path?.[0];
        if (!step) {
          this.ctx.prompt("You can't get there.", 1800);
          this.goal = null;
          break;
        }
        deps.audio.play(state.plan.kinds[step.y * state.plan.width + step.x] === CellKind.Water ? 'stepWater' : 'step');
        const followed = this.companionFollows(pos);
        await this.ctx.guard(Promise.all([deps.renderer.moveEntity('player', [step]), followed]), 1200);
        state.player.pos = { x: step.x, y: step.y };
        this.ctx.reveal();

        const trigger = this.combatTrigger();
        if (trigger) {
          this.goal = null;
          this.walking = false;
          await this.hooks.beginCombat(trigger);
          return;
        }
        if (samePos(step, state.plan.exit)) {
          this.goal = null;
          if (await this.takeStairs()) return;
          break;
        }
      }
    } finally {
      this.walking = false;
    }
    this.stepAside();
    if (arrived?.chestId) await this.openChest(arrived.chestId);
    if (arrived?.restId) await this.restAt(arrived.restId);
    this.ctx.hud();
  }

  /** Descend if the hero is on the stairs and they are open; if sealed, say so. Returns true when the floor ended. */
  private async takeStairs(): Promise<boolean> {
    const { state, deps } = this.ctx;
    if (state.finished || state.mode !== 'explore') return false;
    if (!state.stairsOpen) {
      this.ctx.prompt('The stairs are sealed. Defeat the floor boss first.', 3500);
      return false;
    }
    // Chests the hero has seen and not opened: leaving them is allowed, but asked about. The bot never asks.
    const left = state.chests.filter((c) => !c.opened && isSeen(state, c.pos));
    if (left.length > 0 && !deps.options.autoplay) {
      const boss = left.some((c) => c.boss);
      const lines = [`You have not opened ${left.length} chest${left.length === 1 ? '' : 's'} on this floor. Leave ${left.length === 1 ? 'it' : 'them'}?`];
      if (boss) lines.unshift("The boss's chest is still closed.");
      const answer = await deps.ui.confirm({ title: 'Leave treasure behind?', lines, confirmLabel: 'Leave', cancelLabel: 'Go back' });
      if (!answer.ok) return false;
    }
    deps.audio.play('descend');
    this.ctx.finish(state.companion ? { type: 'cleared', pc: state.pc, companion: state.companion.state } : { type: 'cleared', pc: state.pc });
    return true;
  }

  // --------------------------------------------------------------- chests

  async openChest(chestId: string): Promise<void> {
    const { state, deps } = this.ctx;
    const chest = state.chests.find((c) => c.id === chestId);
    if (!chest || chest.opened || state.finished || this.puzzleOpen) return;
    // Every chest knows how many ordinary chests the floor has, so the floor's treasure stays where the economy expects it;
    // the boss's hoard is the rules' boss chest (about two and a half ordinary chests, and a chance of magic gear).
    const ordinary = Math.max(1, state.chests.filter((c) => !c.boss).length);
    const lootRng = (): Rng => state.floorRng.fork(`chest:${chestId}`);
    const boss = chest.boss === true;
    const grade = await this.lockPuzzle(chest, boss, ordinary, lootRng);
    if (state.finished) return;
    chest.opened = true;
    const loot = lootFor(state.depth, lootRng, grade, boss, ordinary);
    deps.ui.banner(`${gradeWords(grade)} ${describeLoot(loot)}`);
    deps.audio.play('chestOpen');
    deps.audio.play('coins', { delay: 0.45 });
    await this.ctx.guard(deps.renderer.playAnim(chest.id, 'attack', { facing: chest.pos }), 1500);

    const next = syncFromCreature(state.pc, state.player);
    next.gold += loot.gold;
    const names: string[] = [`${loot.gold} gold`];
    for (const it of loot.items) {
      const stack = next.inventory.find((x) => x.itemId === it.itemId);
      if (stack) stack.quantity += it.quantity;
      else next.inventory.push({ ...it });
      names.push(`${it.quantity > 1 ? it.quantity + ' x ' : ''}${getItem(it.itemId)?.name ?? it.itemId}`);
    }
    state.pc = next;
    this.ctx.rebuildPlayer();
    deps.renderer.floatText(chest.id, `+${loot.gold} gold`, 'info');
    if (loot.items.length > 0) deps.renderer.floatText(state.player.pos, 'Potion found', 'heal');
    this.ctx.say(`${state.pc.build.name} opens the chest and finds ${names.join(' and ')}.`);
    this.ctx.hud();
  }

  /**
   * The chest's lock: a puzzle played over the paused floor, graded gold, silver or bronze for the loot (or forced:
   * none). Same chest, same puzzle, on a retried floor (the spec comes from the floor's own stream). The player's rating
   * is updated from the result. The bot and headless runs never see a puzzle: they get silver, which is what an
   * instantly opened chest paid, so the economy keeps its tuned baseline.
   */
  private async lockPuzzle(chest: ChestState, boss: boolean, ordinary: number, lootRng: () => Rng): Promise<PuzzleGrade> {
    const { state, deps } = this.ctx;
    if (deps.options.autoplay) return 'silver';
    const skill = this.ctx.puzzleSkill();
    const pick = state.floorRng.fork(`puzzlekind:${chest.id}`);
    const kind = deps.options.puzzle ?? pickKind(pick, skill, state.puzzleKinds);
    const difficulty = deps.options.puzzleLevel ?? nextDifficulty(skill, kind, state.depth);
    const spec: PuzzleSpec = { kind, seed: state.floorRng.fork(`puzzle:${chest.id}`).int(1, 2_000_000_000), difficulty };
    const bossName = state.monsters.find((m) => m.boss)?.creature.name;
    const req: PuzzleRequest = {
      spec,
      title: boss ? (bossName ? `The ${bossName}'s Hoard` : "The Warden's Hoard") : (CHEST_NAMES[state.plan.theme] ?? 'Ironbound Chest'),
      rewards: rewardWords(state.depth, lootRng, boss, ordinary),
    };
    if (boss) req.boss = true;
    // The first lock: a word about what it is (guided help only).
    this.ctx.hint({ id: 'chestLock', kind: 'concept', text: 'Chests are locked. Solve the lock quickly for the best loot, or force it for a little.', anchor: 'center' });
    this.puzzleOpen = true;
    let result: PuzzleResult;
    try {
      result = await deps.ui.playPuzzle(req);
    } finally {
      this.puzzleOpen = false;
    }
    state.puzzleKinds.push(kind);
    this.ctx.setPuzzleSkill(updateSkill(skill, kind, difficulty, result));
    return result.grade;
  }

  // ---------------------------------------------------------------- rests

  /** The shortRest intent: a real short rest, anywhere with no enemy in view. */
  async shortRest(): Promise<void> {
    const { state, deps } = this.ctx;
    if (this.resting || this.walking) return;
    if (shortRestBlock(state) !== undefined) return;
    if (!(await this.confirmRest('short'))) return;
    this.resting = true;
    try {
      const before = syncFromCreature(state.pc, state.player);
      const rng = state.floorRng.fork(`short:${this.shortRests++}`);
      const r = takeShortRest(before, rng);
      state.pc = r.pc;
      state.shortRestsLeft -= 1;
      const companionGain = this.restCompanion(false, rng);
      deps.audio.play('rest');
      deps.ui.banner('Short rest');
      await deps.delay(500);
      this.ctx.rebuildPlayer();
      deps.renderer.setEntityState('player', { hpFraction: state.player.hp / state.player.maxHp });
      if (r.healed > 0) deps.renderer.floatText('player', `+${r.healed}`, 'heal');
      const restored = Object.entries(r.pc.resources)
        .filter(([k, p]) => !isHiddenResource(k) && p.current > (before.resources[k]?.current ?? 0))
        .map(([, p]) => p.name);
      if (companionGain > 0) this.ctx.say(`${state.companion?.def.name ?? 'Your companion'} recovers ${companionGain} HP.`);
      const dice = r.hitDiceSpent === 1 ? '1 Hit Die' : `${r.hitDiceSpent} Hit Dice`;
      this.ctx.say(
        `${r.pc.build.name} takes a short rest, spends ${dice} and recovers ${r.healed} HP.${restored.map((n) => ` ${n} restored.`).join('')}`,
      );
    } finally {
      this.resting = false;
    }
    this.ctx.hud();
  }

  /**
   * Before a rest: say what it would restore and what it costs, and warn when it would be wasteful. A short rest the
   * player chose to stop asking about goes ahead unasked, unless it is wasteful. Cancelling costs nothing. The bot
   * does not ask.
   */
  async confirmRest(kind: 'short' | 'long'): Promise<boolean> {
    const { state, deps } = this.ctx;
    if (deps.options.autoplay) return true;
    const rt = state.companion;
    const preview = previewRest(
      syncFromCreature(state.pc, state.player),
      rt ? { state: { ...rt.state, hp: rt.creature.hp } } : null,
      kind,
      { shortRestsLeft: state.shortRestsLeft, restSitesLeft: state.restSites.filter((r) => !r.used).length },
    );
    const prefs = new Prefs(deps.storage);
    if (kind === 'short' && prefs.remembered('shortRest') && !preview.wasteful) return true;
    const q: Parameters<typeof deps.ui.confirm>[0] = {
      title: kind === 'short' ? 'Take a short rest?' : 'Rest here?',
      lines: [...preview.gains, ...preview.costs],
      confirmLabel: 'Rest',
      cancelLabel: 'Not now',
    };
    if (preview.wasteful) q.warning = 'You would recover very little. Save it for later?';
    if (kind === 'short') q.rememberKey = 'shortRest';
    const answer = await deps.ui.confirm(q);
    if (answer.ok && answer.remember && kind === 'short') prefs.remember('shortRest');
    return answer.ok;
  }

  /** The longRest intent: long rest at the adjacent site. */
  async longRestHere(): Promise<void> {
    const site = adjacentRestSite(this.ctx.state);
    if (site) await this.restAt(site.id);
  }

  /** Long rest at a site next to the hero (never in combat). Does not consume the site if nothing would be gained. */
  async restAt(siteId: string): Promise<void> {
    const { state, deps } = this.ctx;
    const site = state.restSites.find((r) => r.id === siteId);
    if (!site || state.mode !== 'explore' || state.finished || this.resting) return;
    if (cellDistance(state.player.pos, site.pos) > 1) return;
    if (site.used) {
      deps.audio.play('uiError');
      this.ctx.prompt('This site has been used.', 2500);
      return;
    }
    if (!longRestGain(syncFromCreature(state.pc, state.player)) && !companionWantsLongRest(state)) {
      deps.audio.play('uiError');
      this.ctx.prompt('You are already rested.', 2500);
      return;
    }
    if (!(await this.confirmRest('long'))) return;
    if (site.used || this.resting) return;
    this.resting = true;
    try {
      site.used = true;
      deps.audio.play('rest');
      await this.ctx.guard(deps.renderer.playAnim(site.id, 'cast'), 1500);
      const before = state.player.hp;
      state.pc = longRest(syncFromCreature(state.pc, state.player));
      state.shortRestsLeft = SHORT_RESTS_PER_LONG_REST;
      this.ctx.rebuildPlayer();
      this.restCompanion(true);
      const gained = state.player.hp - before;
      deps.renderer.setEntityState(site.id, { dead: true });
      deps.renderer.setEntityState('player', { hpFraction: state.player.hp / state.player.maxHp });
      if (gained > 0) deps.renderer.floatText('player', `+${gained}`, 'heal');
      this.ctx.say(`${state.pc.build.name} makes camp and is fully restored.`);
    } finally {
      this.resting = false;
    }
    this.ctx.hud();
  }

  /** Drink a healing consumable outside combat (rules exports no helper for this; see report). */
  useItem(actionId: string): void {
    const { state, deps } = this.ctx;
    if (this.walking || state.mode !== 'explore' || !actionId.startsWith('drink_')) return;
    const itemId = actionId.slice('drink_'.length);
    const item = getItem(itemId);
    const next = syncFromCreature(state.pc, state.player);
    const owned = next.inventory.find((s) => s.itemId === itemId && s.quantity > 0);
    if (!item?.consumable || !owned) return;
    if (next.hp >= next.maxHp) {
      deps.audio.play('uiError');
      this.ctx.prompt('You are already at full health.', 1800);
      return;
    }
    const rng = state.floorRng.fork(`item:${itemId}:${this.itemUses++}`);
    const healed = rollDice(rng, item.consumable.dice).total;
    const before = next.hp;
    next.hp = Math.min(next.maxHp, next.hp + healed);
    owned.quantity -= 1;
    next.inventory = next.inventory.filter((s) => s.quantity > 0);
    state.pc = next;
    this.ctx.rebuildPlayer();
    const gained = next.hp - before;
    deps.audio.play('potion');
    deps.audio.play('heal', { delay: 0.25 });
    deps.renderer.setEntityState('player', { hpFraction: state.player.hp / state.player.maxHp });
    deps.renderer.floatText('player', `+${gained}`, 'heal');
    this.ctx.say(`${next.build.name} drinks ${item.name} and regains ${gained} hit points.`);
    this.ctx.hud();
  }

  private spellCasts = 0;

  /** Cast a known spell between fights (castOutOfCombat): cures, False Life, Mage Armor. */
  async castSpell(spellId: string): Promise<void> {
    const { state, deps } = this.ctx;
    if (this.walking || this.resting || state.mode !== 'explore' || state.finished) return;
    const synced = syncFromCreature(state.pc, state.player);
    const result = castOutOfCombat(synced, spellId, state.floorRng.fork(`cast:${spellId}:${this.spellCasts++}`));
    if ('error' in result) {
      deps.audio.play('uiError');
      this.ctx.prompt(result.error, 2500);
      return;
    }
    this.resting = true; // blocks other input while the cast plays
    try {
      state.pc = result.pc;
      this.ctx.rebuildPlayer();
      this.ctx.hud();
      deps.audio.play('spellCast');
      if (result.healed !== undefined) deps.audio.play('healSpell', { delay: 0.35 });
      await this.ctx.guard(deps.renderer.playAnim('player', 'cast'), 1200);
      const hp = state.player;
      deps.renderer.setEntityState('player', { hpFraction: hp.hp / hp.maxHp });
      if (result.healed !== undefined) deps.renderer.floatText('player', `+${result.healed}`, 'heal');
      else deps.renderer.floatText('player', spellId === 'false_life' ? `+${hp.tempHp} temp HP` : 'Mage Armor', 'info');
      this.ctx.say(result.log);
    } finally {
      this.resting = false;
    }
    this.ctx.hud();
  }

  // ------------------------------------------------------------ companion

  /**
   * The companion takes the cell the hero is leaving, so it trails one step behind and the hero may walk through it
   * (they swap). Far behind or cut off, it appears beside the hero instead. Resolves when its move has played.
   */
  private companionFollows(heroFrom: GridPos): Promise<void> {
    const { state, deps } = this.ctx;
    const rt = state.companion;
    if (!rt || rt.downed) return Promise.resolve();
    const c = rt.creature;
    if (samePos(c.pos, heroFrom)) return Promise.resolve();
    const d = cellDistance(c.pos, heroFrom);
    const path = d <= 1 ? [heroFrom] : d <= 3 ? state.nav.findPath(c.pos, heroFrom, { maxCost: 4 }) : null;
    if (!path || path.length === 0) {
      const spot = companionSpot(state, heroFrom, heroFrom, 2);
      if (spot) {
        c.pos = spot;
        deps.renderer.placeEntity('companion', spot);
      }
      return Promise.resolve();
    }
    c.pos = { x: heroFrom.x, y: heroFrom.y };
    return deps.renderer.moveEntity('companion', path);
  }

  /** When the hero stops: a companion in a doorway, a corridor or on a drop edge steps to a better cell. */
  stepAside(): void {
    const { state, deps } = this.ctx;
    const rt = state.companion;
    if (!rt || rt.downed || state.mode !== 'explore' || state.finished) return;
    const c = rt.creature;
    const awkward = isChokepoint(state.nav, c.pos) || isChasmEdge(state.nav, c.pos) || nextToHazard(state.nav, c.pos) || samePos(c.pos, state.player.pos);
    if (!awkward) return;
    const spot = companionSpot(state, state.player.pos, c.pos, 3);
    if (!spot) return;
    if ((isChokepoint(state.nav, spot) || isChasmEdge(state.nav, spot) || nextToHazard(state.nav, spot)) && !samePos(c.pos, state.player.pos)) return;
    const path = state.nav.findPath(c.pos, spot, { maxCost: 5 });
    c.pos = spot;
    if (path && path.length > 0) void deps.renderer.moveEntity('companion', path);
    else deps.renderer.placeEntity('companion', spot);
  }

  /** A rest also rests the companion. Returns the hit points a short rest gave it (a long rest: the gain). */
  private restCompanion(long: boolean, rng?: Rng): number {
    const { state, deps } = this.ctx;
    const rt = state.companion;
    if (!rt) return 0;
    let healed = 0;
    const before = rt.creature.hp;
    if (long) {
      const next = longRested(state);
      if (next) rt.state = next;
    } else if (rng) {
      const r = companionShortRest({ ...rt.state, hp: rt.creature.hp }, rt.def, state.pc.level, rng.fork('companion'));
      rt.state = r.state;
      healed = r.healed;
    }
    rebuildCompanion(state);
    deps.renderer.setEntityState('companion', { hpFraction: rt.creature.hp / rt.creature.maxHp });
    const gain = rt.creature.hp - before;
    if (gain > 0) deps.renderer.floatText('companion', `+${gain}`, 'heal');
    return long ? gain : healed;
  }

  private prayers = 0;

  /** The Sphinx's Prayer of Healing between fights: heals the hero and the companion. */
  async prayer(): Promise<void> {
    const { state, deps } = this.ctx;
    const rt = state.companion;
    if (!rt || this.walking || this.resting || state.mode !== 'explore' || state.finished) return;
    const result = companionPrayer(
      syncFromCreature(state.pc, state.player),
      { ...rt.state, hp: rt.creature.hp },
      rt.def,
      state.pc.level,
      state.floorRng.fork(`prayer:${this.prayers++}`),
    );
    if ('error' in result) {
      deps.audio.play('uiError');
      this.ctx.prompt(result.error, 2500);
      return;
    }
    this.resting = true;
    try {
      const heroBefore = state.player.hp;
      const compBefore = rt.creature.hp;
      state.pc = result.pc;
      rt.state = result.state;
      this.ctx.rebuildPlayer();
      rebuildCompanion(state);
      this.ctx.hud();
      deps.audio.play('spellCast');
      deps.audio.play('healSpell', { delay: 0.35 });
      await this.ctx.guard(deps.renderer.playAnim('companion', 'cast'), 1200);
      deps.renderer.setEntityState('player', { hpFraction: state.player.hp / state.player.maxHp });
      deps.renderer.setEntityState('companion', { hpFraction: rt.creature.hp / rt.creature.maxHp });
      if (state.player.hp > heroBefore) deps.renderer.floatText('player', `+${state.player.hp - heroBefore}`, 'heal');
      if (rt.creature.hp > compBefore) deps.renderer.floatText('companion', `+${rt.creature.hp - compBefore}`, 'heal');
      this.ctx.say(
        `${rt.def.name} casts Prayer of Healing: ${state.pc.build.name} regains ${state.player.hp - heroBefore} and ${rt.def.name} ${rt.creature.hp - compBefore} hit points.`,
      );
    } finally {
      this.resting = false;
    }
    this.ctx.hud();
  }

  /** Stop walking (the floor is ending or combat is taking over). */
  stop(): void {
    this.goal = null;
  }
}
