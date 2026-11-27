import { MILESTONE_FLOORS } from '../core/themes';
import { COMPANION_JOIN_LEVEL } from '../core/types';
import type { CompanionState } from '../core/types';
import { createCharacter, getCompanion, getCreationOptions, migrateEquipment, newCompanionState } from '../rules';
import { defaultCompanionId } from './party';
import { Prefs } from './prefs';
import { runBot } from './autoplay';
import type { BotResult } from './autoplay';
import type { GameDeps, RunState } from './deps';
import { SHORT_RESTS_PER_FLOOR } from './deps';
import { FloorSession } from './floorSession';
import { runHub } from './hubFlow';
import { quickCharacter } from './quickBuild';
import { devStartDepth, isDevStart } from './runPlan';
import type { QuickOptions } from './quickBuild';
import { deleteSave, loadQuality, loadSave, runFromSave, writeSave } from './save';

/** The dev companion: the ?companion= one (or by seed, from level 4), in the ?stance= stance. */
function devCompanion(o: GameDeps['options'], level: number, seed: number): CompanionState | undefined {
  if (o.companion === 'none' || level < COMPANION_JOIN_LEVEL) return undefined;
  const id = o.companion && getCompanion(o.companion) ? o.companion : defaultCompanionId(seed);
  const state = newCompanionState(id, level);
  if (o.stance) state.stance = o.stance;
  return state;
}

/** The ?preset= ?background= ?spell= choices of a dev start. */
function devHero(o: GameDeps['options']): QuickOptions {
  const out: QuickOptions = {};
  if (o.preset) out.preset = o.preset;
  if (o.background) out.background = o.background;
  if (o.spell) out.spell = o.spell;
  return out;
}

/** The last floor of a normal run: the milestone, or the dev ?floors= (1 to 20). */
export function lastFloor(o: GameDeps['options']): number {
  if (o.floors === undefined) return MILESTONE_FLOORS;
  // The dev ?floors= can shorten a run (for testing) as well as keep the default: 1 to 20.
  return Math.max(1, Math.min(20, Math.floor(o.floors) || MILESTONE_FLOORS));
}

export type RunEnd = 'victory' | 'quit';

/**
 * The conductor: title, creation, runs, floors, hub, death and victory. All of
 * its dependencies are injected so it runs under Vitest with fakes.
 */
export class Game {
  /** The floor currently in play (or just finished, until it is replaced). */
  session: FloorSession | null = null;
  /** Result of the bot on the latest floor, when autoplay is on. */
  botDone: Promise<BotResult> | null = null;
  private stopped = false;
  private attempts = 0;

  constructor(readonly deps: GameDeps) {
    const { renderer, ui, options, storage } = deps;
    renderer.onPick((p) => this.session?.handlePick(p));
    renderer.onHover((p) => this.session?.handleHover(p));
    ui.onIntent((i) => this.session?.handleIntent(i));
    const quality = options.quality ?? loadQuality(storage);
    if (quality) renderer.setQuality(quality);
  }

  /** Keyboard input (the shell forwards keys here). */
  handleKey(key: string, shift = false): void {
    this.session?.handleKey(key, shift);
  }

  stop(): void {
    this.stopped = true;
  }

  /** Title screen loop. Dev shortcuts (?depth=, ?autoplay=) skip straight into a run. */
  async boot(): Promise<void> {
    const { options, ui, storage } = this.deps;
    if (isDevStart(options)) {
      // Dev shortcuts reach any floor, 1 to 20, whatever the milestone; normal play stops at MILESTONE_FLOORS.
      const depth = devStartDepth(options);
      const seed = options.seed ?? this.deps.newSeed();
      // ?level= sets the hero's level on its own; by default the hero is as strong as the floor expects.
      const level = Math.max(1, Math.min(20, Math.floor(options.level ?? depth)));
      const pc = quickCharacter(level, devHero(options));
      const companion = devCompanion(options, pc.level, seed);
      await this.playRun({
        runSeed: seed,
        depth,
        pc,
        shortRestsLeft: SHORT_RESTS_PER_FLOOR,
        ...(companion ? { companion } : {}),
      });
    }
    while (!this.stopped) {
      this.deps.audio.setAmbience(null);
      const save = loadSave(storage);
      const choice = await ui.showTitle({ hasSave: save !== null });
      if (this.stopped) return;
      let run: RunState;
      if (choice === 'continue' && save) {
        run = runFromSave(save);
        // An older save has no help level: use the device's.
        const saved = new Prefs(storage).help();
        if (!run.help && saved) run.help = saved;
      } else {
        const build = await ui.showCreation(getCreationOptions());
        let pc;
        try {
          pc = migrateEquipment(createCharacter(build));
        } catch (err) {
          // The creation screen handed over an invalid build: report it and go back to the title.
          console.error('Invalid character build', build, err);
          ui.banner('That character is not valid', err instanceof Error ? err.message : undefined);
          continue;
        }
        // "New to this kind of game?": asked once per new game (not for dev starts or the bot), remembered as the device default.
        const prefs = new Prefs(storage);
        const help = options.help ?? (options.autoplay ? 'standard' : await ui.showHelpChoice());
        if (!options.autoplay) prefs.setHelp(help);
        run = {
          runSeed: options.seed ?? this.deps.newSeed(),
          depth: 1,
          pc,
          shortRestsLeft: SHORT_RESTS_PER_FLOOR,
          help,
        };
      }
      await this.playRun(run);
    }
  }

  /** Play floors from `start` until the run ends. */
  async playRun(start: RunState): Promise<RunEnd> {
    const { ui, storage, options } = this.deps;
    let run = start;
    for (;;) {
      if (this.stopped) return 'quit';
      this.session?.dispose();
      const session = new FloorSession(this.deps, run, ++this.attempts);
      this.session = session;
      try {
        await session.enter();
      } catch (err) {
        console.error('Could not enter the floor', err);
        ui.setLoading(null);
        ui.banner('The floor failed to load', 'Please reload the page');
        return 'quit';
      }
      writeSave(storage, { ...run, pc: session.entryCharacter, shortRestsLeft: SHORT_RESTS_PER_FLOOR });
      if (options.autoplay) {
        this.botDone = runBot(session, { pause: (ms) => this.deps.delay(ms) }).catch((err) => {
          console.error('Bot failed', err);
          return 'stuck' as const;
        });
      }

      const outcome = await session.outcome;
      ui.hideHud();
      this.deps.audio.setAmbience(null);
      this.deps.audio.setCombat(false);
      if (outcome.type === 'abandon') {
        session.dispose();
        deleteSave(storage);
        return 'quit';
      }
      if (outcome.type === 'dead') {
        const choice = await ui.showDeath({ depth: run.depth, killedBy: outcome.killedBy });
        session.dispose();
        if (choice === 'quit') {
          deleteSave(storage);
          return 'quit';
        }
        const save = loadSave(storage);
        if (!save) return 'quit';
        // The rating is the player's, not the floor's: what they learned on the failed try stays.
        const skill = run.puzzleSkill;
        run = runFromSave(save);
        if (skill) run.puzzleSkill = skill;
        continue;
      }
      // Floor cleared.
      session.dispose();
      if (run.depth >= lastFloor(options)) {
        await ui.showVictory({ floorsCleared: run.depth });
        deleteSave(storage);
        return 'victory';
      }
      const left = await runHub(ui, this.deps.audio, outcome.pc, run.depth, options.autoplay === true && options.headless === true, run.runSeed, outcome.companion ?? run.companion);
      run = { runSeed: run.runSeed, depth: run.depth + 1, pc: left.pc, shortRestsLeft: SHORT_RESTS_PER_FLOOR, ...(run.help ? { help: run.help } : {}), ...(run.puzzleSkill ? { puzzleSkill: run.puzzleSkill } : {}) };
      if (left.companion) run.companion = left.companion;
    }
  }
}
