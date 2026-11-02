// Pre-download satellite tiles around the base station so the map works offline on the beach.
//
//   npm run tiles -- --yes                      (defaults: base station from config, 800 m radius, z15–19)
//   npm run tiles -- --yes --lat 6.81 --lng 79.89 --radius 1000 --minz 15 --maxz 19
//
// Tiles are saved as public/tiles/{z}/{x}/{y}.jpg, which is what config.map.offlineUrl expects.
//
// TERMS OF USE: this fetches Esri World Imagery tiles. Esri's terms restrict bulk downloading
// and offline use of basemap tiles; check that your use (a small area, a university project)
// is allowed for your account before running it. The script refuses to run without --yes,
// keeps the request rate low and never re-downloads tiles it already has.

import fs from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);

const LAT = Number(args.lat ?? 6.8122982);
const LNG = Number(args.lng ?? 79.8907368);
const RADIUS = Number(args.radius ?? 800);
const MINZ = Number(args.minz ?? 15);
const MAXZ = Number(args.maxz ?? 19);
const URL = args.url ?? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OUT = path.resolve('public/tiles');
const CONCURRENCY = 3;
const DELAY_MS = 120;

const lon2x = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const dLat = RADIUS / 111320;
const dLng = RADIUS / (111320 * Math.cos((LAT * Math.PI) / 180));

const jobs = [];
for (let z = MINZ; z <= MAXZ; z++) {
  const x0 = lon2x(LNG - dLng, z);
  const x1 = lon2x(LNG + dLng, z);
  const y0 = lat2y(LAT + dLat, z);
  const y1 = lat2y(LAT - dLat, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push({ z, x, y });
}

console.log(`Area: ${RADIUS} m around ${LAT}, ${LNG} · zoom ${MINZ}–${MAXZ} · ${jobs.length} tiles → ${OUT}`);
if (!args.yes) {
  console.log('\nRead the terms-of-use note at the top of this script, then re-run with --yes to download.');
  process.exit(0);
}

let done = 0;
let skipped = 0;
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function worker() {
  while (jobs.length) {
    const { z, x, y } = jobs.shift();
    const file = path.join(OUT, String(z), String(x), `${y}.jpg`);
    try {
      await fs.access(file);
      skipped++;
      continue;
    } catch {
      /* not downloaded yet */
    }
    try {
      const res = await fetch(URL.replace('{z}', z).replace('{x}', x).replace('{y}', y), {
        headers: { 'User-Agent': 'beach-safety-base-station (offline cache for FYP field test)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
      done++;
    } catch (e) {
      failed++;
      console.warn(`  z${z}/${x}/${y}: ${e.message}`);
    }
    if ((done + skipped + failed) % 25 === 0) process.stdout.write(`  ${done} downloaded, ${skipped} cached, ${failed} failed\r`);
    await sleep(DELAY_MS);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\nFinished: ${done} downloaded, ${skipped} already cached, ${failed} failed.`);
console.log('In the app, tick "Offline tiles" under the map (or set map.tileSource = \'offline\' in src/config.ts).');
