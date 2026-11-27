import type { GameAudio } from '../audio';
import { THEMES } from '../core/themes';
import type { HubIntent, HubModel, ItemDef, PlayerCharacter, GameUi } from '../core/types';
import {
  applyLevelUp,
  buyItem,
  computeAc,
  equipItem,
  floorReward,
  getCreationOptions,
  getItem,
  longRest,
  previewLevelUp,
  shopStock,
} from '../rules';
import { defaultLevelChoices } from './quickBuild';
import { floorTheme } from './runPlan';

/** Mutable hub state: the character as the player shapes it between floors. */
export class HubFlow {
  pc: PlayerCharacter;
  private levelTaken = false;
  private readonly classNames = new Map(getCreationOptions().classes.map((c) => [c.id, c.name]));
  private readonly speciesNames = new Map(getCreationOptions().species.map((s) => [s.id, s.name]));

  /** `cleared` is the floor just finished: it grants the long rest and the gold. */
  constructor(
    character: PlayerCharacter,
    private readonly cleared: number,
    private readonly audio: GameAudio,
    private readonly runSeed: number,
  ) {
    this.pc = { ...longRest(character) };
    this.pc.gold = Math.round((this.pc.gold + floorReward(cleared)) * 100) / 100;
  }

  get nextDepth(): number {
    return this.cleared + 1;
  }

  model(): HubModel {
    const pc = this.pc;
    const ids = new Set<string>(pc.inventory.map((s) => s.itemId));
    for (const id of Object.values(pc.equipped)) if (id) ids.add(id);
    const items: Record<string, ItemDef> = {};
    for (const id of ids) {
      const item = getItem(id);
      if (item) items[id] = item;
    }
    const model: HubModel = {
      nextDepth: this.nextDepth,
      nextThemeName: THEMES[floorTheme(this.runSeed, this.nextDepth)].name,
      character: pc,
      items,
      characterSummary: {
        name: pc.build.name,
        className: this.classNames.get(pc.build.classId) ?? pc.build.classId,
        speciesName: this.speciesNames.get(pc.build.speciesId) ?? pc.build.speciesId,
        ac: computeAc(pc),
      },
      shop: shopStock(this.nextDepth).map((item) => ({ item, price: item.cost, affordable: pc.gold >= item.cost })),
    };
    const preview = this.levelTaken ? null : previewLevelUp(pc);
    if (preview) model.levelUp = preview;
    return model;
  }

  handle(intent: HubIntent): HubModel {
    try {
      switch (intent.type) {
        case 'confirmLevelUp':
          if (!this.levelTaken && previewLevelUp(this.pc)) {
            this.pc = applyLevelUp(this.pc, intent.choices);
            this.levelTaken = true;
            this.audio.play('levelUp');
          }
          break;
        case 'buy':
          this.pc = buyItem(this.pc, intent.itemId);
          this.audio.play('coins');
          break;
        case 'equip':
          this.pc = equipItem(this.pc, intent.itemId);
          this.audio.play('uiConfirm');
          break;
        case 'descend':
          break;
      }
    } catch (err) {
      this.audio.play('uiError');
      console.warn('Hub action rejected', intent, err);
    }
    return this.model();
  }

  /** Make sure a pending level-up is taken (default choices) before descending. */
  settle(): PlayerCharacter {
    if (!this.levelTaken && previewLevelUp(this.pc)) {
      this.pc = applyLevelUp(this.pc, defaultLevelChoices(this.pc));
      this.levelTaken = true;
    }
    return this.pc;
  }
}

/** Show the hub (or, headless, take the level-up and descend). Returns the character that leaves it. */
export async function runHub(
  ui: GameUi,
  audio: GameAudio,
  character: PlayerCharacter,
  clearedDepth: number,
  headless: boolean,
  runSeed: number,
): Promise<PlayerCharacter> {
  const hub = new HubFlow(character, clearedDepth, audio, runSeed);
  if (!headless) await ui.showHub(hub.model(), (intent) => hub.handle(intent));
  return hub.settle();
}
