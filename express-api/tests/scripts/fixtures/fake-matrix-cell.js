/**
 * fake-matrix-cell.js — real subprocess fixture for matrix-cell-dispatch tests.
 *
 * Stands in for the per-cell runner invocation (a REAL spawned Node
 * process, not an in-process double). Behaviour is driven by env vars
 * so the dispatcher under test passes ordinary argv:
 *
 *   FAKE_CELL_EXIT             exit code (default 0)
 *   FAKE_CELL_SLEEP_MS         delay before exiting
 *   FAKE_CELL_STDOUT           string written to stdout
 *   FAKE_CELL_STDERR           string written to stderr
 *   FAKE_CELL_ECHO_ARGV_FILE   write { argv, browser, probe } JSON here
 *   FAKE_CELL_PROBE            echoed into the argv-file (env-plumbing proof)
 *   FAKE_CELL_HANDSHAKE_DIR    enables handshake mode (see below)
 *   FAKE_CELL_PEERS            comma-separated browser slugs in the handshake
 *   FAKE_CELL_HANDSHAKE_TIMEOUT_MS  poll budget (default 4000)
 *
 * Handshake mode: the cell writes `<own-browser>.marker` into the dir,
 * then polls until every OTHER peer's marker exists. Exit 0 when all
 * seen; exit 7 on poll timeout. Two cells dispatched by a BLOCKING
 * (spawnSync-style) loop deadlock — the first cell exits 7 because its
 * peer is never spawned while it lives. Only a truly concurrent
 * dispatcher lets both exit 0.
 */
const fs = require('fs');
const path = require('path');

function browserFromArgv(argv) {
  let browser = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--browser') browser = argv[i + 1];
  }
  return browser;
}

async function main() {
  const argv = process.argv.slice(2);
  const browser = browserFromArgv(argv);

  if (process.env.FAKE_CELL_ECHO_ARGV_FILE) {
    fs.writeFileSync(
      process.env.FAKE_CELL_ECHO_ARGV_FILE,
      JSON.stringify({ argv, browser, probe: process.env.FAKE_CELL_PROBE || null }),
    );
  }
  if (process.env.FAKE_CELL_STDOUT) process.stdout.write(process.env.FAKE_CELL_STDOUT);
  if (process.env.FAKE_CELL_STDERR) process.stderr.write(process.env.FAKE_CELL_STDERR);

  if (process.env.FAKE_CELL_HANDSHAKE_DIR) {
    const dir = process.env.FAKE_CELL_HANDSHAKE_DIR;
    const peers = String(process.env.FAKE_CELL_PEERS || '')
      .split(',')
      .filter(Boolean)
      .filter((p) => p !== browser);
    fs.writeFileSync(path.join(dir, `${browser}.marker`), 'up');
    const budget = parseInt(process.env.FAKE_CELL_HANDSHAKE_TIMEOUT_MS || '4000', 10);
    const t0 = Date.now();
    while (Date.now() - t0 < budget) {
      if (peers.every((p) => fs.existsSync(path.join(dir, `${p}.marker`)))) {
        process.exit(0);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    process.exit(7);
  }

  const sleepMs = parseInt(process.env.FAKE_CELL_SLEEP_MS || '0', 10);
  if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  process.exit(parseInt(process.env.FAKE_CELL_EXIT || '0', 10));
}

main();
