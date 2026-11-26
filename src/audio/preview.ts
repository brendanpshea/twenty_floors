import { createAudio, SFX_IDS, type SfxId } from './index';
import type { ThemeId } from '../core/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const audio = createAudio({
  storage: {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
  },
});

const mute = $<HTMLButtonElement>('mute');
const vol = $<HTMLInputElement>('vol');
const syncMute = () => {
  mute.textContent = audio.isMuted() ? 'Unmute' : 'Mute';
  mute.classList.toggle('on', audio.isMuted());
};
vol.value = '0.7';
document.addEventListener('pointerdown', () => audio.unlock());
mute.onclick = () => {
  audio.unlock();
  audio.setMuted(!audio.isMuted());
  syncMute();
};
vol.oninput = () => audio.setVolume(Number(vol.value));
syncMute();

for (const id of SFX_IDS) {
  const b = document.createElement('button');
  b.textContent = id;
  b.onclick = () => {
    audio.unlock();
    audio.play(id);
  };
  $('sfx').append(b);
}

const ambBox = $('amb');
const ambButtons: HTMLButtonElement[] = [];
const options: [string, ThemeId | null][] = [['off', null], ['warrens', 'warrens'], ['crypt', 'crypt'], ['depths', 'depths'], ['sewers', 'sewers'], ['fungal', 'fungal'], ['hold', 'hold'], ['library', 'library'], ['foundry', 'foundry'], ['ice', 'ice']];
for (const [label, theme] of options) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => {
    audio.unlock();
    audio.setAmbience(theme);
    ambButtons.forEach((x) => x.classList.toggle('on', x === b));
  };
  ambButtons.push(b);
  ambBox.append(b);
}
let combat = false;
const cb = document.createElement('button');
cb.textContent = 'combat';
cb.onclick = () => {
  audio.unlock();
  combat = !combat;
  audio.setCombat(combat);
  cb.classList.toggle('on', combat);
};
ambBox.append(cb);

/** A plausible 10 second fight: [ms, sound, options]. */
const FIGHT: [number, SfxId, { pan?: number; pitch?: number; volume?: number }?][] = [
  [0, 'combatStart'],
  [900, 'diceRoll'],
  [1500, 'turnStart'],
  [1900, 'step'], [2050, 'step'], [2200, 'step'],
  [2600, 'diceRoll'],
  [3100, 'swing'], [3250, 'hitBlade', { pan: 0.3 }], [3300, 'hurtMonster', { pan: 0.3 }],
  [4300, 'turnStart', { pitch: 0.9 }],
  [4600, 'claw', { pan: -0.2 }], [4700, 'hurtHero'],
  [5400, 'diceRoll'],
  [5900, 'swing'], [6000, 'miss', { pan: 0.3 }],
  [6700, 'bite', { pan: -0.3 }], [6780, 'hurtHero'],
  [7400, 'diceRoll'],
  [7900, 'swing'], [8000, 'crit', { pan: 0.3 }], [8050, 'hurtMonster', { pan: 0.3 }],
  [8700, 'deathMonster', { pan: 0.3 }],
  [9400, 'victory'],
  [9500, 'coins'],
];
$('fight').onclick = () => {
  audio.unlock();
  audio.setCombat(true);
  cb.classList.add('on');
  combat = true;
  for (const [ms, id, o] of FIGHT) setTimeout(() => audio.play(id, o), ms);
  setTimeout(() => {
    audio.setCombat(false);
    cb.classList.remove('on');
    combat = false;
  }, 10000);
};

if (new URLSearchParams(location.search).has('selftest')) {
  document.body.classList.add('selftest');
  const out = $('selftest-out');
  void import('./selftest')
    .then(async (m) => {
      const res = await m.runSelfTest();
      out.textContent = m.formatReport(res);
      out.setAttribute('data-done', '1');
    })
    .catch((e: unknown) => {
      out.textContent = 'SELFTEST ERROR: ' + String(e instanceof Error ? e.stack : e);
      out.setAttribute('data-done', 'error');
    });
}
