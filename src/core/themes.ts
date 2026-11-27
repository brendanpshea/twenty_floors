import { Rng, hashSeed } from './rng';
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

/** Floors from 1 that always use the fixed run's themes; they are tuned on those themes. */
export const FIXED_THEME_FLOORS = 3;

/** Floors in a normal run. */
export const MILESTONE_FLOORS = 20;

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

/**
 * The floors each theme may turn up on in a randomized run: the depths its monsters and bosses
 * can carry. The fixed run's own floors are always inside the range.
 */
export const THEME_RANGE: Record<ThemeId, [minDepth: number, maxDepth: number]> = {
  warrens: [1, 4],
  forest: [1, 8],
  crypt: [1, 7],
  depths: [2, 9],
  sewers: [3, 9],
  marsh: [3, 11],
  fungal: [4, 10],
  hold: [5, 13],
  peaks: [5, 16],
  library: [7, 15],
  foundry: [9, 17],
  ice: [10, 18],
  ruin: [12, 19],
  hell: [15, 19],
  lair: [20, 20],
};

export interface RunPlanOptions {
  /**
   * Floors from 1 that keep the fixed run's themes. Floors 1 to 3 are tuned against the real
   * engine on those themes, so the default leaves them alone; 0 randomizes the whole run.
   */
  fixedFloors?: number;
}

/**
 * The themes of a randomized run, one per floor (index 0 is floor 1). Deterministic in the run
 * seed. A theme stays for one or two floors, is never used twice, only turns up on floors inside
 * its THEME_RANGE, and the last floor is always the lair.
 */
export function planRunThemes(runSeed: number, opts: RunPlanOptions = {}): ThemeId[] {
  const fixed = Math.max(0, Math.min(TOTAL_FLOORS, opts.fixedFloors ?? FIXED_THEME_FLOORS));
  const ids = (Object.keys(THEME_RANGE) as ThemeId[]).filter((id) => id !== 'lair');
  const fits = (id: ThemeId, d: number): boolean => THEME_RANGE[id][0] <= d && THEME_RANGE[id][1] >= d;
  // Draw a run floor by floor; a draw that paints itself into a corner is thrown away and redrawn.
  for (let attempt = 0; attempt < 200; attempt++) {
    const rng = new Rng(hashSeed(runSeed, `themes:${attempt}`));
    const out: ThemeId[] = [];
    for (let d = 1; d <= fixed; d++) out.push(themeForDepth(d));
    const used = new Set<ThemeId>(out);
    let stuck = false;
    while (out.length < TOTAL_FLOORS - 1) {
      const d = out.length + 1;
      const open = ids.filter((id) => !used.has(id) && fits(id, d));
      if (open.length === 0) {
        stuck = true;
        break;
      }
      // Themes about to run out of floors are favoured, so the deep floors keep their choices.
      const soonest = Math.min(...open.map((id) => THEME_RANGE[id][1]));
      const urgent = open.filter((id) => THEME_RANGE[id][1] <= soonest + 3);
      const id = urgent[rng.int(0, urgent.length - 1)] as ThemeId;
      used.add(id);
      out.push(id);
      if (d + 1 < TOTAL_FLOORS && fits(id, d + 1) && rng.chance(0.6)) out.push(id);
    }
    if (stuck) continue;
    out.push('lair');
    return out;
  }
  // No draw worked (not seen in practice): the fixed run.
  return Array.from({ length: TOTAL_FLOORS }, (_, k) => themeForDepth(k + 1));
}
