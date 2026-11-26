import type { GameEvent } from '../core/types';

/** Bookkeeping conditions: worth a line when they start, noise when they end. */
export const QUIET_CONDITIONS: ReadonlySet<string> = new Set(['dodging', 'disengaged']);

const ABILITY_NAMES = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' } as const;

function signed(n: number): string {
  return n >= 0 ? `+ ${n}` : `- ${Math.abs(n)}`;
}

/**
 * One readable log line for an event, with the dice shown, or null when the
 * event needs no line of its own. `nameOf` resolves creature ids.
 */
export function logLine(e: GameEvent, nameOf: (id: string) => string): string | null {
  switch (e.type) {
    case 'roundStart':
      return e.round > 1 ? `Round ${e.round}.` : null;
    case 'attackRoll': {
      const prefix = e.reaction ? 'Opportunity attack: ' : '';
      const rolled =
        e.dice.length > 1
          ? `rolls ${e.dice.join(' and ')} (${e.mode}), takes ${e.d20}: `
          : '';
      const verdict =
        e.outcome === 'crit'
          ? 'critical hit!'
          : e.outcome === 'hit'
            ? 'hit.'
            : e.outcome === 'fumble'
              ? 'natural 1, miss.'
              : 'miss.';
      return `${prefix}${nameOf(e.attackerId)} attacks ${nameOf(e.targetId)} with ${e.actionName}: ${rolled}${e.d20} ${signed(e.bonus)} = ${e.total} vs AC ${e.targetAc} — ${verdict}`;
    }
    case 'saveRoll':
      return `${nameOf(e.creatureId)} rolls a ${ABILITY_NAMES[e.ability]} save: ${e.d20} ${signed(e.bonus)} = ${e.total} vs DC ${e.dc} — ${e.success ? 'success' : 'fail'}.`;
    case 'damage': {
      const mod =
        e.modifier === 'resisted' ? ' (resisted)' : e.modifier === 'vulnerable' ? ' (vulnerable)' : e.modifier === 'immune' ? ' (immune)' : '';
      const crit = e.crit ? ' (critical)' : '';
      const down = e.hpAfter <= 0 ? ` ${nameOf(e.targetId)} drops to 0 HP.` : '';
      return `${nameOf(e.targetId)} takes ${e.amount} ${e.damageType} damage${mod}${crit}.${down}`;
    }
    case 'heal':
      return `${nameOf(e.targetId)} regains ${e.amount} hit points.`;
    case 'conditionAdded':
      return `${nameOf(e.creatureId)} is ${e.condition}.`;
    case 'conditionRemoved':
      if (QUIET_CONDITIONS.has(e.condition)) return null;
      return `${nameOf(e.creatureId)} is no longer ${e.condition}.`;
    case 'death':
      return `${nameOf(e.creatureId)} is defeated.`;
    case 'log':
      return e.text;
    default:
      return null;
  }
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
