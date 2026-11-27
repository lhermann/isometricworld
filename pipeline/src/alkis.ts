/**
 * ALKIS parcels (Flurstücke) of Baden-Württemberg, LGL open data (Datenlizenz Deutschland – Namensnennung 2.0,
 * "Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0"), read from the LGL's OGC API Features (beta,
 * https://ogcapi.lgl-bw.de/beta/pygeoapi/, collection `flurstueck`; no owner data). Regions with sources "lgl":
 * the property lines the gardens follow (preset `gardens`, ground.ts → gardens.ts).
 *
 * Fetched in ~1 km tiles (a tile answers in one page of up to 10 000 parcels; more pages by offset), deduplicated
 * by id, stored as data/raw/<area>/alkis-parcels.json: { parcels: Array<[id, area m², ring lon/lat…]> }.
 *
 *   npx tsx src/alkis.ts <area>      fetch (fetch.ts does it for "lgl" regions)
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RAW } from "./paths.ts";

const API = "https://ogcapi.lgl-bw.de/beta/pygeoapi/collections/flurstueck/items";
const TILE: [number, number] = [0.01, 0.015]; // deg lat, lon (~1.1 km)
const PAGE = 10000;

export type Parcel = [string, number, number[]]; // id, amtliche Fläche (m²), outer ring as lon, lat, lon, lat…

export const parcelsFile = (area: string) => join(RAW, area, "alkis-parcels.json");

async function page(bbox: number[], offset: number) {
  const url = `${API}?f=json&bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&limit=${PAGE}&offset=${offset}&properties=amtliche_flaeche`;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { features: Array<{ id: string; properties: { amtliche_flaeche: number }; geometry: { type: string; coordinates: number[][][] | number[][][][] } }> };
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
}

/** All parcels touching bbox [s, w, n, e] into data/raw/<area>/alkis-parcels.json (skipped when it exists). */
export async function fetchParcels(area: string, [s, w, n, e]: number[]) {
  const file = parcelsFile(area);
  if (existsSync(file)) return;
  const out = new Map<string, Parcel>();
  const ny = Math.ceil((n - s) / TILE[0]), nx = Math.ceil((e - w) / TILE[1]);
  let done = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const b = [w + i * TILE[1], s + j * TILE[0], Math.min(e, w + (i + 1) * TILE[1]), Math.min(n, s + (j + 1) * TILE[0])];
    for (let off = 0; ; off += PAGE) {
      const fs = (await page(b, off)).features;
      for (const f of fs) {
        if (out.has(f.id)) continue;
        // multipolygons (rare): the largest part's outer ring
        const rings = f.geometry.type === "MultiPolygon" ? (f.geometry.coordinates as number[][][][]).map((p) => p[0]) : [(f.geometry.coordinates as number[][][])[0]];
        const ring = rings.sort((a, c) => c.length - a.length)[0];
        if (!ring || ring.length < 4) continue;
        out.set(f.id, [f.id, f.properties.amtliche_flaeche, ring.flatMap(([lo, la]) => [Math.round(lo * 1e7) / 1e7, Math.round(la * 1e7) / 1e7])]);
      }
      if (fs.length < PAGE) break;
    }
    process.stdout.write(`\r  alkis: ${++done}/${nx * ny} tiles, ${out.size} parcels`);
  }
  process.stdout.write("\n");
  writeFileSync(file, JSON.stringify({ parcels: [...out.values()] }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { AREAS } = await import("./areas.ts");
  const name = process.argv[2], area = AREAS[name];
  if (!area) throw new Error("usage: alkis.ts <area>");
  await fetchParcels(name, area.bbox);
}
