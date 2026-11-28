import type { ActionDef, CellHighlight, CombatApi, Command, CompanionStance, GameEvent, GridPos, PickResult } from '../core/types';
import {
  SHOVE_PUSH_ID,
  SHOVE_TRIP_ID,
  advise,
  attacksLeft,
  createCombat,
  createPartyDriver,
  exposedToPush,
  expertPolicy,
  planPush,
  playerPolicy,
  type PushPlan,
  syncCompanion,
  syncFromCreature,
} from '../rules';
import type { PartyDriver } from '../rules';
import { cellDistance } from './fog';
import type { MonsterState, SessionCtx } from './floorState';
import { blockedAt, isEntityVisible, samePos } from './floorState';
import { companionSpot, rebuildCompanion } from './party';
import { Prefs } from './prefs';
import type { Playback } from './playback';

type Mode = 'move' | 'target' | 'point';

/** The single action-bar entry that stands for Shove: Push and Shove: Trip (see HudModel and selectAction). */
export const SHOVE_ID = 'shove';

/** Pause lengths, in ms. The injected `delay` makes tests instant. */
const PAUSE = { intro: 650, betweenTurns: 140, autoEnd: 700 } as const;

/** The whole fight: player input while it is the hero's turn, enemy turns, playback, the end. */
export class CombatController {
  combat: CombatApi | null = null;
  mode: Mode = 'move';
  selectedActionId: string | null = null;
  previewActionId: string | null = null;
  /** True while events play or enemies act: input is ignored. */
  busy = false;
  private reach: Map<string, number> = new Map();
  private hoverCell: GridPos | null = null;
  private targetable: string[] = [];
  private autoEndToken = 0;
  private fightNo = 0;
  private hoverEnt: string | null = null;
  /** Plays the companion's and the monsters' turns (the stance can change mid-fight). */
  private driver: PartyDriver | null = null;
  /** The prompt to show while aiming, so it can come back after an area warning. */
  private pointPrompt: string | null = null;
  private areaWarning = '';

  constructor(
    private readonly ctx: SessionCtx,
    private readonly playback: Playback,
    private readonly attempt: number,
    private readonly onEnded: () => void,
  ) {}

  /** The creatures the selected action can target right now (empty unless choosing a target). */
  get targetableIds(): readonly string[] {
    return this.mode === 'target' ? this.targetable : [];
  }

  get playerTurn(): boolean {
    const c = this.combat;
    return !!c && !c.isOver && c.activeId === 'player' && !this.busy;
  }

  // ----------------------------------------------------------- lifecycle

  /** Start a fight. Resolves when it is the player's first turn (or the fight is already over). */
  async begin(monsters: MonsterState[]): Promise<void> {
    const { state, deps } = this.ctx;
    state.mode = 'combat';
    state.targetId = null;
    this.mode = 'move';
    this.selectedActionId = null;
    this.busy = true;
    this.ctx.prompt(undefined);
    deps.renderer.setHighlights([]);
    deps.ui.banner('Combat!');
    this.ctx.say('Combat begins!');
    const comp = state.companion;
    if (comp) this.placeCompanion();
    const fighters = [state.player, ...(comp ? [comp.creature] : []), ...monsters.map((m) => m.creature)];
    this.driver = createPartyDriver(comp?.state.stance ?? 'close');
    const rng = state.floorRng.fork(`combat:${this.attempt}:${this.fightNo++}`);
    const combat = createCombat(fighters, state.nav, rng, { depth: state.depth });
    this.combat = combat;
    state.shownHp.clear();
    state.shownDead.clear();
    for (const c of fighters) {
      state.shownHp.set(c.id, c.hp);
      if (c.dead) state.shownDead.add(c.id);
    }
    state.shownActive = null;
    const boss = monsters.find((m) => m.creature.resources['_boss'] !== undefined);
    try {
      await deps.delay(PAUSE.intro);
      if (boss) this.ctx.prompt(`Boss: ${boss.creature.name}`, 6000);
      await this.playback.play(combat.begin());
      await this.advance();
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy = false;
      this.afterGate();
    }
  }

  /** The stance the companion's driver is playing with (for tests and the HUD). */
  get driverStance(): CompanionStance | undefined {
    return this.driver?.stance;
  }

  setStance(stance: CompanionStance): void {
    if (this.driver) this.driver.stance = stance;
  }

  /** Put the companion on a free cell beside the hero (and off the hero's own cell) as the fight starts. */
  private placeCompanion(): void {
    const { state, deps } = this.ctx;
    const rt = state.companion;
    if (!rt) return;
    const c = rt.creature;
    const near = cellDistance(c.pos, state.player.pos) <= 2 && !samePos(c.pos, state.player.pos);
    const clash = state.monsters.some((m) => !m.creature.dead && samePos(m.creature.pos, c.pos));
    if (!near || clash) {
      const spot = companionSpot(state, state.player.pos, c.pos, 2) ?? companionSpot(state, state.player.pos, c.pos, 5);
      if (spot) {
        c.pos = spot;
        deps.renderer.placeEntity('companion', spot);
      }
    }
    rt.downed = false;
  }

  /** When the floor's boss has fallen: its hoard appears on the nearest free cell, with a flourish. */
  private dropBossChest(): void {
    const { state, deps } = this.ctx;
    if (state.chests.some((c) => c.boss)) return;
    const boss = state.monsters.find((m) => m.boss && m.creature.dead);
    if (!boss) return;
    const taken = (p: GridPos): boolean =>
      samePos(p, state.player.pos) ||
      (state.companion !== null && samePos(p, state.companion.creature.pos)) ||
      samePos(p, state.plan.exit) ||
      state.chests.some((c) => samePos(c.pos, p)) ||
      state.restSites.some((r) => samePos(r.pos, p)) ||
      state.monsters.some((m) => !m.creature.dead && m.creature.hp > 0 && samePos(m.creature.pos, p));
    let at: GridPos | null = null;
    for (let r = 0; r <= 8 && !at; r++) {
      for (let dy = -r; dy <= r && !at; dy++) {
        for (let dx = -r; dx <= r && !at; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const p = { x: boss.creature.pos.x + dx, y: boss.creature.pos.y + dy };
          if (state.nav.inBounds(p) && state.nav.isWalkable(p) && state.nav.hazardAt(p) === 'none' && !taken(p)) at = p;
        }
      }
    }
    if (!at) return;
    const id = 'chest_boss';
    state.chests.push({ id, pos: at, opened: false, boss: true });
    deps.renderer.spawnEntity(id, { model: 'chest_boss' }, at, { faction: 'ally', size: 'small' });
    // Spawned hidden, then shown with its arrival flourish.
    deps.renderer.setEntityState(id, { visible: false });
    deps.renderer.setEntityState(id, { visible: true });
    state.entityVisible.set(id, true);
    void deps.renderer.playAnim(id, 'cast', { facing: at });
    this.ctx.say(`The ${boss.creature.name} leaves its hoard behind.`);
    deps.renderer.focusCamera(at);
    void deps.delay(1600).then(() => {
      if (!state.finished && state.mode === 'explore') deps.renderer.followEntity('player');
    });
  }

  /** After a won fight: save the companion's state, and stand a downed one back up at 1 HP. */
  private reviveCompanion(): void {
    const { state, deps } = this.ctx;
    const rt = state.companion;
    if (!rt) return;
    const wasDown = rt.downed || rt.creature.dead || rt.creature.hp <= 0;
    rt.state = syncCompanion(rt.state, rt.creature);
    rebuildCompanion(state);
    deps.renderer.setEntityState('companion', { dead: false, selected: false, hpFraction: rt.creature.hp / rt.creature.maxHp });
    if (wasDown) {
      deps.audio.play('companionUp');
      deps.renderer.floatText('companion', 'Back on its feet', 'heal');
      this.ctx.say(`${rt.creature.name} is back on its feet.`);
    }
  }

  /** Enemy turns until it is the player's turn again, or the fight ends. */
  private async advance(): Promise<void> {
    const combat = this.combat;
    if (!combat) return;
    const state = this.ctx.state;
    // Pace the enemies: a crowd in view acts in a quick run instead of a parade (see Playback.beginEnemyRound).
    const seenEnemies = combat.creatures().filter((c) => c.id !== 'player' && !c.dead && c.hp > 0 && isEntityVisible(state, c.id)).length;
    const driver = this.driver ?? createPartyDriver('close');
    this.playback.beginEnemyRound(seenEnemies);
    try {
      for (let guard = 0; guard < 400 && !combat.isOver && combat.activeId !== 'player'; guard++) {
        const actor = combat.activeId;
        const wasSeen = isEntityVisible(state, actor);
        await this.playback.play(driver.playTurn(combat, state.nav));
        // No pause for a monster the hero never saw act.
        if (wasSeen || isEntityVisible(state, actor)) await this.ctx.deps.delay(this.playback.turnGap(PAUSE.betweenTurns));
      }
    } finally {
      this.playback.endEnemyRound();
    }
    if (combat.isOver) await this.finishCombat();
    else this.beginPlayerTurn();
  }

  private beginPlayerTurn(): void {
    this.mode = 'move';
    this.selectedActionId = null;
    this.previewActionId = null;
    this.refreshReach();
  }

  private async finishCombat(): Promise<void> {
    const { state, deps } = this.ctx;
    const combat = this.combat;
    if (!combat) return;
    this.setTargetable([]);
    deps.renderer.setHighlights([]);
    for (const m of state.monsters) deps.renderer.setEntityState(m.creature.id, { selected: false });
    deps.renderer.setEntityState('player', { selected: false });
    state.pc = syncFromCreature(state.pc, state.player);
    state.player.conditions = [];
    const comp = state.companion;
    const won = combat.winner === 'player' && state.player.hp > 0;
    this.combat = null;
    state.shownHp.clear();
    state.shownDead.clear();
    state.shownActive = null;
    state.targetId = null;
    if (!won) {
      state.mode = 'explore';
      this.ctx.finish({ type: 'dead', killedBy: state.lastHitBy || 'the dungeon' });
      return;
    }
    state.mode = 'explore';
    if (comp) this.reviveCompanion();
    this.dropBossChest();
    const sealedBefore = !state.stairsOpen;
    if (sealedBefore && !state.monsters.some((m) => m.boss && !m.creature.dead)) state.stairsOpen = true;
    if (sealedBefore && state.stairsOpen) {
      deps.audio.play('stairsUnlock', { delay: 0.6 });
      const hoard = state.monsters.find((m) => m.boss && m.creature.dead);
      deps.ui.banner('Victory', hoard ? `The ${hoard.creature.name} leaves its hoard behind` : 'The way down is open');
      this.ctx.say('The floor boss is dead. The stairs down are open.');
    } else {
      deps.ui.banner('Victory');
      this.ctx.say('Victory!');
    }
    deps.renderer.followEntity('player');
    if (state.stairsOpen && samePos(state.player.pos, state.plan.exit)) this.ctx.prompt('You are standing on the stairs. Tap yourself to descend.', 6000);
    if (state.depth === 1 && !state.restHintShown && state.player.hp < state.player.maxHp) {
      state.restHintShown = true;
      this.ctx.prompt('Short rests work anywhere safe (2 between long rests). Campsites give a full long rest, once each.', 9000);
    }
    this.onEnded();
  }

  // --------------------------------------------------------------- input

  /** Take the gate, run `fn`, release it. Errors surface as a HUD prompt. */
  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.busy || !this.combat || this.combat.isOver) return;
    this.busy = true;
    this.autoEndToken++;
    this.ctx.hud();
    try {
      await fn();
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy = false;
      this.afterGate();
    }
  }

  private fail(err: unknown): void {
    console.error('Combat error', err);
    this.ctx.prompt(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`, 4000);
  }

  /** After the gate opens again: refresh highlights, HUD, auto end-of-turn. */
  private afterGate(): void {
    if (this.combat && !this.combat.isOver && this.combat.activeId === 'player') {
      if (this.reach.size === 0 && this.mode === 'move') this.refreshReach();
      else this.renderHighlights();
      this.scheduleAutoEnd();
    }
    this.ctx.hud();
  }

  /** Execute one player command and play it out (gate must be held). */
  private async perform(cmd: Command): Promise<void> {
    const combat = this.combat;
    if (!combat) return;
    this.setTargetable([]);
    this.ctx.deps.renderer.setHighlights([]);
    let events;
    try {
      events = combat.execute(cmd);
    } catch (err) {
      this.fail(err);
      this.mode = 'move';
      this.selectedActionId = null;
      this.refreshReach();
      return;
    }
    this.mode = 'move';
    this.selectedActionId = null;
    this.ctx.prompt(undefined);
    this.pointPrompt = null;
    this.areaWarning = '';
    this.driver?.noteHeroEvents(events as GameEvent[]);
    await this.playback.play(events);
    if (combat.isOver || combat.activeId !== 'player') await this.advance();
    else this.refreshReach();
  }

  async tap(pick: PickResult): Promise<void> {
    if (!this.playerTurn) return;
    const combat = this.combat as CombatApi;
    const ent = this.creatureAtPick(pick);
    if (this.mode === 'target' && this.selectedActionId) {
      const actionId = this.selectedActionId;
      if (ent && combat.validTargets(actionId).includes(ent)) {
        await this.run(() => this.perform({ type: 'action', actionId, targetId: ent }));
      } else if (ent) {
        this.ctx.state.targetId = ent;
        this.ctx.deps.audio.play('uiError');
        this.ctx.prompt('Not a valid target for that action.', 2000);
        this.ctx.hud();
      } else {
        this.cancel();
      }
      return;
    }
    if (this.mode === 'point' && this.selectedActionId) {
      const actionId = this.selectedActionId;
      const cell = pick.cell;
      if (!cell) return;
      const a = combat.availableActions().find((x) => x.id === actionId);
      const range = a?.targeting.kind === 'point' ? a.targeting.range : 0;
      if (range === 0) {
        // A cone or line from the hero: the tapped cell gives the direction. Touch has no hover, so the first
        // tap aims (and shows the area) and a second tap on the same cell confirms.
        if (samePos(cell, this.ctx.state.player.pos)) {
          this.ctx.prompt('Aim away from yourself.', 1800);
          return;
        }
        if (!sameCell(cell, this.hoverCell)) {
          this.hoverCell = { ...cell };
          this.renderHighlights();
          this.ctx.prompt(`${a?.name ?? 'Spell'}: tap again to confirm.`, 2500);
          return;
        }
      } else if (cellDistance(this.ctx.state.player.pos, cell) > range) {
        this.ctx.prompt('Out of range.', 1800);
        return;
      }
      await this.run(() => this.perform({ type: 'action', actionId, point: cell }));
      return;
    }
    // Movement mode.
    if (ent) {
      this.ctx.state.targetId = ent;
      if (ent === 'player' || ent === 'companion') {
        // Yourself and your companion are looked at, never attacked.
        this.ctx.hud();
        return;
      }
      const quick = this.quickAttackFor(ent);
      if (quick) await this.run(() => this.perform({ type: 'action', actionId: quick, targetId: ent }));
      else {
        const plan = this.approachPlan(ent);
        if (!plan || plan.path.length === 0) {
          this.ctx.deps.audio.play('uiError');
          this.ctx.prompt(this.whyNoAttack(ent), 2600);
          this.ctx.hud();
          return;
        }
        const leave = await this.confirmLeave(plan.path);
        if (leave === 'cancel') return;
        this.ctx.prompt(undefined);
        await this.run(async () => {
          if (leave === 'disengage') await this.perform({ type: 'action', actionId: 'disengage' });
          await this.perform({ type: 'move', path: plan.path });
          const c = this.combat;
          if (plan.attackId && c && !c.isOver && c.activeId === 'player') {
            await this.perform({ type: 'action', actionId: plan.attackId, targetId: ent });
          } else if (!plan.reaches && c && !c.isOver) {
            this.ctx.prompt('Out of reach this turn.', 2500);
          }
        });
      }
      return;
    }
    const cell = pick.cell;
    if (!cell) return;
    if (!this.reach.has(key(cell))) {
      this.ctx.deps.audio.play('uiError');
      this.ctx.prompt("You can't move there this turn.", 1800);
      return;
    }
    const path = this.pathTo(cell);
    if (!path) return;
    const leave = await this.confirmLeave(path);
    if (leave === 'cancel') return;
    this.ctx.prompt(undefined);
    this.warnEdge(cell);
    await this.run(async () => {
      if (leave === 'disengage') await this.perform({ type: 'action', actionId: 'disengage' });
      await this.perform({ type: 'move', path });
    });
  }

  async selectAction(actionId: string): Promise<void> {
    if (!this.playerTurn) return;
    const combat = this.combat as CombatApi;
    // One "Shove" button: the first press aims a push, the second switches to Trip, the third cancels.
    if (actionId === SHOVE_ID) {
      if (this.selectedActionId === SHOVE_TRIP_ID) {
        this.cancel();
        return;
      }
      actionId = this.selectedActionId === SHOVE_PUSH_ID ? SHOVE_TRIP_ID : SHOVE_PUSH_ID;
      if (!combat.availableActions().some((x) => x.id === actionId)) return;
      const check = combat.canUse(actionId);
      if (!check.ok) {
        this.ctx.deps.audio.play('uiError');
        this.ctx.prompt(check.reason ?? "You can't shove now.", 2200);
        return;
      }
      const valid = combat.validTargets(actionId);
      if (valid.length === 0) {
        this.ctx.deps.audio.play('uiError');
        this.ctx.prompt('No one to shove within reach.', 2000);
        return;
      }
      this.ctx.deps.audio.play('uiClick');
      this.mode = 'target';
      this.selectedActionId = actionId;
      this.setTargetable(valid);
      this.ctx.prompt(
        actionId === SHOVE_PUSH_ID
          ? 'Shove: push the target one cell away. Press Shove again for Trip, Esc to cancel.'
          : 'Shove: knock the target prone. Press Shove again to cancel.',
      );
      this.autoEndToken++;
      this.renderHighlights();
      this.ctx.hud();
      return;
    }
    if (this.selectedActionId === actionId) {
      this.cancel();
      return;
    }
    const a = combat.availableActions().find((x) => x.id === actionId);
    if (!a) return;
    const check = combat.canUse(actionId);
    if (!check.ok) {
      this.ctx.deps.audio.play('uiError');
      this.ctx.prompt(check.reason ?? "You can't do that now.", 2200);
      return;
    }
    this.ctx.deps.audio.play('uiClick');
    switch (a.targeting.kind) {
      case 'self':
        await this.run(() => this.perform({ type: 'action', actionId }));
        return;
      case 'creature': {
        const valid = combat.validTargets(actionId);
        if (valid.length === 0) {
          this.ctx.deps.audio.play('uiError');
          this.ctx.prompt('No target in range.', 2000);
          return;
        }
        this.mode = 'target';
        this.selectedActionId = actionId;
        this.setTargetable(valid);
        this.ctx.prompt(`${a.name}: choose a target. Tap empty floor or press Esc to cancel.`);
        break;
      }
      case 'point':
        this.mode = 'point';
        this.selectedActionId = actionId;
        this.pointPrompt = `${a.name}: choose where to aim. Tap empty floor or press Esc to cancel.`;
        this.areaWarning = '';
        this.ctx.prompt(this.pointPrompt);
        break;
    }
    this.autoEndToken++;
    this.renderHighlights();
    this.ctx.hud();
  }

  async endTurn(): Promise<void> {
    if (!this.playerTurn) return;
    await this.run(() => this.perform({ type: 'endTurn' }));
  }

  cancel(): void {
    if (!this.playerTurn) return;
    this.pointPrompt = null;
    this.areaWarning = '';
    this.mode = 'move';
    this.selectedActionId = null;
    this.setTargetable([]);
    this.ctx.prompt(undefined);
    this.renderHighlights();
    this.scheduleAutoEnd();
    this.ctx.hud();
  }

  /** The bot's turn: the scripted hero policy decides. Resolves when the command has played out. */
  async autoAct(): Promise<void> {
    if (!this.playerTurn) return;
    await this.run(async () => {
      const combat = this.combat as CombatApi;
      await this.perform((this.ctx.deps.options.expert ? expertPolicy : playerPolicy)(combat, this.ctx.state.nav));
    });
  }

  hover(pick: PickResult): void {
    const state = this.ctx.state;
    if (this.busy || !this.combat) return;
    const ent = this.creatureAtPick(pick) ?? null;
    const prevTarget = state.targetId;
    state.targetId = ent;
    this.hoverEnt = ent !== 'player' && ent !== 'companion' ? ent : null;
    this.previewActionId = this.mode === 'move' && ent && ent !== 'player' && ent !== 'companion' ? this.quickAttackFor(ent) : null;
    const cell = pick.cell;
    const changed = !sameCell(cell, this.hoverCell) || ent !== prevTarget;
    this.hoverCell = cell ? { ...cell } : null;
    if (changed && this.combat.activeId === 'player') this.renderHighlights();
    if (ent !== prevTarget || this.mode === 'target') this.ctx.hud();
  }

  // ------------------------------------------------------------- helpers

  private creatureAtPick(pick: PickResult): string | undefined {
    const combat = this.combat;
    if (!combat) return undefined;
    const alive = (id: string): boolean => {
      const c = combat.creature(id);
      return !!c && !c.dead && c.hp > 0 && isEntityVisible(this.ctx.state, id);
    };
    if (pick.entityId && alive(pick.entityId)) return pick.entityId;
    if (pick.cell) {
      const here = combat.creatures().find((c) => alive(c.id) && samePos(c.pos, pick.cell as GridPos));
      return here?.id;
    }
    return undefined;
  }

  /** The action a plain tap on this creature would use: melee if it reaches, else ranged. */
  /** Why a click on this enemy cannot become an attack: nothing left to attack with, or nowhere in reach to get to. */
  private whyNoAttack(targetId: string): string {
    const combat = this.combat;
    if (!combat) return 'Not now.';
    const attacks = combat.availableActions().filter((a) => a.attack !== undefined && a.targeting.kind === 'creature' && !a.targeting.friendly);
    const usable = attacks.filter((a) => combat.canUse(a.id).ok);
    if (usable.length === 0) {
      const bonus = combat.availableActions().some((a) => a.cost === 'bonus' && combat.canUse(a.id).ok && a.attack !== undefined);
      return bonus
        ? 'Your action is spent: only a bonus-action attack is left. Pick it below, or End Turn (Space).'
        : 'No attacks left this turn. End Turn (Space) to let the enemies act.';
    }
    const name = combat.creature(targetId)?.name ?? 'That enemy';
    return combat.turn.movementLeft <= 0
      ? `${name} is out of reach and you have no movement left. Use a ranged attack, or End Turn (Space).`
      : `${name} is out of reach this turn. Use a ranged attack or move closer.`;
  }

  /**
   * Walking out of an enemy's reach gives it an opportunity attack. Before such a move, ask: Disengage first (if the hero
   * can still take it), move anyway, or stay. Remembered with "Don't ask again" (then the move simply goes ahead).
   */
  private async confirmLeave(path: GridPos[]): Promise<'go' | 'disengage' | 'cancel'> {
    const combat = this.combat;
    const { deps } = this.ctx;
    if (!combat || deps.options.autoplay) return 'go';
    const threats = combat.opportunityThreats(path);
    if (threats.length === 0) return 'go';
    const prefs = new Prefs(deps.storage);
    if (prefs.remembered('leaveReach')) return 'go';
    const names = threats.map((id) => combat.creature(id)?.name ?? 'An enemy');
    const who = names.length === 1 ? `${names[0]} gets` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} each get`;
    const dis = combat.availableActions().find((a) => a.id === 'disengage');
    const canDisengage = !!dis && combat.canUse('disengage').ok;
    const cost = dis?.cost === 'bonus' ? 'your bonus action' : 'your action';
    const lines = [`${who} a free attack (an opportunity attack) as you move out of reach.`];
    lines.push(canDisengage ? `Disengage first to leave safely: it uses ${cost}.` : 'You cannot Disengage now: your action is spent.');
    const answer = await deps.ui.confirm({
      title: 'Leave and take a free hit?',
      lines,
      confirmLabel: 'Move anyway',
      cancelLabel: 'Stay',
      ...(canDisengage ? { altLabel: 'Disengage first' } : {}),
      rememberKey: 'leaveReach',
    });
    if (answer.alt) return 'disengage';
    if (!answer.ok) return 'cancel';
    if (answer.remember) prefs.remember('leaveReach');
    return 'go';
  }

  quickAttackFor(targetId: string): string | null {
    const combat = this.combat;
    if (!combat) return null;
    const cands = combat
      .availableActions()
      .filter(
        (a) =>
          a.attack !== undefined &&
          a.targeting.kind === 'creature' &&
          !a.targeting.friendly &&
          combat.canUse(a.id).ok &&
          combat.validTargets(a.id).includes(targetId),
      );
    const melee = cands.find((a) => a.targeting.kind === 'creature' && a.targeting.melee);
    return (melee ?? cands[0])?.id ?? null;
  }

  /** How to get a melee attack onto this creature: walk to the cheapest reachable cell in reach, or as far as possible toward it. */
  private approachPlan(targetId: string): { path: GridPos[]; attackId: string | null; reaches: boolean } | null {
    const combat = this.combat;
    const t = combat?.creature(targetId);
    if (!combat || !t) return null;
    const melee = combat
      .availableActions()
      .find((a) => a.attack !== undefined && a.targeting.kind === 'creature' && a.targeting.melee && !a.targeting.friendly && combat.canUse(a.id).ok);
    if (!melee || melee.targeting.kind !== 'creature') return null;
    const nav = this.ctx.state.nav;
    const range = melee.targeting.range;
    let best: { pos: GridPos; cost: number } | null = null;
    for (const [k, cost] of this.reach) {
      const pos = unkey(k);
      if (cellDistance(pos, t.pos) > range || !nav.hasLineOfSight(pos, t.pos)) continue;
      if (!best || cost < best.cost) best = { pos, cost };
    }
    if (best) {
      const path = this.pathTo(best.pos);
      if (path) return { path, attackId: melee.id, reaches: true };
    }
    // Not reachable this turn: as far as the movement allows along the shortest way in.
    const blocked = blockedAt(this.ctx.state);
    const from = this.ctx.state.player.pos;
    let shortest: GridPos[] | null = null;
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        const n = { x: t.pos.x + dx, y: t.pos.y + dy };
        if ((dx === 0 && dy === 0) || !nav.inBounds(n) || !nav.isWalkable(n) || blocked(n)) continue;
        const p = nav.findPath(from, n, { blocked });
        if (p && (!shortest || p.length < shortest.length)) shortest = p;
      }
    }
    if (!shortest) return null;
    const prefix: GridPos[] = [];
    let left = combat.turn.movementLeft;
    let cur = from;
    for (const p of shortest) {
      const c = nav.stepCost(cur, p);
      if (c > left) break;
      left -= c;
      prefix.push(p);
      cur = p;
    }
    return { path: prefix, attackId: null, reaches: false };
  }

  private refreshReach(): void {
    const combat = this.combat;
    this.reach = new Map();
    if (combat && !combat.isOver && combat.activeId === 'player') {
      for (const r of combat.reachable()) this.reach.set(key(r.pos), r.cost);
    }
    this.renderHighlights();
  }

  private pathTo(cell: GridPos): GridPos[] | null {
    const combat = this.combat;
    if (!combat) return null;
    const occupied = (p: GridPos): boolean => blockedAt(this.ctx.state)(p);
    return this.ctx.state.nav.findPath(this.ctx.state.player.pos, cell, {
      blocked: occupied,
      maxCost: combat.turn.movementLeft,
    });
  }

  private setTargetable(ids: string[]): void {
    const r = this.ctx.deps.renderer;
    for (const id of this.targetable) if (!ids.includes(id)) r.setEntityState(id, { targetable: false });
    for (const id of ids) if (!this.targetable.includes(id)) r.setEntityState(id, { targetable: true });
    this.targetable = ids;
  }

  private renderHighlights(): void {
    const combat = this.combat;
    const r = this.ctx.deps.renderer;
    if (!combat || combat.isOver || combat.activeId !== 'player') {
      r.setHighlights([]);
      return;
    }
    const out: CellHighlight[] = [];
    if (this.mode === 'move') {
      for (const k of this.reach.keys()) out.push({ pos: unkey(k), style: 'move' });
      // Guided: when the suggestion is a move, its destination is marked.
      if (this.ctx.state.help === 'guided') {
        const adv = advise(combat, this.ctx.state.nav);
        const step = adv?.command.type === 'move' ? adv.command.path[adv.command.path.length - 1] : undefined;
        if (step) out.push({ pos: step, style: 'path' });
      }
      const h = this.hoverCell;
      const plan = this.hoverEnt && !this.quickAttackFor(this.hoverEnt) ? this.approachPlan(this.hoverEnt) : null;
      if (plan) {
        for (const pos of plan.path) out.push({ pos, style: 'path' });
      } else if (h && this.reach.has(key(h))) {
        const path = this.pathTo(h);
        if (path) for (const pos of path) out.push({ pos, style: 'path' });
      }
    } else if (this.mode === 'target') {
      for (const id of this.targetable) {
        const c = combat.creature(id);
        if (c) out.push({ pos: c.pos, style: 'target' });
      }
      // With a push aimed: where the hovered or selected target would land ('danger' when that is a pit or lava).
      out.push(...this.pushLanding());
    } else if (this.mode === 'point' && this.selectedActionId && this.hoverCell) {
      const state = this.ctx.state;
      const comp = state.companion && !state.companion.downed ? state.companion.creature : null;
      const warn: string[] = [];
      for (const pos of combat.areaCells(this.selectedActionId, this.hoverCell)) {
        // The caster's own cell and the companion's are marked: it is the player's call, but they should see it.
        const self = samePos(pos, state.player.pos);
        const friend = comp !== null && samePos(pos, comp.pos);
        if (self) warn.push('You are');
        else if (friend) warn.push('Your companion is');
        out.push({ pos, style: self || friend ? 'danger' : 'area' });
      }
      this.warnArea(warn.length === 0 ? '' : warn.length > 1 ? 'You and your companion are in the area' : `${warn[0]} in the area`);
    }
    r.setHighlights(out);
  }

  /**
   * Highlights for the push aimed at the hovered or selected target: the cell it would land in ('danger' when that
   * is a pit or lava, 'path' otherwise); when a fire or spikes obstacle would stop it, the obstacle cell is 'danger'
   * and the cell it stops in is 'path'. (The obstacle field of the plan arrives with the rules; absent, it is ignored.)
   */
  pushLanding(): CellHighlight[] {
    const combat = this.combat;
    const state = this.ctx.state;
    const act = this.selectedActionId;
    const id = state.targetId;
    if (!combat || !act || !id || act !== SHOVE_PUSH_ID || !this.targetable.includes(id)) return [];
    const t = combat.creature(id);
    if (!t) return [];
    const me = state.player.pos;
    const occupied = (p: GridPos): boolean => combat.creatures().some((o) => o.id !== t.id && !o.dead && o.hp > 0 && samePos(o.pos, p));
    const plan = planPush(state.nav, occupied, t.pos, Math.sign(t.pos.x - me.x), Math.sign(t.pos.y - me.y), 1) as PushPlan & {
      obstacle?: { kind: string; at: GridPos };
    };
    const out: CellHighlight[] = [];
    const last = plan.path[plan.path.length - 1];
    if (plan.obstacle) {
      out.push({ pos: plan.obstacle.at, style: 'danger' });
      out.push({ pos: last ?? t.pos, style: 'path' });
    } else if (last) {
      out.push({ pos: last, style: plan.hazard !== undefined ? 'danger' : 'path' });
    }
    return out;
  }

  private edgeWarnedTurn = -1;

  /**
   * A soft warning when the hero steps next to a drop or lava and an enemy could get behind them to shove: once per
   * turn at most, and never a refusal.
   */
  private warnEdge(cell: GridPos): void {
    const combat = this.combat;
    const state = this.ctx.state;
    if (!combat || this.edgeWarnedTurn === combat.round) return;
    const foes = combat.creatures().filter((c) => c.faction === 'enemy' && !c.dead && c.hp > 0);
    if (!exposedToPush(state.nav, cell, foes)) return;
    this.edgeWarnedTurn = combat.round;
    this.ctx.prompt('Edge: you could be shoved off.', 3500);
  }

  /** Show (or clear) the "you are in the area" prompt while aiming. */
  private warnArea(text: string): void {
    if (text === this.areaWarning) return;
    this.areaWarning = text;
    this.ctx.prompt(text !== '' ? text : (this.pointPrompt ?? undefined));
  }

  /** Nothing worth doing is left this turn. */
  hasUsefulOptions(): boolean {
    const combat = this.combat;
    if (!combat || combat.isOver) return false;
    const turn = combat.turn;
    if (turn.movementLeft > 0 && this.reach.size > 0) return true;
    const player = this.ctx.state.player;
    const useful = (a: ActionDef): boolean => {
      if (a.effects?.includes('dash') || a.effects?.includes('dodge') || a.effects?.includes('disengage')) return false;
      if (a.cost === 'bonus') return !!a.heal && !a.damage ? player.hp < player.maxHp : true;
      // Action Surge (free) is worth it once the attacks are spent; the off-hand attack (free for Nick) as soon as it can be made.
      if (a.cost === 'free') return a.effects?.includes('offhand') ? true : turn.actionUsed && attacksLeft(combat) === 0;
      // Extra Attack: weapon attacks go on while any are left, even though the action is spent.
      if (a.cost === 'action') return !turn.actionUsed || (isWeaponAttack(a) && attacksLeft(combat) > 0);
      return false;
    };
    return combat.availableActions().some((a) => useful(a) && combat.canUse(a.id).ok && hasWhere(combat, a));
  }

  private scheduleAutoEnd(): void {
    const token = ++this.autoEndToken;
    if (this.hasUsefulOptions()) return;
    void (async () => {
      await this.ctx.deps.delay(PAUSE.autoEnd);
      if (token !== this.autoEndToken || !this.playerTurn || this.ctx.state.finished) return;
      await this.endTurn();
    })();
  }

}

/** A weapon attack (the kind Extra Attack repeats). */
function isWeaponAttack(a: ActionDef): boolean {
  return a.id.startsWith('atk_') || a.id.startsWith('throw_') || a.id === 'unarmed' || a.effects?.includes('weaponAttack') === true;
}

function hasWhere(combat: CombatApi, a: ActionDef): boolean {
  if (a.targeting.kind === 'creature') return combat.validTargets(a.id).length > 0;
  return true;
}

function key(p: GridPos): string {
  return `${p.x},${p.y}`;
}

function unkey(k: string): GridPos {
  const [x, y] = k.split(',');
  return { x: Number(x), y: Number(y) };
}

function sameCell(a: GridPos | null, b: GridPos | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y;
}
