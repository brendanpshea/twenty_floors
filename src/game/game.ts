import { MILESTONE_FLOORS } from '../core/themes';
import { createCharacter, getCreationOptions } from '../rules';
import { runBot } from './autoplay';
import type { BotResult } from './autoplay';
import type { GameDeps, RunState } from './deps';
import { SHORT_RESTS_PER_FLOOR } from './deps';
import { FloorSession } from './floorSession';
import { runHub } from './hubFlow';
import { quickCharacter } from './quickBuild';
import { devStartDepth, isDevStart } from './runPlan';
import { deleteSave, loadQuality, loadSave, runFromSave, writeSave } from './save';

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
      await this.playRun({
        runSeed: options.seed ?? this.deps.newSeed(),
        depth,
        pc: quickCharacter(depth),
        shortRestsLeft: SHORT_RESTS_PER_FLOOR,
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
      } else {
        const build = await ui.showCreation(getCreationOptions());
        let pc;
        try {
          pc = createCharacter(build);
        } catch (err) {
          // The creation screen handed over an invalid build: report it and go back to the title.
          console.error('Invalid character build', build, err);
          ui.banner('That character is not valid', err instanceof Error ? err.message : undefined);
          continue;
        }
        run = {
          runSeed: options.seed ?? this.deps.newSeed(),
          depth: 1,
          pc,
          shortRestsLeft: SHORT_RESTS_PER_FLOOR,
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
        run = runFromSave(save);
        continue;
      }
      // Floor cleared.
      session.dispose();
      if (run.depth >= MILESTONE_FLOORS) {
        await ui.showVictory({ floorsCleared: run.depth });
        deleteSave(storage);
        return 'victory';
      }
      const pc = await runHub(ui, this.deps.audio, outcome.pc, run.depth, options.autoplay === true && options.headless === true, run.runSeed);
      run = { runSeed: run.runSeed, depth: run.depth + 1, pc, shortRestsLeft: SHORT_RESTS_PER_FLOOR };
    }
  }
}
