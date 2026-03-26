/**
 * Seed Firebase Emulators with initial data.
 * Run: node local/seed.js
 *
 * Idempotent — checks if data exists before creating.
 * Uses Firebase Admin SDK pointed at emulators via env vars.
 */

const admin = require("firebase-admin");
const {
  S3Client,
  CreateBucketCommand,
  PutBucketPolicyCommand,
} = require("@aws-sdk/client-s3");

// Point at emulators
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST =
  process.env.FIREBASE_DATABASE_EMULATOR_HOST || "localhost:9000";

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "demo-shytalk" });
}

const db = admin.firestore();
const auth = admin.auth();

async function seedIfMissing(path, data) {
  const doc = await db.doc(path).get();
  if (!doc.exists) {
    await db.doc(path).set(data);
    console.log(`  Created: ${path}`);
  } else {
    console.log(`  Exists:  ${path}`);
  }
}

async function seedAuthUser(email, password, displayName, customClaims) {
  let uid;
  try {
    const existing = await auth.getUserByEmail(email);
    console.log(`  Exists:  Auth user ${email}`);
    uid = existing.uid;
  } catch (_err) {
    const created = await auth.createUser({
      email,
      password,
      displayName,
      emailVerified: true,
    });
    console.log(`  Created: Auth user ${email}`);
    uid = created.uid;
  }
  // Set custom claims (e.g., admin: true) — idempotent
  if (customClaims) {
    await auth.setCustomUserClaims(uid, customClaims);
  }
  return uid;
}

async function seed() {
  // Verify emulator is running before seeding (prevents accidental writes to cloud Firestore)
  try {
    await fetch("http://localhost:8080");
  } catch {
    console.error(
      "Firestore emulator not running at localhost:8080. Start with: bash local/start.sh",
    );
    process.exit(1);
  }

  const now = Date.now();
  console.log("Seeding Firebase Emulators...\n");

  // Config documents
  console.log("Config:");
  await seedIfMissing("config/economy", {
    dailyBonus: 50,
    spinCost: 10,
    pullCosts: { 1: 10, 10: 80, 100: 700 },
    milestoneRewards: { 7: 100, 14: 250, 30: 500 },
  });
  await seedIfMissing("config/app", {
    minVersionCode: 1,
    latestVersionCode: 1,
    latestVersionName: "1.0.0",
    accountDeletionGracePeriodDays: 30,
    inactiveAccountDeleteMonths: 0,
  });
  await seedIfMissing("config/startingScreens", {});
  await seedIfMissing("config/moderation", {
    autoModEnabled: false,
    gcsThreshold: 50,
  });
  await seedIfMissing("alertConfig/settings", {
    errorRateThreshold: 10,
    slowResponseThreshold: 5000,
    alertCooldownMs: 300000,
  });
  await seedIfMissing("logConfig/settings", {
    retentionHours: 48,
    archiveRetentionDays: 90,
  });

  // Counter
  console.log("\nCounter:");
  await seedIfMissing("counters/uniqueId", { value: 100000002 });

  // Admin user
  console.log("\nAdmin user:");
  const adminFirebaseUid = await seedAuthUser(
    "claude-test@shytalk.dev",
    "localdev123",
    "Local Admin",
    { admin: true },
  );
  await seedIfMissing("users/100000001", {
    uid: "claude-test@shytalk.dev",
    firebaseUid: adminFirebaseUid,
    uniqueId: 100000001,
    displayName: "Local Admin",
    userType: "ADMIN",
    shyCoins: 10000,
    shyBeans: 0,
    gcsScore: 100,
    warningCount: 0,
    hasActiveWarning: false,
    luckScore: 0,
    pityCounter: 0,
    loginStreak: 0,
    isSuspended: false,
    blockedUserIds: [],
    followingIds: [],
    followerIds: [],
    createdAt: now,
    lastSeenAt: now,
  });
  await seedIfMissing("identityMap/email:claude-test@shytalk.dev", {
    uniqueId: 100000001,
    provider: "email",
    identifier: "claude-test@shytalk.dev",
    linkedAt: now,
    unlinked: false,
    unlinkedAt: null,
  });

  // Regular user
  console.log("\nRegular user:");
  const userFirebaseUid = await seedAuthUser(
    "user@test.com",
    "localdev123",
    "Test User",
  );
  await seedIfMissing("users/100000002", {
    uid: "user@test.com",
    firebaseUid: userFirebaseUid,
    uniqueId: 100000002,
    displayName: "Test User",
    userType: "MEMBER",
    shyCoins: 500,
    shyBeans: 0,
    gcsScore: 100,
    warningCount: 0,
    hasActiveWarning: false,
    luckScore: 0,
    pityCounter: 0,
    loginStreak: 0,
    isSuspended: false,
    blockedUserIds: [],
    followingIds: [],
    followerIds: [],
    createdAt: now,
    lastSeenAt: now,
  });
  await seedIfMissing("identityMap/email:user@test.com", {
    uniqueId: 100000002,
    provider: "email",
    identifier: "user@test.com",
    linkedAt: now,
    unlinked: false,
    unlinkedAt: null,
  });

  // Ensure counter is at least past the seeded user IDs
  const counterDoc = await db.doc("counters/uniqueId").get();
  if (counterDoc.exists && counterDoc.data().value < 100000002) {
    await db.doc("counters/uniqueId").set({ value: 100000002 });
  }

  // Sample gifts
  console.log("\nSample content:");
  await seedIfMissing("gifts/local-gift-1", {
    name: "Heart",
    coinValue: 10,
    showInStore: true,
    showOnWheel: true,
    weight: 1.0,
    order: 0,
    animationUrl: "",
    soundUrl: "",
    iconUrl: "",
  });
  await seedIfMissing("gifts/local-gift-2", {
    name: "Star",
    coinValue: 50,
    showInStore: true,
    showOnWheel: true,
    weight: 0.5,
    order: 1,
    animationUrl: "",
    soundUrl: "",
    iconUrl: "",
  });
  await seedIfMissing("gifts/local-gift-3", {
    name: "Diamond",
    coinValue: 200,
    showInStore: true,
    showOnWheel: false,
    weight: 0.1,
    order: 2,
    animationUrl: "",
    soundUrl: "",
    iconUrl: "",
  });

  // Coin package
  await seedIfMissing("coinPackages/local-pack-1", {
    coins: 100,
    bonusCoins: 0,
    productId: "local_100_coins",
    isActive: true,
    order: 0,
  });

  // Fun fact
  await seedIfMissing("funFacts/local-fact-1", {
    text: "ShyTalk was built with Kotlin Multiplatform!",
    isActive: true,
  });

  // MinIO bucket (only when MinIO is available)
  const minioEndpoint = process.env.MINIO_ENDPOINT || "http://localhost:9002";
  try {
    console.log("\nMinIO bucket:");
    const minioClient = new S3Client({
      endpoint: minioEndpoint,
      region: "us-east-1",
      credentials: {
        accessKeyId: process.env.MINIO_ROOT_USER || "minioadmin",
        secretAccessKey: process.env.MINIO_ROOT_PASSWORD || "minioadmin",
      },
      forcePathStyle: true,
    });
    const bucket = process.env.R2_BUCKET_NAME || "shytalk-media";
    try {
      await minioClient.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`  Created: ${bucket}`);
    } catch (err) {
      if (
        err.name === "BucketAlreadyOwnedByYou" ||
        err.name === "BucketAlreadyExists"
      ) {
        console.log(`  Exists:  ${bucket}`);
      } else {
        throw err;
      }
    }
    await minioClient.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: "*",
              Action: ["s3:GetObject"],
              Resource: [`arn:aws:s3:::${bucket}/*`],
            },
          ],
        }),
      }),
    );
    console.log(`  Policy:  public-read on ${bucket}`);
  } catch (err) {
    console.warn(
      "  MinIO not available, skipping bucket creation:",
      err.message,
    );
  }

  console.log("\nSeed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
