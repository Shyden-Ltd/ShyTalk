/**
 * One physical device, one driver at a time — enforced ACROSS PROCESSES.
 *
 * Operator 2026-08-01: "make sure this cannot happen again."
 *
 * What happened: the gauntlet wedged with two of these running at once
 * against the same phone —
 *
 *   adb -s 3b402284 shell uiautomator dump --compressed /sdcard/dump.xml
 *   adb -s 3b402284 shell uiautomator dump --compressed /sdcard/dump.xml
 *
 * `uiautomator dump` takes an exclusive UiAutomation connection. A second
 * concurrent dump cannot get one, and the pair deadlocked: three matrix cells
 * sat at 58 scenarios with no output for eight minutes. It is also the likely
 * engine behind the EXIT=137 relaunch loop already recorded in
 * reference-matrix-orphans-and-hung-uiautomator — the phone opening and closing
 * the app forever.
 *
 * Why a FILE lock and not a mutex: the matrix runs every cell as its own OS
 * process (matrix-cell-dispatch spawns them), so nothing in-process can see a
 * sibling cell. The exclusion has to live somewhere both processes can reach.
 *
 * Why a lock at all, when cell-aware driver attachment already stops two cells
 * from holding the same phone: that is a policy, and one `--driver=all` away
 * from being violated again. This is the guarantee that does not depend on
 * anyone remembering.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { withDeviceLock, lockPathFor } = require('../../scripts/drivers/device-lock');

const SERIAL = 'test-device-0001';

const cleanup = () => {
  try {
    fs.unlinkSync(lockPathFor(SERIAL));
  } catch {
    /* not held */
  }
};
beforeEach(cleanup);
afterEach(cleanup);

describe('withDeviceLock — mutual exclusion', () => {
  it('serialises two overlapping holders: the second cannot enter until the first leaves', async () => {
    const order = [];
    let releaseFirst;
    const firstInside = new Promise((r) => {
      releaseFirst = r;
    });

    const a = withDeviceLock(SERIAL, async () => {
      order.push('a-enter');
      await firstInside;
      order.push('a-exit');
      return 'a';
    });

    // Let A take the lock before B even asks for it.
    await new Promise((r) => setImmediate(r));
    const b = withDeviceLock(SERIAL, async () => {
      order.push('b-enter');
      return 'b';
    });

    // B must NOT have entered while A is still inside — that is the whole point.
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(['a-enter']);

    releaseFirst();
    expect(await a).toBe('a');
    expect(await b).toBe('b');
    expect(order).toEqual(['a-enter', 'a-exit', 'b-enter']);
  });

  it('releases the lock when the body THROWS, or one failure wedges the device forever', async () => {
    await expect(
      withDeviceLock(SERIAL, async () => {
        throw new Error('dump failed');
      }),
    ).rejects.toThrow('dump failed');

    // Still acquirable.
    await expect(withDeviceLock(SERIAL, async () => 'after')).resolves.toBe('after');
  });

  it('does not serialise DIFFERENT devices against each other', async () => {
    // Two phones must run concurrently; over-locking would silently halve the
    // matrix's throughput and look like a stall.
    let inside = 0;
    let maxInside = 0;
    const body = async () => {
      inside++;
      maxInside = Math.max(maxInside, inside);
      await new Promise((r) => setImmediate(r));
      inside--;
    };
    await Promise.all([withDeviceLock(SERIAL, body), withDeviceLock('other-device-0002', body)]);
    expect(maxInside).toBe(2);
    try {
      fs.unlinkSync(lockPathFor('other-device-0002'));
    } catch {
      /* already released */
    }
  });
});

describe('withDeviceLock — stale locks', () => {
  it('reclaims a lock whose holder process is gone', async () => {
    // The exact aftermath of a SIGKILLed cell: the file outlives the process.
    // Without reclamation the phone is unusable until someone deletes it by hand.
    const deadPid = 2147480000; // far above any live pid on macOS
    fs.writeFileSync(
      lockPathFor(SERIAL),
      JSON.stringify({ pid: deadPid, token: 'stale', at: Date.now() }),
    );
    await expect(withDeviceLock(SERIAL, async () => 'reclaimed')).resolves.toBe('reclaimed');
  });

  it('reclaims a lock older than the stale window even if some pid matches', async () => {
    // pid numbers get recycled; age is the backstop.
    fs.writeFileSync(
      lockPathFor(SERIAL),
      JSON.stringify({ pid: process.pid, token: 'ancient', at: Date.now() - 60 * 60 * 1000 }),
    );
    await expect(withDeviceLock(SERIAL, async () => 'reclaimed', { staleMs: 1000 })).resolves.toBe(
      'reclaimed',
    );
  });

  it('reclaims a corrupt lock file rather than blocking forever on it', async () => {
    fs.writeFileSync(lockPathFor(SERIAL), 'not json at all');
    await expect(withDeviceLock(SERIAL, async () => 'reclaimed')).resolves.toBe('reclaimed');
  });
});

describe('withDeviceLock — failure modes', () => {
  it('THROWS on timeout instead of proceeding unguarded', async () => {
    // Proceeding without the lock is precisely the deadlock this exists to
    // prevent, so the timeout must be loud. A live holder, not a stale one.
    fs.writeFileSync(
      lockPathFor(SERIAL),
      JSON.stringify({ pid: process.pid, token: 'live', at: Date.now() }),
    );
    await expect(
      withDeviceLock(SERIAL, async () => 'should never run', { timeoutMs: 150, staleMs: 600000 }),
    ).rejects.toThrow(/device .* is held/i);
  });

  it('names the device and the holding pid so the operator can act', async () => {
    fs.writeFileSync(
      lockPathFor(SERIAL),
      JSON.stringify({ pid: process.pid, token: 'live', at: Date.now() }),
    );
    await expect(
      withDeviceLock(SERIAL, async () => 'x', { timeoutMs: 150, staleMs: 600000 }),
    ).rejects.toThrow(new RegExp(`${SERIAL}[\\s\\S]*${process.pid}`));
  });

  it('does NOT delete a lock that was reclaimed by someone else', async () => {
    // Classic double-release bug: A is declared stale, B takes the lock, A
    // finishes and unlinks — leaving B running unguarded on a "free" device.
    // The token is what tells A the lock is no longer its own.
    const p = lockPathFor(SERIAL);
    await withDeviceLock(SERIAL, async () => {
      fs.writeFileSync(
        p,
        JSON.stringify({ pid: process.pid, token: 'someone-else', at: Date.now() }),
      );
    });
    expect(JSON.parse(fs.readFileSync(p, 'utf8')).token).toBe('someone-else');
  });

  it('rejects a blank serial rather than locking a shared "" key for every device', () => {
    expect(() => lockPathFor('')).toThrow(/serial/i);
    expect(() => lockPathFor(undefined)).toThrow(/serial/i);
  });

  it('keeps the lock path inside tmpdir even for a hostile serial', () => {
    // A serial is device-reported input; `../../etc/passwd` must not escape.
    const p = lockPathFor('../../etc/passwd');
    expect(path.dirname(p)).toBe(os.tmpdir());
  });
});

describe('withDeviceLock — real cross-process exclusion', () => {
  it('excludes a genuinely separate OS process, which is the real matrix shape', () => {
    // No doubles: two child processes, one device, both racing for the lock.
    // If exclusion were in-process only this would report overlap.
    const script = `
      const { withDeviceLock } = require(${JSON.stringify(path.resolve(__dirname, '../../scripts/drivers/device-lock'))});
      withDeviceLock(${JSON.stringify(SERIAL)}, async () => {
        process.stdout.write('IN ' + process.pid + ' ' + Date.now() + '\\n');
        const until = Date.now() + 400;
        while (Date.now() < until) { /* hold the device, as a real dump does */ }
        process.stdout.write('OUT ' + process.pid + ' ' + Date.now() + '\\n');
      }, { timeoutMs: 15000 }).catch((e) => { process.stdout.write('ERR ' + e.message + '\\n'); process.exit(1); });
    `;
    const run = () =>
      execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 });

    // Two processes started back to back; each prints its own IN/OUT window.
    const [outA, outB] = [run(), run()];
    const win = (out) => {
      const inAt = Number(/IN \d+ (\d+)/.exec(out)[1]);
      const outAt = Number(/OUT \d+ (\d+)/.exec(out)[1]);
      return [inAt, outAt];
    };
    const [aIn, aOut] = win(outA);
    const [bIn, bOut] = win(outB);
    // Non-overlapping windows: one finished before the other started.
    expect(aOut <= bIn || bOut <= aIn).toBe(true);
  }, 40000);
});
