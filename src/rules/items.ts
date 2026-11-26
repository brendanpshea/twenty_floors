import { ITEMS } from '../data/items';
import type { ItemDef } from '../core/types';

/**
 * The item catalog the rules read from. Defaults to the real data; tests swap
 * in their own with setItemCatalog so they never depend on data contents.
 */
let catalog: readonly ItemDef[] = ITEMS;

export function setItemCatalog(items: readonly ItemDef[]): void {
  catalog = items;
}

export function resetItemCatalog(): void {
  catalog = ITEMS;
}

export function itemCatalog(): readonly ItemDef[] {
  return catalog;
}

export function getItem(id: string): ItemDef | undefined {
  return catalog.find((i) => i.id === id);
}

export function requireItem(id: string): ItemDef {
  const item = getItem(id);
  if (!item) throw new Error(`Unknown item: ${id}`);
  return item;
}
