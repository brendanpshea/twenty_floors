import { ITEMS } from '../data/items';
import { MAGIC_ITEMS } from '../data/magicItems';
import type { ItemDef } from '../core/types';

/**
 * The item catalog the rules read from. Defaults to the real data; tests swap
 * in their own with setItemCatalog so they never depend on data contents.
 */
/** The real catalog: the mundane and +N items of data/items plus the magic items of data/magicItems. */
const DEFAULT_CATALOG: readonly ItemDef[] = [...ITEMS, ...MAGIC_ITEMS];
let catalog: readonly ItemDef[] = DEFAULT_CATALOG;

export function setItemCatalog(items: readonly ItemDef[]): void {
  catalog = items;
}

export function resetItemCatalog(): void {
  catalog = DEFAULT_CATALOG;
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
