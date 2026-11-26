import type { FloorPlan } from '../core/types';
import { CellKind } from '../core/types';

/** Letters used when `propLetters` is on. */
const PROP_LETTER: Record<string, string> = {
  pillar: 'P',
  sarcophagus: 'S',
  statue: 'T',
  urn: 'u',
  brazier: 'f',
  crate: 'x',
  barrel: 'b',
  stalagmite: 'v',
  campfire: 'F',
  crystal: '*',
  broken_pillar: 'p',
};

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Debug dump. Legend: '#' wall, '.' floor, ':' chasm, '~' water, '+' door,
 * '<' entrance, '>' exit, 'm' monster slot, 'B' boss slot, 'c' chest slot,
 * 'o' blocking prop, 'R' rest spot, ' ' void. With `withElevation`, a second grid follows
 * where walkable cells show their elevation step (0-9 then a-z).
 */
export function floorToAscii(plan: FloorPlan, withElevation = false, propLetters = false): string {
  const { width: w, height: h } = plan;
  const rows: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      switch (plan.kinds[y * w + x]) {
        case CellKind.Wall:
          row.push('#');
          break;
        case CellKind.Floor:
          row.push('.');
          break;
        case CellKind.Chasm:
          row.push(':');
          break;
        case CellKind.Water:
          row.push('~');
          break;
        case CellKind.Door:
          row.push('+');
          break;
        default:
          row.push(' ');
      }
    }
    rows.push(row);
  }
  for (const p of plan.props) {
    if (p.blocking) (rows[p.pos.y] as string[])[p.pos.x] = propLetters ? (PROP_LETTER[p.type] ?? 'o') : 'o';
  }
  for (const s of plan.spawns) {
    (rows[s.pos.y] as string[])[s.pos.x] = s.role === 'boss' ? 'B' : s.role === 'chest' ? 'c' : 'm';
  }
  for (const r of plan.restSpots ?? []) (rows[r.y] as string[])[r.x] = 'R';
  (rows[plan.entrance.y] as string[])[plan.entrance.x] = '<';
  (rows[plan.exit.y] as string[])[plan.exit.x] = '>';
  const main = rows.map((r) => r.join('').trimEnd()).join('\n');
  if (!withElevation) return main;
  const elev: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = plan.kinds[i];
      if (k === CellKind.Floor || k === CellKind.Water || k === CellKind.Door) {
        line += DIGITS[Math.min(35, plan.elevation[i] as number)] ?? '?';
      } else line += k === CellKind.Wall ? '#' : k === CellKind.Chasm ? ':' : ' ';
    }
    elev.push(line.trimEnd());
  }
  return `${main}\n\n-- elevation --\n${elev.join('\n')}`;
}
