import type { GameAudio } from '../audio';
import { THEMES } from '../core/themes';
import { COMPANION_JOIN_LEVEL } from '../core/types';
import type { CompanionState, HubIntent, HubModel, ItemDef, PlayerCharacter, GameUi } from '../core/types';
import {
  applyLevelUp,
  buyItem,
  canEquip,
  companionLongRest,
  companionOptions,
  computeAc,
  equipItem,
  floorReward,
  getCreationOptions,
  getCompanion,
  getItem,
  longRest,
  migrateEquipment,
  newCompanionState,
  previewLevelUp,
  shopStock,
} from '../rules';
import { defaultCompanionId } from './party';
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
    /** Tells the player what an equip did (the hub has no confirm dialog). */
    private readonly notify: (text: string) => void = () => undefined,
    /** The companion that travelled with the hero, if any. */
    companion?: CompanionState,
  ) {
    this.pc = { ...longRest(migrateEquipment(character)) };
    this.pc.gold = Math.round((this.pc.gold + floorReward(cleared)) * 100) / 100;
    if (companion && getCompanion(companion.id)) this.companion = { ...companion };
    this.restCompanion();
  }

  /** The travelling companion: rested at every hub visit, sized for the hero's level. */
  companion: CompanionState | undefined;

  /** The level the hero will have on the next floor (a level-up still to take counts). */
  private get nextLevel(): number {
    return this.pc.level + (!this.levelTaken && previewLevelUp(this.pc) ? 1 : 0);
  }

  /** A hub visit is a long rest for the companion too, after the level-up (so it is sized for the new level). */
  private restCompanion(): void {
    const c = this.companion;
    const def = c ? getCompanion(c.id) : undefined;
    if (c && def) this.companion = companionLongRest(c, def, this.pc.level);
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
    if (this.nextLevel >= COMPANION_JOIN_LEVEL) {
      model.companions = { options: companionOptions(this.nextLevel), chosenId: this.companion?.id ?? null, required: !this.companion };
    }
    return model;
  }

  handle(intent: HubIntent): HubModel {
    try {
      switch (intent.type) {
        case 'confirmLevelUp':
          if (!this.levelTaken && previewLevelUp(this.pc)) {
            this.pc = applyLevelUp(this.pc, intent.choices);
            this.levelTaken = true;
            this.restCompanion();
            this.audio.play('levelUp');
          }
          break;
        case 'buy':
          this.pc = buyItem(this.pc, intent.itemId);
          this.audio.play('coins');
          break;
        case 'equip':
          {
            const check = canEquip(this.pc, intent.itemId);
            if (!check.ok) {
              this.audio.play('uiError');
              this.notify(check.reason ?? 'You cannot equip that');
              break;
            }
            this.pc = equipItem(this.pc, intent.itemId);
            this.audio.play('uiConfirm');
            if (check.reason) this.notify(check.reason);
            else if (check.unequips) this.notify(`${getItem(check.unequips)?.name ?? check.unequips} is put away.`);
          }
          break;
        case 'chooseCompanion': {
          const def = getCompanion(intent.id);
          if (!def) throw new Error(`Unknown companion: ${intent.id}`);
          if (this.companion?.id !== def.id) {
            // A swap arrives at full health, in the stance the player had chosen.
            const fresh = newCompanionState(def.id, this.nextLevel);
            if (this.companion) fresh.stance = this.companion.stance;
            this.companion = fresh;
            this.audio.play('uiConfirm');
          }
          break;
        }
        case 'descend':
          break;
      }
    } catch (err) {
      this.audio.play('uiError');
      console.warn('Hub action rejected', intent, err);
      // Show why (an incomplete set of level-up choices, say) instead of failing silently.
      this.notify(err instanceof Error ? err.message : String(err));
    }
    return this.model();
  }

  /**
   * Make sure a pending level-up is taken (suggested choices) and a companion is chosen when one is due, before
   * descending. After this the hero can always go down: nothing the player left unfinished can block the run.
   */
  settle(): PlayerCharacter {
    if (!this.levelTaken && previewLevelUp(this.pc)) {
      this.pc = applyLevelUp(this.pc, defaultLevelChoices(this.pc));
      this.levelTaken = true;
      this.restCompanion();
    }
    if (!this.companion && this.nextLevel >= COMPANION_JOIN_LEVEL) {
      this.companion = newCompanionState(defaultCompanionId(this.runSeed), this.nextLevel);
    }
    return this.pc;
  }
}

/** Show the hub (or, headless, take the level-up and descend). Returns the hero and companion that leave it. */
export async function runHub(
  ui: GameUi,
  audio: GameAudio,
  character: PlayerCharacter,
  clearedDepth: number,
  headless: boolean,
  runSeed: number,
  companion?: CompanionState,
): Promise<{ pc: PlayerCharacter; companion?: CompanionState }> {
  const hub = new HubFlow(character, clearedDepth, audio, runSeed, (text) => ui.banner('Hub', text), companion);
  if (!headless) await ui.showHub(hub.model(), (intent) => hub.handle(intent));
  const pc = hub.settle();
  return hub.companion ? { pc, companion: hub.companion } : { pc };
}
