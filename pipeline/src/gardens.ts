/**
 * Property lines of house gardens (preset `gardens`; learned from AI paintings of Stuttgart's residential streets,
 * where every plot is framed by a hedge or a fence). ground.ts lays them out from the ALKIS parcels (alkis.ts): a
 * parcel holding a dwelling (LoD2 function 31001_1000…1199) is a garden; each of its edges becomes a hedge, a fence
 * or nothing (hashed per edge, so a shared edge gets one), cut where it runs through a building, a street with its
 * pavements, a path, a parking lot or water. Street fronts get lower hedges, cut where the driveways cross.
 *
 * Features: { k: "hedge" | "fence", l: polyline, w: height (m) }. The ground draws their shadows and the fences
 * themselves (page/ground.ts: a thin line; in 3D a fence's ink outline drew it as a dark bar), scene.ts builds the
 * hedges in 3D (hedges3d).
 *
 * Planted edges and front gardens, as the paintings have them: bushes in clumps along the inside of each plot's
 * edges (densest in the front strip, sparse behind a hedge) and along the house walls, a quarter of them flowering
 * ({ k: "bushes", g: [x, y, radius, top, bloom]… }, scene.ts → renderer bushes); a paved path from the street front
 * to the house where no driveway reaches it, with a gap in the front hedge ({ k: "gpath", l, w: width }).
 */
import type { Feature } from "./ground.ts";
import { CLAD, type P2, type Piece, prism } from "./landmarks/shapes.ts";
import type { Parcel } from "./alkis.ts";
import { pathLength } from "./courts.ts";

const hash = (x: number, y: number, k: number) => { const h = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return h - Math.floor(h); };

function inRing(r: P2[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < xi + ((y - yi) * (xj - xi)) / (yj - yi)) c = !c;
  }
  return c;
}

/** A 1 m raster of where no hedge may stand. */
class Blocked {
  a: Uint8Array; nx: number; ny: number;
  constructor(public x0: number, public y0: number, x1: number, y1: number) {
    this.nx = Math.ceil(x1 - x0) + 1; this.ny = Math.ceil(y1 - y0) + 1; this.a = new Uint8Array(this.nx * this.ny);
  }
  at(x: number, y: number) {
    const i = Math.floor(x - this.x0), j = Math.floor(y - this.y0);
    return i < 0 || j < 0 || i >= this.nx || j >= this.ny ? 1 : this.a[j * this.nx + i];
  }
  /** polygon (even-odd rings), grown by `pad` cells */
  fill(rings: P2[][], pad = 0) {
    let y0 = Infinity, y1 = -Infinity;
    for (const r of rings) for (const p of r) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    for (let j = Math.max(0, Math.floor(y0 - this.y0)); j <= Math.min(this.ny - 1, Math.ceil(y1 - this.y0)); j++) {
      const y = this.y0 + j + 0.5, xs: number[] = [];
      for (const r of rings) for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
        const [xi, yi] = r[i], [xk, yk] = r[k];
        if (yi > y !== yk > y) xs.push(xi + ((y - yi) * (xk - xi)) / (yk - yi));
      }
      xs.sort((p, q) => p - q);
      for (let q = 0; q + 1 < xs.length; q += 2)
        for (let i = Math.max(0, Math.floor(xs[q] - this.x0) - pad); i <= Math.min(this.nx - 1, Math.floor(xs[q + 1] - this.x0) + pad); i++)
          for (let d = -pad; d <= pad; d++) if (j + d >= 0 && j + d < this.ny) this.a[(j + d) * this.nx + i] = 1;
    }
  }
  /** a line `r` metres either side */
  line(l: P2[], r: number) {
    const R = Math.ceil(r);
    for (let s = 1; s < l.length; s++) {
      const [ax, ay] = l[s - 1], [bx, by] = l[s], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let t = 0; t <= n; t++) {
        const x = ax + ((bx - ax) * t) / n, y = ay + ((by - ay) * t) / n, ci = Math.floor(x - this.x0), cj = Math.floor(y - this.y0);
        for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
          if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
          if (Math.hypot(this.x0 + i + 0.5 - x, this.y0 + j + 0.5 - y) <= r) this.a[j * this.nx + i] = 1;
        }
      }
    }
  }
}

/** street kinds and how far their paving reaches past half the carriageway (pavements) */
const WAYS: Record<string, number> = { highway: 3, street: 1.5, lane: 0.6, dirtroad: 0.4, path: 0.3, plaza: 0.3, cycle: 0.3, rail: 1.5 };
const PAVED = /^(parking|paving|plaza|water|pool|pitch|playground|platform|railyard|tarmac|construction)$/;

export function gardenLines(parcels: Parcel[], dwellings: Array<{ fp: P2[]; fn: string }>, features: Feature[], toEnu: (lon: number, lat: number) => P2, bbox: number[]): Feature[] {
  // gardens: parcels a dwelling stands on (by its centroid)
  const [ex0, ey0, ex1, ey1] = bbox;
  const rings: P2[][] = [];
  for (const [, area, c] of parcels) {
    if (area < 100 || area > 6000) continue;
    const r: P2[] = [];
    for (let i = 0; i < c.length; i += 2) r.push(toEnu(c[i], c[i + 1]));
    if (r.every(([x, y]) => x < ex0 || x > ex1 || y < ey0 || y > ey1)) continue;
    rings.push(r);
  }
  const grid = new Map<string, number[]>();
  rings.forEach((r, i) => {
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / 50); gx <= Math.floor(Math.max(...xs) / 50); gx++)
      for (let gy = Math.floor(Math.min(...ys) / 50); gy <= Math.floor(Math.max(...ys) / 50); gy++) (grid.get(`${gx}_${gy}`) ?? grid.set(`${gx}_${gy}`, []).get(`${gx}_${gy}`)!).push(i);
  });
  const garden = new Set<number>();
  for (const d of dwellings) {
    const code = Number(d.fn.split("_")[1]);
    if (d.fn.split("_")[0] !== "31001" || !(code >= 1000 && code < 1200)) continue;
    const cx = d.fp.reduce((a, p) => a + p[0], 0) / d.fp.length, cy = d.fp.reduce((a, p) => a + p[1], 0) / d.fp.length;
    for (const i of grid.get(`${Math.floor(cx / 50)}_${Math.floor(cy / 50)}`) ?? []) if (inRing(rings[i], cx, cy)) garden.add(i);
  }
  if (!garden.size) return [];

  // where hedges can't stand
  let [bx0, by0, bx1, by1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const i of garden) for (const [x, y] of rings[i]) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  const blocked = new Blocked(bx0 - 2, by0 - 2, bx1 + 2, by1 + 2);
  for (const d of dwellings) blocked.fill([d.fp], 1);
  const front = new Blocked(bx0 - 2, by0 - 2, bx1 + 2, by1 + 2); // near a street: the front of the plot
  for (const f of features) {
    if (f.l && WAYS[f.k] !== undefined) {
      blocked.line(f.l, (f.w ?? 3) / 2 + WAYS[f.k]);
      if (/^(street|lane|highway)$/.test(f.k)) front.line(f.l, (f.w ?? 3) / 2 + WAYS[f.k] + 6);
    } else if (f.r && PAVED.test(f.k)) blocked.fill(f.r);
  }

  // the houses on each garden; a paved path from the street front to the nearest wall where nothing paved reaches it
  const houses = new Map<number, P2[][]>();
  for (const d of dwellings) {
    const code = Number(d.fn.split("_")[1]);
    if (d.fn.split("_")[0] !== "31001" || !(code >= 1000 && code < 1200)) continue;
    const cx = d.fp.reduce((a, p) => a + p[0], 0) / d.fp.length, cy = d.fp.reduce((a, p) => a + p[1], 0) / d.fp.length;
    for (const i of grid.get(`${Math.floor(cx / 50)}_${Math.floor(cy / 50)}`) ?? []) if (garden.has(i) && inRing(rings[i], cx, cy)) (houses.get(i) ?? houses.set(i, []).get(i)!).push(d.fp);
  }
  const near = (a: P2, b: P2, p: P2): [P2, number] => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    const q: P2 = [a[0] + dx * t, a[1] + dy * t];
    return [q, Math.hypot(q[0] - p[0], q[1] - p[1])];
  };
  const out: Feature[] = [], paths: P2[][] = [];
  for (const [pi, fps] of houses) {
    const r = rings[pi], m = r.length, fp = fps[0];
    const hc: P2 = [fp.reduce((a, p) => a + p[0], 0) / fp.length, fp.reduce((a, p) => a + p[1], 0) / fp.length];
    let best: [P2, number] | null = null;
    for (let s = 0; s < m; s++) {
      const a = r[s], b = r[(s + 1) % m];
      if (front.at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) !== 1) continue;
      const c = near(a, b, hc);
      if (!best || c[1] < best[1]) best = c;
    }
    if (!best) continue;
    let door: [P2, number] | null = null;
    for (let s = 0; s < fp.length; s++) { const c = near(fp[s], fp[(s + 1) % fp.length], best[0]); if (!door || c[1] < door[1]) door = c; }
    const [a, b] = [best[0], door![0]], len = door![1];
    if (len < 3 || len > 30) continue;
    let free = true;
    for (let d = 1.5; d < len - 1.8 && free; d += 0.5) free = !blocked.at(a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len);
    if (!free) continue; // a driveway or a path already
    paths.push([a, b]);
    out.push({ k: "gpath", l: [a, b].map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as P2), w: 1.2 });
  }
  for (const l of paths) blocked.line(l, 0.9); // the gate in the front hedge

  // each garden's outline in stretches (its street front, each side: consecutive edges alike), one kind and height
  // per stretch, so a curved front made of many short edges stays one hedge; shared edges drawn once
  const seen = new Set<string>(), bushes = new Map<number, number[]>(), taken = new Set<string>();
  /** a bush at x, y unless the spot is paved, built on, outside the plot or taken; clumped by a 5 m noise */
  const plant = (pi: number, x: number, y: number, low: boolean) => {
    const k = `${Math.round(x / 1.8)},${Math.round(y / 1.8)}`;
    if (taken.has(k) || blocked.at(x, y) || !inRing(rings[pi], x, y)) return;
    taken.add(k);
    // drawn ~1.6× life size like the graves (a true 1 m bush is 2–3 px)
    const h = hash(x, y, 21), r = 0.85 + hash(x, y, 22) * 0.6, top = low ? 1.0 + h * 0.6 : 1.3 + h * 1.2;
    const bl = hash(x, y, 23), bloom = bl < 0.09 ? 1 : bl < 0.15 ? 2 : bl < 0.2 ? 3 : bl < 0.24 ? 4 : 0;
    (bushes.get(pi) ?? bushes.set(pi, []).get(pi)!).push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(r * 10) / 10, Math.round(top * 10) / 10, bloom);
  };
  const clump = (x: number, y: number) => (hash(Math.floor(x / 5), Math.floor(y / 5), 24) < 0.55 ? 1.5 : 0.35);
  const key = (p: P2) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  for (const pi of garden) {
    const r = rings[pi], m = r.length;
    const cx = r.reduce((q, p) => q + p[0], 0) / m, cy = r.reduce((q, p) => q + p[1], 0) / m;
    const isFront = r.map((a, s) => { const b = r[(s + 1) % m]; return front.at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) === 1; });
    // a stretch ends where the front flag changes or the outline turns a corner (> 35°)
    const turn = (s: number) => {
      const a = r[(s + m - 1) % m], b = r[s], c = r[(s + 1) % m];
      const d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
      return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) > 0.6 || isFront[s] !== isFront[(s + m - 1) % m];
    };
    let start = 0;
    while (start < m && !turn(start)) start++;
    if (start === m) start = 0;
    const stretches: number[][] = [];
    for (let q = 0; q < m; q++) {
      const s = (start + q) % m;
      if (q === 0 || turn(s)) stretches.push([]);
      stretches.at(-1)!.push(s);
    }
    for (const st of stretches) {
      const a0 = r[st[0]], fr = isFront[st[0]];
      const total = st.reduce((q, s) => q + Math.hypot(r[(s + 1) % m][0] - r[s][0], r[(s + 1) % m][1] - r[s][1]), 0);
      if (total < 2) continue;
      const pick = hash(Math.round(a0[0] + cx), Math.round(a0[1] + cy), 3);
      const kind = pick < 0.55 ? "hedge" : pick < 0.85 ? "fence" : null;
      // planted edge: bushes 1 m inside the line (front: inside the front hedge), every 1.6 m by chance
      const pb = fr ? 0.6 : kind === "hedge" ? 0.2 : 0.45, inset = fr ? 2.2 : 1.4;
      for (const s of st) {
        const a = r[s], b = r[(s + 1) % m], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.5) continue;
        const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, side = (cx - a[0]) * -uy + (cy - a[1]) * ux > 0 ? 1 : -1;
        for (let d = 1.0; d < len - 0.8; d += 2.0) {
          const x = a[0] + ux * d - uy * inset * side, y = a[1] + uy * d + ux * inset * side;
          if (hash(x, y, 25) < pb * clump(x, y)) plant(pi, x, y, fr);
        }
      }
      if (!kind) continue;
      const hh = hash(a0[0], a0[1], 5), h = kind === "fence" ? 1.0 + hh * 0.4 : fr ? 0.9 + hh * 0.4 : 1.3 + hh * 0.6;
      let run: P2[] = [];
      const flush = () => {
        if (pathLength(run) >= 2.5)
          out.push({ k: kind, l: run.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as P2), w: Math.round(h * 10) / 10 });
        run = [];
      };
      for (const s of st) {
        const a = r[s], b = r[(s + 1) % m], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const k = [key(a), key(b)].sort().join("|"), dup = seen.has(k);
        seen.add(k);
        if (dup || len < 0.05) { flush(); continue; }
        const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
        // street fronts 0.8 m into the plot, off the pavement (sidewalks are mapped as their own footways)
        const side = (cx - a[0]) * -uy + (cy - a[1]) * ux > 0 ? 1 : -1, off = fr ? 0.8 : 0, ox = -uy * off * side, oy = ux * off * side;
        const n = Math.ceil(len / 0.5);
        for (let t = run.length ? 1 : 0; t <= n; t++) {
          const d = (len * t) / n, x = a[0] + ux * d + ox, y = a[1] + uy * d + oy;
          if (blocked.at(x, y)) flush(); // a driveway (OSM service lane), a house, a path
          else if (run.length >= 2 && t > 0 && t < n) run[run.length - 1] = [x, y]; // straight: move the end
          else run.push([x, y]);
        }
      }
      flush();
    }
  }
  // along the house walls: a bed 1.6 m out from the wall
  for (const [pi, fps] of houses) for (const fp of fps) {
    const n = fp.length;
    for (let s = 0; s < n; s++) {
      const a = fp[s], b = fp[(s + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) continue;
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const side = inRing(fp, mx - uy * 0.3, my + ux * 0.3) ? -1 : 1; // outward
      for (let d = 1.0; d < len - 0.8; d += 2.2) {
        const x = a[0] + ux * d - uy * 2.0 * side, y = a[1] + uy * d + ux * 2.0 * side;
        if (hash(x, y, 26) < 0.3 * clump(x, y)) plant(pi, x, y, false);
      }
    }
  }
  for (const g of bushes.values()) out.push({ k: "bushes", g });
  return out;
}

const SCREEN = [0.13, 0.27, 0.19];
const LEAF = [[0.26, 0.42, 0.20], [0.22, 0.38, 0.19], [0.30, 0.46, 0.22]], LEAF_TOP = [[0.36, 0.53, 0.25], [0.31, 0.49, 0.23], [0.40, 0.57, 0.27]];

/** Hedges, 0.8 m thick and a little lighter on top, and tennis windscreens (courts.ts), as pieces per 100 m cell and colour. */
export function hedges3d(features: Feature[], ground: (x: number, y: number) => number): Piece[] {
  const cells = new Map<string, Piece>();
  const pieceFor = (x: number, y: number, kind: string, roof: number[], wall: number[]) => {
    const cx = Math.floor(x / 100), cy = Math.floor(y / 100), key = `${cx}_${cy}_${kind}`;
    let p = cells.get(key);
    if (!p) {
      const x0 = cx * 100, y0 = cy * 100;
      p = { roof: [], wall: [], footprint: [[x0, y0], [x0 + 100, y0], [x0 + 100, y0 + 100], [x0, y0 + 100]], height: 3, base: ground(x0 + 50, y0 + 50) - 30, look: { roof, wall, style: CLAD, bare: 4 } };
      cells.set(key, p);
    }
    return p;
  };
  for (const f of features) {
    if ((f.k !== "hedge" && f.k !== "screen") || !f.l) continue;
    const h = f.w ?? 1.2, [mx, my] = f.l[0], half = f.k === "screen" ? 0.1 : 0.4;
    const c = Math.floor(hash(Math.round(mx), Math.round(my), 11) * 3);
    const p = f.k === "screen" ? pieceFor(mx, my, "screen", SCREEN, SCREEN) : pieceFor(mx, my, `hedge${c}`, LEAF_TOP[c], LEAF[c]);
    for (let s = 1; s < f.l.length; s++) {
      const a = f.l[s - 1], b = f.l[s], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.1) continue;
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      // in ~4 m pieces so the top follows the ground; each a little longer so the corners close
      const n = Math.max(1, Math.ceil(len / 4)), nx = -uy * half, ny = ux * half;
      for (let i = 0; i < n; i++) {
        const d0 = (len * i) / n - (i === 0 ? 0.3 : 0), d1 = (len * (i + 1)) / n + (i === n - 1 ? 0.3 : 0);
        const p0: P2 = [a[0] + ux * d0, a[1] + uy * d0], p1: P2 = [a[0] + ux * d1, a[1] + uy * d1];
        const z = Math.min(ground(p0[0], p0[1]), ground(p1[0], p1[1])) - p.base;
        prism(p, [[p0[0] + nx, p0[1] + ny], [p1[0] + nx, p1[1] + ny], [p1[0] - nx, p1[1] - ny], [p0[0] - nx, p0[1] - ny]], z - 0.1, z + h);
      }
    }
  }
  return [...cells.values()];
}
