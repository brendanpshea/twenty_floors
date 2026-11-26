import type { ActionDef, Creature, GridPos, MonsterDef, ResourcePool } from '../core/types';
import { CELL_FEET } from '../core/types';
import { aggressiveAction, standardActions } from './actions';
import { clone } from './util';

/** Build a combat-ready Creature from a stat block. */
export function instantiateMonster(def: MonsterDef, id: string, pos: GridPos): Creature {
  const actions: ActionDef[] = clone(def.actions);
  for (const std of standardActions()) {
    if (!actions.some((a) => a.id === std.id)) actions.push(std);
  }
  if (def.traits.includes('aggressive') && !actions.some((a) => a.id === 'aggressive')) {
    actions.push(aggressiveAction());
  }
  // Limited-use abilities: the data gives only the amount per use, so each pool holds one use per floor.
  const resources: Record<string, ResourcePool> = {};
  for (const a of actions) {
    if (a.uses && !resources[a.uses.resource]) {
      resources[a.uses.resource] = {
        name: a.uses.resource,
        current: a.uses.amount,
        max: a.uses.amount,
        refresh: 'floor',
      };
    }
  }
  return {
    id,
    defId: def.id,
    name: def.name,
    faction: 'enemy',
    pos: { x: pos.x, y: pos.y },
    size: def.size,
    level: def.cr,
    abilities: { ...def.abilities },
    proficiencyBonus: def.proficiencyBonus,
    saveProficiencies: [...def.saveProficiencies],
    ac: def.ac,
    maxHp: def.hp,
    hp: def.hp,
    tempHp: 0,
    speed: Math.round(def.speedFt / CELL_FEET),
    resistances: [...def.resistances],
    vulnerabilities: [...def.vulnerabilities],
    immunities: [...def.immunities],
    conditionImmunities: [...def.conditionImmunities],
    conditions: [],
    traits: [...def.traits],
    actions,
    resources,
    visual: { ...def.visual },
    dead: false,
  };
}
