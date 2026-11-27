import type { DamageType, GameEvent, GridPos } from '../core/types';
import { CellKind } from '../core/types';
import { QUIET_CONDITIONS, capitalize, logLine } from './eventLog';
import type { SessionCtx } from './floorState';
import { cellDistance } from './fog';
import { creatureById, isEntityVisible, isSeen, setEntityVisible } from './floorState';

/** Target length of one enemy round, in ms, however many monsters are in view. */
export const ENEMY_ROUND_BUDGET_MS = 5500;
/** Monsters this near the hero are on screen already: the camera stays on the hero. */
const CAMERA_STAY_RANGE = 6;

/**
 * Plays batches of GameEvents back through the renderer, in order, awaiting
 * animations, and writes the log. Knows nothing about input.
 */
export class Playback {
  /** The camera has left the hero to look at a far-off monster. */
  private camAway = false;
  /** Enemy-round pacing: set by beginEnemyRound, cleared by endEnemyRound. */
  private pace: { start: number; turnsLeft: number; cap: number } | null = null;

  constructor(private readonly ctx: SessionCtx) {}

  /**
   * Start timing an enemy round with some monster turns that will be seen (visibleTurns). Every animation wait is
   * capped to its share of what is left of the budget, so a crowd acts in a quick run (overlapping
   * animations) rather than one long parade. Turns of unseen monsters cost nothing.
   */
  beginEnemyRound(visibleTurns: number): void {
    this.pace = { start: Date.now(), turnsLeft: visibleTurns, cap: Number.POSITIVE_INFINITY };
  }

  endEnemyRound(): void {
    this.pace = null;
  }

  /** The longest to wait on an animation that normally takes ms; share is its part of a turn. */
  private wait(ms: number, share = 0.5): number {
    const p = this.pace;
    return p ? Math.min(ms, Math.max(0, p.cap * share)) : ms;
  }

  /** Pause between two turns, shorter when many monsters act. */
  turnGap(ms: number): number {
    const p = this.pace;
    return p ? Math.min(ms, Math.max(0, p.cap * 0.15)) : ms;
  }

  private startTurn(): void {
    const p = this.pace;
    if (!p) return;
    const left = Math.max(1, p.turnsLeft);
    p.cap = Math.max(0, ENEMY_ROUND_BUDGET_MS - (Date.now() - p.start)) / left;
    p.turnsLeft = Math.max(0, p.turnsLeft - 1);
  }

  private nameOf = (id: string): string => creatureById(this.ctx.state, id)?.name ?? id;

  async play(events: readonly GameEvent[]): Promise<void> {
    for (let i = 0; i < events.length; i++) {
      const e = events[i] as GameEvent;
      try {
        await this.one(e, events.slice(i + 1, i + 6));
      } catch (err) {
        console.error('Playback failed on event', e, err);
      }
    }
    this.ctx.hud();
  }

  /** Dice, swing/shot and impact sounds for one attack roll, timed against the attack animation. */
  private attackSounds(e: Extract<GameEvent, { type: 'attackRoll' }>, ahead: readonly GameEvent[]): void {
    const audio = this.ctx.deps.audio;
    const attacker = creatureById(this.ctx.state, e.attackerId);
    const def = attacker?.actions.find((a) => a.name === e.actionName);
    const melee = def?.targeting.kind === 'creature' ? def.targeting.melee : true;
    const name = e.actionName.toLowerCase();
    audio.play('diceRoll');
    const swing = name.includes('bite') ? 'bite' : name.includes('claw') ? 'claw' : melee ? 'swing' : 'bowShot';
    audio.play(swing, { delay: 0.12 });
    if (e.outcome === 'miss' || e.outcome === 'fumble') {
      audio.play('miss', { delay: 0.3 });
      return;
    }
    const dmg = ahead.find((x) => x.type === 'damage' && x.targetId === e.targetId);
    const type: DamageType = dmg && dmg.type === 'damage' ? dmg.damageType : 'slashing';
    const impact = !melee ? 'arrowHit' : type === 'bludgeoning' ? 'hitBlunt' : type === 'piercing' ? 'hitPierce' : 'hitBlade';
    audio.play(impact, { delay: 0.3 });
    if (e.outcome === 'crit') audio.play('crit', { delay: 0.35 });
  }

  private posOf(id: string): GridPos | undefined {
    return creatureById(this.ctx.state, id)?.pos;
  }

  private async one(e: GameEvent, ahead: readonly GameEvent[]): Promise<void> {
    const { state, deps } = this.ctx;
    const r = deps.renderer;
    const audio = deps.audio;
    const line = logLine(e, this.nameOf);
    if (line) {
      this.ctx.say(line);
      this.ctx.hud();
    }

    switch (e.type) {
      case 'combatStart':
        audio.play('combatStart');
        audio.setCombat(true);
        break;
      case 'combatEnd':
        audio.setCombat(false);
        audio.play(e.winner === 'player' ? 'victory' : 'defeat', { delay: 0.3 });
        break;
      case 'actionUsed':
        if (e.actionId === 'dash') audio.play('dash');
        else if (e.actionId.startsWith('drink_')) audio.play('potion');
        break;
      case 'turnStart': {
        const prev = state.shownActive;
        if (prev && prev !== e.creatureId && state.entityVisible.has(prev)) r.setEntityState(prev, { selected: false });
        state.shownActive = e.creatureId;
        if (e.creatureId === 'player') audio.play('turnStart');
        const c = creatureById(state, e.creatureId);
        if (e.creatureId !== 'player' && this.pace && c && isEntityVisible(state, e.creatureId)) this.startTurn();
        if (c && !c.dead && isEntityVisible(state, e.creatureId)) {
          r.setEntityState(e.creatureId, { selected: true });
          if (e.creatureId === 'player') {
            r.followEntity('player');
            this.camAway = false;
          } else if (cellDistance(c.pos, state.player.pos) > CAMERA_STAY_RANGE) {
            r.focusCamera(c.pos);
            this.camAway = true;
          } else if (this.camAway) {
            r.followEntity('player');
            this.camAway = false;
          }
        }
        this.ctx.hud();
        break;
      }
      case 'move': {
        const end = e.path[e.path.length - 1];
        if (!end) break;
        const startVisible = state.entityVisible.get(e.creatureId) ?? true;
        if (e.creatureId === 'player' || startVisible || isSeen(state, end)) {
          e.path.forEach((c, i) => {
            const water = state.plan.kinds[c.y * state.plan.width + c.x] === CellKind.Water;
            audio.play(water ? 'stepWater' : 'step', { delay: i * 0.13, volume: e.creatureId === 'player' ? 1 : 0.7 });
          });
        }
        if (e.creatureId === 'player' || startVisible || isSeen(state, end)) {
          setEntityVisible(this.ctx, e.creatureId, true);
          await this.ctx.guard(r.moveEntity(e.creatureId, e.path), this.wait(600 + e.path.length * 250));
        } else {
          r.placeEntity(e.creatureId, end);
        }
        if (e.creatureId === 'player') this.ctx.reveal();
        else setEntityVisible(this.ctx, e.creatureId, isSeen(state, end));
        break;
      }
      case 'attackRoll': {
        const target = this.posOf(e.targetId);
        const visible = isEntityVisible(state, e.attackerId) || isEntityVisible(state, e.targetId);
        if (visible) this.attackSounds(e, ahead);
        if (visible) {
          const p = r.playAnim(e.attackerId, 'attack', target ? { facing: target } : undefined);
          await this.ctx.guard(p, this.wait(1500));
        }
        if (e.outcome === 'hit' || e.outcome === 'crit') {
          if (visible) void r.playAnim(e.targetId, 'hit');
        } else if (isEntityVisible(state, e.targetId)) {
          r.floatText(e.targetId, 'Miss', 'miss');
        }
        break;
      }
      case 'saveRoll':
        if (e.success && isEntityVisible(state, e.creatureId)) r.floatText(e.creatureId, 'Saved', 'info');
        break;
      case 'damage': {
        const c = creatureById(state, e.targetId);
        if (isEntityVisible(state, e.targetId)) audio.play(e.targetId === 'player' ? 'hurtHero' : 'hurtMonster', { delay: 0.3 });
        state.shownHp.set(e.targetId, Math.max(0, e.hpAfter));
        if (e.targetId === 'player' && e.sourceId) state.lastHitBy = this.nameOf(e.sourceId);
        if (c && isEntityVisible(state, e.targetId)) {
          const text = e.modifier === 'immune' ? 'Immune' : String(e.amount);
          r.floatText(e.targetId, text, e.crit ? 'crit' : 'damage');
          r.setEntityState(e.targetId, { hpFraction: c.maxHp > 0 ? Math.max(0, e.hpAfter) / c.maxHp : 0 });
        }
        this.ctx.hud();
        break;
      }
      case 'heal': {
        const c = creatureById(state, e.targetId);
        state.shownHp.set(e.targetId, e.hpAfter);
        if (isEntityVisible(state, e.targetId)) audio.play('heal', { delay: 0.1 });
        if (c && isEntityVisible(state, e.targetId)) {
          r.floatText(e.targetId, `+${e.amount}`, 'heal');
          r.setEntityState(e.targetId, { hpFraction: c.maxHp > 0 ? e.hpAfter / c.maxHp : 1 });
        }
        this.ctx.hud();
        break;
      }
      case 'conditionAdded':
        if (isEntityVisible(state, e.creatureId)) {
          r.floatText(e.creatureId, capitalize(e.condition), 'info');
          if (!QUIET_CONDITIONS.has(e.condition)) audio.play('debuff');
        }
        this.ctx.hud();
        break;
      case 'conditionRemoved':
        if (!QUIET_CONDITIONS.has(e.condition) && isEntityVisible(state, e.creatureId)) {
          r.floatText(e.creatureId, `Not ${e.condition}`, 'info');
        }
        this.ctx.hud();
        break;
      case 'death': {
        state.shownDead.add(e.creatureId);
        state.shownHp.set(e.creatureId, 0);
        if (isEntityVisible(state, e.creatureId)) {
          audio.play(e.creatureId === 'player' ? 'deathHero' : 'deathMonster');
          await this.ctx.guard(r.playAnim(e.creatureId, 'death'), this.wait(1500, 0.3));
          r.setEntityState(e.creatureId, { dead: true, selected: false });
        } else {
          r.setEntityState(e.creatureId, { dead: true });
        }
        this.ctx.hud();
        break;
      }
      default:
        break;
    }
  }
}
