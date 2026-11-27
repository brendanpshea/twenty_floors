import type { ChoiceSlot, HubIntent, HubModel, ItemDef } from '../core/types';
import { button, clear, h, prettifyId, rebuildPreserving } from './dom';
import { termify } from './glossary';
import { createIcon } from './icons';

/** Magic items get a subtle rarity colour; mundane items stay plain. */
function rarityClass(item: ItemDef | undefined): string {
  if (!item || item.magicBonus === undefined) return '';
  return ` tf-rar tf-rar--${item.rarity ?? 'common'}`;
}

function iconForItem(item: ItemDef): string {
  if (item.icon) return item.icon;
  switch (item.kind) {
    case 'armor':
      return 'armor';
    case 'shield':
      return 'shield';
    case 'consumable':
      return 'potion';
    default:
      return 'melee';
  }
}

function itemStat(item: ItemDef): string {
  if (item.weapon) {
    const w = item.weapon;
    const props = w.properties.length ? ` · ${w.properties.map(prettifyId).join(', ')}` : '';
    return `${w.damage.dice} ${w.damage.type}${props}`;
  }
  if (item.armor) {
    const a = item.armor;
    const dex = a.dexCap === undefined ? ' + Dex' : a.dexCap === 0 ? '' : ` + Dex (max ${a.dexCap})`;
    return `${prettifyId(a.category)} armor · AC ${a.baseAc}${dex}`;
  }
  if (item.shieldBonus !== undefined) return `Shield · +${item.shieldBonus} AC`;
  if (item.consumable?.effect === 'heal') return `Restores ${item.consumable.dice} hit points`;
  if (item.consumable?.effect === 'timed') return `Lasts ${item.consumable.fights} fight${item.consumable.fights === 1 ? '' : 's'}`;
  return '';
}

export function buildHub(
  initial: HubModel,
  send: (intent: HubIntent) => HubModel,
  done: () => void,
): HTMLElement {
  let model = initial;
  let picks: Record<string, string> = {};
  let pickFor = -1;
  let finished = false;
  let showAll = false;
  let armedSlot: number | null = null;
  const expanded = new Set<string>();

  const root = h('div', 'tf-screen tf-screen--hub');
  const frame = h('div', 'tf-hub');
  const head = h('header', 'tf-hub-head');
  const body = h('main', 'tf-hub-body');
  const foot = h('footer', 'tf-hub-foot');
  frame.append(head, body, foot);
  root.append(frame);

  function intent(i: HubIntent): void {
    if (finished) return;
    model = send(i);
    render();
  }

  function renderHead(): void {
    clear(head);
    const t = h('div', 'tf-hub-titles');
    t.append(
      h('h1', 'tf-hub-title', 'A Moment of Rest'),
      h('p', 'tf-hub-sub', `${model.characterSummary.name} rests before floor ${model.nextDepth}.`),
    );
    const gold = h('div', 'tf-gold');
    gold.setAttribute('aria-label', `${model.character.gold} gold`);
    gold.append(createIcon('coin', 'tf-icon tf-gold-icon'), h('span', 'tf-gold-num', String(model.character.gold)), h('span', 'tf-gold-label', 'gold'));
    head.append(t, gold);
  }

  function section(title: string, cls = ''): { el: HTMLElement; body: HTMLElement } {
    const el = h('section', `tf-panel tf-hub-sec ${cls}`.trim());
    el.append(h('h2', 'tf-panel-title', title));
    const b = h('div', 'tf-hub-sec-body');
    el.append(b);
    return { el, body: b };
  }

  type Taken = (slot: ChoiceSlot, optionId: string) => 'above' | 'below' | null;

  /** Up to six options: cards. */
  function cardPicker(slot: ChoiceSlot, taken: Taken): HTMLElement {
    const g = h('div', 'tf-cards tf-cards--compact');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', slot.name);
    for (const o of slot.options) {
      const on = picks[slot.key] === o.id;
      const where = taken(slot, o.id);
      const c = h('button', `tf-card${on ? ' is-selected' : ''}${where ? ' is-taken' : ''}`);
      c.type = 'button';
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', String(on));
      if (where) c.setAttribute('aria-disabled', 'true');
      c.dataset['key'] = `lu-${slot.key}-${o.id}`;
      const hd = h('div', 'tf-card-head');
      const tick = h('span', 'tf-card-tick');
      tick.append(createIcon('check'));
      hd.append(h('span', 'tf-card-title', o.name), tick);
      const dsc = h('p', 'tf-card-desc');
      dsc.append(termify(o.description));
      c.append(hd, dsc);
      if (where) c.append(h('div', 'tf-card-note', `Chosen ${where}`));
      c.addEventListener('click', () => {
        if (where) return;
        picks[slot.key] = o.id;
        render();
      });
      g.append(c);
    }
    return g;
  }

  /** More than six options: a searchable, scrollable list of 44 px rows with the chosen option described below. */
  function listPicker(slot: ChoiceSlot, taken: Taken): HTMLElement {
    const wrap = h('div', 'tf-picker');
    const rows: { el: HTMLButtonElement; name: string }[] = [];
    if (slot.options.length > 12) {
      const input = h('input', 'tf-input tf-picker-search');
      input.type = 'search';
      input.placeholder = `Search ${slot.options.length} options`;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('aria-label', `Search ${slot.name}`);
      input.dataset['key'] = `lu-search-${slot.key}`;
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        let shown = 0;
        for (const r of rows) {
          const match = q === '' || r.name.includes(q);
          r.el.hidden = !match;
          if (match) shown++;
        }
        empty.hidden = shown > 0;
      });
      wrap.append(input);
    }
    const list = h('div', 'tf-picker-list');
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', slot.name);
    const empty = h('div', 'tf-hint tf-picker-empty', 'No matches.');
    empty.hidden = true;
    for (const o of slot.options) {
      const on = picks[slot.key] === o.id;
      const where = taken(slot, o.id);
      const r = h('button', `tf-picker-row${on ? ' is-selected' : ''}${where ? ' is-taken' : ''}`);
      r.type = 'button';
      r.setAttribute('role', 'radio');
      r.setAttribute('aria-checked', String(on));
      if (where) r.setAttribute('aria-disabled', 'true');
      r.dataset['key'] = `lu-${slot.key}-${o.id}`;
      const tick = h('span', 'tf-picker-tick');
      tick.append(createIcon('check'));
      r.append(h('span', 'tf-picker-name', o.name), where ? h('span', 'tf-picker-note', `Chosen ${where}`) : tick);
      r.addEventListener('click', () => {
        if (where) return;
        picks[slot.key] = o.id;
        render();
      });
      list.append(r);
      rows.push({ el: r, name: o.name.toLowerCase() });
    }
    list.append(empty);
    wrap.append(list);
    const chosen = slot.options.find((o) => o.id === picks[slot.key]);
    const pdesc = h('div', `tf-picker-desc${chosen ? '' : ' is-empty'}`);
    pdesc.append(chosen ? termify(chosen.description) : document.createTextNode('Select an option to read what it does.'));
    wrap.append(pdesc);
    // Bring the chosen row into view after a re-render.
    queueMicrotask(() => {
      const sel = list.querySelector<HTMLElement>('.is-selected');
      if (sel) list.scrollTop = Math.max(0, sel.offsetTop - list.clientHeight / 2 + sel.offsetHeight / 2);
    });
    return wrap;
  }

  function levelUpSection(): HTMLElement | null {
    const lu = model.levelUp;
    if (!lu) return null;
    if (pickFor !== lu.toLevel) {
      pickFor = lu.toLevel;
      picks = {};
    }
    const s = section('Level Up', 'tf-levelup');
    const top = h('div', 'tf-lu-top');
    const lv = h('div', 'tf-lu-levels');
    lv.append(h('span', 'tf-lu-from', `Level ${lu.fromLevel}`), createIcon('up', 'tf-icon tf-lu-arrow'), h('span', 'tf-lu-to', `Level ${lu.toLevel}`));
    top.append(lv, h('span', 'tf-lu-hp', `+${lu.hpGain} max HP`));
    s.body.append(top);
    if (lu.featureSummaries.length) {
      const ul = h('ul', 'tf-card-list');
      for (const f of lu.featureSummaries) {
        const li = h('li');
        li.append(termify(f));
        ul.append(li);
      }
      s.body.append(ul);
    }
    const slots = lu.choices;
    const taken = (slot: ChoiceSlot, optionId: string): 'above' | 'below' | null => {
      if (!slot.group) return null;
      const idx = slots.indexOf(slot);
      for (let i = 0; i < slots.length; i++) {
        const o = slots[i];
        if (!o || o === slot || o.group !== slot.group) continue;
        if (picks[o.key] === optionId) return i < idx ? 'above' : 'below';
      }
      return null;
    };
    for (const slot of slots) {
      const grp = h('div', 'tf-lu-choice');
      const head = h('div', 'tf-lu-choice-head');
      const chosen = slot.options.find((o) => o.id === picks[slot.key]);
      head.append(h('h3', 'tf-sub-title', slot.name));
      head.append(h('span', `tf-lu-status${chosen ? ' is-done' : ''}`, chosen ? chosen.name : 'Choose one'));
      grp.append(head);
      if (slot.options.length > 6) grp.append(listPicker(slot, taken));
      else grp.append(cardPicker(slot, taken));
      s.body.append(grp);
    }
    const missing = lu.choices.filter((c) => picks[c.key] === undefined);
    const ready = missing.length === 0;
    const confirm = button('tf-btn tf-btn--primary', 'Confirm Level Up', () => {
      intent({ type: 'confirmLevelUp', choices: { ...picks } });
    });
    confirm.dataset['key'] = 'confirm-levelup';
    confirm.disabled = !ready;
    s.body.append(confirm);
    if (!ready) s.body.append(h('p', 'tf-hint', `Still to choose: ${missing.map((c) => c.name).join(', ')}.`));
    return s.el;
  }

  const ROLE: Record<string, string> = { healer: 'Healer', blaster: 'Blaster', skirmisher: 'Skirmisher' };

  function companionSection(): HTMLElement | null {
    const co = model.companions;
    if (!co) return null;
    const s = section('Companion', 'tf-comp-sec');
    s.body.append(
      h(
        'p',
        'tf-hint',
        co.chosenId === null
          ? 'An ally joins you from here on. The game plays it; you choose how it fights. You can swap at every rest.'
          : 'Tap another card to swap companions. The new one joins on the next floor.',
      ),
    );
    const g = h('div', 'tf-cards tf-cards--compact tf-comp-cards');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', 'Companion');
    for (const c of co.options) {
      const on = c.id === co.chosenId;
      const card = h('button', `tf-card${on ? ' is-selected' : ''}`);
      card.type = 'button';
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(on));
      card.dataset['key'] = `companion-${c.id}`;
      const hd = h('div', 'tf-card-head');
      const glyph = h('span', 'tf-card-glyph tf-comp-glyph');
      glyph.append(createIcon(`role-${c.role}`));
      const tick = h('span', 'tf-card-tick');
      tick.append(createIcon('check'));
      hd.append(glyph, h('span', 'tf-card-title', c.name), tick);
      card.append(
        hd,
        h('div', 'tf-card-meta', `${ROLE[c.role] ?? c.role} \u00b7 Lv ${c.level} \u00b7 HP ${c.maxHp} \u00b7 AC ${c.ac}`),
        h('p', 'tf-card-desc', c.description),
      );
      if (c.summaries.length) {
        const ul = h('ul', 'tf-card-list');
        for (const t of c.summaries) ul.append(h('li', undefined, t));
        card.append(ul);
      }
      if (c.nextUnlock) card.append(h('div', 'tf-card-feat', `At level ${c.nextUnlock.level}: ${c.nextUnlock.summary}`));
      card.addEventListener('click', () => {
        if (!on) intent({ type: 'chooseCompanion', id: c.id });
      });
      g.append(card);
    }
    s.body.append(g);
    return s.el;
  }

  function characterSection(): HTMLElement {
    const ch = model.character;
    const sum = model.characterSummary;
    // Definitions come from the model; prettifying the id is only a last resort for a missing def.
    const nameOf = (id: string): string => model.items[id]?.name ?? prettifyId(id);
    const s = section('Character');

    const top = h('div', 'tf-char-top');
    const who = h('div', 'tf-char-who');
    who.append(
      h('div', 'tf-char-name', sum.name),
      h('div', 'tf-char-sub', `${sum.speciesName} ${sum.className} · Level ${ch.level}`),
    );
    const stats = h('div', 'tf-char-stats');
    const stat = (k: string, v: string): HTMLElement => {
      const e = h('div', 'tf-stat');
      e.append(h('span', 'tf-stat-v', v), h('span', 'tf-stat-k', k));
      return e;
    };
    stats.append(stat('HP', `${ch.hp}/${ch.maxHp}`), stat('AC', String(sum.ac)));
    top.append(who, stats);
    s.body.append(top);

    const worn = ch.worn;
    const notes = model.itemNotes;
    const eq = h('div', 'tf-equip');
    const slot = (label: string, id: string | undefined): HTMLElement => {
      const r = h('div', 'tf-equip-slot');
      r.append(h('span', 'tf-equip-k', label), h('span', `tf-equip-v${id ? '' : ' is-empty'}`, id ? nameOf(id) : 'Empty'));
      return r;
    };
    eq.append(
      slot('Main hand', ch.equipped.mainHand),
      slot('Off hand', ch.equipped.offHand),
      slot('Ranged', ch.equipped.ranged),
      slot('Armor', ch.equipped.armor),
    );
    s.body.append(eq);

    // Worn magic items: shown once the game supplies item notes or worn data.
    if (notes || worn) {
      s.body.append(h('h3', 'tf-sub-title', 'Worn'));
      const weq = h('div', 'tf-equip tf-equip--worn');
      const SLOTS: [string, keyof NonNullable<typeof worn>][] = [
        ['Head', 'head'],
        ['Neck', 'neck'],
        ['Cloak', 'cloak'],
        ['Hands', 'hands'],
        ['Wrists', 'wrists'],
        ['Belt', 'belt'],
        ['Feet', 'feet'],
        ['Ring 1', 'ring'],
        ['Ring 2', 'ring2'],
      ];
      for (const [label, key] of SLOTS) weq.append(slot(label, worn?.[key]));
      s.body.append(weq);
    }

    // Quick slots: tap an empty slot, then a consumable in the pack; tap a filled slot to clear it.
    if (model.quickSlots) {
      const qs = model.quickSlots;
      s.body.append(h('h3', 'tf-sub-title', 'Quick slots'));
      const row = h('div', 'tf-quick');
      qs.forEach((q, i) => {
        const armed = armedSlot === i;
        const b = h('button', `tf-qslot${q ? ' is-filled' : ''}${armed ? ' is-armed' : ''}`);
        b.type = 'button';
        b.dataset['key'] = `qslot-${i}`;
        const def = q ? model.items[q.itemId] : undefined;
        const ic = h('span', 'tf-qslot-icon');
        ic.append(createIcon(q ? (def ? iconForItem(def) : 'potion') : undefined));
        b.append(h('span', 'tf-qslot-num', String(i + 1)), ic);
        if (q) {
          b.append(h('span', 'tf-qslot-name', nameOf(q.itemId)), h('span', 'tf-qslot-count', `\u00d7${q.count}`));
          b.setAttribute('aria-label', `Quick slot ${i + 1}: ${nameOf(q.itemId)}, ${q.count}. Tap to clear.`);
        } else {
          b.append(h('span', 'tf-qslot-name is-empty', armed ? 'Pick below' : 'Empty'));
          b.setAttribute('aria-label', `Quick slot ${i + 1}, empty. Tap, then choose an item below.`);
        }
        b.addEventListener('click', () => {
          if (q) {
            armedSlot = null;
            intent({ type: 'setQuickSlot', slot: i, itemId: null });
          } else {
            armedSlot = armed ? null : i;
            render();
          }
        });
        row.append(b);
      });
      s.body.append(row);
      if (armedSlot !== null) s.body.append(h('p', 'tf-hint', `Choose a consumable below to put in slot ${armedSlot + 1}.`));
    }

    const invHead = h('div', 'tf-inv-head');
    invHead.append(h('h3', 'tf-sub-title', 'Inventory'));
    if (model.attunement) {
      const full = model.attunement.used >= model.attunement.limit;
      const chip = h('span', `tf-attune-count${full ? ' is-full' : ''}`, `Attunement ${model.attunement.used} / ${model.attunement.limit}`);
      chip.title = 'Some magic items only work while you are attuned to them. You can attune to a few at once.';
      invHead.append(chip);
    }
    s.body.append(invHead);
    const wornCount = (id: string): number =>
      [ch.equipped.mainHand, ch.equipped.offHand, ch.equipped.ranged, ch.equipped.armor, ...Object.values(worn ?? {})].filter((x) => x === id).length;
    if (ch.inventory.length === 0) {
      s.body.append(h('p', 'tf-hint', 'Your pack is empty.'));
    }
    const list = h('ul', 'tf-inv');
    for (const st of ch.inventory) {
      const def = model.items[st.itemId];
      const note = notes?.[st.itemId];
      const li = h('li', `tf-inv-row${rarityClass(def)}${note?.inert ? ' is-inert' : ''}`);
      const ic = h('span', 'tf-inv-icon');
      ic.append(createIcon(def ? iconForItem(def) : undefined));
      const info = h('span', 'tf-inv-info');
      info.append(h('span', 'tf-inv-name', `${nameOf(st.itemId)}${st.quantity > 1 ? ` \u00d7${st.quantity}` : ''}`));
      if (def) info.append(h('span', 'tf-inv-desc', itemStat(def)));
      if (note && note.effects.length) {
        const ul = h('ul', 'tf-effects');
        for (const e of note.effects) {
          const li2 = h('li');
          li2.append(termify(e));
          ul.append(li2);
        }
        info.append(ul);
      }
      if (note?.inert) info.append(h('span', 'tf-inert', 'Not attuned: does nothing'));
      li.append(ic, info);
      const actions = h('span', 'tf-inv-actions');
      if (def && def.kind !== 'consumable') {
        const n = wornCount(st.itemId);
        if (n > 0) actions.append(h('span', 'tf-tag', n > 1 ? `Equipped \u00d7${n}` : 'Equipped'));
        if (n > 0 && notes) {
          const off = button('tf-btn tf-btn--small', 'Take off', () => intent({ type: 'unequip', itemId: st.itemId }), `Take off ${nameOf(st.itemId)}`);
          off.dataset['key'] = `unequip-${st.itemId}`;
          actions.append(off);
        }
        if (st.quantity > n) {
          const b = button('tf-btn tf-btn--small', 'Equip', () => intent({ type: 'equip', itemId: st.itemId }), `Equip ${nameOf(st.itemId)}`);
          b.dataset['key'] = `equip-${st.itemId}`;
          if (note && !note.canEquip) {
            b.disabled = true;
            if (note.reason) info.append(h('span', 'tf-inv-reason', note.reason));
          }
          actions.append(b);
        }
        if (note?.needsAttunement) {
          const at = note.attuned
            ? button('tf-btn tf-btn--small', 'End attunement', () => intent({ type: 'unattune', itemId: st.itemId }), `End attunement with ${nameOf(st.itemId)}`)
            : button('tf-btn tf-btn--small tf-btn--accent', 'Attune', () => intent({ type: 'attune', itemId: st.itemId }), `Attune to ${nameOf(st.itemId)}`);
          at.dataset['key'] = `attune-${st.itemId}`;
          if (!note.attuned && !note.canAttune) {
            at.disabled = true;
            info.append(h('span', 'tf-inv-reason', 'Attunement is full: end another first.'));
          }
          actions.append(at);
        }
      } else if (def && note?.quickable && armedSlot !== null) {
        const slotNo = armedSlot;
        const put = button('tf-btn tf-btn--small tf-btn--primary', `Put in slot ${slotNo + 1}`, () => {
          armedSlot = null;
          intent({ type: 'setQuickSlot', slot: slotNo, itemId: st.itemId });
        });
        put.dataset['key'] = `put-${st.itemId}`;
        actions.append(put);
      }
      if (actions.childElementCount) li.append(actions);
      list.append(li);
    }
    s.body.append(list);
    return s.el;
  }

  const VERDICT: Record<string, string> = {
    upgrade: 'Upgrade',
    tradeoff: 'Trade-off',
    sidegrade: 'Sidegrade',
    downgrade: 'Downgrade',
    unsuitable: 'Not for your build',
    owned: 'Owned',
  };

  /** Upgrades, trade-offs, sidegrades, consumables, other gear; then (hidden by default) downgrades, unsuitable and owned. */
  function shopRank(e: HubModel['shop'][number]): number {
    switch (e.compare?.verdict) {
      case 'upgrade':
        return 0;
      case 'tradeoff':
        return 1;
      case 'sidegrade':
        return 2;
      case 'downgrade':
        return 5;
      case 'unsuitable':
        return 6;
      case 'owned':
        return 7;
      default:
        return e.item.kind === 'consumable' ? 3 : 4;
    }
  }

  function compareBlock(e: HubModel['shop'][number]): HTMLElement | null {
    const cmp = e.compare;
    if (!cmp) return null;
    const wrap = h('div', 'tf-cmp');
    const open = expanded.has(e.item.id);
    const detail = cmp.changes.length > 0 || cmp.replaces.length > 0;
    const row = h(detail ? 'button' : 'div', `tf-cmp-row${detail ? ' is-button' : ''}`);
    if (row instanceof HTMLButtonElement) {
      row.type = 'button';
      row.setAttribute('aria-expanded', String(open));
      row.dataset['key'] = `cmp-${e.item.id}`;
      row.addEventListener('click', () => {
        if (expanded.has(e.item.id)) expanded.delete(e.item.id);
        else expanded.add(e.item.id);
        render();
      });
    }
    const sum = h('span', 'tf-cmp-summary');
    sum.append(termify(cmp.summary));
    row.append(h('span', `tf-verdict tf-verdict--${cmp.verdict}`, VERDICT[cmp.verdict] ?? cmp.verdict), sum);
    if (detail) row.append(createIcon('chevron', `tf-icon tf-cmp-chev${open ? ' is-open' : ''}`));
    wrap.append(row);
    if (open && detail) {
      const tbl = h('div', 'tf-cmp-table');
      for (const c of cmp.changes) {
        if (c.label.toLowerCase() === 'effect') {
          const eff = h('div', 'tf-cmp-effect');
          eff.append(termify(c.to || c.from));
          tbl.append(eff);
          continue;
        }
        const r = h('div', 'tf-cmp-line');
        const mark = c.better === true ? '\u25b2' : c.better === false ? '\u25bc' : '\u00b7';
        r.append(
          h('span', 'tf-cmp-label', c.label),
          h('span', 'tf-cmp-from', c.from),
          h('span', 'tf-cmp-arrow', '\u2192'),
          h('span', `tf-cmp-to ${c.better === true ? 'is-better' : c.better === false ? 'is-worse' : ''}`.trim(), c.to),
          h('span', `tf-cmp-mark ${c.better === true ? 'is-better' : c.better === false ? 'is-worse' : ''}`.trim(), mark),
        );
        tbl.append(r);
      }
      if (cmp.replaces.length) tbl.append(h('div', 'tf-cmp-puts', `Puts away: ${cmp.replaces.join(', ')}`));
      wrap.append(tbl);
    }
    return wrap;
  }

  function shopSection(): HTMLElement {
    const s = section('Shop');
    if (model.shop.length === 0) s.body.append(h('p', 'tf-hint', 'The merchant has nothing for sale.'));
    const sorted = model.shop.map((e, i) => ({ e, i, r: shopRank(e) })).sort((a, b) => a.r - b.r || a.i - b.i);
    const hiddenCount = sorted.filter((x) => x.r >= 5).length;
    const shown = showAll ? sorted : sorted.filter((x) => x.r < 5);
    const grid = h('div', 'tf-shop');
    for (const { e } of shown) {
      const c = h('div', `tf-shop-item${e.affordable ? '' : ' is-unaffordable'}${rarityClass(e.item)}`);
      const ic = h('span', 'tf-inv-icon');
      ic.append(createIcon(iconForItem(e.item)));
      const info = h('div', 'tf-shop-info');
      info.append(h('div', 'tf-inv-name', e.item.name));
      const stat = itemStat(e.item);
      if (stat) info.append(h('div', 'tf-shop-stat', stat));
      info.append(h('div', 'tf-inv-desc', e.item.description));
      const cmp = compareBlock(e);
      if (cmp) info.append(cmp);
      const buy = h('button', 'tf-btn tf-btn--small tf-buy');
      buy.type = 'button';
      buy.dataset['key'] = `buy-${e.item.id}`;
      buy.setAttribute('aria-label', `Buy ${e.item.name} for ${e.price} gold`);
      buy.append(createIcon('coin', 'tf-icon tf-buy-icon'), h('span', undefined, String(e.price)));
      buy.disabled = !e.affordable;
      if (!e.affordable) buy.title = 'Not enough gold';
      buy.addEventListener('click', () => intent({ type: 'buy', itemId: e.item.id }));
      c.append(ic, info, buy);
      grid.append(c);
    }
    s.body.append(grid);
    if (hiddenCount > 0) {
      const t = button(
        'tf-btn tf-btn--small tf-shop-toggle',
        showAll ? 'Hide unsuitable items' : `Show everything (${hiddenCount} more)`,
        () => {
          showAll = !showAll;
          render();
        },
      );
      t.dataset['key'] = 'shop-toggle';
      t.setAttribute('aria-expanded', String(showAll));
      s.body.append(t);
    }
    return s.el;
  }

  function renderFoot(): void {
    clear(foot);
    const levelPending = !!model.levelUp;
    const compPending = !levelPending && !!model.companions?.required && model.companions.chosenId === null;
    const pending = levelPending || compPending;
    const hint = h(
      'p',
      'tf-hub-hint',
      levelPending
        ? 'Confirm your level up before descending.'
        : compPending
          ? 'Choose a companion before descending.'
          : 'You are fully rested. The stairs wait.',
    );
    const label = `Descend to Floor ${model.nextDepth}: ${model.nextThemeName}`;
    const go = button('tf-btn tf-btn--primary tf-btn--xl tf-descend', label, () => {
      if (finished || model.levelUp || (model.companions?.required && model.companions.chosenId === null)) return;
      finished = true;
      send({ type: 'descend' });
      done();
    });
    go.dataset['key'] = 'descend';
    go.disabled = pending;
    foot.append(hint, go);
  }

  function render(): void {
    renderHead();
    rebuildPreserving(body, root, () => {
      clear(body);
      const grid = h('div', 'tf-hub-grid');
      const left = h('div', 'tf-hub-col');
      const lu = levelUpSection();
      if (lu) left.append(lu);
      left.append(characterSection());
      const right = h('div', 'tf-hub-col');
      const comp = companionSection();
      if (comp) right.append(comp);
      right.append(shopSection());
      grid.append(left, right);
      body.append(grid);
    });
    renderFoot();
  }

  render();
  return root;
}
