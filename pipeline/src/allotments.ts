/**
 * Allotment gardens laid out plot by plot (preset `gardens`; learned from AI paintings of Stuttgart's Kleingärten,
 * where every plot shows its shed, its beds and the hedge round it, instead of a flat green grid). The ALKIS parcel of a
 * leased Kleingartenanlage is one large parcel, so the plots are procedural:
 *
 * - plots of 11 × 15 m on a grid turned to the allotment's own paths (the longest mapped paths inside it, else its
 *   longest edge), back to back in pairs with a 2.4 m path between the pairs; a plot only where all of it is inside
 *   the allotment and off the mapped paths, roads, water and buildings;
 * - each plot edge a low hedge or a fence (gardens.ts kinds, drawn and built like the house gardens'), shared edges once;
 * - a shed in the plot's back corner (3D, sheds3d: wooden walls, a coloured roof), unless LoD2 already has a building in
 *   the plot;
 * - beds over the front two thirds: strips of earth, rows or greens (page/ground.ts).
 *
 * Features: { k: "path", l, w } (the aisles), { k: "hedge" | "fence", l, w: height }, { k: "shed", r, v: colour, w: height },
 * { k: "beds", r }.
 */
import type { Feature } from "./ground.ts";
import { CLAD, type P2, type Piece, prism } from "./landmarks/shapes.ts";
import { pathLength } from "./courts.ts";

const hash = (x: number, y: number, k: number) => { const h = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return h - Math.floor(h); };
const PW = 11, PD = 15, AISLE = 2.4, PERIOD = 2 * PD + AISLE;

function inRing(r: P2[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < r[i][0] + ((y - r[i][1]) * (r[j][0] - r[i][0])) / (r[j][1] - r[i][1])) c = !c;
  return c;
}
const inRings = (rs: P2[][], x: number, y: number) => rs.reduce((c, r) => (inRing(r, x, y) ? !c : c), false);
const segDist = (a: P2, b: P2, x: number, y: number) => {
  const l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2, t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / l2)) : 0;
  return Math.hypot(x - a[0] - t * (b[0] - a[0]), y - a[1] - t * (b[1] - a[1]));
};

const WAYS = /^(path|plaza|lane|dirtroad|street|highway|cycle|rail|grassway)$/;

export function allotmentLayout(features: Feature[], buildings: P2[][]): Feature[] {
  const out: Feature[] = [];
  const ways = features.filter((f) => f.l && WAYS.test(f.k));
  const wet = features.filter((f) => f.r && /^(water|pool)$/.test(f.k));
  const bmid = buildings.map((fp) => [fp.reduce((a, p) => a + p[0], 0) / fp.length, fp.reduce((a, p) => a + p[1], 0) / fp.length] as P2);
  for (const f of features) {
    if (f.k !== "allotments" || !f.r) continue;
    const rings = f.r;
    let [bx0, by0, bx1, by1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of rings[0]) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    if ((bx1 - bx0) * (by1 - by0) < 600) continue;
    const near = (l: P2[]) => l.some(([x, y]) => x > bx0 - 5 && x < bx1 + 5 && y > by0 - 5 && y < by1 + 5);
    const myWays = ways.filter((w) => near(w.l!)), myWet = wet.filter((w) => near(w.r![0]));
    const myBuildings = buildings.map((fp, i) => i).filter((i) => bmid[i][0] > bx0 && bmid[i][0] < bx1 && bmid[i][1] > by0 && bmid[i][1] < by1);
    // the grid's direction: the mapped paths inside (length-weighted, mod 90°), else the longest edge
    let sx = 0, sy = 0;
    for (const w of myWays) for (let i = 1; i < w.l!.length; i++) {
      const [a, b] = [w.l![i - 1], w.l![i]], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (!inRings(rings, mx, my)) continue;
      const ang = 4 * Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      sx += Math.cos(ang) * len; sy += Math.sin(ang) * len;
    }
    if (Math.hypot(sx, sy) < 20) {
      const r = rings[0];
      let best = 0;
      for (let i = 1; i < r.length; i++) {
        const len = Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
        if (len > best) { best = len; const ang = 4 * Math.atan2(r[i][1] - r[i - 1][1], r[i][0] - r[i - 1][0]); sx = Math.cos(ang); sy = Math.sin(ang); }
      }
    }
    const th = Math.atan2(sy, sx) / 4, ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;
    const at = (u: number, v: number): P2 => [u * ux + v * vx, u * uy + v * vy];
    const cs = rings[0].map(([x, y]) => [x * ux + y * uy, x * vx + y * vy]);
    const u0 = Math.min(...cs.map((c) => c[0])), u1 = Math.max(...cs.map((c) => c[0])), v0 = Math.min(...cs.map((c) => c[1])), v1 = Math.max(...cs.map((c) => c[1]));
    // what a point may not touch: a mapped way (and its edge), water, a building (sheds aside)
    const free = (x: number, y: number) => {
      if (!inRings(rings, x, y)) return false;
      for (const w of myWays) { const r = (w.w ?? 2) / 2 + 0.5; for (let i = 1; i < w.l!.length; i++) if (segDist(w.l![i - 1], w.l![i], x, y) < r) return false; }
      for (const w of myWet) if (inRings(w.r!, x, y)) return false;
      return true;
    };
    const plots = new Map<string, { i: number; j: number; side: number }>();
    for (let j = 0; v0 + j * PERIOD < v1; j++) for (const side of [0, 1]) {
      const vb = v0 + j * PERIOD + side * PD; // plot rows: [vb, vb + PD]; the aisle after the second
      for (let i = 0; u0 + i * PW < u1; i++) {
        const ub = u0 + i * PW;
        let ok = true;
        for (let a = 0; a <= 4 && ok; a++) for (let b = 0; b <= 4 && ok; b++) { const [x, y] = at(ub + 0.3 + (a * (PW - 0.6)) / 4, vb + 0.3 + (b * (PD - 0.6)) / 4); if (!free(x, y)) ok = false; }
        if (ok) plots.set(`${i}_${j}_${side}`, { i, j, side });
      }
    }
    if (!plots.size) continue;
    // aisles: the 2.4 m strip behind each pair's second row, where plots on it exist
    for (let j = 0; v0 + j * PERIOD < v1; j++) {
      const v = v0 + j * PERIOD + 2 * PD + AISLE / 2;
      let run: P2[] = [];
      const flush = () => { if (pathLength(run) >= 8) out.push({ k: "path", l: run.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as P2), w: 2 }); run = []; };
      for (let i = 0; u0 + i * PW < u1; i++) {
        const has = plots.has(`${i}_${j}_1`) || plots.has(`${i}_${j + 1}_0`);
        if (!has) { flush(); continue; }
        if (!run.length) run.push(at(u0 + i * PW, v));
        run[1] = at(u0 + (i + 1) * PW, v);
      }
      flush();
    }
    // per plot: edges, shed, beds
    const seen = new Set<string>();
    for (const { i, j, side } of plots.values()) {
      const ub = u0 + i * PW, vb = v0 + j * PERIOD + side * PD, aisleSide = side === 1 ? 1 : 0; // the front: towards the aisle
      const [cx, cy] = at(ub + PW / 2, vb + PD / 2);
      const edges: Array<[string, P2, P2]> = [
        [`u${i}_${j}_${side}`, at(ub, vb), at(ub + PW, vb)], [`u${i}_${j}_${side + 1}`, at(ub, vb + PD), at(ub + PW, vb + PD)],
        [`v${i}_${j}_${side}`, at(ub, vb), at(ub, vb + PD)], [`v${i + 1}_${j}_${side}`, at(ub + PW, vb), at(ub + PW, vb + PD)],
      ];
      for (const [key, a, b] of edges) {
        if (seen.has(key)) continue;
        seen.add(key);
        const h = hash(a[0] + b[0], a[1] + b[1], 3), kind = h < 0.6 ? "hedge" : "fence";
        out.push({ k: kind, l: [a, b].map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as P2), w: Math.round((kind === "hedge" ? 1.0 + h * 0.5 : 1.0) * 10) / 10 });
      }
      // a shed in a back corner, unless a surveyed building stands in the plot
      const inPlot = (p: P2) => { const u = p[0] * ux + p[1] * uy - ub, v = p[0] * vx + p[1] * vy - vb; return u > 0 && u < PW && v > 0 && v < PD; };
      const surveyed = myBuildings.some((k) => inPlot(bmid[k]));
      const left = hash(cx, cy, 5) < 0.5, sw = 3.2 + hash(cx, cy, 6) * 1.2, sd = 2.6 + hash(cx, cy, 7) * 0.8;
      const su0 = left ? 1.0 : PW - 1.0 - sw, sv0 = aisleSide ? 1.0 : PD - 1.0 - sd; // back: away from the aisle
      if (!surveyed) out.push({ k: "shed", r: [[at(ub + su0, vb + sv0), at(ub + su0 + sw, vb + sv0), at(ub + su0 + sw, vb + sv0 + sd), at(ub + su0, vb + sv0 + sd)].map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as P2)], v: Math.floor(hash(cx, cy, 8) * SHED_ROOFS.length), w: 2.4 });
      // beds: 4–7 strips over the front two thirds
      const n = 4 + Math.floor(hash(cx, cy, 9) * 4), bw = 1.0, gap = 0.45, bl = PW - 2 - hash(cx, cy, 10) * 2.5;
      const fv0 = aisleSide ? PD - 0.9 - n * (bw + gap) : 0.9, bu0 = 1.0;
      const beds: P2[][] = [];
      for (let k = 0; k < n; k++) {
        const v = fv0 + k * (bw + gap);
        beds.push([at(ub + bu0, vb + v), at(ub + bu0 + bl, vb + v), at(ub + bu0 + bl, vb + v + bw), at(ub + bu0, vb + v + bw)].map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as P2));
      }
      out.push({ k: "beds", r: beds });
    }
    f.v = 1; // laid out: the ground leaves out its plain grid
  }
  return out;
}

/** roofs: red (twice as common), white, grey, green; walls: white, light wood, white, sage (as the AI paints them: bright) */
export const SHED_ROOFS = [[0.80, 0.34, 0.25], [0.80, 0.34, 0.25], [0.84, 0.84, 0.82], [0.50, 0.51, 0.53], [0.42, 0.55, 0.40]];
const SHED_WALLS = [[0.92, 0.91, 0.87], [0.76, 0.62, 0.45], [0.92, 0.91, 0.87], [0.58, 0.66, 0.52]];

/** Sheds as pieces per 100 m cell, roof colour and wall colour. */
export function sheds3d(features: Feature[], ground: (x: number, y: number) => number): Piece[] {
  const cells = new Map<string, Piece>();
  for (const f of features) {
    if (f.k !== "shed" || !f.r) continue;
    const r = f.r[0], [x, y] = r[0], wi = Math.floor(hash(x, y, 12) * SHED_WALLS.length), ri = f.v ?? 0;
    const cx = Math.floor(x / 100), cy = Math.floor(y / 100), key = `${cx}_${cy}_${ri}_${wi}`;
    let p = cells.get(key);
    if (!p) {
      const x0 = cx * 100, y0 = cy * 100;
      p = { roof: [], wall: [], footprint: [[x0, y0], [x0 + 100, y0], [x0 + 100, y0 + 100], [x0, y0 + 100]], height: 3, base: ground(x0 + 50, y0 + 50) - 30, look: { roof: SHED_ROOFS[ri], wall: SHED_WALLS[wi], style: CLAD, bare: 4 } };
      cells.set(key, p);
    }
    const z = Math.min(...r.map((q) => ground(q[0], q[1]))) - p.base;
    prism(p, r, z - 0.1, z + (f.w ?? 2.2));
  }
  return [...cells.values()];
}
