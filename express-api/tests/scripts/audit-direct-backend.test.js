/**
 * EPIC-0006 — the direct-backend call-site inventory.
 *
 * `check-no-direct-backend.js` is the ratchet: does this FILE import the
 * Firebase data SDK. This script answers the remediation question instead —
 * every individual CALL, sorted into the four buckets that decide how it gets
 * migrated. The numbers it produces are what the epic's plan is sized from, so
 * a miscount is a mis-scoped epic.
 *
 * It shipped with no tests at all. Nothing here is mocked: it is a read-only
 * static scan over the real repository, which is exactly what it does in
 * anger.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'audit-direct-backend.js');
const { audit, BUCKETS } = require(SCRIPT);

const NODE = process.execPath;
const runCli = (args) =>
  execFileSync(NODE, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32e6 });

let report;
beforeAll(() => {
  report = audit();
});

describe('the audit finds something to audit', () => {
  test('it reports files, and each carries the shape the summary reads', () => {
    // Non-vacuous first. An audit that scanned nothing would make every
    // assertion below pass while proving the opposite of what they claim.
    expect(Array.isArray(report)).toBe(true);
    expect(report.length).toBeGreaterThan(0);
    for (const entry of report) {
      expect(typeof entry.file).toBe('string');
      expect(typeof entry.platform).toBe('string');
      expect(Array.isArray(entry.hits)).toBe(true);
    }
  });

  test('there are real call sites, not just files', () => {
    const hits = report.flatMap((e) => e.hits);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('nothing is left out', () => {
  test('every hit lands in a declared bucket', () => {
    // The script sorts into four buckets because each implies a different
    // migration. A hit with a bucket nobody declared would be counted in the
    // total and absent from every plan.
    const declared = new Set(BUCKETS.map((b) => b.key));
    expect(declared.size).toBe(BUCKETS.length);

    const strays = [
      ...new Set(
        report.flatMap((e) => e.hits.map((h) => h.bucket)).filter((b) => !declared.has(b)),
      ),
    ];
    expect({ strays }).toEqual({ strays: [] });
  });

  test('unclassified lines are REPORTED, never silently dropped', () => {
    // The script's own stated principle: "a silent miss in an audit is worse
    // than a noisy one". That only holds if the field survives to the caller.
    // It is a COUNT, not a list — but it must reach the caller, and a file is
    // reported when it has hits OR unclassified lines, so a file that is
    // nothing BUT unclassified still appears rather than vanishing.
    for (const entry of report) {
      expect(entry).toHaveProperty('unclassified');
      expect(Number.isInteger(entry.unclassified)).toBe(true);
      expect(entry.unclassified).toBeGreaterThanOrEqual(0);
      expect(entry.hits.length + entry.unclassified).toBeGreaterThan(0);
    }
  });

  test('every hit names the line it was found on', () => {
    // The inventory is worked through by a human opening files. A hit without
    // a line number is a file to re-read rather than a site to fix.
    for (const hit of report.flatMap((e) => e.hits)) {
      expect(Number.isInteger(hit.line)).toBe(true);
      expect(hit.line).toBeGreaterThan(0);
    }
  });
});

describe('it audits the client, not the server', () => {
  test('express-api never appears — it is the sanctioned channel', () => {
    // The whole epic is about moving access BEHIND express-api. Counting
    // express-api's own Firestore use would inflate the remaining work with
    // the destination it is being moved to.
    const server = report.map((e) => e.file).filter((f) => f.startsWith('express-api/'));
    expect({ server }).toEqual({ server: [] });
  });

  test('every file scanned is client code', () => {
    const CLIENT = /^(app\/src\/main\/|shared\/src\/(androidMain|iosMain|commonMain)\/|public\/)/;
    const outside = report.map((e) => e.file).filter((f) => !CLIENT.test(f));
    expect({ outside }).toEqual({ outside: [] });
  });
});

describe('a listener continuation is not a second listener', () => {
  const listen = BUCKETS.find((b) => b.key === 'listen');

  test('the listen bucket exists and is the one under test', () => {
    expect(listen).toBeDefined();
    expect(listen.strong).toBeInstanceOf(RegExp);
  });

  test('`return@addSnapshotListener` does NOT count as a subscription', () => {
    // Documented in the script and worth pinning: it is a Kotlin CONTINUATION
    // inside a listener block. Counting it makes a four-line lambda look like
    // three subscriptions, and the architecturally hard set — the one SSE has
    // to absorb — looks bigger than it is.
    const re = new RegExp(listen.strong.source, listen.strong.flags);
    expect(re.test('return@addSnapshotListener')).toBe(false);
  });

  test('a real addSnapshotListener still counts', () => {
    // The other half. A guard that suppressed both would hide the hard set
    // entirely, which is the failure mode worth more than the false count.
    const re = new RegExp(listen.strong.source, listen.strong.flags);
    expect(re.test('ref.addSnapshotListener { snap, err ->')).toBe(true);
  });
});

describe('the command line', () => {
  test('--json emits parseable JSON with the same files the API returned', () => {
    const parsed = JSON.parse(runCli(['--json']));
    expect(parsed).toBeTruthy();
    const files = JSON.stringify(parsed);
    expect(files).toContain(report[0].file);
  });

  test('the human summary names every bucket, so none is invisible', () => {
    const out = runCli([]);
    for (const b of BUCKETS) {
      expect(out).toContain(b.key);
    }
  });

  test('--file narrows to one file', () => {
    const withHits = report.find((e) => e.hits.length > 0);
    expect(withHits).toBeDefined();
    const out = runCli(['--file', withHits.file]);
    expect(out).toContain(withHits.file);
  });

  test('--file with a path that does not exist says so rather than reporting nothing', () => {
    // Answering "0 call sites" to a typo is how an audit gets believed when it
    // has not looked anywhere.
    const missing = path.join('app', 'src', 'main', 'no-such-file-for-tests.kt');
    let out;
    try {
      out = runCli(['--file', missing]);
    } catch (err) {
      out = `${err.stdout || ''}${err.stderr || ''}`;
    }
    // Not just "some output": the distinction that matters is stated, so a
    // reader cannot mistake a typo for a clean file.
    expect(out).toContain(missing);
    expect(out.toLowerCase()).toContain('not a report of zero call sites');
  });
});

describe('it never executes what it reads', () => {
  test('a scanned file with a side effect in it is only read', () => {
    // The script is pointed at source trees it does not control. If it ever
    // required or evaluated a file instead of reading it, a scan would run
    // arbitrary code from the repository it is auditing.
    const marker = path.join(os.tmpdir(), `audit-side-effect-${process.pid}`);
    fs.rmSync(marker, { force: true });
    const planted = path.join(REPO_ROOT, 'public', 'audit-side-effect-probe.js');
    fs.writeFileSync(
      planted,
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n` +
        "firebase.firestore().collection('x').onSnapshot(() => {});\n",
    );
    try {
      audit();
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(planted, { force: true });
      fs.rmSync(marker, { force: true });
    }
  });
});
