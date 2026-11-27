import type { Tooltip } from './tooltip';

/** Plain-language explanations of rules terms. Keys are lower case. */
export const GLOSSARY: Record<string, string> = {
  'armor class': 'How hard you are to hit. An attack hits if its roll meets or beats this number.',
  'hit chance': 'Your odds, as a percentage, that this attack lands.',
  action: 'Your main thing each turn: attack, dash, dodge, cast a spell. You get one.',
  'bonus action': 'A quick extra move you can add each turn, like Second Wind. You get one, and only some abilities use it.',
  reaction: 'Something you do on someone else’s turn, such as striking a foe that walks away. One per round.',
  advantage: 'Roll two dice and keep the better one.',
  disadvantage: 'Roll two dice and keep the worse one.',
  'saving throw': 'A roll to resist a spell or effect. Beat the difficulty and you avoid or reduce it.',
  concentration: 'Some spells need your focus. Casting another one, or being badly hurt, can break it.',
  prone: 'Knocked down. Melee attacks against you have advantage; standing up costs half your movement.',
  restrained: 'Held in place. You cannot move, attacks against you have advantage, and yours have disadvantage.',
  paralyzed: 'Cannot move or act. Attacks against you have advantage and hits up close are critical.',
  cover: 'Something in the way that makes a target harder to hit. Half cover adds 2 to Armor Class, three-quarters adds 5.',
  'hit dice': 'Your recovery pool. A short rest spends them to heal; a long rest restores them.',
  'short rest': 'A breather. Spend Hit Dice to heal and regain short-rest abilities. Not with an enemy in view.',
  'long rest': 'A full night’s sleep at a rest site: restores everything. Each site works once.',
  'last stand': 'When you drop to 0 HP you do not die at once; you fight on for a moment before falling.',
  cleave: 'Weapon mastery: when you hit, you may make a free hit on a second enemy beside the first.',
  graze: 'Weapon mastery: even a miss deals damage equal to your ability modifier.',
  nick: 'Weapon mastery: your off-hand weapon attack is made as part of the same action.',
  push: 'Weapon mastery: a hit shoves a Large or smaller target 10 feet away.',
  sap: 'Weapon mastery: a hit gives the target disadvantage on its next attack.',
  slow: 'Weapon mastery: a hit reduces the target’s speed by 10 feet until your next turn.',
  topple: 'Weapon mastery: a hit forces a save, and on a failure the target falls prone.',
  vex: 'Weapon mastery: a hit gives you advantage on your next attack against that target.',
  'sneak attack': 'Extra damage when you hit a target you have advantage against, or one beside your ally.',
  'opportunity attack': 'A free strike against a creature that moves away from you. Disengage avoids it.',
  shove: 'Push a creature 5 feet. Shove one off an edge and it takes falling damage.',
};

const ALIASES: Record<string, string> = {
  ac: 'armor class',
  'hit die': 'hit dice',
  'saving throws': 'saving throw',
  reactions: 'reaction',
};

let tip: Tooltip | null = null;

export function setGlossaryTooltip(t: Tooltip): void {
  tip = t;
}

export function lookup(term: string): { key: string; text: string } | undefined {
  const k0 = term.toLowerCase();
  const key = ALIASES[k0] ?? k0;
  const text = GLOSSARY[key];
  return text ? { key, text } : undefined;
}

export function titleCase(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

const ALL_KEYS = [...Object.keys(GLOSSARY), ...Object.keys(ALIASES)].sort((a, b) => b.length - a.length);
const ESC = ALL_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const RE = new RegExp(`\\b(${ESC.join('|')})\\b`, 'gi');

/** Canonical glossary keys that appear in the text, in order, without repeats. */
export function findTerms(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(RE)) {
    const found = lookup(m[0]);
    if (found && !out.includes(found.key)) out.push(found.key);
  }
  return out;
}

/** Make an element show a glossary entry on hover, long-press and tap. */
export function attachTerm(el: HTMLElement, term: string): void {
  const found = lookup(term);
  if (!found || !tip) return;
  const t = tip;
  t.attach(el, () => ({ title: titleCase(found.key), body: found.text }));
}

export function termSpan(label: string, term: string): HTMLElement {
  const s = document.createElement('span');
  s.textContent = label;
  if (!lookup(term)) return s;
  s.className = 'tf-term';
  attachTerm(s, term);
  s.addEventListener('click', (e) => {
    e.stopPropagation();
    tip?.flash(s, 4000);
  });
  return s;
}

/** Text with glossary terms marked (dotted underline, explained on hover or tap). Built from text nodes only. */
export function termify(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(RE)) {
    const idx = m.index ?? 0;
    if (idx > last) frag.append(document.createTextNode(text.slice(last, idx)));
    frag.append(termSpan(m[0], m[0]));
    last = idx + m[0].length;
  }
  if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
  return frag;
}

/** Replace an element's children with termified text (only when it changed). */
export function setTermText(el: HTMLElement, text: string): void {
  if (el.dataset['t'] === text) return;
  el.dataset['t'] = text;
  el.replaceChildren(termify(text));
}
