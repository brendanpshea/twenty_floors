import type {
  Ability,
  AbilityScores,
  BackgroundInfo,
  CharacterBuild,
  ChoiceSlot,
  ClassInfo,
  CreationOptions,
  Skill,
  SpeciesInfo,
} from '../core/types';
import {
  ABILITIES,
  ABILITY_NAMES,
  abilityMod,
  button,
  clamp,
  fmtSigned,
  h,
  prettifyId,
  rebuildPreserving,
} from './dom';
import { createIcon } from './icons';
import type { Tooltip } from './tooltip';

const STEP_LABELS = ['Species', 'Class', 'Background', 'Abilities', 'Skills', 'Name'] as const;
const LAST = STEP_LABELS.length - 1;
const NAME_MAX = 24;
const RANDOM_NAMES = [
  'Aldric',
  'Brenna',
  'Caelum',
  'Dara',
  'Edric',
  'Fenna',
  'Garrick',
  'Hale',
  'Isolde',
  'Joren',
  'Kestrel',
  'Lyra',
  'Maren',
  'Orin',
  'Petra',
  'Rowan',
  'Sable',
  'Tamsin',
  'Ulric',
  'Wren',
];

type IncreaseMode = 'twoOne' | 'oneOneOne';

interface CardSpec {
  key: string;
  title: string;
  description: string;
  bullets?: string[];
  meta?: string;
  selected: boolean;
  onPick: () => void;
  /** One-line feat summary shown under the title. */
  feat?: string;
  /** Compact card for long option lists: description clamps to two lines (full text in the tooltip). */
  compact?: boolean;
  /** When set the card cannot be picked, and this note says why. */
  disabled?: string;
}

function skillName(s: Skill): string {
  return prettifyId(s);
}

export function buildCreation(
  options: CreationOptions,
  done: (build: CharacterBuild) => void,
  tip?: Tooltip,
): HTMLElement {
  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  const stdValues = [...options.standardArray].sort((a, b) => b - a);
  const pb = options.pointBuy;

  let step = 0;
  let speciesId = '';
  let classId = options.classes.length === 1 ? (options.classes[0]?.id ?? '') : '';
  let backgroundId = '';
  let incMode: IncreaseMode = 'twoOne';
  let plus2: Ability = 'str';
  let plus1: Ability = 'dex';
  let abMode: 'standard' | 'pointbuy' = 'standard';
  const stdIdx: Record<Ability, number> = { str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 };
  const pbBase: Record<Ability, number> = { str: pb.min, dex: pb.min, con: pb.min, int: pb.min, wis: pb.min, cha: pb.min };
  /** Class skill picks only (never the background's granted skills). */
  const skills = new Set<Skill>();
  const choices: Record<string, string> = {};
  let name = '';

  const species = (): SpeciesInfo | undefined => options.species.find((s) => s.id === speciesId);
  const klass = (): ClassInfo | undefined => options.classes.find((c) => c.id === classId);
  const background = (): BackgroundInfo | undefined => options.backgrounds.find((b) => b.id === backgroundId);

  // ---------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------
  const stdScore = (a: Ability): number => stdValues[stdIdx[a]] ?? 8;
  const baseScore = (a: Ability): number => (abMode === 'standard' ? stdScore(a) : pbBase[a]);
  const costOf = (score: number): number => pb.costs[score] ?? 0;
  const pointsSpent = (): number => ABILITIES.reduce((n, a) => n + costOf(pbBase[a]), 0);
  const pointsLeft = (): number => pb.budget - pointsSpent();

  function increases(): Partial<Record<Ability, number>> {
    const bg = background();
    if (!bg) return {};
    const opts = bg.abilityOptions;
    if (incMode === 'oneOneOne') {
      const out: Partial<Record<Ability, number>> = {};
      for (const a of opts) out[a] = 1;
      return out;
    }
    const out: Partial<Record<Ability, number>> = {};
    out[plus2] = 2;
    out[plus1] = (out[plus1] ?? 0) + 1;
    return out;
  }

  function finalScores(): AbilityScores {
    const inc = increases();
    const out = {} as AbilityScores;
    for (const a of ABILITIES) out[a] = baseScore(a) + (inc[a] ?? 0);
    return out;
  }

  function grantedSkills(): Skill[] {
    return background()?.skills ?? [];
  }

  function skillPool(): Skill[] {
    const c = klass();
    if (!c) return [];
    const granted = new Set(grantedSkills());
    return c.skillChoices.from.filter((s) => !granted.has(s));
  }

  function skillNeed(): number {
    const c = klass();
    if (!c) return 0;
    return Math.min(c.skillChoices.count, skillPool().length);
  }

  function increasesValid(): boolean {
    const bg = background();
    if (!bg) return false;
    if (incMode === 'oneOneOne') return bg.abilityOptions.length >= 3;
    return plus2 !== plus1 && bg.abilityOptions.includes(plus2) && bg.abilityOptions.includes(plus1);
  }

  function choicesValid(): boolean {
    const c = klass();
    if (!c) return false;
    return slotsValid(c.choices);
  }

  function nameValid(): boolean {
    return name.trim().length > 0 && name.trim().length <= NAME_MAX;
  }

  function validStep(i: number): boolean {
    switch (i) {
      case 0:
        return !!species();
      case 1:
        return !!klass();
      case 2:
        return !!background() && increasesValid() && slotsValid(featSlots());
      case 3:
        return abMode === 'standard' ? true : pointsLeft() >= 0;
      case 4:
        return skills.size === skillNeed() && choicesValid();
      case 5:
        return nameValid();
      default:
        return false;
    }
  }

  const reachable = (i: number): boolean => {
    for (let k = 0; k < i; k++) if (!validStep(k)) return false;
    return true;
  };

  // ---------------------------------------------------------------------
  // State mutators
  // ---------------------------------------------------------------------
  function pickBackground(id: string): void {
    if (backgroundId !== id) for (const slot of featSlots()) delete choices[slot.key];
    backgroundId = id;
    const bg = background();
    if (bg) {
      plus2 = bg.abilityOptions[0] ?? 'str';
      plus1 = bg.abilityOptions[1] ?? 'dex';
      incMode = 'twoOne';
    }
    pruneSkills();
  }

  function pruneSkills(): void {
    const pool = new Set(skillPool());
    for (const s of [...skills]) if (!pool.has(s)) skills.delete(s);
  }

  function pickClass(id: string): void {
    if (classId !== id) {
      for (const slot of klass()?.choices ?? []) delete choices[slot.key];
      classId = id;
      skills.clear();
    }
  }

  function featSlots(): ChoiceSlot[] {
    return background()?.feat?.choices ?? [];
  }

  /** Where else in the same group this option is already chosen, if anywhere. */
  function takenElsewhere(slots: ChoiceSlot[], slot: ChoiceSlot, optionId: string): 'above' | 'below' | null {
    if (!slot.group) return null;
    const idx = slots.indexOf(slot);
    for (let i = 0; i < slots.length; i++) {
      const o = slots[i];
      if (!o || o === slot || o.group !== slot.group) continue;
      if (choices[o.key] === optionId) return i < idx ? 'above' : 'below';
    }
    return null;
  }

  /** Fill every unset slot with the first option not already taken in its group. */
  function fillSlots(slots: ChoiceSlot[]): void {
    for (const slot of slots) {
      const first = slot.options.find((o) => !takenElsewhere(slots, slot, o.id));
      if (first) choices[slot.key] = first.id;
    }
  }

  function slotsValid(slots: ChoiceSlot[]): boolean {
    return slots.every(
      (slot) => slot.options.some((o) => o.id === choices[slot.key]) && !takenElsewhere(slots, slot, choices[slot.key] ?? ''),
    );
  }

  function applyRecommended(): void {
    const c = klass();
    if (!c) return;
    const rec = c.recommendedAbilities;
    const order = [...ABILITIES].sort((a, b) => rec[b] - rec[a] || ABILITIES.indexOf(a) - ABILITIES.indexOf(b));
    if (abMode === 'standard') {
      order.forEach((a, i) => {
        stdIdx[a] = Math.min(i, stdValues.length - 1);
      });
    } else {
      for (const a of ABILITIES) pbBase[a] = clamp(rec[a], pb.min, pb.max);
      while (pointsLeft() < 0) {
        const top = [...ABILITIES].sort((a, b) => pbBase[b] - pbBase[a])[0];
        if (!top || pbBase[top] <= pb.min) break;
        pbBase[top] -= 1;
      }
    }
  }

  function stepStd(a: Ability, dir: 1 | -1): void {
    // dir = 1 raises the value (lower index in the descending list).
    const to = stdIdx[a] - dir;
    if (to < 0 || to >= stdValues.length) return;
    const other = ABILITIES.find((o) => o !== a && stdIdx[o] === to);
    if (other) stdIdx[other] = stdIdx[a];
    stdIdx[a] = to;
  }

  function stepPb(a: Ability, dir: 1 | -1): void {
    const next = pbBase[a] + dir;
    if (next < pb.min || next > pb.max) return;
    if (dir > 0 && costOf(next) - costOf(pbBase[a]) > pointsLeft()) return;
    pbBase[a] = next;
  }

  function quickStart(): void {
    const s = options.species[0];
    const c = options.classes[0];
    const b = options.backgrounds[0];
    if (!s || !c || !b) return;
    speciesId = s.id;
    classId = '';
    pickClass(c.id);
    pickBackground(b.id);
    abMode = 'standard';
    applyRecommended();
    for (const sk of skillPool().slice(0, skillNeed())) skills.add(sk);
    fillSlots(c.choices);
    fillSlots(featSlots());
    if (!name.trim()) name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] ?? 'Hero';
    step = LAST;
    refresh();
  }

  function build(): CharacterBuild {
    const c = klass();
    const bg = background();
    const base = {} as AbilityScores;
    for (const a of ABILITIES) base[a] = baseScore(a);
    // Only the class skill picks; the background's skills are granted by the rules engine.
    const picked = [...skills].filter((s) => !(bg?.skills ?? []).includes(s));
    return {
      name: name.trim(),
      speciesId,
      classId: c?.id ?? classId,
      backgroundId,
      baseAbilities: base,
      abilityIncreases: increases(),
      skills: picked,
      choices: { ...choices },
    };
  }

  // ---------------------------------------------------------------------
  // Shared DOM builders
  // ---------------------------------------------------------------------
  function card(spec: CardSpec): HTMLButtonElement {
    const b = h('button', `tf-card${spec.selected ? ' is-selected' : ''}${spec.compact ? ' tf-card--compact' : ''}${spec.disabled ? ' is-taken' : ''}`);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(spec.selected));
    b.dataset['key'] = spec.key;
    const head = h('div', 'tf-card-head');
    head.append(h('span', 'tf-card-glyph', spec.title.charAt(0).toUpperCase()), h('span', 'tf-card-title', spec.title));
    const tick = h('span', 'tf-card-tick');
    tick.append(createIcon('check'));
    head.append(tick);
    b.append(head);
    if (spec.meta) b.append(h('div', 'tf-card-meta', spec.meta));
    if (spec.feat) b.append(h('div', 'tf-card-feat', spec.feat));
    b.append(h('p', 'tf-card-desc', spec.description));
    if (spec.disabled) {
      b.append(h('div', 'tf-card-note', spec.disabled));
      b.setAttribute('aria-disabled', 'true');
    }
    if (spec.bullets && spec.bullets.length) {
      const ul = h('ul', 'tf-card-list');
      for (const t of spec.bullets) ul.append(h('li', undefined, t));
      b.append(ul);
    }
    if (spec.compact && tip) {
      tip.attach(b, () => ({ title: spec.title, sub: spec.disabled, body: spec.description }));
    } else if (spec.compact) {
      b.title = spec.description;
    }
    b.addEventListener('click', () => {
      if (!spec.disabled) spec.onPick();
    });
    return b;
  }

  function cardGrid(label: string, cards: HTMLElement[]): HTMLElement {
    const g = h('div', 'tf-cards');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', label);
    g.append(...cards);
    return g;
  }

  function heading(title: string, sub?: string): HTMLElement {
    const w = h('div', 'tf-step-head');
    w.append(h('h2', 'tf-step-title', title));
    if (sub) w.append(h('p', 'tf-step-sub', sub));
    return w;
  }

  function segmented<T extends string>(
    label: string,
    items: { key: T; label: string; disabled?: boolean }[],
    active: T,
    onPick: (k: T) => void,
    dataPrefix: string,
  ): HTMLElement {
    const w = h('div', 'tf-seg');
    w.setAttribute('role', 'radiogroup');
    w.setAttribute('aria-label', label);
    for (const it of items) {
      const b = h('button', `tf-seg-btn${it.key === active ? ' is-active' : ''}`, it.label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(it.key === active));
      b.dataset['key'] = `${dataPrefix}-${it.key}`;
      if (it.disabled) {
        b.disabled = true;
      }
      b.addEventListener('click', () => onPick(it.key));
      w.append(b);
    }
    return w;
  }

  function chipToggle(key: string, label: string, state: 'on' | 'off' | 'granted' | 'locked', onClick?: () => void): HTMLButtonElement {
    const b = h('button', `tf-skill is-${state}`);
    b.type = 'button';
    b.dataset['key'] = key;
    if (state === 'on') b.append(createIcon('check', 'tf-icon tf-skill-check'));
    b.append(h('span', undefined, label));
    if (state === 'granted') {
      b.disabled = true;
      b.append(h('span', 'tf-skill-tag', 'Granted'));
    } else if (state === 'locked') {
      b.setAttribute('aria-disabled', 'true');
    }
    b.setAttribute('aria-pressed', String(state === 'on' || state === 'granted'));
    if (onClick && state !== 'granted') b.addEventListener('click', onClick);
    return b;
  }

  // ---------------------------------------------------------------------
  // Step bodies
  // ---------------------------------------------------------------------
  function stepSpecies(): HTMLElement[] {
    const cards = options.species.map((s) =>
      card({
        key: `species-${s.id}`,
        title: s.name,
        description: s.description,
        bullets: s.traitSummaries,
        selected: s.id === speciesId,
        onPick: () => {
          speciesId = s.id;
          refresh();
        },
      }),
    );
    return [heading('Choose your species', 'Where your hero comes from shapes their body and their gifts.'), cardGrid('Species', cards)];
  }

  function stepClass(): HTMLElement[] {
    const cards = options.classes.map((c) =>
      card({
        key: `class-${c.id}`,
        title: c.name,
        meta: `Hit die d${c.hitDie} · Primary: ${c.primaryAbilities.map((a) => ABILITY_NAMES[a]).join(', ')}`,
        description: c.description,
        bullets: c.featureSummaries,
        selected: c.id === classId,
        onPick: () => {
          pickClass(c.id);
          refresh();
        },
      }),
    );
    return [heading('Choose your class', 'Your training decides how you fight.'), cardGrid('Class', cards)];
  }

  function stepBackground(): HTMLElement[] {
    const cards = options.backgrounds.map((b) =>
      card({
        key: `bg-${b.id}`,
        title: b.name,
        meta: `Skills: ${b.skills.map(skillName).join(', ')}`,
        description: b.description,
        bullets: [`Can raise ${b.abilityOptions.map((a) => ABILITY_NAMES[a]).join(', ')}`],
        feat: b.feat ? `${b.feat.name}: ${b.feat.summaries[0] ?? b.feat.description}` : undefined,
        selected: b.id === backgroundId,
        onPick: () => {
          pickBackground(b.id);
          refresh();
        },
      }),
    );
    const out = [
      heading('Choose your background', 'What you did before the descent. It grants skills and ability increases.'),
      cardGrid('Background', cards),
    ];
    const bg = background();
    if (bg) out.push(increasePanel(bg));
    if (bg?.feat && bg.feat.choices.length) out.push(featPanel(bg));
    return out;
  }

  function increasePanel(bg: BackgroundInfo): HTMLElement {
    const panel = h('section', 'tf-panel tf-inc');
    panel.append(h('h3', 'tf-panel-title', `${bg.name}: ability increases`));
    panel.append(
      segmented<IncreaseMode>(
        'Increase pattern',
        [
          { key: 'twoOne', label: '+2 / +1' },
          { key: 'oneOneOne', label: '+1 / +1 / +1' },
        ],
        incMode,
        (k) => {
          incMode = k;
          refresh();
        },
        'inc-mode',
      ),
    );
    const pickRow = (label: string, current: Ability, set: (a: Ability) => void, prefix: string): HTMLElement => {
      const row = h('div', 'tf-inc-row');
      row.append(h('span', 'tf-inc-label', label));
      row.append(
        segmented<Ability>(
          label,
          bg.abilityOptions.map((a) => ({ key: a, label: ABILITY_NAMES[a] })),
          current,
          (a) => {
            set(a);
            refresh();
          },
          prefix,
        ),
      );
      return row;
    };
    if (incMode === 'twoOne') {
      // Choosing the ability the other slot uses swaps the two.
      panel.append(
        pickRow(
          '+2 to',
          plus2,
          (a) => {
            if (a === plus1) plus1 = plus2;
            plus2 = a;
          },
          'inc2',
        ),
        pickRow(
          '+1 to',
          plus1,
          (a) => {
            if (a === plus2) plus2 = plus1;
            plus1 = a;
          },
          'inc1',
        ),
      );
    } else {
      panel.append(
        h('p', 'tf-hint', `Each of ${bg.abilityOptions.map((a) => ABILITY_NAMES[a]).join(', ')} gets +1.`),
      );
    }
    return panel;
  }

  function stepAbilities(): HTMLElement[] {
    const c = klass();
    const head = heading('Assign your abilities', 'Base scores plus your background increases give the final score.');
    const bar = h('div', 'tf-ab-bar');
    bar.append(
      segmented<'standard' | 'pointbuy'>(
        'Method',
        [
          { key: 'standard', label: 'Standard Array' },
          { key: 'pointbuy', label: 'Point Buy' },
        ],
        abMode,
        (k) => {
          abMode = k;
          refresh();
        },
        'mode',
      ),
    );
    const rec = button('tf-btn tf-btn--small', 'Recommended', () => {
      applyRecommended();
      refresh();
    });
    rec.dataset['key'] = 'recommended';
    rec.disabled = !c;
    bar.append(rec);

    const panel = h('section', 'tf-panel tf-ab');
    if (abMode === 'pointbuy') {
      const left = pointsLeft();
      const pts = h('div', 'tf-ab-points');
      pts.append(h('span', 'tf-ab-points-num', String(left)), h('span', undefined, ` of ${pb.budget} points left`));
      pts.classList.toggle('is-over', left < 0);
      panel.append(pts);
    } else {
      panel.append(h('p', 'tf-hint', `Values ${stdValues.join(', ')}: use + and − to trade scores between abilities.`));
    }
    const inc = increases();
    const final = finalScores();
    const table = h('div', 'tf-ab-table');
    const headRow = h('div', 'tf-ab-row tf-ab-row--head');
    for (const t of ['Ability', 'Base', 'Bonus', 'Score', 'Mod']) headRow.append(h('span', undefined, t));
    table.append(headRow);
    for (const a of ABILITIES) {
      const row = h('div', 'tf-ab-row');
      const nm = h('span', 'tf-ab-name');
      nm.append(h('strong', undefined, a.toUpperCase()), h('span', 'tf-ab-full', ABILITY_NAMES[a]));
      if (c?.primaryAbilities.includes(a)) {
        const star = h('span', 'tf-ab-primary');
        star.title = 'Primary ability for this class';
        star.append(createIcon('star', 'tf-icon'));
        star.setAttribute('aria-label', 'Primary ability');
        nm.append(star);
      }
      const ctl = h('span', 'tf-ab-ctl');
      const dec = h('button', 'tf-step-btn', '−');
      const incBtn = h('button', 'tf-step-btn', '+');
      dec.type = 'button';
      incBtn.type = 'button';
      dec.setAttribute('aria-label', `Decrease ${ABILITY_NAMES[a]}`);
      incBtn.setAttribute('aria-label', `Increase ${ABILITY_NAMES[a]}`);
      dec.dataset['key'] = `dec-${a}`;
      incBtn.dataset['key'] = `inc-${a}`;
      if (abMode === 'standard') {
        dec.disabled = stdIdx[a] >= stdValues.length - 1;
        incBtn.disabled = stdIdx[a] <= 0;
        dec.addEventListener('click', () => {
          stepStd(a, -1);
          refresh();
        });
        incBtn.addEventListener('click', () => {
          stepStd(a, 1);
          refresh();
        });
      } else {
        dec.disabled = pbBase[a] <= pb.min;
        const nextCost = costOf(pbBase[a] + 1) - costOf(pbBase[a]);
        incBtn.disabled = pbBase[a] >= pb.max || nextCost > pointsLeft();
        dec.addEventListener('click', () => {
          stepPb(a, -1);
          refresh();
        });
        incBtn.addEventListener('click', () => {
          stepPb(a, 1);
          refresh();
        });
      }
      ctl.append(dec, h('span', 'tf-ab-base', String(baseScore(a))), incBtn);
      const bonus = inc[a] ?? 0;
      const bonusEl = h('span', `tf-ab-bonus${bonus ? ' has-bonus' : ''}`, bonus ? `+${bonus}` : '–');
      const fin = h('span', 'tf-ab-final', String(final[a]));
      const mod = h('span', 'tf-ab-mod', fmtSigned(abilityMod(final[a])));
      row.append(nm, ctl, bonusEl, fin, mod);
      table.append(row);
    }
    panel.append(table);
    return [head, bar, panel];
  }

  function stepSkills(): HTMLElement[] {
    const c = klass();
    const out: HTMLElement[] = [heading('Skills and training', 'Pick the skills you are trained in and make your class choices.')];
    if (!c) return out;
    const granted = grantedSkills();
    const need = skillNeed();
    const pool = skillPool();

    const sk = h('section', 'tf-panel');
    sk.append(h('h3', 'tf-panel-title', `Class skills: choose ${need}`));
    const counter = h('span', 'tf-counter', `${skills.size} / ${need}`);
    counter.classList.toggle('is-done', skills.size === need);
    sk.firstElementChild?.append(counter);
    const wrap = h('div', 'tf-skills');
    const full = skills.size >= need;
    for (const s of pool) {
      const on = skills.has(s);
      wrap.append(
        chipToggle(`skill-${s}`, skillName(s), on ? 'on' : full ? 'locked' : 'off', () => {
          if (on) skills.delete(s);
          else if (!full) skills.add(s);
          refresh();
        }),
      );
    }
    sk.append(wrap);
    if (granted.length) {
      sk.append(h('h4', 'tf-sub-title', `From your background (${background()?.name ?? ''})`));
      const gw = h('div', 'tf-skills');
      for (const s of granted) gw.append(chipToggle(`granted-${s}`, skillName(s), 'granted'));
      sk.append(gw);
    }
    out.push(sk);

    for (const slot of c.choices) out.push(choicePanel(c.choices, slot));
    return out;
  }

  function slotCards(slots: ChoiceSlot[], slot: ChoiceSlot, compact: boolean): HTMLElement {
    const cards = slot.options.map((o) => {
      const where = takenElsewhere(slots, slot, o.id);
      return card({
        key: `choice-${slot.key}-${o.id}`,
        title: o.name,
        description: o.description,
        compact,
        selected: choices[slot.key] === o.id,
        disabled: where ? `Chosen ${where}` : undefined,
        onPick: () => {
          choices[slot.key] = o.id;
          refresh();
        },
      });
    });
    const g = cardGrid(slot.name, cards);
    if (compact) g.classList.add('tf-cards--compact');
    return g;
  }

  function choicePanel(slots: ChoiceSlot[], slot: ChoiceSlot): HTMLElement {
    const panel = h('section', 'tf-panel');
    panel.append(h('h3', 'tf-panel-title', slot.name));
    panel.append(slotCards(slots, slot, slot.options.length > 5));
    return panel;
  }

  function featPanel(bg: BackgroundInfo): HTMLElement {
    const feat = bg.feat;
    const panel = h('section', 'tf-panel tf-feat');
    if (!feat) return panel;
    const casting = feat.choices.some((s) => /spell|cantrip/i.test(s.name));
    panel.append(h('h3', 'tf-panel-title', `${feat.name} \u2014 ${casting ? 'choose your spells' : 'make your choices'}`));
    panel.append(h('p', 'tf-hint', feat.description));
    for (const slot of feat.choices) {
      panel.append(h('h4', 'tf-sub-title', slot.name), slotCards(feat.choices, slot, slot.options.length > 4));
    }
    return panel;
  }

  let nameInput: HTMLInputElement | null = null;

  function stepSummary(): HTMLElement[] {
    const c = klass();
    const sp = species();
    const bg = background();
    const out: HTMLElement[] = [heading('Name your hero', 'Last step. Check your choices, then begin the descent.')];

    const nameRow = h('div', 'tf-name-row');
    const input = h('input', 'tf-input');
    input.type = 'text';
    input.maxLength = NAME_MAX;
    input.placeholder = 'Hero name';
    input.value = name;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Hero name');
    input.dataset['key'] = 'name';
    input.addEventListener('input', () => {
      name = input.value;
      updateChrome();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && validStep(LAST)) {
        e.preventDefault();
        finish();
      }
    });
    nameInput = input;
    const dice = h('button', 'tf-iconbtn');
    dice.type = 'button';
    dice.setAttribute('aria-label', 'Random name');
    dice.title = 'Random name';
    dice.append(createIcon('dice'));
    dice.addEventListener('click', () => {
      name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] ?? 'Hero';
      input.value = name;
      updateChrome();
      input.focus();
    });
    nameRow.append(input, dice);

    const sheet = h('section', 'tf-panel tf-sheet');
    const kv = (k: string, v: string): HTMLElement => {
      const r = h('div', 'tf-kv');
      r.append(h('span', 'tf-kv-k', k), h('span', 'tf-kv-v', v));
      return r;
    };
    const left = h('div', 'tf-sheet-col');
    left.append(
      kv('Species', sp?.name ?? '–'),
      kv('Class', c?.name ?? '–'),
      kv('Background', bg?.name ?? '–'),
    );
    const chosen = [...skills, ...grantedSkills().filter((s) => !skills.has(s))];
    left.append(kv('Skills', chosen.map(skillName).join(', ') || '–'));
    if (c) {
      for (const slot of c.choices) {
        const o = slot.options.find((x) => x.id === choices[slot.key]);
        left.append(kv(slot.name, o?.name ?? '–'));
      }
    }
    const feat = bg?.feat;
    if (feat) {
      const names = feat.choices.map((slot) => slot.options.find((x) => x.id === choices[slot.key])?.name ?? '–');
      const text =
        names.length > 1
          ? `${feat.name}: ${names.slice(0, -1).join(', ')} \u2014 ${names[names.length - 1] ?? ''}`
          : names.length === 1
            ? `${feat.name}: ${names[0] ?? ''}`
            : feat.name;
      left.append(kv('Feat', text));
    }
    const right = h('div', 'tf-sheet-col');
    const final = finalScores();
    const grid = h('div', 'tf-scores');
    for (const a of ABILITIES) {
      const t = h('div', 'tf-score');
      t.append(
        h('span', 'tf-score-name', a.toUpperCase()),
        h('span', 'tf-score-val', String(final[a])),
        h('span', 'tf-score-mod', fmtSigned(abilityMod(final[a]))),
      );
      grid.append(t);
    }
    right.append(grid);
    sheet.append(left, right);
    out.push(nameRow, sheet);
    return out;
  }

  const STEP_BUILDERS: (() => HTMLElement[])[] = [
    stepSpecies,
    stepClass,
    stepBackground,
    stepAbilities,
    stepSkills,
    stepSummary,
  ];

  // ---------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------
  const root = h('div', 'tf-screen tf-screen--creation');
  const frame = h('div', 'tf-create');
  const head = h('header', 'tf-create-head');
  head.append(h('h1', 'tf-create-title', 'Create your hero'));
  const stepper = h('ol', 'tf-stepper');
  const stepBtns: HTMLButtonElement[] = STEP_LABELS.map((label, i) => {
    const li = h('li', 'tf-stepper-li');
    const b = h('button', 'tf-stepper-item');
    b.type = 'button';
    b.dataset['key'] = `step-${i}`;
    b.append(h('span', 'tf-stepper-num', String(i + 1)), h('span', 'tf-stepper-label', label));
    b.addEventListener('click', () => {
      if (i <= step || reachable(i)) {
        step = i;
        refresh();
      }
    });
    li.append(b);
    stepper.append(li);
    return b;
  });
  head.append(stepper);
  const body = h('main', 'tf-create-body');
  const foot = h('footer', 'tf-create-foot');
  const back = button('tf-btn tf-back', 'Back', () => goBack());
  const quick = button('tf-btn tf-qs', 'Quick start', () => quickStart());
  quick.title = 'Pick sensible defaults and jump to the summary';
  const next = h('button', 'tf-btn tf-btn--primary tf-next');
  next.type = 'button';
  next.addEventListener('click', () => goNext());
  const spacer = h('div', 'tf-spacer');
  foot.append(back, spacer, quick, next);
  frame.append(head, body, foot);
  root.append(frame);

  function goBack(): void {
    if (step > 0) {
      step--;
      refresh();
    }
  }

  function finish(): void {
    if (validStep(LAST) && reachable(LAST)) done(build());
  }

  function goNext(): void {
    if (!validStep(step)) return;
    if (step === LAST) finish();
    else {
      step++;
      refresh();
    }
  }

  function updateChrome(): void {
    stepBtns.forEach((b, i) => {
      const ok = i <= step || reachable(i);
      b.classList.toggle('is-current', i === step);
      b.classList.toggle('is-done', i < step && validStep(i));
      b.classList.toggle('is-locked', !ok);
      b.setAttribute('aria-disabled', String(!ok));
      if (i === step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    back.hidden = step === 0;
    quick.hidden = step !== 0;
    next.textContent = step === LAST ? 'Begin' : 'Next';
    next.disabled = !validStep(step);
    // Keep the current step visible when the stepper scrolls (phones).
    const cur = stepBtns[step];
    if (cur) {
      const li = cur.parentElement;
      if (li) stepper.scrollLeft = li.offsetLeft - (stepper.clientWidth - li.offsetWidth) / 2;
    }
  }

  function refresh(): void {
    rebuildPreserving(body, root, () => {
      body.replaceChildren(...(STEP_BUILDERS[step]?.() ?? []));
    });
    updateChrome();
  }

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && step > 0) {
      e.preventDefault();
      goBack();
    }
  });

  refresh();
  void nameInput;
  return root;
}
