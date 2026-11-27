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
  // Limited-use abilities. HOUSE RULE (data convention): on a monster's action `uses.amount` is the number of uses per floor
  // ("2/Day" is 2) and each use takes 1 from the pool, so a pool is as big as the largest amount among the actions that share it.
  const resources: Record<string, ResourcePool> = {};
  for (const a of actions) {
    if (!a.uses) continue;
    const n = Math.max(1, a.uses.amount);
    const pool = resources[a.uses.resource];
    if (pool) {
      pool.current = pool.max = Math.max(pool.max, n);
    } else {
      resources[a.uses.resource] = { name: a.uses.resource, current: n, max: n, refresh: 'floor' };
    }
    a.uses = { resource: a.uses.resource, amount: 1 };
  }
  // Regeneration reuses the hidden `_regen` pool the engine reads at the start of every turn (see startTurn).
  if (def.regeneration) resources['_regen'] = { name: 'Regeneration', current: def.regeneration.amount, max: 0, refresh: 'longRest' };
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
    ...(def.auras ? { auras: def.auras.map((a) => ({ ...a })) } : {}),
    ...(def.regeneration?.stoppedBy ? { regenStoppedBy: [...def.regeneration.stoppedBy] } : {}),
    actions,
    resources,
    visual: { ...def.visual },
    dead: false,
  };
}
