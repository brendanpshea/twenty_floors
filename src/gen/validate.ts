import type { FloorPlan, GridPos } from '../core/types';
import { CellKind } from '../core/types';
import { MAX_GRID, NEI4, NEI8, isWalkKind } from './grid';
import { LIGHT_TYPES } from './layout';
import { buildCost, createNavGrid, floodReach } from './nav';
import { restSetProblems } from './rest';

export const PROP_BLOCKING: Record<string, boolean> = {
  torch: false,
  rubble: false,
  pillar: true,
  crate: true,
  barrel: true,
  bones: false,
  stalagmite: true,
  mushrooms: false,
  campfire: true,
  sarcophagus: true,
  brazier: true,
  statue: true,
  urn: true,
  cobweb: false,
  crystal: true,
  broken_pillar: true,
  chain: false,
};

const THEME_PROPS: Record<string, string[]> = {
  warrens: ['stalagmite', 'mushrooms', 'campfire'],
  crypt: ['sarcophagus', 'brazier', 'statue', 'urn', 'cobweb'],
  depths: ['crystal', 'broken_pillar', 'chain'],
};
const COMMON_PROPS = ['torch', 'rubble', 'pillar', 'crate', 'barrel', 'bones'];

/** Returns a list of problems with a floor; empty means valid. */
export function validateFloor(plan: FloorPlan): string[] {
  const errs: string[] = [];
  const { width: w, height: h } = plan;
  const n = w * h;
  const fail = (s: string): void => {
    if (errs.length < 40) errs.push(s);
  };

  if (w > MAX_GRID || h > MAX_GRID || w < 8 || h < 8) fail(`bad size ${w}x${h}`);
  if (plan.kinds.length !== n || plan.elevation.length !== n || plan.roomIds.length !== n) {
    fail('array sizes do not match width*height');
    return errs;
  }
  for (let i = 0; i < n; i++) {
    const k = plan.kinds[i] as number;
    if (k < 0 || k > 5) {
      fail(`invalid kind ${k} at ${i}`);
      return errs;
    }
  }
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? CellKind.Void : (plan.kinds[y * w + x] as number));

  // Walls and enclosure; elevation rules.
  let minWalk = 127;
  for (let i = 0; i < n; i++) if (isWalkKind(plan.kinds[i] as number)) minWalk = Math.min(minWalk, plan.elevation[i] as number);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = plan.kinds[i] as number;
      const walk = isWalkKind(k);
      if (walk || k === CellKind.Chasm) {
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) fail(`walkable/chasm cell on border at ${x},${y}`);
        for (const [dx, dy] of NEI8) {
          const nk = at(x + dx, y + dy);
          if (nk === CellKind.Void) {
            fail(`${walk ? 'walkable' : 'chasm'} cell ${x},${y} touches void`);
            break;
          }
        }
      }
      if (walk) {
        const e = plan.elevation[i] as number;
        for (const [dx, dy] of NEI8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (isWalkKind(plan.kinds[j] as number) && Math.abs((plan.elevation[j] as number) - e) > 1) {
            fail(`elevation step >1 between ${x},${y} and ${nx},${ny}`);
            break;
          }
        }
      } else if (k === CellKind.Wall) {
        let best = -999;
        for (const [dx, dy] of NEI8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (isWalkKind(plan.kinds[j] as number)) best = Math.max(best, plan.elevation[j] as number);
        }
        if (best !== -999 && best !== plan.elevation[i]) fail(`wall ${x},${y} elevation ${plan.elevation[i]} != ${best}`);
      } else if (k === CellKind.Chasm) {
        if (plan.elevation[i] !== minWalk) fail(`chasm ${x},${y} elevation not minimum`);
      }
    }
  }

  // Entrance / exit.
  const cellOk = (p: GridPos): boolean => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
  const blockAt = new Set<number>();
  for (const p of plan.props) if (p.blocking) blockAt.add(p.pos.y * w + p.pos.x);
  for (const [name, p] of [
    ['entrance', plan.entrance],
    ['exit', plan.exit],
  ] as const) {
    if (!cellOk(p) || !isWalkKind(plan.kinds[p.y * w + p.x] as number)) fail(`${name} not walkable`);
    else if (blockAt.has(p.y * w + p.x)) fail(`${name} on a blocking prop`);
  }
  if (plan.entrance.x === plan.exit.x && plan.entrance.y === plan.exit.y) fail('entrance equals exit');

  // Rooms.
  const rooms = plan.rooms;
  rooms.forEach((r, i) => {
    if (r.id !== i) fail(`room ${i} has id ${r.id}`);
  });
  const count = (role: string): number => rooms.filter((r) => r.role === role).length;
  if (count('entrance') !== 1) fail('need exactly one entrance room');
  if (count('boss') !== 1) fail('need exactly one boss room');
  if (count('combat') < 3) fail('need at least 3 combat rooms');
  if (count('treasure') < 1) fail('need at least 1 treasure room');
  for (const r of rooms) {
    for (const nb of r.neighbors) {
      const o = rooms[nb];
      if (!o || !o.neighbors.includes(r.id)) fail(`neighbors of ${r.id} not symmetric (${nb})`);
    }
    if (!cellOk(r.center) || !isWalkKind(plan.kinds[r.center.y * w + r.center.x] as number)) fail(`room ${r.id} center not walkable`);
    else if (blockAt.has(r.center.y * w + r.center.x)) fail(`room ${r.id} center on a blocking prop`);
    else if (plan.roomIds[r.center.y * w + r.center.x] !== r.id) fail(`room ${r.id} center is in another room`);
    if (r.role === 'passage') fail('passage rooms are not used; passages have roomId -1');
  }
  const entranceRoom = rooms.find((r) => r.role === 'entrance');
  const bossRoom = rooms.find((r) => r.role === 'boss');
  if (entranceRoom && cellOk(plan.entrance) && plan.roomIds[plan.entrance.y * w + plan.entrance.x] !== entranceRoom.id) {
    fail('entrance not in entrance room');
  }
  if (bossRoom && cellOk(plan.exit) && plan.roomIds[plan.exit.y * w + plan.exit.x] !== bossRoom.id) fail('exit not in boss room');
  for (let i = 0; i < n; i++) {
    const id = plan.roomIds[i] as number;
    if (id < -1 || id >= rooms.length) {
      fail(`bad room id ${id}`);
      break;
    }
  }
  if (entranceRoom) {
    const dist = new Array<number>(rooms.length).fill(-1);
    dist[entranceRoom.id] = 0;
    const q = [entranceRoom.id];
    for (let hd = 0; hd < q.length; hd++) {
      const r = rooms[q[hd] as number];
      if (!r) continue;
      for (const nb of r.neighbors) {
        if (dist[nb] === -1) {
          dist[nb] = (dist[r.id] as number) + 1;
          q.push(nb);
        }
      }
    }
    let far = 0;
    for (const r of rooms) {
      if (r.distanceFromEntrance !== dist[r.id]) fail(`room ${r.id} distanceFromEntrance ${r.distanceFromEntrance} != ${dist[r.id]}`);
      far = Math.max(far, dist[r.id] as number);
    }
    if (bossRoom && (dist[bossRoom.id] as number) < far - 1) fail('boss room is not near-farthest');
    if (bossRoom) {
      // Every route to the boss goes through combat rooms: no non-combat neighbour but the last combat room.
      for (const nb of bossRoom.neighbors) if (rooms[nb]?.role !== 'combat') fail('boss room adjacent to a non-combat room');
    }
  }

  // Reachability through the real nav rules.
  const nav = createNavGrid(plan);
  if (cellOk(plan.entrance) && nav.isWalkable(plan.entrance)) {
    const reach = floodReach(plan, plan.entrance);
    const ok = (p: GridPos): boolean => cellOk(p) && reach[p.y * w + p.x] === 1;
    if (!ok(plan.exit)) fail('exit unreachable from entrance');
    for (const r of rooms) if (!ok(r.center)) fail(`room ${r.id} center unreachable`);
    for (const s of plan.spawns) if (!ok(s.pos)) fail(`spawn at ${s.pos.x},${s.pos.y} unreachable`);
    // The boss must be sealed behind combat rooms: with every combat room blocked it cannot be reached.
    if (bossRoom && ok(bossRoom.center)) {
      const cost = buildCost(plan);
      for (let i = 0; i < n; i++) {
        const id = plan.roomIds[i] as number;
        if (id >= 0 && rooms[id]?.role === 'combat') cost[i] = 0;
      }
      const sealed = floodReach(plan, plan.entrance, cost);
      if (sealed[bossRoom.center.y * w + bossRoom.center.x] === 1) fail('boss room reachable without crossing a combat room');
    }
  }

  // Spawn slots.
  const seen = new Set<number>();
  const perRoom = new Map<number, { monster: number; boss: number; chest: number }>();
  for (const s of plan.spawns) {
    if (!cellOk(s.pos)) {
      fail('spawn out of bounds');
      continue;
    }
    const i = s.pos.y * w + s.pos.x;
    const k = plan.kinds[i] as number;
    if (k !== CellKind.Floor && k !== CellKind.Water) fail(`spawn at ${s.pos.x},${s.pos.y} on kind ${k}`);
    if (blockAt.has(i)) fail(`spawn at ${s.pos.x},${s.pos.y} on blocking prop`);
    if (seen.has(i)) fail(`duplicate spawn at ${s.pos.x},${s.pos.y}`);
    seen.add(i);
    if (i === plan.entrance.y * w + plan.entrance.x || i === plan.exit.y * w + plan.exit.x) fail('spawn on entrance/exit');
    if (plan.roomIds[i] !== s.roomId) fail(`spawn roomId mismatch at ${s.pos.x},${s.pos.y}`);
    const c = perRoom.get(s.roomId) ?? { monster: 0, boss: 0, chest: 0 };
    c[s.role]++;
    perRoom.set(s.roomId, c);
  }
  for (const r of rooms) {
    const c = perRoom.get(r.id) ?? { monster: 0, boss: 0, chest: 0 };
    if (r.role === 'combat' && (c.monster < 3 || c.monster > 6 || c.boss || c.chest)) fail(`combat room ${r.id} spawns ${JSON.stringify(c)}`);
    if (r.role === 'boss' && (c.boss !== 1 || c.monster < 2 || c.monster > 4 || c.chest)) fail(`boss room ${r.id} spawns ${JSON.stringify(c)}`);
    if (r.role === 'treasure' && (c.chest !== 1 || c.monster || c.boss)) fail(`treasure room ${r.id} spawns ${JSON.stringify(c)}`);
    if (r.role === 'entrance' && (c.monster || c.boss || c.chest)) fail('entrance room has spawns');
  }

  // Props and lights.
  const propAt = new Map<string, boolean>();
  const blockingAt = new Set<number>();
  for (const p of plan.props) {
    const allowed = COMMON_PROPS.includes(p.type) || (THEME_PROPS[plan.theme] ?? []).includes(p.type);
    if (!allowed) fail(`prop ${p.type} not allowed in ${plan.theme}`);
    if (PROP_BLOCKING[p.type] !== p.blocking) fail(`prop ${p.type} blocking flag wrong`);
    if (!cellOk(p.pos)) {
      fail('prop out of bounds');
      continue;
    }
    const i = p.pos.y * w + p.pos.x;
    const k = plan.kinds[i] as number;
    if (k !== CellKind.Floor) fail(`prop ${p.type} at ${p.pos.x},${p.pos.y} not on a floor cell`);
    if (p.rotation < 0 || p.rotation > 3 || !Number.isInteger(p.rotation)) fail('bad prop rotation');
    if (p.blocking) {
      if (blockingAt.has(i)) fail(`two blocking props at ${p.pos.x},${p.pos.y}`);
      blockingAt.add(i);
    }
    if (p.type === 'torch') {
      const [dx, dy] = NEI4[p.rotation] as readonly [number, number];
      if (at(p.pos.x + dx, p.pos.y + dy) !== CellKind.Wall) fail(`torch at ${p.pos.x},${p.pos.y} does not face a wall`);
    }
    const key = `${p.pos.x},${p.pos.y}`;
    propAt.set(key, (propAt.get(key) ?? false) || LIGHT_TYPES.has(p.type));
  }
  if (plan.lights.length < 8 || plan.lights.length > 24) fail(`${plan.lights.length} lights (need 8..24)`);
  for (const l of plan.lights) {
    const atRest = (plan.restSpots ?? []).some((r) => r.x === l.pos.x && r.y === l.pos.y);
    if (!atRest && propAt.get(`${l.pos.x},${l.pos.y}`) !== true) fail(`light at ${l.pos.x},${l.pos.y} has no light-giving prop`);
  }
  for (const e of restSetProblems(plan)) fail(e);
  return errs;
}
