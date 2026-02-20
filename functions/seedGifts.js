const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const catalog = [
  { name: "Rose", coinValue: 8, baseDropRate: 0.70, bracket: "COMMON", order: 1 },
  { name: "Heart", coinValue: 10, baseDropRate: 0.70, bracket: "COMMON", order: 2 },
  { name: "Thumbs Up", coinValue: 12, baseDropRate: 0.70, bracket: "COMMON", order: 3 },
  { name: "Star", coinValue: 15, baseDropRate: 0.70, bracket: "COMMON", order: 4 },
  { name: "Smiley", coinValue: 18, baseDropRate: 0.70, bracket: "COMMON", order: 5 },
  { name: "Coffee", coinValue: 20, baseDropRate: 0.70, bracket: "COMMON", order: 6 },
  { name: "Candy", coinValue: 25, baseDropRate: 0.70, bracket: "COMMON", order: 7 },
  { name: "Balloon", coinValue: 30, baseDropRate: 0.70, bracket: "COMMON", order: 8 },
  { name: "Teddy Bear", coinValue: 50, baseDropRate: 0.20, bracket: "UNCOMMON", order: 9 },
  { name: "Perfume", coinValue: 80, baseDropRate: 0.20, bracket: "UNCOMMON", order: 10 },
  { name: "Diamond Ring", coinValue: 120, baseDropRate: 0.20, bracket: "UNCOMMON", order: 11 },
  { name: "Bouquet", coinValue: 150, baseDropRate: 0.20, bracket: "UNCOMMON", order: 12 },
  { name: "Fireworks", coinValue: 200, baseDropRate: 0.20, bracket: "UNCOMMON", order: 13 },
  { name: "Music Box", coinValue: 300, baseDropRate: 0.20, bracket: "UNCOMMON", order: 14 },
  { name: "Treasure Chest", coinValue: 500, baseDropRate: 0.08, bracket: "RARE", order: 15 },
  { name: "Crown", coinValue: 800, baseDropRate: 0.08, bracket: "RARE", order: 16 },
  { name: "Sports Car", coinValue: 1200, baseDropRate: 0.08, bracket: "RARE", order: 17 },
  { name: "Yacht", coinValue: 1800, baseDropRate: 0.08, bracket: "RARE", order: 18 },
  { name: "Dragon", coinValue: 2500, baseDropRate: 0.08, bracket: "RARE", order: 19 },
  { name: "Phoenix", coinValue: 3500, baseDropRate: 0.08, bracket: "RARE", order: 20 },
  { name: "Crystal Ball", coinValue: 5000, baseDropRate: 0.018, bracket: "EPIC", order: 21 },
  { name: "Castle", coinValue: 8000, baseDropRate: 0.018, bracket: "EPIC", order: 22 },
  { name: "Spaceship", coinValue: 12000, baseDropRate: 0.018, bracket: "EPIC", order: 23 },
  { name: "Aurora", coinValue: 16000, baseDropRate: 0.018, bracket: "EPIC", order: 24 },
  { name: "Galaxy Unicorn", coinValue: 20000, baseDropRate: 0.018, bracket: "EPIC", order: 25 },
  { name: "ShyTalk Emblem", coinValue: 35000, baseDropRate: 0.002, bracket: "LEGENDARY", order: 26 },
  { name: "Celestial Throne", coinValue: 52000, baseDropRate: 0.002, bracket: "LEGENDARY", order: 27 },
];

async function seed() {
  const batch = db.batch();
  for (const gift of catalog) {
    const docId = gift.name.toLowerCase().replace(/\s+/g, "_");
    batch.set(db.collection("gifts").doc(docId), {
      ...gift,
      beanValue: Math.floor(gift.coinValue * 0.6),
      broadcastEnabled: gift.bracket === "LEGENDARY",
      animationUrl: "",
      soundUrl: "",
      iconUrl: "",
    }, { merge: true });
  }
  await batch.commit();
  console.log(`Seeded ${catalog.length} gifts`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
