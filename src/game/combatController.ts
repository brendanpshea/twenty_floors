import type { ActionDef, CellHighlight, CombatApi, Command, GridPos, PickResult } from '../core/types';
import { createCombat, playerPolicy, runAiTurn, syncFromCreature } from '../rules';
import { cellDistance } from './fog';
import type { MonsterState, SessionCtx } from './floorState';
import { blockedAt, isEntityVisible, samePos } from './floorState';
import type { Playback } from './playback';

type Mode = 'move' | 'target' | 'point';

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

  constructor(
    private readonly ctx: SessionCtx,
    private readonly playback: Playback,
    private readonly attempt: number,
    private readonly onEnded: () => void,
  ) {}

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
    const fighters = [state.player, ...monsters.map((m) => m.creature)];
    const rng = state.floorRng.fork(`combat:${this.attempt}:${this.fightNo++}`);
    const combat = createCombat(fighters, state.nav, rng);
    this.combat = combat;
    state.shownHp.clear();
    state.shownDead.clear();
    for (const c of fighters) {
      state.shownHp.set(c.id, c.hp);
      if (c.dead) state.shownDead.add(c.id);
    }
    state.shownActive = null;
    try {
      await deps.delay(PAUSE.intro);
      await this.playback.play(combat.begin());
      await this.advance();
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy = false;
      this.afterGate();
    }
  }

  /** Enemy turns until it is the player's turn again, or the fight ends. */
  private async advance(): Promise<void> {
    const combat = this.combat;
    if (!combat) return;
    for (let guard = 0; guard < 400 && !combat.isOver && combat.activeId !== 'player'; guard++) {
      await this.playback.play(runAiTurn(combat, this.ctx.state.nav));
      await this.ctx.deps.delay(PAUSE.betweenTurns);
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
    const sealedBefore = !state.stairsOpen;
    if (sealedBefore && !state.monsters.some((m) => m.boss && !m.creature.dead)) state.stairsOpen = true;
    if (sealedBefore && state.stairsOpen) {
      deps.audio.play('stairsUnlock', { delay: 0.6 });
      deps.ui.banner('Victory', 'The way down is open');
      this.ctx.say('The floor boss is dead. The stairs down are open.');
    } else {
      deps.ui.banner('Victory');
      this.ctx.say('Victory!');
    }
    deps.renderer.followEntity('player');
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
      if (cellDistance(this.ctx.state.player.pos, cell) > range) {
        this.ctx.prompt('Out of range.', 1800);
        return;
      }
      await this.run(() => this.perform({ type: 'action', actionId, point: cell }));
      return;
    }
    // Movement mode.
    if (ent) {
      this.ctx.state.targetId = ent;
      if (ent === 'player') {
        this.ctx.hud();
        return;
      }
      const quick = this.quickAttackFor(ent);
      if (quick) await this.run(() => this.perform({ type: 'action', actionId: quick, targetId: ent }));
      else {
        const plan = this.approachPlan(ent);
        if (!plan || plan.path.length === 0) {
          this.ctx.deps.audio.play('uiError');
          this.ctx.prompt('Out of reach. Move closer or choose an action.', 2200);
          this.ctx.hud();
          return;
        }
        this.ctx.prompt(undefined);
        await this.run(async () => {
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
    this.ctx.prompt(undefined);
    await this.run(() => this.perform({ type: 'move', path }));
  }

  async selectAction(actionId: string): Promise<void> {
    if (!this.playerTurn) return;
    const combat = this.combat as CombatApi;
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
        this.ctx.prompt(`${a.name}: choose where to aim. Tap empty floor or press Esc to cancel.`);
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
      await this.perform(playerPolicy(combat, this.ctx.state.nav));
    });
  }

  hover(pick: PickResult): void {
    const state = this.ctx.state;
    if (this.busy || !this.combat) return;
    const ent = this.creatureAtPick(pick) ?? null;
    const prevTarget = state.targetId;
    state.targetId = ent;
    this.hoverEnt = ent !== 'player' ? ent : null;
    this.previewActionId = this.mode === 'move' && ent && ent !== 'player' ? this.quickAttackFor(ent) : null;
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
    } else if (this.mode === 'point' && this.selectedActionId && this.hoverCell) {
      for (const pos of combat.areaCells(this.selectedActionId, this.hoverCell)) out.push({ pos, style: 'area' });
    }
    r.setHighlights(out);
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
      if (a.cost === 'free') return turn.actionUsed;
      if (a.cost === 'action') return !turn.actionUsed;
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
