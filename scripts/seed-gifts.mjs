/**
 * One-time seed script: populate Firestore `gifts` collection
 *
 * Seeds 27 gifts used by the gacha wheel and gift store.
 * Idempotent — skips gifts that already exist (matched by document ID).
 *
 * Setup:
 *   npm install firebase-admin dotenv  (if not already installed)
 *   Ensure .env has GOOGLE_APPLICATION_CREDENTIALS pointing to the service account JSON
 *
 * Run:
 *   node scripts/seed-gifts.mjs
 */

import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  const { config } = await import("dotenv");
  config({ path: envPath });
}

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

if (!getApps().length) {
  initializeApp();
}
const db = getFirestore();

// Same catalog as worker-api/src/routes/admin-gifts.js seed endpoint
const SEED_GIFTS = [
  { id: "rose",           name: "Rose",           coinValue: 1,      order: 1  },
  { id: "lollipop",       name: "Lollipop",       coinValue: 5,      order: 2  },
  { id: "ice_cream",      name: "Ice Cream",      coinValue: 10,     order: 3  },
  { id: "coffee",         name: "Coffee",         coinValue: 25,     order: 4  },
  { id: "teddy_bear",     name: "Teddy Bear",     coinValue: 50,     order: 5  },
  { id: "chocolate_box",  name: "Chocolate Box",  coinValue: 100,    order: 6  },
  { id: "bouquet",        name: "Bouquet",         coinValue: 200,    order: 7  },
  { id: "perfume",        name: "Perfume",         coinValue: 500,    order: 8  },
  { id: "fireworks",      name: "Fireworks",       coinValue: 1000,   order: 9  },
  { id: "diamond_ring",   name: "Diamond Ring",    coinValue: 2000,   order: 10 },
  { id: "crown",          name: "Crown",           coinValue: 5000,   order: 11 },
  { id: "castle",         name: "Castle",          coinValue: 10000,  order: 12 },
  { id: "yacht",          name: "Yacht",           coinValue: 20000,  order: 13 },
  { id: "rocket",         name: "Rocket",          coinValue: 50000,  order: 14 },
  { id: "planet",         name: "Planet",          coinValue: 100000, order: 15 },
  { id: "universe",       name: "Universe",        coinValue: 200000, order: 16 },
  { id: "star",           name: "Star",            coinValue: 10,     order: 17 },
  { id: "heart",          name: "Heart",           coinValue: 25,     order: 18 },
  { id: "balloon",        name: "Balloon",         coinValue: 5,      order: 19 },
  { id: "cake",           name: "Cake",            coinValue: 50,     order: 20 },
  { id: "pizza",          name: "Pizza",           coinValue: 15,     order: 21 },
  { id: "sushi",          name: "Sushi",           coinValue: 30,     order: 22 },
  { id: "rainbow",        name: "Rainbow",         coinValue: 500,    order: 23 },
  { id: "sunflower",      name: "Sunflower",       coinValue: 100,    order: 24 },
  { id: "music_box",      name: "Music Box",       coinValue: 250,    order: 25 },
  { id: "magic_lamp",     name: "Magic Lamp",      coinValue: 1500,   order: 26 },
  { id: "treasure_chest", name: "Treasure Chest",  coinValue: 3000,   order: 27 },
];

async function seed() {
  const collection = db.collection("gifts");
  const existing = await collection.get();
  const existingIds = new Set(existing.docs.map((d) => d.id));

  let added = 0;
  let skipped = 0;

  for (const gift of SEED_GIFTS) {
    if (existingIds.has(gift.id)) {
      console.log(`  SKIP (exists): ${gift.name}`);
      skipped++;
      continue;
    }

    await collection.doc(gift.id).set({
      id:           gift.id,
      name:         gift.name,
      coinValue:    gift.coinValue,
      order:        gift.order,
      animationUrl: "",
      soundUrl:     "",
      iconUrl:      "",
      showInStore:  true,
      showOnWheel:  true,
      weight:       1.0,
    });
    console.log(`  ADD: ${gift.name} (${gift.coinValue} coins)`);
    added++;
  }

  console.log(`\nDone! Added ${added}, skipped ${skipped} (already existed).`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
