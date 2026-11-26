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
  ruin: {
    id: 'ruin',
    name: 'The Overgrown Ruin',
    tagline: 'Roofless halls under open sky, and a forest that has taken them back.',
  },
  hell: {
    id: 'hell',
    name: 'The Hell-touched Vault',
    tagline: 'Red stone, chained doors, and a heat that is not from any fire.',
  },
  lair: {
    id: 'lair',
    name: "The Dragon's Lair",
    tagline: 'Scorched rock, old bones, and gold enough to be worth all twenty floors.',
  },
  forest: {
    id: 'forest',
    name: 'The Wildwood',
    tagline: 'Clearings between old trees, and paths that were not made by people.',
  },
  marsh: {
    id: 'marsh',
    name: 'The Drowned Fen',
    tagline: 'Islands of mud in standing water, reeds higher than your head, lights that move.',
  },
  peaks: {
    id: 'peaks',
    name: 'The Windswept Heights',
    tagline: 'Ledges and rope bridges over a long drop, and a wind that wants you off them.',
  },
};

export const TOTAL_FLOORS = 20;

/**
 * Outdoor themes that are not on the fixed run: each can stand in for a floor in the depth range
 * given (inclusive) once runs are randomized. Until then they are reachable only from the dev
 * preview pages. Their monsters span that range.
 */
export const ALTERNATE_THEMES: Partial<Record<ThemeId, [minDepth: number, maxDepth: number]>> = {
  forest: [1, 10],
  marsh: [3, 14],
  peaks: [5, 18],
};

/** Every theme that may be used for a floor: the fixed run's theme first, then any alternates. */
export function themesForDepth(depth: number): ThemeId[] {
  const out: ThemeId[] = [themeForDepth(depth)];
  for (const [id, range] of Object.entries(ALTERNATE_THEMES) as Array<[ThemeId, [number, number]]>) {
    if (depth >= range[0] && depth <= range[1] && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Floors playable in the current milestone. */
export const MILESTONE_FLOORS = 3;

const THEME_ORDER: ThemeId[] = ['warrens', 'crypt', 'depths'];

/** Which theme a floor uses. Deterministic; more themes slot in here as they are built. */
export function themeForDepth(depth: number): ThemeId {
  // Every floor from 1 to 20 has its own theme; anything outside that range is clamped into it.
  const d = Math.max(1, Math.min(TOTAL_FLOORS, Math.floor(depth) || 1));
  if (d <= 3) return THEME_ORDER[d - 1] as ThemeId;
  if (d <= 5) return 'sewers';
  if (d <= 7) return 'fungal';
  if (d <= 9) return 'hold';
  if (d <= 11) return 'library';
  if (d <= 13) return 'foundry';
  if (d <= 15) return 'ice';
  if (d <= 17) return 'ruin';
  if (d <= 19) return 'hell';
  return 'lair';
}
