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
};

export const TOTAL_FLOORS = 20;

/** Floors playable in the current milestone. */
export const MILESTONE_FLOORS = 3;

const THEME_ORDER: ThemeId[] = ['warrens', 'crypt', 'depths'];

/** Which theme a floor uses. Deterministic; more themes slot in here as they are built. */
export function themeForDepth(depth: number): ThemeId {
  // Floors 4 and 5 are the sewers, 6 and 7 the fungal caverns; deeper floors reuse the first three until their themes are built.
  if (depth === 4 || depth === 5) return 'sewers';
  if (depth === 6 || depth === 7) return 'fungal';
  return THEME_ORDER[(depth - 1) % THEME_ORDER.length] as ThemeId;
}
