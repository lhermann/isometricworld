/**
 * Tennis nets in 3D (preset pitchMarkings; ground.ts lays out the courts, features.json `g` on sport=tennis pitches:
 * centre, axis, scale per court): a dark mesh under a white tape, between two posts 0.9 m beyond the doubles
 * lines, drawn a little thicker than life so it holds at the render's scale. The ground draws its shadow (page/ground.ts).
 * Pieces are gathered per 100 m cell, like the graves.
 */
import { CLAD, type P2, type Piece, prism } from "./landmarks/shapes.ts";

const MESH = [0.22, 0.23, 0.25], TAPE = [0.95, 0.95, 0.93], POST = [0.20, 0.32, 0.24];

export function nets3d(courts: number[], ground: (x: number, y: number) => number): Piece[] {
  const cells = new Map<string, Piece>();
  const pieceFor = (x: number, y: number, kind: string, colour: number[]) => {
    const cx = Math.floor(x / 100), cy = Math.floor(y / 100), key = `${cx}_${cy}_${kind}`;
    let p = cells.get(key);
    if (!p) {
      const x0 = cx * 100, y0 = cy * 100;
      p = { roof: [], wall: [], footprint: [[x0, y0], [x0 + 100, y0], [x0 + 100, y0 + 100], [x0, y0 + 100]], height: 3, base: ground(x0 + 50, y0 + 50) - 30, look: { roof: colour, wall: colour, style: CLAD, bare: 4 } };
      cells.set(key, p);
    }
    return p;
  };
  for (let q = 0; q < courts.length; q += 5) {
    const [cx, cy, ux, uy, s] = courts.slice(q, q + 5), n = 5.485 * s + 0.9 * s, z = ground(cx, cy);
    // a rectangle in court axes (a along the court, b across) to map metres
    const rect = (a0: number, b0: number, a1: number, b1: number): P2[] =>
      ([[a0, b0], [a1, b0], [a1, b1], [a0, b1]] as P2[]).map(([a, b]) => [cx + a * ux - b * uy, cy + a * uy + b * ux]);
    const mesh = pieceFor(cx, cy, "mesh", MESH), tape = pieceFor(cx, cy, "tape", TAPE), post = pieceFor(cx, cy, "post", POST);
    prism(mesh, rect(-0.06, -n, 0.06, n), z - mesh.base - 0.05, z - mesh.base + 0.85);
    prism(tape, rect(-0.09, -n, 0.09, n), z - tape.base + 0.85, z - tape.base + 1.0);
    for (const e of [-1, 1]) prism(post, rect(-0.12, e * n - 0.12, 0.12, e * n + 0.12), z - post.base - 0.05, z - post.base + 1.07);
  }
  return [...cells.values()];
}

/**
 * Windscreens round tennis courts (preset pitchMarkings): a 2.5 m dark green screen along the outline of each group
 * of courts. A court edge is left out where it lies inside or within 1.5 m of another tennis court (the screen runs
 * round the whole complex, not between neighbours). Features { k: "screen", l, w: height }: the ground draws their
 * shadows, gardens.ts hedges3d builds them. A pitch mapped round a whole club, holding other courts, is skipped.
 */
/** length along a polyline */
export const pathLength = (l: P2[]) => l.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0), 0);

export function screenLines(all: P2[][]): Array<{ k: string; l: P2[]; w: number }> {
  const out: Array<{ k: string; l: P2[]; w: number }> = [];
  const mid = (r: P2[]): P2 => [r.reduce((q, p) => q + p[0], 0) / r.length, r.reduce((q, p) => q + p[1], 0) / r.length];
  // a pitch mapped round a whole club (holding other courts) is not a court: left out
  const holds = (r: P2[], q: P2[]) => { const [x, y] = mid(q); let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < r[i][0] + ((y - r[i][1]) * (r[j][0] - r[i][0])) / (r[j][1] - r[i][1])) c = !c; return c; };
  const courts = all.filter((r) => !all.some((q) => q !== r && holds(r, q)));
  const box = courts.map((r) => [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))]);
  const inRing = (r: P2[], x: number, y: number) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < r[i][0] + ((y - r[i][1]) * (r[j][0] - r[i][0])) / (r[j][1] - r[i][1])) c = !c;
    return c;
  };
  const segDist = (r: P2[], x: number, y: number) => {
    let d = Infinity;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[j], [bx, by] = r[i], l2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2)) : 0;
      d = Math.min(d, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
    }
    return d;
  };
  const shared = (self: number, x: number, y: number) => courts.some((r, i) => i !== self && x > box[i][0] - 2 && x < box[i][2] + 2 && y > box[i][1] - 2 && y < box[i][3] + 2 && (inRing(r, x, y) || segDist(r, x, y) < 1.5));
  courts.forEach((r, ci) => {
    let run: P2[] = [];
    const flush = () => { if (pathLength(run) >= 2) out.push({ k: "screen", l: run, w: 2.5 }); run = []; };
    const ring = r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1] ? r.slice(0, -1) : r;
    for (let s = 0; s < ring.length; s++) {
      const a = ring[s], b = ring[(s + 1) % ring.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / 0.5));
      for (let t = run.length ? 1 : 0; t <= n; t++) {
        const x = a[0] + ((b[0] - a[0]) * t) / n, y = a[1] + ((b[1] - a[1]) * t) / n;
        if (shared(ci, x, y)) flush();
        else if (run.length >= 2 && t > 0 && t < n) run[run.length - 1] = [x, y];
        else run.push([x, y]);
      }
    }
    flush();
  });
  return out.map((f) => ({ ...f, l: f.l.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as P2) }));
}
