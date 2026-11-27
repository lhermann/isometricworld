/**
 * Graves in 3D (preset `graves`; ground.ts lays them out per cemetery field, features.json `g`): learned from an AI
 * painting of the Pragfriedhof, where graves stand out as objects, not as a pattern on the lawn.
 *
 * Each grave, 1.6× life size like its layout (true size is 2–3 px): most have a low stone rim with the bed heaped
 * inside it (ivy, bedding plants or bare earth), some are only a heap of earth; a headstone stands upright at the head
 * end. The ground draws their drop shadows (page/ground.ts); the post pass inks their edges.
 * Pieces are gathered per 100 m cell and colour, so a cemetery is a few hundred meshes, not 100 000.
 */
import { CLAD, type P2, type Piece, prism } from "./landmarks/shapes.ts";

/** beds: ivy, dark evergreen ground cover, bedding plants, bare earth */
const BEDS = [[0.36, 0.52, 0.22], [0.30, 0.45, 0.20], [0.45, 0.58, 0.27], [0.55, 0.42, 0.30]];
/** stone: light limestone, grey granite, black granite, red sandstone */
const STONES = [[0.90, 0.89, 0.86], [0.90, 0.89, 0.86], [0.62, 0.62, 0.61], [0.25, 0.25, 0.27], [0.76, 0.62, 0.52]];
const EARTH = [0.50, 0.40, 0.30];
const S = 1.6; // the layout's scale

const hash = (x: number, y: number, k: number) => { const h = Math.sin(x * 12.9898 + y * 78.233 + k * 37.719) * 43758.5453; return h - Math.floor(h); };

/** g: x, y, angle (degrees), head side per grave; ground: terrain height at a point */
export function graves3d(g: number[], ground: (x: number, y: number) => number): Piece[] {
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
  for (let q = 0; q < g.length; q += 4) {
    const x = g[q], y = g[q + 1], a = (g[q + 2] * Math.PI) / 180, head = g[q + 3] ? -1 : 1;
    const c = Math.cos(a), s = Math.sin(a);
    // a rectangle in grave axes (u across, w along; metres of life size) to map metres
    const rect = (u0: number, w0: number, u1: number, w1: number): P2[] =>
      ([[u0, w0], [u1, w0], [u1, w1], [u0, w1]] as P2[]).map(([u, w]) => [x + (u * c - w * s) * S, y + (u * s + w * c) * S]);
    const z = ground(x, y);
    const stone = STONES[Math.floor(hash(x, y, 13) * STONES.length)], si = STONES.indexOf(stone);
    const bed = Math.floor(hash(x, y, 1) * BEDS.length), rimmed = hash(x, y, 2) < 0.7;
    if (rimmed) { // a stone rim, the bed heaped inside it
      const rim = pieceFor(x, y, `rim${si}`, stone, stone);
      prism(rim, rect(-0.48, -1.05, 0.48, 1.05), z - rim.base - 0.05, z - rim.base + 0.2);
      const b = pieceFor(x, y, `bed${bed}`, BEDS[bed], BEDS[bed]);
      prism(b, rect(-0.38, -0.93, 0.38, 0.93), z - b.base, z - b.base + 0.35);
    } else { // a heap of earth, planted or bare
      const b = pieceFor(x, y, `heap${bed}`, BEDS[bed], EARTH);
      prism(b, rect(-0.42, -0.98, 0.42, 0.98), z - b.base - 0.05, z - b.base + 0.3);
    }
    // the headstone: upright at the head end, 0.8 m wide and 0.2 m thick (× 1.6), 1.0–1.4 m tall (drawn up like the layout)
    const hs = pieceFor(x, y, `stone${si}`, stone, stone), tall = 1.0 + hash(x, y, 7) * 0.4;
    prism(hs, rect(-0.4, head * 1.0 - 0.1, 0.4, head * 1.0 + 0.1), z - hs.base - 0.05, z - hs.base + tall);
  }
  return [...cells.values()];
}
