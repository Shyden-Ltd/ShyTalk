const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const STORAGE_BASE = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/gifts%2Ficons%2F";
const TOKEN_SUFFIX = "?alt=media";
function iconUrl(giftId) { return `${STORAGE_BASE}${giftId}.png${TOKEN_SUFFIX}`; }

const catalog = [
  { name: "Rose", coinValue: 8, order: 1, docId: "rose" },
  { name: "Heart", coinValue: 10, order: 2, docId: "heart" },
  { name: "Thumbs Up", coinValue: 12, order: 3, docId: "thumbs_up" },
  { name: "Star", coinValue: 15, order: 4, docId: "star" },
  { name: "Smiley", coinValue: 18, order: 5, docId: "smiley" },
  { name: "Coffee", coinValue: 20, order: 6, docId: "coffee" },
  { name: "Candy", coinValue: 25, order: 7, docId: "candy" },
  { name: "Balloon", coinValue: 30, order: 8, docId: "balloon" },
  { name: "Teddy Bear", coinValue: 50, order: 9, docId: "teddy_bear" },
  { name: "Perfume", coinValue: 80, order: 10, docId: "perfume" },
  { name: "Diamond Ring", coinValue: 120, order: 11, docId: "diamond_ring" },
  { name: "Bouquet", coinValue: 150, order: 12, docId: "bouquet" },
  { name: "Fireworks", coinValue: 200, order: 13, docId: "fireworks" },
  { name: "Music Box", coinValue: 300, order: 14, docId: "music_box" },
  { name: "Treasure Chest", coinValue: 500, order: 15, docId: "treasure_chest" },
  { name: "Crown", coinValue: 800, order: 16, docId: "crown" },
  { name: "Sports Car", coinValue: 1200, order: 17, docId: "sports_car" },
  { name: "Yacht", coinValue: 1800, order: 18, docId: "yacht" },
  { name: "Dragon", coinValue: 2500, order: 19, docId: "dragon" },
  { name: "Phoenix", coinValue: 3500, order: 20, docId: "phoenix" },
  { name: "Crystal Ball", coinValue: 5000, order: 21, docId: "crystal_ball" },
  { name: "Castle", coinValue: 8000, order: 22, docId: "castle" },
  { name: "Spaceship", coinValue: 12000, order: 23, docId: "spaceship" },
  { name: "Aurora", coinValue: 16000, order: 24, docId: "aurora" },
  { name: "Galaxy Unicorn", coinValue: 20000, order: 25, docId: "galaxy_unicorn" },
  { name: "ShyTalk Emblem", coinValue: 35000, order: 26, docId: "shytalk_emblem" },
  { name: "Celestial Throne", coinValue: 52000, order: 27, docId: "celestial_throne" },
];

async function seed() {
  const batch = db.batch();
  for (const gift of catalog) {
    const { docId, ...giftData } = gift;
    batch.set(db.collection("gifts").doc(docId), {
      ...giftData,
      animationUrl: "",
      soundUrl: "",
      iconUrl: iconUrl(docId),
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
