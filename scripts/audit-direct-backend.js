#!/usr/bin/env node
/**
 * Call-site inventory of every direct client→backend data access.
 *
 * `check-no-direct-backend.js` answers a different question: does this FILE
 * import the Firebase data SDK. That is the right shape for a ratchet — it is
 * cheap, stable, and hard to argue with — but it cannot tell you how much work
 * remediation is, or which sites are the hard ones.
 *
 * This answers the remediation question instead: every individual call, sorted
 * into the four buckets that decide how it gets migrated.
 *
 *   read      one-shot get       → an ordinary GET endpoint
 *   listen    live subscription  → SSE (SHY-0169), the architecturally hard set
 *   write     set/update/add     → an ordinary POST/PATCH endpoint
 *   delete    removal            → an ordinary DELETE endpoint
 *
 * Read-only static scan. Never executes what it reads. Deliberately reports
 * UNCLASSIFIED lines that look like SDK use but match no bucket, because a
 * silent miss in an audit is worse than a noisy one — the whole point is that
 * nothing is left out.
 *
 * Usage:
 *   node scripts/audit-direct-backend.js            # human summary
 *   node scripts/audit-direct-backend.js --json     # machine-readable
 *   node scripts/audit-direct-backend.js --file X   # one file, every hit
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

/** Client code only. express-api is the sanctioned server-side channel. */
const CLIENT_ROOTS = [
  /^app\/src\/main\//,
  /^shared\/src\/(androidMain|iosMain|commonMain)\//,
  /^public\//,
];

const SKIP = [
  /\/build\//,
  /node_modules/,
  /\/Pods\//,
  /Test\.kt$/,
  /androidTest/,
  /src\/test\//,
];

/**
 * Buckets, most specific first — a line matching several is counted once, as
 * the strongest thing it does. A listener that also reads is a listener; that
 * is what decides how it migrates.
 *
 * Split into STRONG and WEAK on purpose.
 *
 * A first version gated every bucket behind "the line also mentions firestore
 * or a collection", and reported ZERO live listeners on Android — against 42
 * real `addSnapshotListener` calls — because `addSnapshotListener {` on its own
 * line says neither. An audit that silently under-reports is worse than none:
 * it produces a number people plan around.
 *
 * STRONG markers are unambiguous by themselves (nothing but Firestore has an
 * `addSnapshotListener`). WEAK markers (`.get()`, `.set(`, `.delete()`) are
 * ordinary Kotlin and still need nearby SDK context to count.
 */
const BUCKETS = [
  {
    key: "listen",
    label: "live subscription (needs SSE)",
    strong:
      // `(?<!@)` matters: `return@addSnapshotListener` is a CONTINUATION inside
      // a listener block, not a second listener. Without it a four-line lambda
      // counts as three subscriptions and the hard set looks bigger than it is.
      /(?<!@)addSnapshotListener|(?<!@)addValueEventListener|(?<!@)addChildEventListener|onSnapshot\s*\(|\bvalueEvents\b|\bchildEvents\b|\.snapshots\b/,
    weak: null,
  },
  {
    key: "delete",
    label: "delete",
    strong: /deleteDoc\s*\(|removeValue\s*\(/,
    weak: /\.delete\s*\(\s*\)|\.remove\s*\(\s*\)/,
  },
  {
    key: "write",
    label: "write",
    // `batch.update(` and `transaction.update(` are unambiguous Firestore
    // idioms but their surrounding lines never say "firestore", so the context
    // window missed them — two real writes hiding in the unattributed pile.
    strong:
      /setDoc\s*\(|updateDoc\s*\(|addDoc\s*\(|setValue\s*\(|updateChildren\s*\(|runTransaction|onDisconnect\s*\(|\b(batch|transaction)\.(set|update|delete)\s*\(/,
    weak: /\.set\s*\(|\.update\s*\(|\.add\s*\(|\.batch\s*\(/,
  },
  {
    key: "read",
    label: "one-shot read",
    strong: /getDoc\s*\(|getDocs\s*\(/,
    weak: /\.get\s*\(\s*\)/,
  },
];

/**
 * Nearby SDK context for the WEAK markers.
 *
 * Kotlin chains across lines, so the collection/document that gives a `.get()`
 * its meaning is often several lines above. A window is used rather than the
 * single line — that mismatch is what left 171 lines unattributed before.
 */
/**
 * Lines that LOOK like weak markers but are ordinary collection/URL/state code.
 * Excluded so the residual "unattributed" count means something: after this,
 * what remains has been eyeballed and is not backend access.
 */
const BENIGN =
  /params\.set\s*\(|store\.set\s*\(|searchParams|\.add\s*\(\s*\w+\s*\)\s*;?\s*$|listener\.remove\s*\(|\bSet\s*\(|\bMap\s*\(|\b(tempFile|cacheFile|outFile|file)\.delete\s*\(/;

const SDK_NEARBY =
  /firestore|firebaseFirestore|rtdb|database\s*\(|collection\s*\(|document\s*\(|\.doc\s*\(|\.ref\s*\(|reference\s*\(|snapshot|DocumentSnapshot|CollectionReference|DatabaseReference/i;

const CONTEXT_WINDOW = 6;

/**
 * Files that RECEIVE the SDK rather than importing it.
 *
 * `public/admin/js/tabs/*.js` take their Firestore functions through
 * `deps.firestoreFns` and call them as `_onSnapshot(...)`, `_getDocs(...)`.
 * An import check cannot see that, and the first version of this audit
 * therefore reported ZERO call sites across three admin tabs that between them
 * make thirteen — including eight in spin-monitor.js.
 *
 * Injection is a perfectly ordinary way to hold an SDK, so an audit that only
 * looks for imports is an audit with a blind spot in it.
 */
const RECEIVES_DATA_SDK = /firestoreFns|firebaseFns|deps\.(firestore|db)\b/;

/** Files that import a Firebase DATA sdk — the ratchet's own question. */
const IMPORTS_DATA_SDK =
  /com\.google\.firebase\.(firestore|database|storage)|dev\.gitlive\.firebase\.(firestore|database|storage)|from ['"]firebase\/(firestore|database|storage)|getFirestore\s*\(|firebase\.(firestore|database|storage)\s*\(/;

function trackedFiles() {
  const res = spawnSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64e6,
  });
  if (res.status !== 0) throw new Error("git ls-files failed");
  return res.stdout.split("\0").filter(Boolean);
}

function inScope(rel) {
  if (SKIP.some((r) => r.test(rel))) return false;
  if (!/\.(kt|js|mjs|cjs)$/.test(rel)) return false;
  return CLIENT_ROOTS.some((r) => r.test(rel));
}

function platformOf(rel) {
  if (rel.startsWith("public/")) return "web";
  if (rel.includes("/iosMain/")) return "ios";
  if (rel.includes("/androidMain/") || rel.startsWith("app/src/"))
    return "android";
  return "common";
}

function serviceOf(text) {
  if (
    /database|rtdb|valueEvents|setValue|updateChildren|onDisconnect/i.test(text)
  )
    return "rtdb";
  if (/storage/i.test(text)) return "storage";
  return "firestore";
}

function audit() {
  const files = trackedFiles().filter(inScope);
  const out = [];

  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    let content;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!IMPORTS_DATA_SDK.test(content) && !RECEIVES_DATA_SDK.test(content))
      continue;

    const lines = content.split("\n");
    const hits = [];
    let unclassified = 0;

    const nearbyHasContext = (i) => {
      const from = Math.max(0, i - CONTEXT_WINDOW);
      const to = Math.min(lines.length, i + CONTEXT_WINDOW + 1);
      return SDK_NEARBY.test(lines.slice(from, to).join("\n"));
    };

    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*"))
        return;

      let bucket = BUCKETS.find((b) => b.strong && b.strong.test(trimmed));
      if (!bucket && BENIGN.test(trimmed)) return;
      if (!bucket) {
        const weak = BUCKETS.find((b) => b.weak && b.weak.test(trimmed));
        if (weak && nearbyHasContext(i)) bucket = weak;
        else if (weak) unclassified += 1;
      }
      if (bucket) {
        hits.push({
          line: i + 1,
          bucket: bucket.key,
          service: serviceOf(
            lines.slice(Math.max(0, i - CONTEXT_WINDOW), i + 1).join("\n"),
          ),
          text: trimmed.slice(0, 120),
        });
      }
    });

    if (hits.length || unclassified) {
      out.push({ file: rel, platform: platformOf(rel), hits, unclassified });
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const result = audit();

  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(result, null, 2));
    return;
  }

  const only = args.indexOf("--file");
  if (only !== -1) {
    const want = args[only + 1];
    const matched = result.filter((x) => x.file.includes(want));
    // Say so rather than printing nothing. Silence here reads as "this file
    // has no direct backend access", which is the same sentence a typo
    // produces — and this script exists on the principle that a silent miss in
    // an audit is worse than a noisy one.
    if (matched.length === 0) {
      console.log(
        `No audited file matches "${want}".\n` +
          "  Nothing was scanned for it — this is NOT a report of zero call sites.\n" +
          "  Paths are repo-relative and only client code is audited " +
          "(app/src/main, shared/src/{androidMain,iosMain,commonMain}, public).",
      );
      return;
    }
    for (const f of matched) {
      console.log(`\n${f.file}  (${f.platform})`);
      for (const h of f.hits) {
        console.log(
          `  ${String(h.line).padStart(5)}  ${h.bucket.padEnd(7)} ${h.service.padEnd(9)} ${h.text}`,
        );
      }
      if (f.unclassified)
        console.log(`  (+${f.unclassified} chained path lines)`);
    }
    return;
  }

  const totals = {};
  const byPlatform = {};
  for (const f of result) {
    byPlatform[f.platform] ??= {
      files: 0,
      read: 0,
      listen: 0,
      write: 0,
      delete: 0,
    };
    byPlatform[f.platform].files += 1;
    for (const h of f.hits) {
      totals[h.bucket] = (totals[h.bucket] || 0) + 1;
      byPlatform[f.platform][h.bucket] += 1;
    }
  }

  console.log("Direct client→backend call sites\n");
  console.log(`${"file".padEnd(72)} ${"plat".padEnd(8)} read listen write del`);
  console.log("-".repeat(104));
  for (const f of result.sort((a, b) => b.hits.length - a.hits.length)) {
    const c = { read: 0, listen: 0, write: 0, delete: 0 };
    for (const h of f.hits) c[h.bucket] += 1;
    console.log(
      `${f.file.replace(/^(app|shared|public)\//, "").padEnd(72)} ${f.platform.padEnd(8)} ` +
        `${String(c.read).padStart(4)} ${String(c.listen).padStart(6)} ${String(c.write).padStart(5)} ${String(c.delete).padStart(3)}`,
    );
  }
  console.log("-".repeat(104));
  console.log(`\nFILES: ${result.length}`);
  for (const [p, v] of Object.entries(byPlatform)) {
    console.log(
      `  ${p.padEnd(8)} files=${v.files}  read=${v.read} listen=${v.listen} write=${v.write} delete=${v.delete}`,
    );
  }
  console.log(
    `\nTOTAL call sites: ${Object.values(totals).reduce((a, b) => a + b, 0)}` +
      `  (read=${totals.read || 0} listen=${totals.listen || 0} write=${totals.write || 0} delete=${totals.delete || 0})`,
  );
  const unc = result.reduce((n, f) => n + f.unclassified, 0);
  if (unc) console.log(`Chained path lines not attributed to a call: ${unc}`);
}

if (require.main === module) main();
module.exports = { audit, BUCKETS };
