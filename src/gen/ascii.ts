import type { FloorPlan } from '../core/types';
import { CellKind } from '../core/types';
import { PROP_OBSTACLE } from './obstacles';

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

const POST_LETTER: Record<string, string> = { front: 'f', back: 'b', flank: 'k', high: 'h', hidden: 'x', guard: 'g', escort: 'e' };

/**
 * Debug dump. Legend: '#' wall, '.' floor, ':' chasm, '~' water, '+' door,
 * '<' entrance, '>' exit, 'B' boss slot, 'c' chest slot, 'o' blocking prop, 'R' rest
 * spot, '*' a fire prop and '^' a spiked one (both hurt a creature pushed into them), ' ' void. Monster slots show their post: 'f' front, 'b' back, 'k' flank, 'h' high,
 * 'x' hidden, 'g' guard, 'e' escort ('m' for a slot without a post). With `withElevation`, a
 * second grid follows where walkable cells show their elevation step (0-9 then a-z). A
 * `-- rooms --` legend at the end lists every room's role and formation.
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
    if (p.blocking) {
      const ob = PROP_OBSTACLE[p.type];
      (rows[p.pos.y] as string[])[p.pos.x] = ob === 'fire' ? '*' : ob === 'spikes' ? '^' : propLetters ? (PROP_LETTER[p.type] ?? 'o') : 'o';
    }
  }
  for (const s of plan.spawns) {
    (rows[s.pos.y] as string[])[s.pos.x] = s.role === 'boss' ? 'B' : s.role === 'chest' ? 'c' : (POST_LETTER[s.post ?? ''] ?? 'm');
  }
  for (const r of plan.restSpots ?? []) (rows[r.y] as string[])[r.x] = 'R';
  (rows[plan.entrance.y] as string[])[plan.entrance.x] = '<';
  (rows[plan.exit.y] as string[])[plan.exit.x] = '>';
  const main = rows.map((r) => r.join('').trimEnd()).join('\n');
  const legend = `\n\n-- rooms --\n${plan.rooms.map((r) => `${r.id} ${r.role}${r.formation ? ` ${r.formation}` : ''}`).join('\n')}`;
  if (!withElevation) return main + legend;
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
  return `${main}\n\n-- elevation --\n${elev.join('\n')}${legend}`;
}
