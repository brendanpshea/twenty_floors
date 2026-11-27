import type { HubItemNote, ItemDef, PlayerCharacter } from '../core/types';
import { QUICK_SLOTS } from '../core/types';
import { attunementStatus, canAttune, canEquip, quickSlotIds } from './character';
import { compareItem } from './compare';
import { describeEffectLine } from './describe';
import { getItem } from './items';
import { timedEffects } from './passives';
import { getSpell } from './spells';

const spellName = (id: string): string => getSpell(id)?.name ?? id;

/** Plain lines for what an item does (passives, granted spells, the effect of a timed consumable). */
export function itemEffectLines(item: ItemDef): string[] {
  const lines = (item.passives ?? []).map((p) => describeEffectLine(p, spellName)).filter((t) => t !== '');
  const c = item.consumable;
  if (c?.effect === 'heal') lines.push(`Heals ${c.dice}`);
  if (c?.effect === 'timed') {
    lines.push(`Lasts ${c.fights === 1 ? 'this fight' : `${c.fights} fights`}`);
    if (c.hover) lines.push('Narrow flight');
    for (const p of c.passives) {
      const t = describeEffectLine(p, spellName);
      if (t) lines.push(t);
    }
  }
  if (item.magicBonus) lines.push(`${item.magicBonus > 0 ? '+' : ''}${item.magicBonus} to hit and damage or AC`);
  return lines;
}

/**
 * What the pack screen needs for every item the hero owns, beyond the ItemDef (the UI shows it and never works it out):
 * effects, where it is worn, whether it can be put on (and why not), attunement, and a comparison with what is worn now.
 */
export function hubItemNotes(pc: PlayerCharacter): Record<string, HubItemNote> {
  const out: Record<string, HubItemNote> = {};
  const worn = Object.entries(pc.worn ?? {}) as [NonNullable<HubItemNote['wornIn']>, string][];
  for (const stack of pc.inventory) {
    const item = getItem(stack.itemId);
    if (!item || stack.quantity <= 0) continue;
    const can = canEquip(pc, item.id);
    const attuned = (pc.attuned ?? []).includes(item.id);
    const needs = item.attunement === true;
    const wornIn = worn.find(([, id]) => id === item.id)?.[0];
    const equippedNow = Object.values(pc.equipped).includes(item.id);
    const note: HubItemNote = {
      effects: itemEffectLines(item),
      canEquip: can.ok && !equippedNow && wornIn === undefined,
      needsAttunement: needs,
      attuned,
      canAttune: canAttune(pc, item.id).ok,
      inert: needs && !attuned,
      quickable: item.consumable !== undefined,
    };
    if (wornIn) note.wornIn = wornIn;
    const reason = !can.ok ? can.reason : can.reason;
    if (reason) note.reason = reason;
    if (!note.quickable && !equippedNow && wornIn === undefined && can.ok) {
      // Compare as if the hero did not own it yet (compareItem answers "owned" otherwise).
      const without: PlayerCharacter = { ...pc, inventory: pc.inventory.map((s) => (s.itemId === item.id ? { ...s, quantity: s.quantity - 1 } : s)).filter((s) => s.quantity > 0) };
      const cmp = compareItem(without, item.id);
      if (cmp) note.compare = cmp;
    }
    out[item.id] = note;
  }
  return out;
}

/** HubModel.attunement. */
export function hubAttunement(pc: PlayerCharacter): { used: number; limit: number } {
  const a = attunementStatus(pc);
  return { used: a.used, limit: a.limit };
}

/** HubModel.quickSlots: the four slots in order, null for an empty one. */
export function hubQuickSlots(pc: PlayerCharacter): ({ itemId: string; count: number } | null)[] {
  const ids = quickSlotIds(pc);
  return Array.from({ length: QUICK_SLOTS }, (_, i) => {
    const id = ids[i];
    return id ? { itemId: id, count: pc.inventory.find((s) => s.itemId === id)?.quantity ?? 0 } : null;
  });
}

/** HudModel.player.timed: the passing effects on the hero. */
export function timedView(pc: PlayerCharacter): { name: string; fightsLeft: number; detail?: string }[] {
  return timedEffects(pc).map((t) => {
    const detail = [...(t.hover ? ['Narrow flight'] : []), ...t.passives.map((p) => describeEffectLine(p, spellName))].filter((x) => x !== '').join('; ');
    return { name: t.name, fightsLeft: t.fightsLeft, ...(detail ? { detail } : {}) };
  });
}
