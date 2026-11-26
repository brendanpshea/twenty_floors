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
};

export const TOTAL_FLOORS = 20;

/** Floors playable in the current milestone. */
export const MILESTONE_FLOORS = 3;

const THEME_ORDER: ThemeId[] = ['warrens', 'crypt', 'depths'];

/** Which theme a floor uses. Deterministic; more themes slot in here as they are built. */
export function themeForDepth(depth: number): ThemeId {
  return THEME_ORDER[(depth - 1) % THEME_ORDER.length] as ThemeId;
}
