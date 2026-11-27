import { SHORT_RESTS_PER_LONG_REST } from '../core/types';
import type { GameAudio } from '../audio';
import type { GameUi, PlayerCharacter, QualityLevel, Renderer3D, ThemeId } from '../core/types';

/** The slice of localStorage the game uses. */
export interface StorageLike {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface GameOptions {
  /** Fixed run seed (?seed=). */
  seed?: number;
  /** Start a quick-built Fighter directly on this floor, 1 to 20, whatever the milestone (?depth=). */
  depth?: number;
  quality?: QualityLevel;
  /** A bot plays (?autoplay=1). Implies a quick-built hero when nothing else is given. */
  autoplay?: boolean;
  /** With autoplay: resolve the hub headlessly instead of showing it. */
  headless?: boolean;
  /** No fog of war (?reveal=1). */
  reveal?: boolean;
  /** Force this theme on the dev start floor (?theme=). */
  theme?: ThemeId;
  /** Monsters are spawned but never start a fight (?peace=1). For walking and looking at a floor. */
  peace?: boolean;
}

export interface GameDeps {
  renderer: Renderer3D;
  ui: GameUi;
  audio: GameAudio;
  storage: StorageLike;
  /** Resolves after `ms` milliseconds. Tests pass an instant version. */
  delay(ms: number): Promise<void>;
  /** The only non-seeded randomness: a seed for a brand new run. */
  newSeed(): number;
  options: GameOptions;
}

/** A run in progress: what the save game holds, plus the current character. */
export interface RunState {
  runSeed: number;
  depth: number;
  pc: PlayerCharacter;
  shortRestsLeft: number;
}

export type FloorOutcome =
  | { type: 'cleared'; pc: PlayerCharacter }
  | { type: 'dead'; killedBy: string }
  | { type: 'abandon' };

export const SAVE_KEY = 'twenty-floors.save';
export const QUALITY_KEY = 'twenty-floors.quality';
export const SHORT_RESTS_PER_FLOOR = SHORT_RESTS_PER_LONG_REST;
