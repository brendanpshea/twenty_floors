import type { SfxId } from '../audio';
import type { DamageType, EffectElement, GameEvent, GridPos, VisualEffect } from '../core/types';
import { CellKind } from '../core/types';
import { isSpellAction } from '../rules';
import { QUIET_CONDITIONS, capitalize, logLine } from './eventLog';
import type { SessionCtx } from './floorState';
import { getItem } from '../rules';
import { cellDistance } from './fog';
import { creatureById, isEntityVisible, isSeen, setEntityVisible } from './floorState';

/** Damage types that have a spell-hit sound of their own; the rest land as a blunt hit. */
const SPELL_HIT: Partial<Record<DamageType, SfxId>> = {
  fire: 'fireHit',
  cold: 'coldHit',
  lightning: 'lightningHit',
  force: 'forceHit',
  acid: 'acidHit',
  radiant: 'radiantHit',
  necrotic: 'necroticHit',
  poison: 'poisonHit',
  thunder: 'thunderHit',
};

/** Renderer extras for hazards, off the Renderer3D interface (fakes and older renderers may lack them). */
interface HazardRenderer {
  dropEntity?: (id: string, into: 'fall' | 'lava') => Promise<void>;
  riseEntity?: (id: string, at: GridPos) => Promise<void>;
}

/** The look of an effect for a damage type. */
function elementOf(type: DamageType | undefined): EffectElement {
  switch (type) {
    case 'fire':
    case 'cold':
    case 'lightning':
    case 'force':
    case 'acid':
    case 'radiant':
    case 'necrotic':
    case 'poison':
    case 'thunder':
    case 'psychic':
      return type;
    default:
      return 'physical';
  }
}

/** What flies for a ranged weapon attack, by the name of the weapon or attack. */
function shapeOf(name: string): 'arrow' | 'bolt' | 'javelin' | 'rock' | 'dart' {
  const n = name.toLowerCase();
  if (/crossbow|bolt/.test(n)) return 'bolt';
  if (/javelin|spear|trident/.test(n)) return 'javelin';
  if (/sling|stone|rock|boulder/.test(n)) return 'rock';
  if (/dart|blowgun|needle/.test(n)) return 'dart';
  return 'arrow';
}

/** Sounds for structured feature events; the rest only float their label. */
const FEATURE_SOUND: Record<string, SfxId> = {
  sneakAttack: 'sneakAttack',
  shield: 'shield',
  concentrationStart: 'concentrationStart',
  concentrationEnd: 'concentrationBreak',
  ambush: 'crit',
};

/** Target length of one enemy round, in ms, however many monsters are in view. */
export const ENEMY_ROUND_BUDGET_MS = 5500;
/** Monsters this near the hero are on screen already: the camera stays on the hero. */
const CAMERA_STAY_RANGE = 6;

/**
 * Plays batches of GameEvents back through the renderer, in order, awaiting
 * animations, and writes the log. Knows nothing about input.
 */
export class Playback {
  /** The acting creature has just cast a spell: its damage and healing sound like magic. */
  private spellActive = false;
  /** A Teleport (blink) was announced: the next single-cell move is a jump, not a walk. */
  private pendingBlink: string | null = null;
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
    return (p ? Math.min(ms, Math.max(0, p.cap * share)) : ms) * this.scale();
  }

  /** How much the animation speed setting shortens our own pauses (the renderer shortens its animations itself). */
  private scale(): number {
    const speed = this.ctx.state.speed;
    return speed === 'skip' ? 0.2 : speed === 'fast' ? 0.5 : 1;
  }

  /** A fixed pause, scaled by the animation speed. */
  private pause(ms: number): Promise<void> {
    return this.ctx.guard(this.ctx.deps.delay(ms * this.scale()), 600);
  }

  /** Play a one-shot visual effect and wait for its main beat (the renderer may not have effects yet: then nothing). */
  private async fx(effect: VisualEffect): Promise<void> {
    const r = this.ctx.deps.renderer as { playEffect?: (e: VisualEffect) => Promise<void> };
    if (typeof r.playEffect !== 'function') return;
    try {
      await this.ctx.guard(r.playEffect(effect), this.wait(900, 0.6));
    } catch (err) {
      console.warn('Effect failed', effect, err);
    }
  }

  /** Pause between two turns, shorter when many monsters act. */
  turnGap(ms: number): number {
    const p = this.pace;
    return (p ? Math.min(ms, Math.max(0, p.cap * 0.15)) : ms) * this.scale();
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
    const spell = def !== undefined && isSpellAction(def);
    const name = e.actionName.toLowerCase();
    audio.play('diceRoll');
    const swing = name.includes('bite') ? 'bite' : name.includes('claw') ? 'claw' : melee ? 'swing' : 'bowShot';
    // A spell attack was announced by the cast sound; it has no swing.
    if (!spell) audio.play(swing, { delay: 0.12 });
    if (e.outcome === 'miss' || e.outcome === 'fumble') {
      audio.play('miss', { delay: 0.3 });
      return;
    }
    const dmg = ahead.find((x) => x.type === 'damage' && x.targetId === e.targetId);
    const type: DamageType = dmg && dmg.type === 'damage' ? dmg.damageType : 'slashing';
    // A spell attack lands as its damage type (the damage event plays it); weapons keep their own sounds.
    if (!spell) {
      const impact = !melee ? 'arrowHit' : type === 'bludgeoning' ? 'hitBlunt' : type === 'piercing' ? 'hitPierce' : 'hitBlade';
      audio.play(impact, { delay: 0.3 });
    }
    if (e.outcome === 'crit') audio.play('crit', { delay: 0.35 });
  }

  /**
   * A named feature took effect (the engine's structured `feature` event, which comes right before its log line):
   * float its label over the creature it happened to, and play the matching sound.
   */
  private feature(e: Extract<GameEvent, { type: 'feature' }>, ahead: readonly GameEvent[] = []): void {
    const { state, deps } = this.ctx;
    const audio = deps.audio;
    let sound = FEATURE_SOUND[e.id];
    if (e.id === 'slam') {
      // A pushed creature hit fire or spikes: the sound follows the damage that comes next.
      const dmg = ahead.find((x) => x.type === 'damage');
      sound = dmg && dmg.type === 'damage' && dmg.damageType === 'piercing' ? 'hitPierce' : 'fireHit';
    }
    if (e.id === 'bossAction') {
      // Boss momentum: a distinct beat. A low accent, the label in the warning colour, then the attack follows.
      audio.play('crit');
      const boss = creatureById(state, e.creatureId);
      if (boss && isEntityVisible(state, e.creatureId)) deps.renderer.floatText(e.creatureId, e.label, 'crit');
      return;
    }
    if (sound) audio.play(sound);
    if (e.id === 'shield') void this.fx({ kind: 'aura', on: e.creatureId, style: 'shield' });
    // The save that Burst of Ingenuity adds to belongs to the target; everything else reads best over the creature itself.
    const at = e.id === 'burstOfIngenuity' && e.targetId ? e.targetId : e.creatureId;
    const who = creatureById(state, at);
    if (who && isEntityVisible(state, at)) deps.renderer.floatText(at, e.amount !== undefined && e.id === 'burstOfIngenuity' ? `+${e.amount} ${e.label}` : e.label, 'info');
  }

  /**
   * The visible part of a spell beyond the cast animation: a volley of darts for Magic Missile, a beam or a bolt for a
   * save-or-damage spell on one creature, a flash across the cells of a cone or burst, a shimmer for a buff.
   */
  private async spellEffect(e: Extract<GameEvent, { type: 'actionUsed' }>, act: import('../core/types').ActionDef): Promise<void> {
    const type = act.damage?.[0]?.type;
    const element = type ? elementOf(type) : act.heal ? 'heal' : 'arcane';
    const t = act.targeting;
    if (act.effects?.includes('magicMissile') && e.targetId) {
      await this.fx({ kind: 'projectile', from: e.creatureId, to: e.targetId, shape: 'orb', element: 'force', hit: true, count: 3 });
    } else if (t.kind === 'point') {
      const cells = e.point ? (this.ctx.areaCells?.(act.id, e.point) ?? []) : [];
      if (cells.length > 0 && act.damage) await this.fx({ kind: 'area', origin: e.creatureId, cells, element });
      else if (cells.length > 0) void this.fx({ kind: 'area', origin: e.creatureId, cells, element: 'arcane' });
    } else if (t.kind === 'creature' && act.damage && act.attack === undefined && e.targetId) {
      // A save spell or an auto-hit on one creature: the attack roll event never comes, so the effect is here.
      if (/ray|lightning|beam/i.test(act.name)) await this.fx({ kind: 'beam', from: e.creatureId, to: e.targetId, element });
      else await this.fx({ kind: 'projectile', from: e.creatureId, to: e.targetId, shape: 'orb', element, hit: true });
    } else if (!act.damage && !act.heal) {
      void this.fx({ kind: 'aura', on: e.targetId ?? e.creatureId, style: /bless/i.test(act.name) ? 'bless' : 'buff' });
    }
  }

  /** A forced move (shove, push, ice): a short, quick slide along the path. */
  private async slide(id: string, path: GridPos[]): Promise<void> {
    const { state, deps } = this.ctx;
    const end = path[path.length - 1];
    if (!end) return;
    const startVisible = state.entityVisible.get(id) ?? true;
    if (id === 'player' || id === 'companion' || startVisible || isSeen(state, end)) {
      setEntityVisible(this.ctx, id, true);
      deps.audio.play('hitBlunt');
      // Far from the hero: look at it (the camera returns on the next hero turn).
      const hero = state.player.pos;
      if (id !== 'player' && cellDistance(end, hero) > CAMERA_STAY_RANGE) {
        deps.renderer.focusCamera(end);
        this.camAway = true;
      }
      await this.ctx.guard(deps.renderer.moveEntity(id, path), this.wait(350 + path.length * 100, 0.4));
    } else {
      deps.renderer.placeEntity(id, end);
    }
    if (id === 'player') this.ctx.reveal();
  }

  /** Into a pit or lava: the cry, the thud (or hiss), and the creature drops out of sight. */
  private async hazard(e: Extract<GameEvent, { type: 'hazard' }>): Promise<void> {
    const { state, deps } = this.ctx;
    const r = deps.renderer;
    const lava = e.hazard === 'lava';
    state.fallen.add(e.creatureId);
    const seen = e.creatureId === 'player' || e.creatureId === 'companion' || isSeen(state, e.at);
    if (seen) {
      r.floatText(e.at, lava ? 'Lava!' : 'Falls!', 'damage');
      deps.audio.play(lava ? 'fireHit' : 'thunderHit');
      if (e.creatureId !== 'player' && cellDistance(e.at, state.player.pos) > CAMERA_STAY_RANGE) {
        r.focusCamera(e.at);
        this.camAway = true;
      }
      const drop = (r as HazardRenderer).dropEntity;
      if (typeof drop === 'function' && (e.hazard === 'fall' || e.hazard === 'lava')) {
        // The renderer tips it over the edge (or sinks it into the slag) and hides it when it is gone.
        await this.ctx.guard(drop.call(r, e.creatureId, e.hazard), 1100);
      } else {
        await this.pause(180);
      }
    }
    r.setEntityState(e.creatureId, { visible: false });
    state.entityVisible.set(e.creatureId, false);
  }

  /** Back out of the drop onto its edge cell: it reappears there, prone. */
  private async climbOut(id: string, to: GridPos): Promise<void> {
    const { state, deps } = this.ctx;
    const seen = id === 'player' || id === 'companion' || isSeen(state, to);
    const rise = (deps.renderer as HazardRenderer).riseEntity;
    state.fallen.delete(id);
    if (seen && typeof rise === 'function') {
      // The renderer places it at the rim and has it climb up.
      state.entityVisible.set(id, true);
      if (id === 'player') this.ctx.reveal();
      deps.audio.play('step');
      await this.ctx.guard(rise.call(deps.renderer, id, to), 900);
      return;
    }
    // No rise effect: a beat below the edge, so the fall reads, then it simply reappears.
    if (seen) await this.pause(450);
    deps.renderer.placeEntity(id, to);
    deps.renderer.setEntityState(id, { visible: seen });
    state.entityVisible.set(id, seen);
    if (seen) deps.audio.play('step');
    if (id === 'player') this.ctx.reveal();
  }

  /** A blink: the creature vanishes, reappears on the far cell, with a flash of light. */
  private async teleport(id: string, to: GridPos): Promise<void> {
    const { state, deps } = this.ctx;
    const r = deps.renderer;
    const seenBefore = isEntityVisible(state, id);
    const seenAfter = id === 'companion' || isSeen(state, to);
    if (seenBefore || seenAfter) {
      deps.audio.play('teleport');
      r.floatText(id, 'Blink!', 'info');
      r.setEntityState(id, { visible: false });
      await this.pause(160);
    }
    r.placeEntity(id, to);
    setEntityVisible(this.ctx, id, seenAfter);
    this.ctx.deps.renderer.setEntityState(id, { visible: seenAfter });
    this.ctx.state.entityVisible.set(id, seenAfter);
    if (seenAfter) await this.pause(160);
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
      case 'actionUsed': {
        if (e.actionId === 'dash') audio.play('dash');
        else if (e.actionId.startsWith('drink_')) audio.play('potion');
        const caster = creatureById(state, e.creatureId);
        const act = caster?.actions.find((a) => a.id === e.actionId);
        if (act && isSpellAction(act)) this.ctx.say(`${this.nameOf(e.creatureId)} casts ${e.name}.`);
        this.spellActive = act !== undefined && isSpellAction(act);
        if (e.actionId === 'blink') this.pendingBlink = e.creatureId;
        if (act && isSpellAction(act) && isEntityVisible(state, e.creatureId)) {
          audio.play('spellCast');
          const facing = e.point ?? (e.targetId ? this.posOf(e.targetId) : undefined);
          await this.ctx.guard(r.playAnim(e.creatureId, 'cast', facing ? { facing } : undefined), this.wait(1000));
          await this.spellEffect(e, act);
        }
        if (e.actionId === 'blink' && isEntityVisible(state, e.creatureId)) void this.fx({ kind: 'aura', on: e.creatureId, style: 'teleport' });
        break;
      }
      case 'feature':
        if (e.id === 'bossAction') await this.pause(450);
        this.feature(e, ahead);
        break;
      case 'hazard':
        await this.hazard(e);
        break;
      case 'turnStart': {
        this.spellActive = false;
        this.pendingBlink = null;
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
        if (this.pendingBlink === e.creatureId && e.path.length === 1) {
          this.pendingBlink = null;
          await this.teleport(e.creatureId, end);
          break;
        }
        if (state.fallen.has(e.creatureId)) {
          await this.climbOut(e.creatureId, end);
          break;
        }
        // A creature that is not the one whose turn it is was pushed (a shove, Thunderwave, ice): a quick slide, not a walk.
        if (e.creatureId !== state.shownActive) {
          await this.slide(e.creatureId, e.path);
          break;
        }
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
        else setEntityVisible(this.ctx, e.creatureId, e.creatureId === 'companion' || isSeen(state, end));
        break;
      }
      case 'attackRoll': {
        const target = this.posOf(e.targetId);
        const visible = isEntityVisible(state, e.attackerId) || isEntityVisible(state, e.targetId);
        if (visible) this.attackSounds(e, ahead);
        const atkDef = creatureById(state, e.attackerId)?.actions.find((a) => a.name === e.actionName);
        // A spell attack already played the cast animation.
        const spellAttack = atkDef !== undefined && isSpellAction(atkDef);
        const rangedWeapon = !spellAttack && atkDef?.targeting.kind === 'creature' && !atkDef.targeting.melee;
        if (visible && !spellAttack) {
          const p = r.playAnim(e.attackerId, rangedWeapon ? 'shoot' : 'attack', target ? { facing: target } : undefined);
          await this.ctx.guard(p, this.wait(1500));
        }
        const hit = e.outcome === 'hit' || e.outcome === 'crit';
        const dmg = ahead.find((x): x is Extract<GameEvent, { type: 'damage' }> => x.type === 'damage' && x.targetId === e.targetId);
        const element = spellAttack ? elementOf(dmg?.damageType) : 'physical';
        if (visible) {
          // The travelling part: an arrow, a bolt of magic or a ray, awaited so the blow lands on the beat.
          if (rangedWeapon) {
            await this.fx({ kind: 'projectile', from: e.attackerId, to: e.targetId, shape: shapeOf(e.actionName), element: 'physical', hit });
          } else if (spellAttack) {
            if (/ray|lightning|beam/i.test(e.actionName)) await this.fx({ kind: 'beam', from: e.attackerId, to: e.targetId, element });
            else await this.fx({ kind: 'projectile', from: e.attackerId, to: e.targetId, shape: 'orb', element, hit });
          }
        }
        if (hit) {
          if (visible) {
            const maxHp = creatureById(state, e.targetId)?.maxHp ?? 0;
            let strength = dmg && maxHp > 0 ? Math.min(1, Math.max(0.15, dmg.amount / maxHp)) : 0.3;
            if (e.outcome === 'crit' || creatureById(state, e.attackerId)?.resources['_boss'] !== undefined) strength = Math.max(strength, 0.9);
            await this.fx({ kind: 'impact', on: e.targetId, from: e.attackerId, strength, element });
            void r.playAnim(e.targetId, 'hit');
          }
        } else if (isEntityVisible(state, e.targetId)) {
          // A miss: the target gets out of the way (or takes it on the shield).
          const shielded = e.targetId === 'player' && state.pc.equipped.offHand !== undefined && getItem(state.pc.equipped.offHand)?.kind === 'shield';
          void r.playAnim(e.targetId, shielded ? 'block' : 'dodge');
          r.floatText(e.targetId, 'Miss', 'miss');
        }
        break;
      }
      case 'saveRoll':
        if (e.success && isEntityVisible(state, e.creatureId)) r.floatText(e.creatureId, 'Saved', 'info');
        break;
      case 'damage': {
        const c = creatureById(state, e.targetId);
        if (isEntityVisible(state, e.targetId)) {
          // A spell lands as its damage type (fire, cold...); the hero still hears that it hurt.
          const magic = this.spellActive ? SPELL_HIT[e.damageType] : undefined;
          if (magic) audio.play(magic, { delay: 0.3 });
          if (!magic || e.targetId === 'player') audio.play(e.targetId === 'player' ? 'hurtHero' : 'hurtMonster', { delay: magic ? 0.4 : 0.3 });
        }
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
        if (isEntityVisible(state, e.targetId)) audio.play(this.spellActive ? 'healSpell' : 'heal', { delay: 0.1 });
        if (c && isEntityVisible(state, e.targetId)) {
          void this.fx({ kind: 'aura', on: e.targetId, style: 'heal' });
          r.floatText(e.targetId, `+${e.amount}`, 'heal');
          r.setEntityState(e.targetId, { hpFraction: c.maxHp > 0 ? e.hpAfter / c.maxHp : 1 });
        }
        this.ctx.hud();
        break;
      }
      case 'conditionAdded':
        if (isEntityVisible(state, e.creatureId)) {
          r.floatText(e.creatureId, capitalize(e.condition), 'info');
          if (!QUIET_CONDITIONS.has(e.condition)) {
            audio.play('debuff');
            void this.fx({ kind: 'aura', on: e.creatureId, style: 'debuff' });
          }
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
        if (e.creatureId === 'companion' && state.companion) state.companion.downed = true;
        state.shownDead.add(e.creatureId);
        state.shownHp.set(e.creatureId, 0);
        if (state.fallen.has(e.creatureId)) {
          // It went into the pit or the lava and is not coming back: no corpse on the floor.
          r.setEntityState(e.creatureId, { dead: true, visible: false, selected: false });
          state.entityVisible.set(e.creatureId, false);
          audio.play(e.creatureId === 'player' ? 'deathHero' : e.creatureId === 'companion' ? 'companionDown' : 'deathMonster', { delay: 0.2 });
        } else if (isEntityVisible(state, e.creatureId)) {
          audio.play(e.creatureId === 'player' ? 'deathHero' : e.creatureId === 'companion' ? 'companionDown' : 'deathMonster');
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
