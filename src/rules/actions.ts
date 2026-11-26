import type { ActionDef } from '../core/types';

/** The three standard actions every creature has. */
export function dashAction(): ActionDef {
  return {
    id: 'dash',
    name: 'Dash',
    description: 'Gain extra movement equal to your speed this turn.',
    icon: 'dash',
    cost: 'action',
    targeting: { kind: 'self' },
    effects: ['dash'],
  };
}

export function disengageAction(): ActionDef {
  return {
    id: 'disengage',
    name: 'Disengage',
    description: 'Your movement does not provoke opportunity attacks this turn.',
    icon: 'disengage',
    cost: 'action',
    targeting: { kind: 'self' },
    effects: ['disengage'],
  };
}

export function dodgeAction(): ActionDef {
  return {
    id: 'dodge',
    name: 'Dodge',
    description: 'Attacks against you have disadvantage and you have advantage on Dexterity saves until your next turn.',
    icon: 'dodge',
    cost: 'action',
    targeting: { kind: 'self' },
    effects: ['dodge'],
  };
}

/** Aggressive trait: a bonus-action dash. */
export function aggressiveAction(): ActionDef {
  return {
    id: 'aggressive',
    name: 'Aggressive',
    description: 'Bonus action: move up to your speed toward an enemy.',
    icon: 'dash',
    cost: 'bonus',
    targeting: { kind: 'self' },
    effects: ['aggressive'],
  };
}

export function standardActions(): ActionDef[] {
  return [dashAction(), disengageAction(), dodgeAction()];
}
