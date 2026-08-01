/**
 * Quoting for the shell that runs ON THE DEVICE.
 *
 * THERE ARE TWO SHELLS, AND THEY ARE EASY TO CONFUSE.
 *
 *   1. The HOST shell — only present if you build a command string and hand
 *      it to `execSync`. Using `execFileSync` with an argument array removes
 *      it entirely, and with it the whole command-injection surface.
 *
 *   2. The DEVICE shell — unavoidable. `adb shell X Y Z` does not pass X Y Z
 *      as argv. adb JOINS them with spaces and hands the resulting string to
 *      `/system/bin/sh` on the phone. Whatever follows `shell` is parsed by a
 *      shell no matter how the host invoked adb.
 *
 * The driver used to escape apostrophes for the HOST shell and stop there.
 * The host shell consumed that escaping, and the device shell then received a
 * bare apostrophe. Verified against the connected device on 2026-08-01:
 *
 *   adb -s … shell echo 'Selma'\''s%sroom'
 *   → /system/bin/sh: no closing quote
 *
 * So every journey step typing a name with an apostrophe — "Selma's room",
 * "O'Brien", "can't" — was already failing on the device, while the comment
 * above the escaping claimed to have fixed precisely that case. It was
 * describing the wrong shell.
 *
 * This module exists as its own file so the rule is unit-testable without a
 * phone. The previous version lived inside the driver factory, reachable only
 * by constructing a driver, so the only tests that existed re-implemented it
 * locally — and a test that carries its own copy of the logic passes happily
 * while production is broken.
 */

/**
 * Quote one argument so `/system/bin/sh` on the device receives it verbatim.
 *
 * Single quotes suppress every form of shell interpretation — `$VAR`,
 * backticks, `|`, `;`, `&`, globs — so only the single quote itself needs
 * handling. The POSIX idiom is to close the quoted run, emit an escaped
 * literal quote, and reopen: `'` becomes `'\''`.
 *
 * Round-tripped against the real device for apostrophes, spaces, `$HOME`,
 * backticks, pipes and semicolons.
 *
 * @param {unknown} arg
 * @returns {string} a single shell word
 */
function posixShellArg(arg) {
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

/**
 * The same rule, named for the caller that needs it most.
 *
 * Kept as an alias rather than a second implementation: CI-script tests
 * quote file lists for a HOST shell with the identical idiom, and two copies
 * of one escaping rule is how they drift — which is exactly what happened
 * between `escapeInputText` and `androidSearchIn`, where both copies were
 * wrong in the same way.
 */
const deviceShellArg = posixShellArg;

/**
 * Quote the arguments of an adb invocation, but ONLY the ones a device shell
 * will parse.
 *
 * `adb reverse tcp:3000 tcp:3000` is read by adb itself and must be passed
 * through untouched — quoting it would make adb look for a port literally
 * named `'tcp:3000'`.
 *
 * @param {string[]} args full adb argument list, e.g. ['shell', 'input', …]
 * @returns {string[]}
 */
function quoteAdbArgs(args) {
  if (!Array.isArray(args)) throw new TypeError('quoteAdbArgs: args must be an array');
  if (args[0] !== 'shell') return args.map(String);
  return ['shell', ...args.slice(1).map(deviceShellArg)];
}

module.exports = { deviceShellArg, posixShellArg, quoteAdbArgs };
