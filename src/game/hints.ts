import type { GameUi, HelpMode, HintRequest, HudModel } from '../core/types';
import type { FloorState } from './floorState';
import { samePos } from './floorState';
import type { Prefs } from './prefs';

/** What a hint rule can look at. */
export interface HintContext {
  model: HudModel;
  state: FloorState;
  /** An adjacent enemy stands by a drop or lava with a decent chance to be shoved in (guided concept hint). */
  edgeShove: boolean;
}

export interface HintDef {
  id: string;
  /** 'control' hints show in both modes; 'concept' hints only in guided mode. */
  kind: 'control' | 'concept';
  text: (c: HintContext) => string;
  anchor?: HintRequest['anchor'] | ((c: HintContext) => HintRequest['anchor']);
  title?: string;
  /** Is this the moment? */
  when: (c: HintContext) => boolean;
  /** Did the player do the thing? Then the hint is taken away. */
  done: (c: HintContext) => boolean;
}

const inCombatTurn = (c: HintContext): boolean => c.model.mode === 'combat' && c.model.combat?.playerTurn === true;
const exploring = (c: HintContext): boolean => c.model.mode === 'explore' && c.state.mode === 'explore';
const actionChosen = (c: HintContext): boolean => c.model.actions.some((a) => a.selected) || c.model.combat?.actionAvailable === false;
const seenEnemy = (c: HintContext): boolean => c.state.monsters.some((m) => !m.creature.dead && m.creature.hp > 0 && c.state.entityVisible.get(m.creature.id) === true);
const pct = (n: number): string => `${Math.round(n * 100)}%`;

export const HINTS: HintDef[] = [
  // ------------------------------------------------------------------ controls (both modes)
  {
    id: 'move',
    kind: 'control',
    text: () => 'Tap a tile to walk there. Drag to look around; pinch or use the wheel to zoom.',
    anchor: 'center',
    when: (c) => exploring(c) && samePos(c.state.player.pos, c.state.plan.entrance),
    done: (c) => !samePos(c.state.player.pos, c.state.plan.entrance),
  },
  {
    id: 'enemyInView',
    kind: 'control',
    text: () => 'An enemy is in view. Tap a creature to see what it is.',
    anchor: 'center',
    when: (c) => exploring(c) && seenEnemy(c),
    done: (c) => c.state.targetId !== null || c.state.mode === 'combat',
  },
  {
    id: 'firstTurn',
    kind: 'control',
    text: () => 'The lit tiles are where you can walk this turn. Pick an action below, then a target.',
    anchor: 'actionBar',
    when: (c) => inCombatTurn(c),
    done: (c) => actionChosen(c) || !inCombatTurn(c),
  },
  {
    id: 'endTurn',
    kind: 'control',
    text: () => 'When you are done, press End Turn.',
    anchor: 'endTurn',
    when: (c) => inCombatTurn(c) && c.model.combat?.actionAvailable === false,
    done: (c) => !inCombatTurn(c),
  },
  {
    id: 'restSite',
    kind: 'control',
    text: () => 'A campsite. Walk next to it to rest and heal fully (each can be used once).',
    anchor: 'center',
    when: (c) => exploring(c) && c.state.restSpotted,
    done: (c) => c.state.restSites.some((r) => r.used) || c.state.mode === 'combat',
  },
  {
    id: 'chest',
    kind: 'control',
    text: () => 'A chest. Walk next to it to open it: gold and potions inside.',
    anchor: 'center',
    when: (c) => exploring(c) && c.state.chests.some((ch) => !ch.opened && c.state.entityVisible.get(ch.id) === true),
    done: (c) => c.state.chests.some((ch) => ch.opened) || c.state.mode === 'combat',
  },
  {
    id: 'companionStance',
    kind: 'control',
    text: () => 'Your companion plays by itself. Close, Back or Focus tells it how to fight.',
    anchor: 'companion',
    when: (c) => exploring(c) && c.model.companion !== undefined,
    done: (c) => c.state.mode === 'combat',
  },
  // ------------------------------------------------------------------ concepts (guided mode)
  {
    id: 'hitChance',
    kind: 'concept',
    text: (c) => `${pct(c.model.target?.hitChance ?? 0)} is your chance to hit: your roll plus your skill against its Armor Class.`,
    anchor: 'target',
    when: (c) => inCombatTurn(c) && c.model.target?.hitChance !== undefined,
    done: (c) => !inCombatTurn(c) || c.model.target?.hitChance === undefined,
  },
  {
    id: 'bonusAction',
    kind: 'concept',
    text: () => 'Second Wind is a bonus action: you can use it as well as your normal action each turn.',
    anchor: { actionId: 'second_wind' },
    when: (c) => inCombatTurn(c) && c.model.combat?.bonusAvailable === true && c.model.actions.some((a) => a.id === 'second_wind' && a.enabled),
    done: (c) => !inCombatTurn(c),
  },
  {
    id: 'lowHp',
    kind: 'concept',
    text: () => 'You are badly hurt. Drink a potion or use Second Wind before you fall.',
    anchor: (c) => ({ actionId: c.model.actions.find((a) => a.id.startsWith('drink_') && a.enabled)?.id ?? 'second_wind' }),
    when: (c) => inCombatTurn(c) && c.model.player.hp * 2 < c.model.player.maxHp,
    done: (c) => !inCombatTurn(c) || c.model.player.hp * 2 >= c.model.player.maxHp,
  },
  {
    id: 'shortRestHurt',
    kind: 'concept',
    text: () => 'You are hurt and nothing is near. A short rest recovers some health.',
    anchor: 'rest',
    when: (c) => exploring(c) && c.model.canShortRest && c.model.player.hp * 10 < c.model.player.maxHp * 7 && !samePos(c.state.player.pos, c.state.plan.entrance),
    done: (c) => !exploring(c) || !c.model.canShortRest,
  },
  {
    id: 'shove',
    kind: 'concept',
    text: () => 'An enemy is at an edge. Shove can push it off for heavy damage if it fails its save.',
    anchor: { actionId: 'shove' },
    when: (c) => inCombatTurn(c) && c.edgeShove,
    done: (c) => !inCombatTurn(c) || c.model.actions.some((a) => a.id === 'shove' && a.selected),
  },
  {
    id: 'cover',
    kind: 'concept',
    text: (c) => `This target has ${c.model.target?.cover === 5 ? 'three-quarters' : 'half'} cover: it is harder to hit (+${c.model.target?.cover} to its Armor Class).`,
    anchor: 'target',
    when: (c) => inCombatTurn(c) && (c.model.target?.cover ?? 0) > 0,
    done: (c) => !inCombatTurn(c) || (c.model.target?.cover ?? 0) === 0,
  },
  {
    id: 'role',
    kind: 'concept',
    text: (c) =>
      c.model.target?.tactic === 'archer'
        ? 'Archers shoot from range. Close in or get out of their sight.'
        : c.model.target?.tactic === 'caster'
          ? 'Casters are fragile but dangerous. Reach them first if you can.'
          : 'Leaders make the monsters around them fight better. Take them down early.',
    anchor: 'target',
    when: (c) => c.model.target !== undefined && ['archer', 'caster', 'leader'].includes(c.model.target.tactic ?? ''),
    done: (c) => c.model.target === undefined,
  },
  {
    id: 'lastStand',
    kind: 'concept',
    text: () => 'Last Stand: a blow that would have killed you left you on 1 HP instead. It comes back on the next floor.',
    anchor: 'player',
    when: (c) => c.state.noticed.has('lastStand'),
    done: () => false,
  },
  {
    id: 'boss',
    kind: 'concept',
    text: () => 'This is the floor boss. Defeat it to open the stairs down.',
    anchor: 'center',
    when: (c) => c.state.monsters.some((m) => m.boss && !m.creature.dead && c.state.entityVisible.get(m.creature.id) === true),
    done: (c) => c.state.mode === 'combat',
  },
];

/**
 * Decides when a hint may be shown: one at a time, once per device, never while enemies are acting, a gap between
 * hints, not at all once tips are off, and concept hints only in guided mode. Hints go away when the player does the thing.
 */
export class HintDirector {
  private showing: { def: HintDef; id: string } | null = null;
  private lastShown = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly ui: GameUi,
    private readonly prefs: Prefs,
    private readonly mode: () => HelpMode,
    private readonly now: () => number,
    private readonly gapMs = 4000,
  ) {}

  /** The id of the hint on screen, if any. */
  get current(): string | null {
    return this.showing?.id ?? null;
  }

  /** Called with fresh state: take away a hint whose thing was done, then offer the first hint that fits the moment. */
  update(c: HintContext, quiet: boolean): void {
    if (this.showing && this.showing.def.done(c)) this.clear(this.showing.id);
    if (quiet || this.showing || this.prefs.tipsOff()) return;
    if (this.now() - this.lastShown < this.gapMs) return;
    const guided = this.mode() === 'guided';
    for (const def of HINTS) {
      if (def.kind === 'concept' && !guided) continue;
      if (this.prefs.hintSeen(def.id) || !def.when(c)) continue;
      this.show(def, c);
      return;
    }
  }

  private show(def: HintDef, c: HintContext): void {
    const anchor = typeof def.anchor === 'function' ? def.anchor(c) : def.anchor;
    const req: HintRequest = { id: def.id, text: def.text(c) };
    if (def.title) req.title = def.title;
    if (anchor !== undefined) req.anchor = anchor;
    this.prefs.markHint(def.id);
    this.showing = { def, id: def.id };
    this.lastShown = this.now();
    this.ui.showHint(req, (result) => {
      if (this.showing?.id === def.id) this.showing = null;
      if (result === 'tipsOff') this.prefs.setTipsOff(true);
    });
  }

  /** Show a one-off hint that does not come from the state rules (the hub's). Same filters apply. */
  offer(def: { id: string; kind: 'control' | 'concept'; text: string; anchor?: HintRequest['anchor'] }, ignoreGap = false): boolean {
    if (this.prefs.tipsOff() || this.prefs.hintSeen(def.id)) return false;
    // A one-off that must be seen (the lock, as it is about to open) replaces whatever hint is up; others wait their turn.
    if (this.showing && ignoreGap) this.clear(this.showing.id);
    if (this.showing) return false;
    if (def.kind === 'concept' && this.mode() !== 'guided') return false;
    if (!ignoreGap && this.now() - this.lastShown < this.gapMs) return false;
    this.prefs.markHint(def.id);
    this.showing = { def: { id: def.id, kind: def.kind, text: () => def.text, when: () => true, done: () => false }, id: def.id };
    this.lastShown = this.now();
    const req: HintRequest = { id: def.id, text: def.text };
    if (def.anchor !== undefined) req.anchor = def.anchor;
    this.ui.showHint(req, (result) => {
      if (this.showing?.id === def.id) this.showing = null;
      if (result === 'tipsOff') this.prefs.setTipsOff(true);
    });
    return true;
  }

  clear(id: string): void {
    if (this.showing?.id !== id) return;
    this.showing = null;
    this.ui.clearHint(id);
  }

  /** Forget the hint on screen without telling the UI (the floor changed). */
  reset(): void {
    if (this.showing) this.ui.clearHint(this.showing.id);
    this.showing = null;
  }
}
