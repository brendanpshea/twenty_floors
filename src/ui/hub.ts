import type { HubIntent, HubModel, ItemDef } from '../core/types';
import { button, clear, h, prettifyId, rebuildPreserving } from './dom';
import { createIcon } from './icons';

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
  if (item.consumable) return `Restores ${item.consumable.dice} hit points`;
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
      for (const f of lu.featureSummaries) ul.append(h('li', undefined, f));
      s.body.append(ul);
    }
    for (const slot of lu.choices) {
      const grp = h('div', 'tf-lu-choice');
      grp.append(h('h3', 'tf-sub-title', slot.name));
      const g = h('div', 'tf-cards tf-cards--compact');
      g.setAttribute('role', 'radiogroup');
      g.setAttribute('aria-label', slot.name);
      for (const o of slot.options) {
        const on = picks[slot.key] === o.id;
        const c = h('button', `tf-card${on ? ' is-selected' : ''}`);
        c.type = 'button';
        c.setAttribute('role', 'radio');
        c.setAttribute('aria-checked', String(on));
        c.dataset['key'] = `lu-${slot.key}-${o.id}`;
        const hd = h('div', 'tf-card-head');
        const tick = h('span', 'tf-card-tick');
        tick.append(createIcon('check'));
        hd.append(h('span', 'tf-card-title', o.name), tick);
        c.append(hd, h('p', 'tf-card-desc', o.description));
        c.addEventListener('click', () => {
          picks[slot.key] = o.id;
          render();
        });
        g.append(c);
      }
      grp.append(g);
      s.body.append(grp);
    }
    const ready = lu.choices.every((c) => picks[c.key] !== undefined);
    const confirm = button('tf-btn tf-btn--primary', 'Confirm Level Up', () => {
      intent({ type: 'confirmLevelUp', choices: { ...picks } });
    });
    confirm.dataset['key'] = 'confirm-levelup';
    confirm.disabled = !ready;
    s.body.append(confirm);
    if (!ready) s.body.append(h('p', 'tf-hint', 'Make your choices to continue.'));
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

    const eq = h('div', 'tf-equip');
    const slot = (label: string, id: string | undefined): HTMLElement => {
      const r = h('div', 'tf-equip-slot');
      r.append(h('span', 'tf-equip-k', label), h('span', `tf-equip-v${id ? '' : ' is-empty'}`, id ? nameOf(id) : 'Empty'));
      return r;
    };
    eq.append(slot('Main hand', ch.equipped.mainHand), slot('Off hand', ch.equipped.offHand), slot('Armor', ch.equipped.armor));
    s.body.append(eq);

    s.body.append(h('h3', 'tf-sub-title', 'Inventory'));
    const equippedIds = new Set([ch.equipped.mainHand, ch.equipped.offHand, ch.equipped.armor].filter((x): x is string => !!x));
    if (ch.inventory.length === 0) {
      s.body.append(h('p', 'tf-hint', 'Your pack is empty.'));
    }
    const list = h('ul', 'tf-inv');
    for (const st of ch.inventory) {
      const def = model.items[st.itemId];
      const li = h('li', 'tf-inv-row');
      const ic = h('span', 'tf-inv-icon');
      ic.append(createIcon(def ? iconForItem(def) : undefined));
      const info = h('span', 'tf-inv-info');
      info.append(h('span', 'tf-inv-name', `${nameOf(st.itemId)}${st.quantity > 1 ? ` ×${st.quantity}` : ''}`));
      if (def) info.append(h('span', 'tf-inv-desc', itemStat(def)));
      li.append(ic, info);
      if (def && def.kind !== 'consumable') {
        if (equippedIds.has(st.itemId)) {
          li.append(h('span', 'tf-tag', 'Equipped'));
        } else {
          const b = button('tf-btn tf-btn--small', 'Equip', () => intent({ type: 'equip', itemId: st.itemId }), `Equip ${nameOf(st.itemId)}`);
          b.dataset['key'] = `equip-${st.itemId}`;
          li.append(b);
        }
      }
      list.append(li);
    }
    s.body.append(list);
    return s.el;
  }

  function shopSection(): HTMLElement {
    const s = section('Shop');
    if (model.shop.length === 0) s.body.append(h('p', 'tf-hint', 'The merchant has nothing for sale.'));
    const grid = h('div', 'tf-shop');
    for (const e of model.shop) {
      const c = h('div', `tf-shop-item${e.affordable ? '' : ' is-unaffordable'}`);
      const ic = h('span', 'tf-inv-icon');
      ic.append(createIcon(iconForItem(e.item)));
      const info = h('div', 'tf-shop-info');
      info.append(h('div', 'tf-inv-name', e.item.name));
      const stat = itemStat(e.item);
      if (stat) info.append(h('div', 'tf-shop-stat', stat));
      info.append(h('div', 'tf-inv-desc', e.item.description));
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
    return s.el;
  }

  function renderFoot(): void {
    clear(foot);
    const pending = !!model.levelUp;
    const hint = h(
      'p',
      'tf-hub-hint',
      pending ? 'Confirm your level up before descending.' : 'You are fully rested. The stairs wait.',
    );
    const label = `Descend to Floor ${model.nextDepth}: ${model.nextThemeName}`;
    const go = button('tf-btn tf-btn--primary tf-btn--xl tf-descend', label, () => {
      if (finished || model.levelUp) return;
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
      right.append(shopSection());
      grid.append(left, right);
      body.append(grid);
    });
    renderFoot();
  }

  render();
  return root;
}
