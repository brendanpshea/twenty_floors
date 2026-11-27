import type { CombatApi, CompanionStance, GameEvent, NavGrid } from '../core/types';
import { runAiTurn, runTurnWith } from './ai';
import { heroLastTarget, runCompanionTurn } from './companionAi';
import { playerPolicy, type PolicyFn } from './sim';

/**
 * Plays whole turns for a hero, a companion and monsters in one combat: the scripted hero policy for 'player', the
 * companion AI (with the stance and the hero's last target) for 'companion', the monster AI for everyone else.
 * The game plays the hero from the UI and can use this for the other two sides in the same way:
 *
 *   while (!combat.isOver) {
 *     if (combat.activeId === 'player') ... wait for the player, then feed the events to driver.noteHeroEvents(events)
 *     else events.push(...driver.playTurn(combat, nav));
 *   }
 */
export interface PartyDriver {
  stance: CompanionStance;
  /** The hero's last target, updated from the hero's events. */
  focusTargetId: string | undefined;
  /** Record events from the hero's actions (keeps `focusTargetId` current for the 'focus' stance). */
  noteHeroEvents(events: GameEvent[]): void;
  /** Play the active creature's whole turn (the hero with `policy`, the companion, or a monster). */
  playTurn(combat: CombatApi, nav: NavGrid): GameEvent[];
}

export function createPartyDriver(stance: CompanionStance = 'close', policy: PolicyFn = playerPolicy): PartyDriver {
  const driver: PartyDriver = {
    stance,
    focusTargetId: undefined,
    noteHeroEvents(events) {
      const t = heroLastTarget(events);
      if (t !== undefined) driver.focusTargetId = t;
    },
    playTurn(combat, nav) {
      let events: GameEvent[];
      if (combat.activeId === 'player') {
        events = runTurnWith(combat, (c) => policy(c, nav));
        driver.noteHeroEvents(events);
      } else if (combat.activeId === 'companion') {
        events = runCompanionTurn(combat, nav, driver.stance, driver.focusTargetId);
      } else {
        events = runAiTurn(combat, nav);
      }
      return events;
    },
  };
  return driver;
}
