import type { ThemeId } from './types';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  tagline: string;
}

export const THEMES: Record<ThemeId, ThemeInfo> = {
  warrens: {
    id: 'warrens',
    name: 'The Goblin Warrens',
    tagline: 'Twisting tunnels, low ceilings, and too many eyes in the dark.',
  },
  crypt: {
    id: 'crypt',
    name: 'The Forgotten Crypt',
    tagline: 'Ordered halls of the dead, who do not all lie still.',
  },
  depths: {
    id: 'depths',
    name: 'The Sundered Depths',
    tagline: 'Broken stone platforms and narrow bridges over a bottomless dark.',
  },
  sewers: {
    id: 'sewers',
    name: 'The Flooded Sewers',
    tagline: 'Brick tunnels, black water to the knee, and things that like it that way.',
  },
  fungal: {
    id: 'fungal',
    name: 'The Fungal Caverns',
    tagline: 'Pale light from a thousand caps, webs between the stalks, and spores on every breath.',
  },
  hold: {
    id: 'hold',
    name: 'The Bandit Hold',
    tagline: 'Timber halls, stolen banners, and a garrison that was expecting someone.',
  },
  library: {
    id: 'library',
    name: 'The Sunken Library',
    tagline: 'Drowned stacks, cold lamplight, and readers who never left.',
  },
  foundry: {
    id: 'foundry',
    name: 'The Foundry',
    tagline: 'Forge-islands over a river of slag, and the things that were made here.',
  },
  ice: {
    id: 'ice',
    name: 'The Ice Caves',
    tagline: 'Blue ice, black water under it, and a cold that hunts.',
  },
};

export const TOTAL_FLOORS = 20;

/** Floors playable in the current milestone. */
export const MILESTONE_FLOORS = 3;

const THEME_ORDER: ThemeId[] = ['warrens', 'crypt', 'depths'];

/** Which theme a floor uses. Deterministic; more themes slot in here as they are built. */
export function themeForDepth(depth: number): ThemeId {
  // Floors 4 and 5 are the sewers, 6 and 7 the fungal caverns, 8 and 9 the bandit hold, 10 and 11 the sunken library, 12 and 13 the foundry, 14 and 15 the ice caves; deeper floors reuse the first three until their themes are built.
  if (depth === 4 || depth === 5) return 'sewers';
  if (depth === 6 || depth === 7) return 'fungal';
  if (depth === 8 || depth === 9) return 'hold';
  if (depth === 10 || depth === 11) return 'library';
  if (depth === 12 || depth === 13) return 'foundry';
  if (depth === 14 || depth === 15) return 'ice';
  return THEME_ORDER[(depth - 1) % THEME_ORDER.length] as ThemeId;
}
