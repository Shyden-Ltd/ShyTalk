/**
 * The working half of reset-local-journey-debris.sh — see that file for why.
 *
 * Reads ground truth from the emulator and clears it through the ADMIN API,
 * which is the same split the journey runner's own sweep uses: a test may read
 * directly, but nothing writes around the authorization layer.
 */
"use strict";

const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNNER = path.join(
  REPO_ROOT,
  "express-api",
  "scripts",
  "device-journey-runner.js",
);
const { personaUniqueId, getIdToken } = require(RUNNER);

const API = process.env.API || "http://localhost:3000";
const APPLY = process.env.APPLY === "1";
const ADMIN_PERSONA = "admin@shytalk.dev";

/** Personas the on-device journeys sign in as, and therefore must start clean. */
const JOURNEY_PERSONAS = [
  "adult-power@shytalk.dev",
  "minor-power@shytalk.dev",
  "lapsed-adult@shytalk.dev",
  "adult-prober@shytalk.dev",
  "harasser@shytalk.dev",
  "victim@shytalk.dev",
  "host@shytalk.dev",
  "admin@shytalk.dev",
];

async function main() {
  process.env.NODE_ENV = "local";
  const { db } = require(
    path.join(REPO_ROOT, "express-api", "src", "utils", "firebase"),
  );
  const token = await getIdToken(ADMIN_PERSONA);

  const uids = JOURNEY_PERSONAS.map((email) => ({
    email,
    uid: personaUniqueId(email),
  }));

  let ticketCount = 0;
  let suspendCount = 0;

  for (const { email, uid } of uids) {
    const open = await db
      .collection("supportTickets")
      .where("userId", "==", uid)
      .where("status", "==", "open")
      .get();
    if (open.size > 0) {
      console.log(`${email} (${uid}): ${open.size} open support ticket(s)`);
      for (const doc of open.docs) {
        const summary = String(doc.data().message || "").slice(0, 60);
        console.log(`   - ${summary}`);
        if (APPLY) {
          const r = await fetch(`${API}/api/support-tickets/${doc.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ status: "resolved" }),
          });
          if (!r.ok)
            throw new Error(`could not resolve ${doc.id}: ${r.status}`);
        }
        ticketCount += 1;
      }
    }

    const user = await db.doc(`users/${uid}`).get();
    if (user.exists && user.data().isSuspended === true) {
      console.log(
        `${email} (${uid}): SUSPENDED — a journey signing in as them will 403`,
      );
      if (APPLY) {
        const r = await fetch(`${API}/api/user/${uid}/unsuspend`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reason: "local journey debris reset" }),
        });
        if (!r.ok)
          throw new Error(
            `could not unsuspend ${uid}: ${r.status} ${await r.text()}`,
          );
      }
      suspendCount += 1;
    }
  }

  console.log(
    `\n${APPLY ? "Cleared" : "Would clear"}: ${ticketCount} open ticket(s), ` +
      `${suspendCount} suspension(s) across ${uids.length} journey personas.`,
  );
  if (!APPLY && ticketCount + suspendCount > 0) {
    console.log("Re-run with --apply to clear.");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
