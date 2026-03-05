/**
 * One-time seed script: populate Firestore `funFacts` collection
 *
 * Setup:
 *   npm install firebase-admin dotenv  (if not already installed)
 *   Ensure .env has GOOGLE_APPLICATION_CREDENTIALS pointing to the service account JSON
 *
 * Run:
 *   node scripts/seed-fun-facts.mjs
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
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

if (!getApps().length) {
  initializeApp();
}
const db = getFirestore();

const FACTS = [
  {
    text: "There are over 7,000 languages spoken in the world today",
    category: "languages",
    emoji: "🌍",
    sourceLanguage: "en",
  },
  {
    text: "Mandarin Chinese has the most native speakers of any language",
    category: "languages",
    emoji: "🇨🇳",
    sourceLanguage: "en",
  },
  {
    text: "The word 'emoji' comes from the Japanese words for picture (e) and character (moji)",
    category: "communication",
    emoji: "😊",
    sourceLanguage: "ja",
  },
  {
    text: "Finnish has no grammatical gender — no 'he' or 'she', just 'hän'",
    category: "languages",
    emoji: "🇫🇮",
    sourceLanguage: "fi",
  },
  {
    text: "The shortest complete sentence in English is 'Go.'",
    category: "languages",
    emoji: "✍️",
    sourceLanguage: "en",
  },
  {
    text: "In Thailand, the traditional greeting involves pressing palms together in a 'wai'",
    category: "culture",
    emoji: "🙏",
    sourceLanguage: "th",
  },
  {
    text: "South Africa has 11 official languages — the most of any country",
    category: "languages",
    emoji: "🇿🇦",
    sourceLanguage: "en",
  },
  {
    text: "The Hawaiian alphabet has only 13 letters: 5 vowels and 8 consonants",
    category: "languages",
    emoji: "🌺",
    sourceLanguage: "haw",
  },
  {
    text: "A 'polyglot' is someone who speaks six or more languages fluently",
    category: "communication",
    emoji: "🗣️",
    sourceLanguage: "en",
  },
  {
    text: "In Japan, silence during conversation is valued as a sign of respect",
    category: "culture",
    emoji: "🇯🇵",
    sourceLanguage: "ja",
  },
  {
    text: "The most translated book in the world is 'The Little Prince'",
    category: "trivia",
    emoji: "📖",
    sourceLanguage: "fr",
  },
  {
    text: "Korean was designed as a scientific writing system by King Sejong in 1443",
    category: "languages",
    emoji: "🇰🇷",
    sourceLanguage: "ko",
  },
  {
    text: "Whistled languages exist in places like Turkey and the Canary Islands",
    category: "communication",
    emoji: "🎵",
    sourceLanguage: "en",
  },
  {
    text: "The word 'coffee' comes from the Arabic 'qahwa'",
    category: "trivia",
    emoji: "☕",
    sourceLanguage: "ar",
  },
  {
    text: "Basque, spoken in Spain and France, is not related to any other known language",
    category: "languages",
    emoji: "🏔️",
    sourceLanguage: "eu",
  },
  {
    text: "In many cultures, a head nod doesn't always mean 'yes' — in Bulgaria it means 'no'",
    category: "culture",
    emoji: "🤔",
    sourceLanguage: "bg",
  },
  {
    text: "Pirahã, an Amazonian language, has no words for specific numbers",
    category: "languages",
    emoji: "🌿",
    sourceLanguage: "myp",
  },
  {
    text: "The most common letter in English is 'E', appearing in 11% of all words",
    category: "trivia",
    emoji: "🔤",
    sourceLanguage: "en",
  },
  {
    text: "Sign languages are fully developed languages with their own grammar",
    category: "communication",
    emoji: "🤟",
    sourceLanguage: "en",
  },
  {
    text: "Icelandic has changed so little that modern speakers can read 800-year-old texts",
    category: "languages",
    emoji: "🇮🇸",
    sourceLanguage: "is",
  },
];

async function seed() {
  const collection = db.collection("funFacts");
  const existing = await collection.get();
  const existingTexts = new Set(existing.docs.map((d) => d.data().text));

  let added = 0;
  let skipped = 0;

  for (const fact of FACTS) {
    if (existingTexts.has(fact.text)) {
      console.log(`  SKIP (exists): ${fact.text.slice(0, 50)}...`);
      skipped++;
      continue;
    }

    const now = FieldValue.serverTimestamp();
    await collection.add({
      ...fact,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  ADD: ${fact.emoji} ${fact.text.slice(0, 50)}...`);
    added++;
  }

  console.log(`\nDone! Added ${added}, skipped ${skipped} (already existed).`);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
