/**
 * Small inline SVG icon set, drawn as 24x24 stroked paths. All markup here is
 * static; model strings only ever select a key, never become markup.
 */
const NS = 'http://www.w3.org/2000/svg';

const ICONS: Record<string, string> = {
  melee:
    '<path d="M4 20 L16 8"/><path d="M14 4 L20 4 L20 10 L9 21"/><path d="M5 15 L9 19"/><path d="M4 20 L6 18"/>',
  ranged:
    '<path d="M7 3 Q21 12 7 21"/><path d="M7 3 V21"/><path d="M2 12 H18"/><path d="M15 9 L18 12 L15 15"/>',
  thrown:
    '<path d="M6 18 L18 6"/><path d="M14 5 L19 5 L19 10"/><path d="M5 19 L3 21"/><path d="M3 11 H7"/><path d="M5 7 H9"/><path d="M13 21 H17"/>',
  dash: '<path d="M6 6 L13 12 L6 18"/><path d="M13 6 L20 12 L13 18"/><path d="M2 9 H5"/><path d="M2 15 H5"/>',
  disengage:
    '<path d="M9 4 L4 9 L9 14"/><path d="M4 9 H14 A6 6 0 0 1 14 21 H8"/>',
  dodge: '<path d="M4 8 H13 A3 3 0 1 0 10 5"/><path d="M4 13 H17 A3 3 0 1 1 14 16"/><path d="M4 18 H9"/>',
  heal: '<circle cx="12" cy="12" r="9"/><path d="M12 7 V17"/><path d="M7 12 H17"/>',
  potion:
    '<path d="M9 3 H15"/><path d="M10 3 V8 L5 17 A3 3 0 0 0 8 21 H16 A3 3 0 0 0 19 17 L14 8 V3"/><path d="M7.5 14 H16.5"/>',
  surge: '<path d="M13 2 L5 14 H11 L10 22 L19 10 H13 Z"/>',
  bite: '<path d="M3 9 Q12 2 21 9"/><path d="M3 15 Q12 22 21 15"/><path d="M6 9.5 L8 14 L10 10.5"/><path d="M13 10.5 L15 14 L17 9.5"/>',
  claw: '<path d="M6 3 L10 21"/><path d="M11 2 L15 22"/><path d="M16 3 L20 19"/>',
  slam: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2 V5"/><path d="M12 19 V22"/><path d="M2 12 H5"/><path d="M19 12 H22"/><path d="M5 5 L7 7"/><path d="M17 17 L19 19"/><path d="M19 5 L17 7"/><path d="M5 19 L7 17"/>',
  spell:
    '<path d="M4 20 L15 9"/><path d="M16 3 V7"/><path d="M14 5 H18"/><path d="M20 10 V14"/><path d="M18 12 H22"/><path d="M9 4 V6"/><path d="M8 5 H10"/>',
  special:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 1 V4"/><path d="M12 20 V23"/><path d="M1 12 H4"/><path d="M20 12 H23"/>',
  generic: '<path d="M12 3 L21 12 L12 21 L3 12 Z"/><circle cx="12" cy="12" r="1.6"/>',
  // UI glyphs
  fire: '<path d="M12 3 C13 6 17 8 17 12.5 A5 5 0 0 1 7 12.5 C7 10.5 8 9.5 9 8.5 C9.5 10 10 10.5 10.5 10.5 C11 8 10.5 5.5 12 3 Z"/><path d="M4 21 L20 17"/><path d="M4 17 L20 21"/>',
  'role-healer':
    '<path d="M12 20 C4 14 3 9 6.5 6.5 C9 5 11 6 12 8 C13 6 15 5 17.5 6.5 C21 9 20 14 12 20 Z"/>',
  'role-blaster':
    '<path d="M12 3 C13 6 17 8 17 12.5 A5 5 0 0 1 7 12.5 C7 10.5 8 9.5 9 8.5 C9.5 10 10 10.5 10.5 10.5 C11 8 10.5 5.5 12 3 Z"/>',
  'role-skirmisher': '<path d="M4 19 L9 13 L12 16 L19 7"/><path d="M14 7 H19 V12"/><path d="M4 12 H7"/>',
  'stance-close':
    '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20 C3 15 13 15 13 20"/><path d="M11 20 C11 15 21 15 21 20"/>',
  'stance-back': '<circle cx="18" cy="12" r="3"/><path d="M13 12 H3"/><path d="M7 8 L3 12 L7 16"/>',
  'stance-focus':
    '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/><path d="M12 2 V6"/><path d="M12 18 V22"/><path d="M2 12 H6"/><path d="M18 12 H22"/>',
  shove:
    '<path d="M4 15 V9"/><path d="M7 14 V7"/><path d="M10 14 V6"/><path d="M13 14 V8"/><path d="M4 15 C4 19 7 21 10 21 C13 21 14 19 14 16 V14"/><path d="M17 8 H21"/><path d="M17 12 H21"/><path d="M17 16 H21"/>',
  cover: '<path d="M12 3 L19 6 V11 C19 15 16 17 12 19 C8 17 5 15 5 11 V6 Z"/><path d="M2 21 H22"/>',
  eye: '<path d="M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z"/><circle cx="12" cy="12" r="3"/>',
  warn: '<path d="M12 3 L22 20 H2 Z"/><path d="M12 9 V14"/><path d="M12 17 V17.5"/>',
  menu: '<path d="M4 7 H20"/><path d="M4 12 H20"/><path d="M4 17 H20"/>',
  coin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/>',
  shield: '<path d="M12 3 L20 6 V12 C20 17 16 20 12 22 C8 20 4 17 4 12 V6 Z"/>',
  armor: '<path d="M8 3 L4 7 L6 11 L8 10 V21 H16 V10 L18 11 L20 7 L16 3 L14 5 H10 Z"/>',
  check: '<path d="M5 12.5 L10 17.5 L19 7"/>',
  chevron: '<path d="M6 9 L12 15 L18 9"/>',
  rest: '<path d="M20 14 A8 8 0 1 1 10 4 A6 6 0 0 0 20 14 Z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>',
  star: '<path d="M12 3 L14.5 9 L21 9.5 L16 14 L17.5 20.5 L12 17 L6.5 20.5 L8 14 L3 9.5 L9.5 9 Z"/>',
  up: '<path d="M12 20 V5"/><path d="M6 11 L12 5 L18 11"/>',
  stairs: '<path d="M3 20 H8 V15 H13 V10 H18 V5 H21"/>',
  skull:
    '<path d="M5 11 A7 7 0 0 1 19 11 V14 L16 15 V19 H8 V15 L5 14 Z"/><circle cx="9.5" cy="12" r="1.4"/><circle cx="14.5" cy="12" r="1.4"/>',
};

export function hasIcon(key: string | undefined): boolean {
  return !!key && Object.prototype.hasOwnProperty.call(ICONS, key);
}

function resolve(key: string | undefined): string {
  return hasIcon(key) ? (key as string) : 'generic';
}

export function createIcon(key?: string, cls = 'tf-icon'): SVGSVGElement {
  const k = resolve(key);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset['icon'] = k;
  svg.innerHTML = ICONS[k] ?? '';
  return svg;
}

/** Put the icon for `key` into `holder`, replacing it only if the key changed. */
export function swapIcon(holder: HTMLElement, key: string | undefined): void {
  const cur = holder.firstElementChild as SVGSVGElement | null;
  if (cur && cur.dataset['icon'] === resolve(key)) return;
  holder.replaceChildren(createIcon(key));
}
