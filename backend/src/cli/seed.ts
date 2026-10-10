/**
 * Loads mock categories + exhibitors (spec §6: mock data allowed for development).
 * Category names are placeholders until the Makerspace team confirms them.
 *
 *   npm run seed            # only if the catalog and votes are empty
 *   npm run seed -- --force # wipe categories/exhibitors/votes and reseed
 */
import 'reflect-metadata';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../database/data-source';
import { runMigrationsLocked } from '../database/migrate';
import { DEFAULT_SETTINGS, sealDisplay } from '../settings/settings.service';

export const CATEGORIES = [
  { slug: 'innovation', name: 'Most Innovative Project', description: 'The boldest new idea or technique on the floor.' },
  { slug: 'impact', name: 'Best Community Impact', description: 'The project that does the most good for people or planet.' },
  { slug: 'craft', name: 'Best Craft & Design', description: 'Beautifully made — finish, materials and attention to detail.' },
];

export const EXHIBITORS: [string, string, string, string, string[]][] = [
  ['Rami Haddad', 'SolarSip', 'A backpack-sized solar still that turns brackish water into drinking water.', 'A1', ['innovation', 'impact']],
  ['Team Qamar', 'Lunar Rover Kit', 'A low-cost rover kit that school teams assemble and program in a weekend.', 'A2', ['innovation']],
  ['Lina Odeh', 'Loom 2.0', 'A desktop loom with an Arduino controller that weaves patterns from photos.', 'A3', ['craft', 'innovation']],
  ['Petra Robotics Club', 'SortBot', 'A vision-guided arm that sorts recyclables on a conveyor belt.', 'B1', ['innovation', 'impact']],
  ['Yousef & Sara', 'Braille Bricks', 'Snap-together blocks that teach Braille letters through play.', 'B2', ['impact', 'craft']],
  ['Amman Fab Kids', 'Cardboard Arcade', 'A full arcade cabinet built from cardboard by kids aged 9–13.', 'B3', ['craft']],
  ['Noor Khalil', 'Olive Bioplastic', 'Biodegradable packaging made from olive-press waste.', 'C1', ['impact', 'innovation']],
  ['Hackerspace Irbid', 'Open Weather Station', 'A solar weather station that publishes open data for farmers.', 'C2', ['impact']],
  ['Dana Saleh', 'Glowing Tatreez', 'Traditional embroidery stitched with conductive thread and tiny LEDs.', 'C3', ['craft', 'innovation']],
  ['Zaid Nasser', 'OpenHand', 'A 3D-printed prosthetic hand that costs less than a phone.', 'D1', ['impact', 'craft']],
  ['Wadi Makers', 'DripMind', 'A soil-sensor irrigation controller that cuts water use in half.', 'D2', ['impact']],
  ['Hiba Mansour', 'Clay Printer', 'A paste-extrusion 3D printer for ceramics, built from scrap.', 'D3', ['craft', 'innovation']],
  ['Team Atlas', 'BridgeBot', 'A compact inspection robot that maps hard-to-reach bridge joints with a phone camera.', 'E1', ['innovation']],
  ['Jabal Amman Girls School', 'Smart Lunch Queue', 'A student-built queue display that reduces cafeteria waiting time.', 'E2', ['innovation', 'impact']],
  ['Team Mosaic', 'TileSnap', 'A handheld scanner that helps restore patterned tiles by matching broken fragments.', 'E3', ['craft', 'innovation']],
  ['Irbid Youth Makers', 'AirWise Classroom', 'A low-cost classroom air-quality monitor with simple traffic-light alerts.', 'F1', ['impact']],
  ['Team Falafel Labs', 'HeatSafe Cart', 'A safer street-food cart burner monitor with temperature and gas-leak alerts.', 'F2', ['impact', 'innovation']],
  ['Salt Robotics Team', 'ShelfScout', 'A small robot that counts missing library books by scanning shelf labels.', 'F3', ['innovation']],
  ['Team Olive Grove', 'Harvest Helper', 'A wearable counter that helps small farms track olive harvest crates offline.', 'G1', ['impact']],
  ['Madaba Mini Makers', 'Puzzle Museum', 'Interactive laser-cut puzzles that teach children about Jordanian heritage sites.', 'G2', ['craft']],
  ['Team Circuit Garden', 'Seedling Sense', 'A nursery tray that detects dry seedlings and sends an SMS reminder.', 'G3', ['innovation', 'impact']],
  ['Aqaba Blue Team', 'Reef Reminder', 'A public display that explains reef-safe habits using sensors and simple games.', 'H1', ['impact']],
];

export async function main() {
  const force = process.argv.includes('--force');
  const ds = await new DataSource(dataSourceOptions).initialize();
  try {
    await runMigrationsLocked(ds);
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      const val = k === 'display' ? sealDisplay({ ...v, key: crypto.randomBytes(18).toString('base64url') }) : v;
      await ds.query('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [k, val]);
    }
    const imgDir = path.join(__dirname, '..', '..', 'seed', 'images');
    const seeded = await ds.transaction(async (m) => {
      await m.query('LOCK TABLE votes IN SHARE ROW EXCLUSIVE MODE');
      const existing = (await m.query(`SELECT
      (SELECT COUNT(*)::int FROM categories) AS categories,
      (SELECT COUNT(*)::int FROM exhibitors) AS exhibitors,
      (SELECT COUNT(*)::int FROM votes) AS votes`))[0];
      if (!force && (existing.categories > 0 || existing.exhibitors > 0 || existing.votes > 0)) {
        console.log(`Existing data (${existing.categories} categories, ${existing.exhibitors} exhibitors, ${existing.votes} votes) — skipping seed. Configure the event's three active categories through admin; do not reseed existing data.`);
        return false;
      }

      if (force) {
        for (const t of ['votes', 'exhibitors', 'categories', 'images']) await m.query(`DELETE FROM ${t}`);
      }
      const catIds: Record<string, number> = {};
      for (const [i, c] of CATEGORIES.entries()) {
        const r = await m.query('INSERT INTO categories (slug, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING id', [c.slug, c.name, c.description, i + 1]);
        catIds[c.slug] = r[0].id;
      }
      for (const [i, [name, project, description, booth, cats]] of EXHIBITORS.entries()) {
        const preferred = path.join(imgDir, `ex${String(i + 1).padStart(2, '0')}.jpg`);
        // Reuse existing sample artwork when a mock project has no dedicated visual.
        const file = fs.existsSync(preferred) ? preferred : path.join(imgDir, `ex${String(i % 12 + 1).padStart(2, '0')}.jpg`);
        if (!fs.existsSync(file)) throw new Error(`Missing sample visual for ${project}`);
        let imageId: string | null = null;
        if (fs.existsSync(file)) {
          const buf = fs.readFileSync(file);
          const img = await m.query('INSERT INTO images (mime_type, bytes, sha256) VALUES ($1,$2,$3) RETURNING id',
            ['image/jpeg', buf, crypto.createHash('sha256').update(buf).digest('hex')]);
          imageId = img[0].id;
        }
        const ex = await m.query('INSERT INTO exhibitors (name, project, description, booth, image_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [name, project, description, booth, imageId]);
        for (const slug of cats) await m.query('INSERT INTO exhibitor_categories VALUES ($1,$2)', [ex[0].id, catIds[slug]]);
      }
      return true;
    });
    if (seeded) console.log(`Seeded ${CATEGORIES.length} categories and ${EXHIBITORS.length} exhibitors.`);
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
