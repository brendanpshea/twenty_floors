/** SVG glyphs for the puzzle views. Built with createElementNS only (never innerHTML). */

const NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) e.appendChild(c);
  return e;
}

interface GlyphDef {
  name: string;
  color: string;
  /** Stroked outline paths. */
  strokes: string[];
  /** Paths filled (translucent) in the same colour. */
  fills?: string[];
  /** Solid fills (dots). */
  solids?: string[];
}

/** Six runes: each differs in SHAPE as well as colour. */
export const GLYPHS: GlyphDef[] = [
  { name: 'Fehu', color: '#66cfc1', strokes: ['M8 3.5v17', 'M8 8.5l8.5-5', 'M8 14l8.5-5'] },
  { name: 'Diamond', color: '#e39a3d', strokes: ['M12 2.8l7.7 9.2-7.7 9.2L4.3 12z'], fills: ['M12 2.8l7.7 9.2-7.7 9.2L4.3 12z'] },
  { name: 'Delta', color: '#b79cf0', strokes: ['M12 3.8l8.6 15.4H3.4z'], fills: ['M12 3.8l8.6 15.4H3.4z'] },
  { name: 'Eye', color: '#f06a6f', strokes: ['M12 4.2a7.8 7.8 0 1 0 .01 0z'], solids: ['M12 9.4a2.6 2.6 0 1 0 .01 0z'] },
  { name: 'Gebo', color: '#efd391', strokes: ['M5 5l14 14', 'M19 5L5 19'] },
  { name: 'Algiz', color: '#7db4f2', strokes: ['M12 21V4.5', 'M12 11L5.2 4.2', 'M12 11l6.8-6.8', 'M6 14.5h12'] },
];

export function runeName(i: number): string {
  return GLYPHS[i % GLYPHS.length]?.name ?? 'Rune';
}

/** Glyph by 0-based index. */
export function glyph(index: number): SVGSVGElement {
  const g = GLYPHS[index % GLYPHS.length] as GlyphDef;
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'tf-pz-glyph', 'aria-hidden': 'true', focusable: 'false' });
  svg.style.color = g.color;
  for (const d of g.fills ?? []) svg.appendChild(svgEl('path', { d, fill: 'currentColor', 'fill-opacity': 0.28, stroke: 'none' }));
  for (const d of g.strokes) {
    svg.appendChild(svgEl('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  for (const d of g.solids ?? []) svg.appendChild(svgEl('path', { d, fill: 'currentColor', stroke: 'none' }));
  return svg;
}

const BITS = [1, 2, 4, 8];
const ENDS: Array<[number, number]> = [
  [50, 0],
  [100, 50],
  [50, 100],
  [0, 50],
];
/** Short perpendicular bar marking a loose end, per direction. */
const LOOSE: Array<[number, number, number, number]> = [
  [28, 4, 72, 4],
  [96, 28, 96, 72],
  [28, 96, 72, 96],
  [4, 28, 4, 72],
];

export interface PipeStyle {
  powered: boolean;
  /** Mask of loose ends. */
  loose: number;
  source: boolean;
  locked: boolean;
}

/** One conduit tile, drawn from its mask. */
export function pipeTile(mask: number, st: PipeStyle): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'tf-pz-pipe', 'aria-hidden': 'true', focusable: 'false' });
  const col = st.powered ? '#66cfc1' : '#a8905a';
  const sink = BITS.filter((b) => mask & b).length === 1;
  for (let d = 0; d < 4; d++) {
    if (!(mask & (BITS[d] as number))) continue;
    const [x, y] = ENDS[d] as [number, number];
    svg.appendChild(svgEl('line', { x1: 50, y1: 50, x2: x, y2: y, stroke: col, 'stroke-width': 24 }));
    svg.appendChild(svgEl('line', { x1: 50, y1: 50, x2: x, y2: y, stroke: '#0b0a10', 'stroke-width': 7, 'stroke-opacity': 0.5 }));
  }
  svg.appendChild(svgEl('circle', { cx: 50, cy: 50, r: sink ? 22 : 16, fill: col }));
  svg.appendChild(svgEl('circle', { cx: 50, cy: 50, r: sink ? 11 : 6, fill: '#0b0a10', 'fill-opacity': 0.55 }));
  if (st.source) {
    svg.appendChild(svgEl('circle', { cx: 50, cy: 50, r: 31, fill: 'none', stroke: '#efd391', 'stroke-width': 5 }));
    svg.appendChild(svgEl('circle', { cx: 50, cy: 50, r: 25, fill: 'none', stroke: '#0b0a10', 'stroke-width': 2, 'stroke-opacity': 0.6 }));
  }
  for (let d = 0; d < 4; d++) {
    if (!(st.loose & (BITS[d] as number))) continue;
    const [x1, y1, x2, y2] = LOOSE[d] as [number, number, number, number];
    svg.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: '#e24a50', 'stroke-width': 7, 'stroke-linecap': 'round' }));
  }
  if (st.locked) {
    for (const [cx, cy] of [
      [12, 12],
      [88, 12],
      [12, 88],
      [88, 88],
    ] as const) {
      svg.appendChild(svgEl('circle', { cx, cy, r: 5.5, fill: '#c9a45c' }));
      svg.appendChild(svgEl('circle', { cx, cy, r: 2, fill: '#0b0a10', 'fill-opacity': 0.6 }));
    }
  }
  return svg;
}

/** Ward mark (a pennant on a staff): a trap the player has marked. */
export function wardFlag(): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'tf-pz-glyph', 'aria-hidden': 'true', focusable: 'false' });
  svg.style.color = '#66cfc1';
  svg.appendChild(svgEl('path', { d: 'M7 3.5v17', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
  svg.appendChild(svgEl('path', { d: 'M7.5 4.5l12 4.5-12 4.5z', fill: 'currentColor', 'fill-opacity': 0.35, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  return svg;
}

/** A sprung trap: spiked burst with a cross. */
export function wardSprung(): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'tf-pz-glyph', 'aria-hidden': 'true', focusable: 'false' });
  svg.style.color = '#f06a6f';
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    const r = i % 2 === 0 ? 10 : 5.2;
    pts.push(`${(12 + Math.cos(a) * r).toFixed(2)},${(12 + Math.sin(a) * r).toFixed(2)}`);
  }
  svg.appendChild(svgEl('polygon', { points: pts.join(' '), fill: 'currentColor', 'fill-opacity': 0.35, stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }));
  svg.appendChild(svgEl('path', { d: 'M9 9l6 6M15 9l-6 6', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linecap': 'round', fill: 'none' }));
  return svg;
}

export function hourglass(): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'tf-pz-hourglass', 'aria-hidden': 'true', focusable: 'false' });
  svg.appendChild(svgEl('path', { d: 'M6 3h12M6 21h12M7 3c0 5 4 6 5 9-1 3-5 4-5 9M17 3c0 5-4 6-5 9 1 3 5 4 5 9', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  svg.appendChild(svgEl('path', { d: 'M9.5 18.5c.7-1.4 1.6-1.9 2.5-2 .9.1 1.8.6 2.5 2z', fill: 'currentColor', 'fill-opacity': 0.7 }));
  return svg;
}

/** Padlock for the solved flourish; the shackle lifts via CSS on `.is-open`. */
export function padlock(): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 48 56', class: 'tf-pz-padlock', 'aria-hidden': 'true', focusable: 'false' });
  const shackle = svgEl('path', {
    class: 'tf-pz-shackle',
    d: 'M14 26V16a10 10 0 0 1 20 0v10',
    fill: 'none',
    stroke: '#efd391',
    'stroke-width': 5,
    'stroke-linecap': 'round',
  });
  svg.appendChild(shackle);
  svg.appendChild(svgEl('rect', { x: 6, y: 24, width: 36, height: 28, rx: 5, fill: '#c9a45c', stroke: '#7d6535', 'stroke-width': 2 }));
  svg.appendChild(svgEl('circle', { cx: 24, cy: 35, r: 4.5, fill: '#0b0a10' }));
  svg.appendChild(svgEl('path', { d: 'M24 38v8', stroke: '#0b0a10', 'stroke-width': 4, 'stroke-linecap': 'round' }));
  return svg;
}
